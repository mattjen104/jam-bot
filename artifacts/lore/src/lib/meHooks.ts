import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
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
  pickerHandle?: string;
}

export interface LibraryItem {
  mbid: string;
  provenance: LibraryProvenance;
  addedAt: string;
  recording: LibraryRecording | null;
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

export function useMyLibraryMbids() {
  return useQuery({
    queryKey: ME_LIBRARY_MBIDS_KEY,
    queryFn: () =>
      fetchOrNull<{ mbids: string[] }>("/api/me/library/mbids").then(
        (d) => d?.mbids ?? [],
      ),
    staleTime: 60_000,
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
  /** Filter by provenance kind: "keep" | "import". */
  source?: "keep" | "import" | "";
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
      return fetchOrNull<{ items: LibraryItem[]; nextCursor: string | null }>(
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
// Preferences (ledger consent)
// ---------------------------------------------------------------------------

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
