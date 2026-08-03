import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, getListStationsNowPlayingQueryKey } from "@workspace/api-client-react";
import { toast } from "../hooks/use-toast";

// ---------------------------------------------------------------------------
// Recovery hint — shown once after the 3rd Keep to nudge linking a service.
// Dismissed state lives in localStorage with a 30-day TTL so it stays out of
// identity data and remains safely disposable.
// ---------------------------------------------------------------------------

export interface MeConnection {
  service: string;
  canWrite: boolean;
  connectedAt: string;
  lastImportAt: string | null;
}

export interface ReplayPlaylistTarget {
  service: "apple_music" | "tidal";
  displayName: string;
  connected: boolean;
  canWrite: boolean;
  configured: boolean;
  authRequired: boolean;
}
export interface LibraryRecording {
  title: string;
  artist: string;
  artworkUrl: string | null;
  albumTitle: string | null;
  /** Spotify track URL from Odesli resolution, when available. */
  spotifyUrl: string | null;
}

export interface LibraryProvenance {
  kind: string;
  service?: string;
  stationSlug?: string;
  /** Display name of the station (joined from spins → stations) */
  stationName?: string;
  pickerHandle?: string;
  /** Display name of the picker/DJ (joined from spins → pickers) */
  pickerName?: string;
}

export interface LibraryItem {
  /** MusicBrainz recording ID. Null for unresolved soft rows (Spotify import). */
  mbid: string | null;
  provenance: LibraryProvenance;
  addedAt: string;
  recording: LibraryRecording | null;
  /**
   * True for tracks that could not be matched to a MusicBrainz MBID during
   * import.  Stored in `spotify_library_items`; shown with Spotify artwork
   * and a provenance badge.  A nightly retry may later resolve them and
   * promote to `library_items`.
   */
  soft?: boolean;
  /** Spotify track ID, populated on soft rows. */
  spotifyId?: string | null;
  /**
   * True when the track was matched via MusicBrainz scored text search
   * (Tier 3 / "text" resolution tier).  Shown as a "(fuzzy match)" badge so
   * users can verify the result.
   */
  fuzzyMatch?: boolean;
}

export interface ImportJobStatus {
  jobId: number;
  service: string;
  status: "pending" | "running" | "done" | "error";
  /** Worker phase: "fetching" | "spine" | "cache" | "resolve" | null */
  phase: "fetching" | "spine" | "cache" | "resolve" | null;
  total: number;
  resolved: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  /**
   * Set when the job skipped the Spotify fetch and resumed from a prior job's
   * stored buffer (complete-buffer resume path). The value is the id of that
   * prior job. The UI uses this to show "Resuming from previous session…"
   * instead of "Fetching your library…".
   */
  resumedFrom: number | null;
  /**
   * Number of tracks that could not be matched to a MusicBrainz MBID.
   * Only populated when `status === "done"`.  The nightly retry pass will
   * attempt to resolve these overnight.
   */
  unresolvedCount?: number;
  /**
   * A sample of up to 50 unresolved tracks (raw artist + title strings) so the
   * Library page can render a dismissable review section without a second
   * request.  Only populated when `status === "done"` and `unresolvedCount > 0`.
   */
  unresolvedSample?: Array<{ rawArtist: string; rawTitle: string }>;
}

export interface OverlapPicker {
  picker: {
    name: string;
    handle: string;
    pickerType: string;
    trustTier: number;
  };
  sharedCount: number;
}

export interface OverlapStation {
  station: { slug: string; name: string; stationClass: string };
  sharedCount: number;
}

export interface OverlapRun {
  runId: number;
  day: string;
  station: { slug: string; name: string; stationClass: string };
  show: { name: string; djName: string | null } | null;
  owned: number;
  discover: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Thin fetch wrapper: throws ApiError on non-ok responses. */
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res, data, { method: options?.method?.toUpperCase() ?? "GET", url });
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return null as T;
  }
  return res.json() as Promise<T>;
}

