import { useQuery } from "@tanstack/react-query";
import { ApiError, type Station } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Types mirroring /api/player/* response shapes
// ---------------------------------------------------------------------------

export interface WpNow {
  mbid: string | null;
  title: string;
  artist: string;
  artworkUrl: string | null;
  playedAt: string;
  resolved: boolean;
}

export interface WpOnAirItem {
  station: Station;
  show: { name: string; djName: string | null } | null;
  now: WpNow;
  earlier: string[];
  /** null when anonymous */
  matchCount: number | null;
}

export interface WpOnAirResponse {
  items: WpOnAirItem[];
  authenticated: boolean;
}

export interface WpRunSpin {
  mbid: string | null;
  title: string;
  artist: string;
  artworkUrl: string | null;
  playedAt: string;
  resolved: boolean;
  inLibrary: boolean;
}

export interface WpRunResponse {
  station: { slug: string; name: string };
  show: { name: string; djName: string | null } | null;
  day: string;
  spinCount: number;
  overlapPct: number | null;
  fromLibrary: WpRunSpin[];
  newToYou: WpRunSpin[];
  trove: {
    selectorName: string;
    sharedCount: number;
    deepCuts: Array<{ artist: string; spinCount: number; runCount: number }>;
  } | null;
  authenticated: boolean;
}

export interface WpLoreCount {
  mbid: string;
  artifactCount: number;
  listCount: number;
  keptSince: string | null;
}

// Recording detail shapes (subset of the /api/recordings/* responses we read).

export interface WpRecording {
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  links: Array<{ name: string; url: string; kind: string }>;
}

export interface WpClaim {
  id: number;
  text: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
}

export interface WpListProvenanceItem {
  listId: number;
  listTitle: string;
  listYear: number | null;
  sourceName: string;
  rank: number | null;
  isRanked: boolean;
  listLength: number | null;
}

export interface WpPick {
  picker: { name: string; handle: string; pickerType: string };
  listTitle: string | null;
  sourceUrl: string | null;
  runId: number | null;
}

export interface WpSpinRow {
  playedAt: string;
  station: { slug: string; name: string } | null;
  show: { name: string; djName: string | null } | null;
  runId: number | null;
}

export interface WpSongExploder {
  episode: {
    title: string;
    episodeUrl: string;
    youtubeUrl: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res, data, { method: "GET", url });
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useWpOnAir() {
  return useQuery({
    queryKey: ["wp", "onair"],
    queryFn: () => apiFetch<WpOnAirResponse>("/api/player/onair"),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function useWpRun(slug: string | null, runId?: number | null) {
  return useQuery({
    queryKey: ["wp", "run", slug, runId ?? "latest"],
    queryFn: () =>
      apiFetch<WpRunResponse>(
        `/api/player/run/${encodeURIComponent(slug!)}${runId != null ? `?runId=${runId}` : ""}`,
      ),
    enabled: slug != null,
    // Past runs are immutable; only tonight's live run needs polling.
    refetchInterval: runId == null ? 60_000 : false,
  });
}

export function useWpLoreCounts(mbids: string[]) {
  const key = [...mbids].sort().join(",");
  return useQuery({
    queryKey: ["wp", "lore-counts", key],
    queryFn: () =>
      apiFetch<{ items: WpLoreCount[] }>(
        `/api/player/lore-counts?mbids=${encodeURIComponent(key)}`,
      ).then((r) => new Map(r.items.map((i) => [i.mbid, i]))),
    enabled: mbids.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useWpRecording(mbid: string | null) {
  return useQuery({
    queryKey: ["wp", "recording", mbid],
    queryFn: () => apiFetch<WpRecording>(`/api/recordings/${mbid}`),
    enabled: mbid != null,
    staleTime: 10 * 60_000,
  });
}

/** Knowledge payload read defensively — pressing/label fields are best-effort. */
export function useWpKnowledge(mbid: string | null) {
  return useQuery({
    queryKey: ["wp", "knowledge", mbid],
    queryFn: () =>
      apiFetch<Record<string, unknown>>(`/api/recordings/${mbid}/knowledge`),
    enabled: mbid != null,
    staleTime: 5 * 60_000,
  });
}

export function useWpListProvenance(mbid: string | null) {
  return useQuery({
    queryKey: ["wp", "list-provenance", mbid],
    queryFn: () =>
      apiFetch<{ items: WpListProvenanceItem[] }>(
        `/api/recordings/${mbid}/list-provenance`,
      ),
    enabled: mbid != null,
    staleTime: 10 * 60_000,
  });
}

export function useWpPicks(mbid: string | null) {
  return useQuery({
    queryKey: ["wp", "picks", mbid],
    queryFn: () => apiFetch<{ picks: WpPick[] }>(`/api/recordings/${mbid}/picks`),
    enabled: mbid != null,
    staleTime: 10 * 60_000,
  });
}

export function useWpRecordingSpins(mbid: string | null) {
  return useQuery({
    queryKey: ["wp", "rec-spins", mbid],
    queryFn: () => apiFetch<{ spins: WpSpinRow[] }>(`/api/recordings/${mbid}/spins`),
    enabled: mbid != null,
    staleTime: 5 * 60_000,
  });
}

export function useWpSongExploder(mbid: string | null) {
  return useQuery({
    queryKey: ["wp", "song-exploder", mbid],
    queryFn: () => apiFetch<WpSongExploder>(`/api/recordings/${mbid}/song-exploder`),
    enabled: mbid != null,
    staleTime: 10 * 60_000,
  });
}
