import { useEffect, useState } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  getGetRecordingSupportQueryKey,
  type RecordingSupportResponse,
  type Station,
  useGetRecordingSupport,
  useHoldRecordingSupport,
  useUnholdRecordingSupport,
} from "@workspace/api-client-react";
import {
  getStreamHealthy,
  mergeOnAirSnapshot,
  mergeSpinIntoOnAir,
  resetOnAirStreamVersions,
  subscribeSpinStream,
  subscribeStreamCatchUp,
  subscribeStreamHealth,
  subscribeStreamSnapshot,
  type SpinStreamEvent,
} from "./nowPlayingStream";
import { BroadcastClockEstimator, type ClockMark } from "../lib/broadcastClock";

// ---------------------------------------------------------------------------
// Types mirroring /api/player/* response shapes
// ---------------------------------------------------------------------------

export interface WpNow {
  mbid: string | null;
  title: string;
  artist: string;
  artworkUrl: string | null;
  playedAt: string;
  /** When Lore received the metadata (ingestion time). Best-effort field. */
  observedAt?: string;
  /** When Lore committed the spin row. */
  persistedAt?: string;
  /** Station-declared start, null when another timing signal is used. */
  sourceStartedAt?: string | null;
  timestampKind?: "source" | "fingerprint" | "inferred" | "receipt";
  timingReason?:
    | "station_declared_start"
    | "fingerprint_play_offset"
    | "inferred_start"
    | "receipt_only";
  timingUncertaintyMs?: number | null;
  /**
   * Server-computed freshness class from the source's polling cadence.
   * "stale" ⇒ show the "may be delayed" hint; absent ⇒ unknown, treat as
   * non-stale.
   */
  freshness?: "fresh" | "aging" | "stale";
  /** Server-computed advisory expiry fields used by the persistent player. */
  estimatedRemainingMs?: number | null;
  likelyExpiring?: boolean;
  timingConfidence?: "trusted" | "estimated" | "unknown";
  serverTime?: string;
  broadcastAdvisory?: {
    kind: "dj_speaking" | "music_resuming";
    observedAt: string;
    expiresAt: string;
  } | null;
  /** Client-only uncertainty from midpoint clock alignment. */
  clockUncertaintyMs?: number | null;
  resolved: boolean;
  /**
   * True while a provisional spin-raw observation is awaiting its resolved
   * spin-changed event — show a subtle "resolving" cue rather than full
   * confidence. Cleared when the resolved event merges.
   */
  resolving?: boolean;
  /**
   * Client-internal: the pre-provisional row state, stashed when a spin-raw
   * frame replaces the display so a terminal spin-raw-failed frame can
   * revert to the last persisted spin. Never present on server payloads.
   */
  revertTo?: { now: WpNow; earlier: string[] } | undefined;
  /** Process-local SSE cursor for monotonic REST/SSE merging. */
  eventId?: number;
  /** Process-local monotonic version for this station. */
  stationVersion?: number;
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
  serverTime?: string;
}

const wpOnAirClock = new BroadcastClockEstimator();