/** Fetch that returns null on 401 (unauthenticated) instead of throwing. */
async function fetchOrNull<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    return await apiFetch<T>(url, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** Start the Spotify Library OAuth flow. Opens in a new tab so it works
 *  both in iframe embeds (canvas preview, Replit) and direct browser visits.
 *  The window must be opened synchronously while the browser still has a
 *  trusted user-gesture context — an async gap before window.open causes
 *  mobile browsers (and most desktop ones) to block the popup silently. */
export async function startSpotifyLibraryConnect(): Promise<void> {
  // Open a blank tab immediately (synchronous, still within the gesture).
  // NOTE: do NOT pass "noopener" — it causes window.open() to return null,
  // which means we can never navigate the popup to the auth URL.
  const win = window.open("", "_blank");
  try {
    const res = await apiFetch<{ url: string }>("/api/me/connect/spotify/start", {
      method: "POST",
    });
    if (win) win.location.href = res.url;
  } catch (err) {
    // If the fetch fails close the blank tab so the user isn't left with one.
    if (win) win.close();
    throw err;
  }
}

/**
 * Reconnect Spotify with write scope — forces Spotify's consent screen so the
 * user can grant user-library-modify when they connected before it was added.
 * Same popup pattern as startSpotifyLibraryConnect.
 */
export async function startSpotifyLibraryReconnect(): Promise<void> {
  const win = window.open("", "_blank");
  try {
    const res = await apiFetch<{ url: string }>("/api/me/connect/spotify/start?scopes=write", {
      method: "POST",
    });
    if (win) win.location.href = res.url;
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

/** Start a library import. Returns the job id on success. */
export async function postStartImport(service: string): Promise<{ jobId: number; status: string }> {
  return apiFetch<{ jobId: number; status: string }>(
    `/api/me/library/import?service=${encodeURIComponent(service)}`,
    { method: "POST" },
  );
}

/** Start a manual track-list import (CSV/paste). No service connection required. */
export async function postStartManualImport(
  tracks: Array<{ artist: string; title: string }>,
): Promise<{ jobId: number; status: string }> {
  return apiFetch<{ jobId: number; status: string }>(
    "/api/me/library/import/manual",
    { method: "POST", body: JSON.stringify({ tracks }), headers: { "Content-Type": "application/json" } },
  );
}

export interface LibraryImageTrack {
  artist: string;
  title: string;
  confidence: number;
}

export interface LibraryImageExtractionResult {
  index: number;
  status: "ok" | "error";
  tracks?: LibraryImageTrack[];
  error?: string;
}

/** Extract rows from transient screenshot bytes; image data is never persisted. */
export async function postExtractLibraryImages(
  images: Array<{ mediaType: string; data: string }>,
): Promise<{ results: LibraryImageExtractionResult[] }> {
  return apiFetch<{ results: LibraryImageExtractionResult[] }>("/api/me/library/extract-images", {
    method: "POST",
    body: JSON.stringify({ images }),
  });
}

/**
 * Start a ListenBrainz loved-recordings import.
 * Validates the username against the LB API before creating a job (returns 400
 * with a clear message if the user doesn't exist).
 * No service connection required — the LB API is public.
 */
export async function postStartListenBrainzImport(
  username: string,
): Promise<{ jobId: number; status: string }> {
  return apiFetch<{ jobId: number; status: string }>(
    "/api/me/library/import/listenbrainz",
    { method: "POST", body: JSON.stringify({ username }), headers: { "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Sync (push Lore library → Spotify)
// ---------------------------------------------------------------------------

export interface SyncReceiptItem {
  mbid: string;
  title: string;
  artist: string;
}

export interface SyncReceiptUnavailableItem extends SyncReceiptItem {
  bandcampUrl: string;
}

export interface SyncReceiptSearchItem extends SyncReceiptItem {
  spotifyUrl: string;
}

export interface SyncReceipt {
  synced: number;
  searchMatched: number;
  alreadySaved: number;
  unavailable: number;
  unavailableItems: SyncReceiptUnavailableItem[];
  searchMatchedItems: SyncReceiptSearchItem[];
}

export interface SyncJobStatus {
  jobId: number;
  service: string;
  status: string;
  phase: string | null;
  total: number;
  processed: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  results: SyncReceipt | null;
  /**
   * Set when this job resumed from a prior interrupted job's committed offset.
   * The UI uses this to show "Resuming…" instead of the plain phase label.
   */
  resumedFrom: number | null;
}

export const ME_LATEST_SYNC_JOB_KEY = ["me", "sync-job", "latest"] as const;
export const ME_SYNC_JOB_KEY = (jobId: number) => ["me", "sync-job", jobId] as const;

export async function postStartSync(service = "spotify"): Promise<{ jobId: number; status: string }> {
  return apiFetch<{ jobId: number; status: string }>(
    `/api/me/library/sync?service=${encodeURIComponent(service)}`,
    { method: "POST" },
  );
}

export function useLatestSyncJob() {
  return useQuery({
    queryKey: ME_LATEST_SYNC_JOB_KEY,
    queryFn: () => fetchOrNull<SyncJobStatus>("/api/me/library/sync"),
    refetchInterval: (query) => {
      const data = query.state.data as SyncJobStatus | null | undefined;
      if (!data) return false;
      if (data.status === "done" || data.status === "error") return false;
      return 2_000;
    },
    staleTime: 0,
    retry: false,
  });
}

export function useSyncJob(jobId: number | null) {
  return useQuery({
    queryKey: ME_SYNC_JOB_KEY(jobId ?? 0),
    queryFn: () => apiFetch<SyncJobStatus>(`/api/me/library/sync/${jobId}`),
    enabled: jobId != null,
    refetchInterval: (query) => {
      const data = query.state.data as SyncJobStatus | null | undefined;
      if (!data) return false;
      if (data.status === "done" || data.status === "error") return false;
      return 2_000;
    },
    staleTime: 0,
    retry: false,
  });
}

export interface FileImportSummary {
  imported: number;
  skipped: number;
  rejected: number;
  errors: Array<{ index: number; reason: string }>;
}

/** Import a `lore.library.v1` JSON export file (parsed client-side). */
export async function postImportLibraryFile(body: unknown): Promise<FileImportSummary> {
  return apiFetch<FileImportSummary>("/api/me/library/import/file", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const ME_CONNECTIONS_KEY = ["me", "connections"] as const;
export const ME_LIBRARY_KEY = (cursor?: string) => ["me", "library", cursor ?? "start"] as const;
export const ME_KEEP_STATUS_KEY = (joined: string) => ["me", "keep-status", joined] as const;
export const ME_OVERLAP_PICKERS_KEY = ["me", "overlaps", "pickers"] as const;
export const ME_OVERLAP_STATIONS_KEY = ["me", "overlaps", "stations"] as const;
export const ME_OVERLAP_RUNS_KEY = ["me", "overlaps", "runs"] as const;
export const ME_OVERLAP_SELECTORS_KEY = ["me", "overlaps", "selectors"] as const;
export const ME_PICKER_OVERLAP_KEY = ["me", "pickers", "overlap"] as const;

export const ME_GHOST_MISSED_KEY = ["me", "ghost", "missed"] as const;
export interface OverlapSelector {
  selector: { name: string; handle: string };
  sharedCount: number;
}
export const ME_IMPORT_JOB_KEY = (jobId: number) => ["me", "import-job", jobId] as const;
export const ME_LATEST_IMPORT_JOB_KEY = ["me", "import-job", "latest"] as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** List of service connections (null = not authenticated). */
export function useMyConnections() {
  return useQuery({
    queryKey: ME_CONNECTIONS_KEY,
    queryFn: () =>
      fetchOrNull<{ connections: MeConnection[] }>("/api/me/connections").then(
        (d) => d?.connections ?? null,
      ),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** Derived: is the user authenticated (has a session)?  */
export function useIsAuthenticated(): boolean | null {
  const { data, isLoading } = useMyConnections();
  if (isLoading) return null;
  return data !== null;
}

/** Whether Spotify library is connected. */
export function useSpotifyLibraryConnected(): boolean {
  const { data } = useMyConnections();
  return Array.isArray(data) && data.some((c) => c.service === "spotify");
}

/** All resolved MBIDs in the user's library — no pagination cap. */
export const ME_LIBRARY_MBIDS_KEY = ["me", "library", "mbids"] as const;

export const ME_PICKER_NAMES_KEY = ["me", "picker-names"] as const;
export const ME_DIAL_CROSSINGS_KEY = (date: string) =>
  ["me", "crossings", date] as const;
export const ME_TASTE_SEEDS_KEY = ["me", "taste-seeds"] as const;
export const ME_MATT_STARTER_LIBRARY_KEY = ["me", "library", "matt-starter"] as const;

export interface MattStarterLibraryStatus {
  available: boolean;
  addedCount: number;
  totalCount: number;
}

export interface MattStarterLibraryCopy extends MattStarterLibraryStatus {
  error?: string;
}

export function useMattStarterLibrary() {
  return useQuery({
    queryKey: ME_MATT_STARTER_LIBRARY_KEY,
    queryFn: () => fetchOrNull<MattStarterLibraryStatus>("/api/me/library/starter"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useStartMattLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<MattStarterLibraryCopy>("/api/me/library/starter", { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(ME_MATT_STARTER_LIBRARY_KEY, data);
      const today = new Date().toISOString().slice(0, 10);
      void queryClient.invalidateQueries({ queryKey: ["me", "library"] });
      void queryClient.invalidateQueries({ queryKey: ME_LIBRARY_MBIDS_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_PICKER_NAMES_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_DIAL_CROSSINGS_KEY(today) });
      void queryClient.invalidateQueries({ queryKey: ME_PICKER_OVERLAP_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_OVERLAP_PICKERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_OVERLAP_STATIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_OVERLAP_RUNS_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_GHOST_MISSED_KEY });
      void queryClient.invalidateQueries({ queryKey: getListStationsNowPlayingQueryKey() });
    },
  });
}

export interface DialCrossing {
  stationSlug: string;
  crossings: number;
  artistCrossings: number;
  lifetimeCrossings: number;
  lifetimeArtistCrossings: number;
}

/**
 * Picker display names whose curated tracks overlap the listener's library.
 * Used by the Dial to mark picker shows without downloading the full MBID list.
 * Returns `{ names: [], hasLibrary: false, hasSeeds: false }` when unauthenticated
 * or library is empty.
 */
export function useMyPickerNames() {
  return useQuery({
    queryKey: ME_PICKER_NAMES_KEY,
    queryFn: () =>
      fetchOrNull<{ names: string[]; hasLibrary: boolean; hasSeeds: boolean }>(
        "/api/me/picker-names",
      ).then((d) => d ?? { names: [], hasLibrary: false, hasSeeds: false }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Taste seeds — zero-friction artist-name onboarding
// ---------------------------------------------------------------------------

/**
 * Read the current taste seeds for this session.
 * Returns an empty array if the user has no seeds yet.
 */
export function useMyTasteSeeds() {
  return useQuery({
    queryKey: ME_TASTE_SEEDS_KEY,
    queryFn: () =>
      fetchOrNull<{ artists: string[] }>("/api/me/taste-seeds").then(
        (d) => d?.artists ?? [],
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Replace the full seed list.  After a successful write the seeds query is
 * updated in place and the crossings query is invalidated so Zone 1 refreshes
 * without a page reload.
 */
export function useSetTasteSeeds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (artists: string[]) =>
      apiFetch<{ artists: string[] }>("/api/me/taste-seeds", {
        method: "PUT",
        body: JSON.stringify({ artists }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(ME_TASTE_SEEDS_KEY, data.artists);
      const today = new Date().toISOString().slice(0, 10);
      void queryClient.invalidateQueries({ queryKey: ME_DIAL_CROSSINGS_KEY(today) });
      void queryClient.invalidateQueries({ queryKey: ME_PICKER_NAMES_KEY });
      // The authenticated now-playing response carries per-listener artist-hit
      // flags. Refresh it with crossings so a newly selected seed is visible
      // on the live dial without waiting for the 30s poll.
      void queryClient.invalidateQueries({ queryKey: getListStationsNowPlayingQueryKey() });
    },
  });
}
/**
 * Server-computed station crossing scores for the rolling 24-hour window.
 * Results are cacheable for 5 minutes; two clients always agree on the same
 * ranking instead of diverging based on fetch timing.
 */
export function useMyDialCrossings(date: string) {
  return useQuery({
    queryKey: ME_DIAL_CROSSINGS_KEY(date),
    queryFn: () =>
      fetchOrNull<{ items: DialCrossing[] }>(
        `/api/me/crossings?date=${encodeURIComponent(date)}`,
      ).then((d) => d?.items ?? []),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

export function useMyLibraryMbids() {
  return useQuery({
    queryKey: ME_LIBRARY_MBIDS_KEY,
    queryFn: () =>
      fetchOrNull<{
        mbids: string[];
        releaseGroupMbids: string[];
        artistMbids: string[];
        softArtists: string[];
      }>("/api/me/library/mbids").then((d) => ({
        mbids: d?.mbids ?? [],
        releaseGroupMbids: d?.releaseGroupMbids ?? [],
        artistMbids: d?.artistMbids ?? [],
        softArtists: d?.softArtists ?? [],
      })),
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Server-side library search: fetches `/api/me/library?q=<term>&source=keep`
 * so results span the full library, not just already-loaded pages.
 * Returns an empty list when unauthenticated or query is blank.
 */
export function useMyLibrarySearch(
  q: string,
  options: { enabled?: boolean; limit?: number } = {},
) {
  const { enabled = true, limit = 6 } = options;
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["me", "library", "search", trimmed, limit] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("q", trimmed);
      params.set("source", "keep");
      params.set("limit", String(limit));
      return fetchOrNull<{ items: LibraryItem[]; nextCursor: string | null }>(
        `/api/me/library?${params}`,
      ).then((d) => d?.items ?? []);
    },
    enabled: enabled && trimmed.length > 0,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Paginated kept+imported library items, newest first.
 * Returns an empty list when unauthenticated.
 */
export function useMyLibrary(cursor?: string, limit = 50) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));

  return useQuery({
    queryKey: ME_LIBRARY_KEY(cursor),
    queryFn: () =>
      fetchOrNull<{ items: LibraryItem[]; nextCursor: string | null }>(
        `/api/me/library?${params}`,
      ).then((d) => d ?? { items: [], nextCursor: null }),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Infinite-scrolling variant of the library list. Pages via the API's
 * addedAt cursor until nextCursor comes back null. Unauthenticated users
 * get a single empty page.
 */
export interface LibraryQueryOptions {
  /** Case-insensitive substring match on title or artist. */
  q?: string;
  /** "added" (default, newest first) | "artist" | "title" (A→Z). */
  sort?: "added" | "artist" | "title";
  /** Filter by provenance kind: "keep" | "import" | "soft" | "critic". */
  source?: "keep" | "import" | "soft" | "critic" | "";
}

export function useMyLibraryInfinite(opts: LibraryQueryOptions = {}, limit = 50) {
  const q = opts.q?.trim() ?? "";
  const sort = opts.sort ?? "added";
  const source = opts.source ?? "";

  return useInfiniteQuery({
    queryKey: ["me", "library", "infinite", limit, q, sort, source] as const,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", String(limit));
      if (q) params.set("q", q);
      if (sort !== "added") params.set("sort", sort);
      if (source) params.set("source", source);
      return fetchOrNull<{ items: LibraryItem[]; nextCursor: string | null; total?: number; keepCount?: number; softCount?: number; criticCount?: number }>(
        `/api/me/library?${params}`,
      ).then((d) => d ?? { items: [], nextCursor: null });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Stable import-scoped counts for the "X of Y from Spotify matched" stat.
 * Always scoped to source=import so the numbers don't change with whatever
 * filter the user has active in the Library view.
 * Returns null when unauthenticated or no import has been run yet.
 */
export function useMyImportStats() {
  return useQuery({
    queryKey: ["me", "library", "import-stats"] as const,
    queryFn: () =>
      fetchOrNull<{ items: LibraryItem[]; nextCursor: string | null; total?: number; softCount?: number }>(
        "/api/me/library?source=import&limit=1",
      ).then((d) => {
        if (d == null) return null;
        return { total: d.total ?? 0, softCount: d.softCount ?? 0 };
      }),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Batch kept-status check for a list of MBIDs.
 * Returns a Set of kept MBIDs; empty when unauthenticated or mbids is empty.
 */
export function useMyKeepStatus(mbids: string[]) {
  const sorted = [...mbids].sort();
  const joined = sorted.join(",");

  return useQuery({
    queryKey: ME_KEEP_STATUS_KEY(joined),
    queryFn: () =>
      fetchOrNull<{ kept: string[] }>(`/api/me/keep/status?mbids=${encodeURIComponent(joined)}`).then(
        (d) => new Set(d?.kept ?? []),
      ),
    enabled: mbids.length > 0,
    staleTime: 30_000,
    retry: false,
  });
}

/** Keep a recording (upsert into library + mirror to Spotify). */
export function useMutationKeep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      mbid,
      spinId,
      provenance,
    }: {
      mbid: string;
      /** Spin the keep came from, when known — links the save to real air history. */
      spinId?: number | null;
      provenance?: Partial<LibraryProvenance>;
    }) =>
      apiFetch<{ keptToLore: boolean; mirrors: unknown[]; showRecoveryHint?: boolean }>(
        "/api/me/keep",
        {
          method: "POST",
          body: JSON.stringify({ mbid, ...(spinId != null ? { spinId } : {}), provenance }),
        },
      ),
    onSuccess: (data, { mbid }) => {
      maybeShowRecoveryHint(data.showRecoveryHint);
      // Optimistically update all keep-status query caches that include this mbid.
      queryClient.setQueriesData<Set<string>>(
        { queryKey: ["me", "keep-status"] },
        (prev) => {
          if (!prev) return new Set([mbid]);
          return new Set([...prev, mbid]);
        },
      );
      // Prefix match: covers both the single-page and infinite library queries.
      void queryClient.invalidateQueries({ queryKey: ["me", "library"] });
    },
  });
}

/**
 * Save an unresolved (or just-resolved) spin by its DB id.
 * Writes to pending_keeps; also to library_items if the spin has an MBID.
 */
export function useMutationKeepSpin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      spinId,
      provenance,
    }: {
      spinId: number;
      provenance?: Partial<LibraryProvenance>;
    }) =>
      apiFetch<{
        keptToLore: boolean;
        pendingKept: boolean;
        mirrors: unknown[];
        showRecoveryHint?: boolean;
      }>("/api/me/keep", {
        method: "POST",
        body: JSON.stringify({ spinId, provenance }),
      }),
    onSuccess: (data, { spinId }) => {
      maybeShowRecoveryHint(data.showRecoveryHint);
      queryClient.setQueriesData<{ saved: Set<number>; pending: Set<number> }>(
        { queryKey: ["me", "pending-keep-status"] },
        (prev) => {
          const saved = new Set(prev?.saved ?? []);
          const pending = new Set(prev?.pending ?? []);
          if (data.keptToLore) saved.add(spinId);
          else pending.add(spinId);
          return { saved, pending };
        },
      );
    },
  });
}

/** Remove a spin-based save (pending or promoted). */
export function useMutationUnkeepSpin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (spinId: number) =>
      apiFetch<null>(`/api/me/keep/spin/${spinId}`, { method: "DELETE" }),
    onSuccess: (_data, spinId) => {
      queryClient.setQueriesData<{ saved: Set<number>; pending: Set<number> }>(
        { queryKey: ["me", "pending-keep-status"] },
        (prev) => {
          const saved = new Set(prev?.saved ?? []);
          const pending = new Set(prev?.pending ?? []);
          saved.delete(spinId);
          pending.delete(spinId);
          return { saved, pending };
        },
      );
    },
  });
}

/**
 * Batch spin save-state check.
 * Returns two Sets: `saved` (promoted to library) and `pending` (unresolved saves).
 */
export function useMySpinKeepStatus(spinIds: number[]) {
  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;
  const joined = [...spinIds].sort((a, b) => a - b).join(",");

  return useQuery({
    queryKey: ["me", "pending-keep-status", joined],
    queryFn: () =>
      fetchOrNull<{ savedSpinIds: number[]; pendingSpinIds: number[] }>(
        `/api/me/keep/pending-status?spinIds=${encodeURIComponent(joined)}`,
      ).then((d) => ({
        saved: new Set(d?.savedSpinIds ?? []),
        pending: new Set(d?.pendingSpinIds ?? []),
      })),
    enabled: isAuthenticated && spinIds.length > 0,
    staleTime: 30_000,
    retry: false,
  });
}

/** Remove a recording from the library. */
export function useMutationUnkeep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mbid: string) =>
      apiFetch<null>(`/api/me/keep/${encodeURIComponent(mbid)}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, mbid) => {
      queryClient.setQueriesData<Set<string>>(
        { queryKey: ["me", "keep-status"] },
        (prev) => {
          if (!prev) return new Set();
          const next = new Set(prev);
          next.delete(mbid);
          return next;
        },
      );
      void queryClient.invalidateQueries({ queryKey: ["me", "library"] });
    },
  });
}

/** Poll an import job's progress. Stops when status === 'done' | 'error'. */
export function useImportJobStatus(jobId: number | null) {
  return useQuery({
    queryKey: jobId != null ? ME_IMPORT_JOB_KEY(jobId) : ["me", "import-job", "none"],
    queryFn: () =>
      apiFetch<ImportJobStatus>(`/api/me/library/import/${jobId!}`),
    enabled: jobId != null,
    refetchInterval: (query) => {
      const data = query.state.data as ImportJobStatus | undefined;
      if (data?.status === "done" || data?.status === "error") return false;
      return 2_000;
    },
    retry: false,
  });
}

/**
 * Polls the most recent import job for the authenticated user.
 * Works across tabs — no jobId needed.  Returns null when the user has no
 * jobs, or when unauthenticated.  Stops polling once the job reaches a
 * terminal state (done / error).
 */
export function useLatestImportJob() {
  return useQuery({
    queryKey: ME_LATEST_IMPORT_JOB_KEY,
    queryFn: () =>
      fetchOrNull<ImportJobStatus>("/api/me/library/import"),
    refetchInterval: (query) => {
      const data = query.state.data as ImportJobStatus | null | undefined;
      if (!data) return false;
      if (data.status === "done" || data.status === "error") return false;
      return 2_000;
    },
    staleTime: 0,
    retry: false,
  });
}

/** Pickers whose picks overlap the user's library. Empty when unauthenticated. */
export function useMyOverlapPickers() {
  return useQuery({
    queryKey: ME_OVERLAP_PICKERS_KEY,
    queryFn: () =>
      fetchOrNull<{ items: OverlapPicker[] }>("/api/me/overlaps/pickers").then(
        (d) => d?.items ?? [],
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Stations ranked by how many of the user's library tracks they've played. */
export function useMyOverlapStations() {
  return useQuery({
    queryKey: ME_OVERLAP_STATIONS_KEY,
    queryFn: () =>
      fetchOrNull<{ items: OverlapStation[] }>("/api/me/overlaps/stations").then(
        (d) => d?.items ?? [],
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** DJ selectors ranked by how many of the user's library tracks they've aired. */
export function useMyOverlapSelectors() {
  return useQuery({
    queryKey: ME_OVERLAP_SELECTORS_KEY,
    queryFn: () =>
      fetchOrNull<{ items: OverlapSelector[] }>("/api/me/overlaps/selectors").then(
        (d) => d?.items ?? [],
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export interface PickerOverlapItem {
  pickerId: number;
  pickerName: string;
  overlapCount: number;
}

/** DJ picker overlap with the caller's full library (exact MBID + RG widening).
 *  Returns [] for unauthenticated users. Stale for 5 minutes. */
export function useMyPickerOverlap() {
  return useQuery({
    queryKey: ME_PICKER_OVERLAP_KEY,
    queryFn: () =>
      fetchOrNull<{ items: PickerOverlapItem[] }>("/api/me/pickers/overlap").then(
        (d) => d?.items ?? [],
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Station runs ranked by library overlap. Empty when unauthenticated. */
export function useMyOverlapRuns() {
  return useQuery({
    queryKey: ME_OVERLAP_RUNS_KEY,
    queryFn: () =>
      fetchOrNull<{ items: OverlapRun[] }>("/api/me/overlaps/runs").then(
        (d) => d?.items ?? [],
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Library list coverage — publication lists featuring the user's albums
// ---------------------------------------------------------------------------

export interface LibraryCoverageAlbum {
  releaseGroupMbid: string;
  albumTitle: string | null;
  releaseYear: number | null;
  rank: number | null;
}

export interface LibraryCoverageList {
  listId: number;
  listTitle: string;
  listUrl: string;
  listYear: number | null;
  listKind: string;
  isRanked: boolean;
  sourceName: string;
  albums: LibraryCoverageAlbum[];
}

export const ME_LIBRARY_COVERAGE_KEY = ["me", "library", "list-coverage"] as const;

/**
 * Publication lists that contain albums from the user's library.
 * Empty when the library has no critic list coverage or when unauthenticated.
 */
export function useMyLibraryCoverage() {
  return useQuery({
    queryKey: ME_LIBRARY_COVERAGE_KEY,
    queryFn: () =>
      fetchOrNull<{ items: LibraryCoverageList[] }>(
        "/api/me/library/list-coverage",
      ).then((d) => d?.items ?? []),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export interface GhostStation {
  stationId: number;
  slug: string;
  name: string;
  streamUrl: string;
  streamFormat: string;
  mode: string;
  attribution: boolean;
  /** The library artist name that links the listener to this station. */
  artistName: string;
}
export interface MyPreferences {
  ledgerEnabled: boolean;
}

export const ME_PREFERENCES_KEY = ["me", "preferences"] as const;

export function useMyPreferences() {
  return useQuery({
    queryKey: ME_PREFERENCES_KEY,
    queryFn: () =>
      fetchOrNull<MyPreferences>("/api/me/preferences").then(
        (d) => d ?? { ledgerEnabled: false },
      ),
    staleTime: 60_000,
    retry: false,
  });
}

export async function patchPreferences(prefs: Partial<MyPreferences>): Promise<MyPreferences> {
  return apiFetch<MyPreferences>("/api/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(prefs),
  });
}

// ---------------------------------------------------------------------------
// Listening ledger — album completion
// ---------------------------------------------------------------------------

export interface AlbumCompletion {
  releaseGroupMbid: string;
  title: string | null;
  artistName: string | null;
  totalTracks: number;
  heardTracks: number;
}

export const ME_ALBUMS_COMPLETED_KEY = ["me", "albums", "completed"] as const;

export function useMyAlbumsCompleted() {
  return useQuery({
    queryKey: ME_ALBUMS_COMPLETED_KEY,
    queryFn: () =>
      fetchOrNull<{ albums: AlbumCompletion[] }>("/api/me/albums/completed").then(
        (d) => d?.albums ?? [],
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Listening ledger — listen CRUD
// ---------------------------------------------------------------------------

export interface ListenItem {
  id: number;
  mbid: string | null;
  spinId: number | null;
  stationId: number | null;
  pickerId: number | null;
  showId: number | null;
  context: string;
  outputService: string;
  startedAt: string;
  msPlayed: number;
  completed: boolean;
  releaseGroupMbid: string | null;
  recording: { title: string; artist: string } | null;
  station: { name: string; slug: string | null } | null;
  picker: { name: string } | null;
  show: { name: string } | null;
}

export async function postListen(body: {
  mbid?: string | null;
  spinId?: number | null;
  stationId?: number | null;
  pickerId?: number | null;
  showId?: number | null;
  context: string;
  outputService: string;
  startedAt?: string;
}): Promise<{ id: number | null }> {
  return apiFetch<{ id: number | null }>("/api/me/listens", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchListen(
  listenId: number,
  msPlayed: number,
): Promise<{ id: number; msPlayed: number; completed: boolean }> {
  return apiFetch(`/api/me/listens/${listenId}`, {
    method: "PATCH",
    body: JSON.stringify({ msPlayed }),
  });
}

export async function deleteListen(listenId: number): Promise<void> {
  return apiFetch(`/api/me/listens/${listenId}`, { method: "DELETE" });
}

export async function deleteAllListens(): Promise<void> {
  return apiFetch("/api/me/listens?confirm=true", { method: "DELETE" });
}

const RECOVERY_HINT_KEY = "lore:recovery_hint_until";

function maybeShowRecoveryHint(show?: boolean): void {
  if (!show) return;
  try {
    const until = Number(localStorage.getItem(RECOVERY_HINT_KEY) ?? 0);
    if (Date.now() < until) return; // suppressed within the 30-day window
    localStorage.setItem(RECOVERY_HINT_KEY, String(Date.now() + RECOVERY_HINT_TTL_MS));
  } catch {
    // localStorage unavailable — show the hint anyway, just can't suppress it.
  }
  toast({
    title: "Keep your library safe",
    description:
      "Link a service or download your library so this survives a cleared browser.",
  });
}

const RECOVERY_HINT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Weekly listening summary — GET /api/me/attendance/weekly
// ---------------------------------------------------------------------------

export interface WeeklyTrack {
  mbid: string;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
  spinCount: number;
  dwellSeconds: number;
  firstHeard: string | null;
  lastHeard: string | null;
}

export interface WeeklySummary {
  week: string;
  weekStart: string;
  weekEnd: string;
  /** Server's current ISO week label — authoritative cap for forward navigation. */
  currentWeek: string;
  tracks: WeeklyTrack[];
  totalTracks: number;
  totalDwellSeconds: number;
}

export const ME_WEEKLY_SUMMARY_KEY = (week: string) =>
  ["me", "attendance", "weekly", week] as const;

/**
 * Weekly confirmed-hearing summary for the authenticated user.
 * `week` is an ISO week label like "2026-W31"; defaults to the current week
 * when omitted.  Returns null when unauthenticated.
 */
export function useMyWeeklySummary(week: string | null) {
  const url = week
    ? `/api/me/attendance/weekly?week=${encodeURIComponent(week)}`
    : "/api/me/attendance/weekly";
  return useQuery({
    queryKey: ME_WEEKLY_SUMMARY_KEY(week ?? "current"),
    queryFn: () => fetchOrNull<WeeklySummary>(url),
    staleTime: 2 * 60_000,
    retry: false,
  });
}

/**
 * Returns the server's canonical current ISO week label (e.g. "2026-W31").
 * This is the authoritative source for the current week — it must not be
 * derived from the client clock, which may be ahead of real time.
 *
 * Falls back to `null` while loading or when unauthenticated, at which point
 * callers should fall back to a client-side estimate.
 */
export function useServerCurrentWeek(): string | null {
  const { data } = useMyWeeklySummary(null);
  return data?.currentWeek ?? null;
}

// ---------------------------------------------------------------------------
// Weekly history — GET /api/me/attendance/weekly/history
// ---------------------------------------------------------------------------

export interface WeekHistoryItem {
  week: string;
  weekStart: string;
  weekEnd: string;
  trackCount: number;
}

export const ME_WEEKLY_HISTORY_KEY = ["me", "attendance", "weekly", "history"] as const;

/**
 * Returns the most-recent non-empty ISO weeks (up to `limit`, default 8) for
 * the authenticated user.  Only weeks with at least one confirmed spin are
 * included.  Returns an empty array when unauthenticated.
 */
export function useMyWeeklyHistory(limit = 8) {
  return useQuery({
    queryKey: [...ME_WEEKLY_HISTORY_KEY, limit] as const,
    queryFn: () =>
      fetchOrNull<{ weeks: WeekHistoryItem[] }>(
        `/api/me/attendance/weekly/history?limit=${limit}`,
      ).then((d) => d?.weeks ?? []),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Stations that have played the user's library artists in the rolling 24 h
 * window but that the user has never consciously tuned into (no listens row
 * for that station). Returns [] when unauthenticated or library is empty.
 * Refetches every 5 minutes so new ghost stations surface during a session.
 */
export function useMyGhostMissed() {
  return useQuery({
    queryKey: ME_GHOST_MISSED_KEY,
    queryFn: () =>
      fetchOrNull<{ stations: GhostStation[] }>("/api/me/ghost/missed").then(
        (d) => d?.stations ?? [],
      ),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

export interface ReplayMaterializationJob {
  id: number;
  replayId: number;
  service: string;
  status: "pending" | "running" | "done" | "error";
  total: number;
  processed: number;
  accepted: number;
  missing: number;
  rejected: number;
  retryable: number;
  name: string;
  description: string;
  playlistId: string | null;
  playlistUrl: string | null;
  error: string | null;
  errorRetryable: boolean;
  finishedAt: string | null;
  receipt: ReplayMaterializationReceipt[];
}

export function useReplayPlaylistTargets(replayId: number) {
  return useQuery({
    queryKey: ["replay", replayId, "playlist-targets"] as const,
    queryFn: () => apiFetch<{ targets: ReplayPlaylistTarget[] }>(`/api/replay/${replayId}/playlist-targets`),
    enabled: Number.isInteger(replayId) && replayId > 0,
    staleTime: 30_000,
    retry: false,
  });
}

export interface ReplayMaterializationReceipt {
  position: number;
  spinId: number;
  mbid: string | null;
  title: string;
  artist: string;
  status: "accepted" | "missing" | "rejected";
  retryable: boolean;
  error?: string;
}

export async function postReplayMaterialization(
  replayId: number,
  service: ReplayPlaylistTarget["service"],
): Promise<ReplayMaterializationJob> {
  return apiFetch<ReplayMaterializationJob>(`/api/replay/${replayId}/materialize`, {
    method: "POST",
    body: JSON.stringify({ service }),
  });
}

export async function startReplayPlaylistConnect(service: ReplayPlaylistTarget["service"]): Promise<void> {
  const win = window.open("", "_blank");
  try {
    const res = await apiFetch<{ url: string }>(`/api/me/connect/${service}/start`, { method: "POST" });
    if (win) win.location.href = res.url;
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

export interface ReplayResolutionMissBreakdown {
  noVector: number;
  noLinks: number;
  noRecording: number;
}

export interface ReplayResolutionJob {
  id: number;
  replayId: number;
  status: "pending" | "running" | "done" | "error";
  total: number;
  processed: number;
  resolved: number;
  missing: number;
  networkErrors: number;
  failed: number;
  committedOffset: number;
  error: string | null;
  finishedAt: string | null;
  failures: Array<{ position: number; spinId: number; error: string }>;
  missBreakdown: ReplayResolutionMissBreakdown;
}

export async function postStartReplayResolution(replayId: number): Promise<ReplayResolutionJob> {
  return apiFetch<ReplayResolutionJob>(`/api/replay/${replayId}/resolve`, { method: "POST" });
}

export function useReplayResolutionJob(jobId: number | null) {
  return useQuery({
    queryKey: ["replay", "resolution-job", jobId ?? 0] as const,
    queryFn: () => apiFetch<ReplayResolutionJob>(`/api/replay/jobs/${jobId}`),
    enabled: jobId != null,
    refetchInterval: (query) => {
      const data = query.state.data as ReplayResolutionJob | undefined;
      return data && (data.status === "done" || data.status === "error") ? false : 2_000;
    },
    retry: false,
  });
}

export function useReplayMaterializationJob(jobId: number | null) {
  return useQuery({
    queryKey: ["replay", "materialization-job", jobId ?? 0] as const,
    queryFn: () => apiFetch<ReplayMaterializationJob>(`/api/replay/materialization-jobs/${jobId}`),
    enabled: jobId != null,
    refetchInterval: (query) => {
      const data = query.state.data as ReplayMaterializationJob | undefined;
      return data && (data.status === "done" || data.status === "error") ? false : 2_000;
    },
    retry: false,
  });
}
