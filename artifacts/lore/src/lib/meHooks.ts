import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Types mirroring /api/me/* response shapes
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

/** Start the Spotify Library OAuth flow. Navigates away from the page. */
export async function startSpotifyLibraryConnect(): Promise<void> {
  const res = await apiFetch<{ url: string }>("/api/me/connect/spotify/start", {
    method: "POST",
  });
  window.location.href = res.url;
}

/** Start a library import. Returns the job id on success. */
export async function postStartImport(service: string): Promise<{ jobId: number; status: string }> {
  return apiFetch<{ jobId: number; status: string }>(
    `/api/me/library/import?service=${encodeURIComponent(service)}`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const ME_CONNECTIONS_KEY = ["me", "connections"] as const;
export const ME_LIBRARY_KEY = (cursor?: string) => ["me", "library", cursor ?? "start"] as const;
export const ME_KEEP_STATUS_KEY = (joined: string) => ["me", "keep-status", joined] as const;
export const ME_OVERLAP_PICKERS_KEY = ["me", "overlaps", "pickers"] as const;
export const ME_OVERLAP_RUNS_KEY = ["me", "overlaps", "runs"] as const;
export const ME_IMPORT_JOB_KEY = (jobId: number) => ["me", "import-job", jobId] as const;

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
    staleTime: 60_000,
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
      provenance,
    }: {
      mbid: string;
      provenance?: Partial<LibraryProvenance>;
    }) =>
      apiFetch<{ keptToLore: boolean; mirrors: unknown[] }>("/api/me/keep", {
        method: "POST",
        body: JSON.stringify({ mbid, provenance }),
      }),
    onSuccess: (_data, { mbid }) => {
      // Optimistically update all keep-status query caches that include this mbid.
      queryClient.setQueriesData<Set<string>>(
        { queryKey: ["me", "keep-status"] },
        (prev) => {
          if (!prev) return new Set([mbid]);
          return new Set([...prev, mbid]);
        },
      );
      void queryClient.invalidateQueries({ queryKey: ME_LIBRARY_KEY() });
    },
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
      void queryClient.invalidateQueries({ queryKey: ME_LIBRARY_KEY() });
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
      return 3_000;
    },
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