export function alignWpOnAirTiming(
  body: WpOnAirResponse,
  clock: BroadcastClockEstimator,
  started: ClockMark,
  received: ClockMark,
): WpOnAirResponse {
  if (!body.serverTime) return body;
  clock.addSample(body.serverTime, started, received);
  const clockUncertaintyMs = clock.uncertaintyMs();
  return {
    ...body,
    items: body.items.map((item) => ({
      ...item,
      now: {
        ...item.now,
        serverTime: body.serverTime,
        clockUncertaintyMs,
      },
    })),
  };
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

/** Poll cadence while the SSE push stream is healthy — a slow safety sweep. */
export const WP_ONAIR_POLL_STREAM_HEALTHY_MS = 120_000;
/** Poll cadence when the stream is degraded/absent — the original backstop. */
export const WP_ONAIR_POLL_DEGRADED_MS = 30_000;

/**
 * useWpOnAir has multiple mounted consumers. Coalesce their shared lifecycle
 * and snapshot callbacks so one browser resume produces one REST request for
 * this cache, not one request per component.
 */
const wpCatchUps = new WeakMap<QueryClient, Promise<void>>();
const wpPendingSpins = new WeakMap<QueryClient, SpinStreamEvent[]>();
const WP_PENDING_SPIN_LIMIT = 256;

function applyWpSpin(
  queryClient: QueryClient,
  event: SpinStreamEvent,
): void {
  let cacheReady = false;
  queryClient.setQueryData<WpOnAirResponse>(["wp", "onair"], (previous) => {
    if (!previous) return previous;
    cacheReady = true;
    return mergeSpinIntoOnAir(previous, event);
  });
  if (cacheReady) return;

  const pending = wpPendingSpins.get(queryClient) ?? [];
  if (
    event.eventId != null &&
    pending.some((queued) => queued.eventId === event.eventId)
  ) {
    return;
  }
  pending.push(event);
  if (pending.length > WP_PENDING_SPIN_LIMIT) {
    pending.splice(0, pending.length - WP_PENDING_SPIN_LIMIT);
  }
  wpPendingSpins.set(queryClient, pending);
}

function mergeWpOnAirFetch(
  queryClient: QueryClient,
  incoming: WpOnAirResponse,
): WpOnAirResponse {
  let merged = mergeOnAirSnapshot(
    queryClient.getQueryData<WpOnAirResponse>(["wp", "onair"]),
    incoming,
  );
  const pending = wpPendingSpins.get(queryClient);
  if (!pending?.length) return merged;

  const retained: SpinStreamEvent[] = [];
  for (const event of pending) {
    if (!merged.items.some((item) => item.station.slug === event.stationSlug)) {
      retained.push(event);
      continue;
    }
    merged = mergeSpinIntoOnAir(merged, event) ?? merged;
  }
  if (retained.length > 0) wpPendingSpins.set(queryClient, retained);
  else wpPendingSpins.delete(queryClient);
  return merged;
}

export const _testOnly_applyWpSpin = applyWpSpin;
export const _testOnly_mergeWpOnAirFetch = mergeWpOnAirFetch;

export function useWpOnAir() {
  const queryClient = useQueryClient();

  // Shared SSE push channel: one module-level EventSource across every
  // consumer of this hook. Pushed spin changes merge straight into the
  // ["wp","onair"] cache so all existing consumers update within seconds of
  // the server logging a spin — no per-component rewrites needed. The merge
  // is idempotent (same-track events return the previous object untouched),
  // so multiple mounted consumers applying the same event is harmless.
  const [streamHealthy, setStreamHealthy] = useState(getStreamHealthy);
  useEffect(() => {
    const unsubSnapshot = subscribeStreamSnapshot(({ resetVersions }) =>
      _testOnly_refreshWpOnAir(queryClient, resetVersions),
    );
    const unsubCatchUp = subscribeStreamCatchUp(() =>
      _testOnly_refreshWpOnAir(queryClient, false),
    );
    const unsubSpins = subscribeSpinStream((event) =>
      applyWpSpin(queryClient, event),
    );
    // Health transitions arrive via the subscription; a change that lands in
    // the tiny window between render and subscribe is at worst one poll cycle
    // stale — the 30s backstop covers it.
    const unsubHealth = subscribeStreamHealth(setStreamHealthy);
    return () => {
      unsubSpins();
      unsubHealth();
      unsubSnapshot();
      unsubCatchUp();
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["wp", "onair"],
    queryFn: async () => {
      const started = wpOnAirClock.mark();
      const incoming = await apiFetch<WpOnAirResponse>("/api/player/onair");
      const received = wpOnAirClock.mark();
      return mergeWpOnAirFetch(
        queryClient,
        alignWpOnAirTiming(incoming, wpOnAirClock, started, received),
      );
    },
    // Polling is the correctness backstop. While the SSE stream is healthy it
    // stretches to a slow sweep (push carries track changes); when the stream
    // is degraded or unavailable it silently resumes the original 30s cadence.
    // React Query pauses background polling when the window is hidden; same
    // query key avoids a loading flash.
    refetchInterval: streamHealthy
      ? WP_ONAIR_POLL_STREAM_HEALTHY_MS
      : WP_ONAIR_POLL_DEGRADED_MS,
    staleTime: 25_000,
  });
}

export interface WpAlbumTrack {
  id: string;
  name: string;
  trackNumber: number;
  isrc: string | null;
}

export function useWpAlbumTracks(trackId: string | null) {
  return useQuery({
    queryKey: ["wp", "album-tracks", trackId],
    queryFn: () =>
      apiFetch<{ tracks: WpAlbumTrack[] }>(
        `/api/spotify/album-tracks?trackId=${encodeURIComponent(trackId!)}`,
      ),
    enabled: trackId != null,
    // Albums are immutable — cache for 30 minutes.
    staleTime: 30 * 60_000,
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

// ---------------------------------------------------------------------------
// For You — top runs ranked by library overlap
// ---------------------------------------------------------------------------

export interface WpForYouRun {
  slug: string;
  stationName: string;
  showName: string | null;
  djName: string | null;
  day: string;
  runId: number;
  totalResolved: number;
  matchCount: number;
  overlapPct: number;
}

export function useWpForYou() {
  return useQuery({
    queryKey: ["wp", "for-you"],
    queryFn: () => apiFetch<{ runs: WpForYouRun[] }>("/api/player/for-you"),
    // Runs are historical; a 5-minute window is plenty fresh.
    staleTime: 5 * 60_000,
    // Don't attempt if we can't tell whether the user is logged in yet;
    // a 401 is fine and handled in the tab, but avoids noise.
    retry: false,
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

// ---------------------------------------------------------------------------
// Selectors tab
// ---------------------------------------------------------------------------

export interface WpSelector {
  id: number;
  name: string;
  handle: string;
  pickerType: string;
  stationName: string | null;
  stationSlug: string | null;
  recentSpinCount: number;
  lastPlayedAt: string | null;
}

export function useWpSelectors() {
  return useQuery({
    queryKey: ["wp", "selectors"],
    queryFn: () => apiFetch<{ selectors: WpSelector[] }>("/api/player/selectors"),
    staleTime: 5 * 60_000,
  });
}

export interface WpSelectorRun {
  runId: number;
  day: string;
  spinCount: number;
  startedAt: string;
  show: { name: string; djName: string | null } | null;
  station: { slug: string; name: string };
}

export function useWpSelectorRuns(handle: string | null) {
  return useQuery({
    queryKey: ["wp", "selector-runs", handle],
    queryFn: () =>
      apiFetch<{ selector: { name: string; handle: string }; runs: WpSelectorRun[] }>(
        `/api/player/selectors/${encodeURIComponent(handle!)}/runs`,
      ),
    enabled: handle != null,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Schedule tab
// ---------------------------------------------------------------------------

export interface WpScheduleSlot {
  stationSlug: string;
  stationName: string;
  showName: string;
  djName: string | null;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  ianaTimezone: string;
  isLive: boolean;
}

export function useWpSchedule() {
  return useQuery({
    queryKey: ["wp", "schedule"],
    queryFn: () =>
      apiFetch<{ liveNow: WpScheduleSlot[]; upcomingToday: WpScheduleSlot[] }>(
        "/api/player/schedule",
      ),
    refetchInterval: 60_000,
    staleTime: 55_000,
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

/**
 * Grounded support links are part of the track sheet, not the on-air surface.
 * Keep the generated hooks behind this webplayer seam so sheet tests can
 * provide deterministic support responses without mocking the whole API
 * client.
 */
export function useWpSupport(mbid: string | null) {
  return useGetRecordingSupport(mbid ?? "", {
    query: {
      queryKey: getGetRecordingSupportQueryKey(mbid ?? ""),
      enabled: mbid != null,
      staleTime: 5 * 60_000,
    },
  });
}

export type WpSupport = RecordingSupportResponse;

export function useWpHoldSupport() {
  return useHoldRecordingSupport();
}

export function useWpUnholdSupport() {
  return useUnholdRecordingSupport();
}

export function _testOnly_refreshWpOnAir(
  queryClient: QueryClient,
  resetVersions: boolean,
): Promise<void> {
  if (resetVersions) {
    queryClient.setQueryData<WpOnAirResponse>(
      ["wp", "onair"],
      resetOnAirStreamVersions,
    );
  }
  const inFlight = wpCatchUps.get(queryClient);
  if (inFlight) return inFlight;

  const request = queryClient
    .refetchQueries(
      {
        queryKey: ["wp", "onair"],
        exact: true,
        type: "active",
      },
      {
        throwOnError: true,
      },
    )
    .then(() => undefined)
    .finally(() => {
      if (wpCatchUps.get(queryClient) === request) {
        wpCatchUps.delete(queryClient);
      }
    });
  wpCatchUps.set(queryClient, request);
  return request;
}
