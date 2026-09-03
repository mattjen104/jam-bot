/**
 * Shared now-playing SSE subscription — one EventSource per browser tab.
 *
 * The server pushes a `spin-changed` event the moment a station's spin is
 * persisted (see /api/stations/now-playing/stream — deliberately outside the
 * OpenAPI/orval surface). This module owns a single module-level EventSource,
 * refcounted across all subscribers, so every consumer of the on-air data
 * benefits from push updates without opening its own connection.
 *
 * Reconnect policy: we manage reconnection ourselves (closing the native
 * EventSource on error) so we can apply exponential backoff and expose an
 * honest health signal. After STREAM_DEGRADED_AFTER_FAILURES consecutive
 * failures the stream is marked degraded — consumers (useWpOnAir) resume
 * their normal 30-second polling cadence as the backstop. The stream becomes
 * healthy only after replay completes or a required REST snapshot succeeds.
 */

import type { WpOnAirResponse } from "./hooks";

/** Compact per-station spin-change payload (mirrors the server's SpinChangedEvent / SpinRawEvent). */
export interface SpinStreamEvent {
  stationSlug: string;
  rawArtist: string;
  rawTitle: string;
  mbid: string | null;
  /** Artwork URL stored on the recording, null when unknown. */
  artworkUrl?: string | null;
  /**
   * Frame discriminator. "spin-raw" is the provisional fast path — emitted
   * before MusicBrainz/Spotify resolution completes. "spin-raw-failed" is the
   * terminal failure frame: the provisional track never persisted, so the
   * display must revert to the last persisted spin. Absent/"spin-changed"
   * means the resolved, persisted event.
   */
  type?: "spin-raw" | "spin-raw-failed" | "spin-changed";
  /** True on provisional `spin-raw` frames — the track is still resolving. */
  provisional?: boolean;
  /** ISO timestamp of when the server observed the spin. Best-effort field. */
  observedAt?: string;
  /** Resolution confidence tier ("recording_id" | "isrc" | "text" | "spotify" | "unresolved"). */
  confidence?: string;
  /** Safe duration evidence used for an approximate fresh-track timer. */
  durationMs?: number;
  isLibraryHit?: boolean;
  isArtistHit?: boolean;
  /** MusicBrainz artist MBID when the spin has been resolved. */
  artistMbid?: string | null;
  /** Primary MusicBrainz release-group MBID when the spin has been resolved. */
  releaseGroupMbid?: string | null;
  /** MusicBrainz first-release year for the recording; null when unknown. */
  releaseYear?: number | null;
  /** MusicBrainz first-release date in partial-ISO form; null when unknown. */
  releaseDate?: string | null;
  /** True when this is the first-ever appearance of this recording in the archive. */
  isFirstSpin?: boolean;
  /** Monotonic event cursor within the current server process. */
  eventId?: number;
  /** Monotonic version for this station within the current server process. */
  stationVersion?: number;
}

type SpinListener = (ev: SpinStreamEvent) => void;
type HealthListener = (healthy: boolean) => void;
export interface StreamSnapshotRequest {
  cursor: number;
  resetVersions: boolean;
}
type SnapshotListener = (
  request: StreamSnapshotRequest,
) => void | Promise<void>;
type CatchUpListener = () => void | Promise<void>;

/** Consecutive connection failures before the stream is declared degraded. */
export const STREAM_DEGRADED_AFTER_FAILURES = 3;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

const STREAM_URL = "/api/stations/now-playing/stream";

const spinListeners = new Set<SpinListener>();
const healthListeners = new Set<HealthListener>();
const snapshotListeners = new Set<SnapshotListener>();
const catchUpListeners = new Set<CatchUpListener>();

let es: EventSource | null = null;
let healthy = false;
let consecutiveFailures = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleListening = false;
let streamId: string | null = null;
let lastEventId = 0;
let readyReceived = false;
let snapshotRecovery: Promise<void> | null = null;
let pendingSnapshotRequest: StreamSnapshotRequest | null = null;
const stationVersions = new Map<string, number>();

function setHealthy(next: boolean): void {
  if (healthy === next) return;
  healthy = next;
  for (const cb of healthListeners) cb(next);
}

/** True when the SSE stream is currently open and delivering events. */
export function getStreamHealthy(): boolean {
  return healthy;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function streamUrl(): string {
  const params = new URLSearchParams();
  if (lastEventId > 0) params.set("lastEventId", String(lastEventId));
  if (streamId) params.set("streamId", streamId);
  const query = params.toString();
  return query ? `${STREAM_URL}?${query}` : STREAM_URL;
}

function maybeMarkReady(): void {
  if (!readyReceived || snapshotRecovery || pendingSnapshotRequest) return;
  consecutiveFailures = 0;
  setHealthy(true);
}

function readControl(msg: MessageEvent): Record<string, unknown> | null {
  try {
    const data = JSON.parse(msg.data as string) as unknown;
    return data != null && typeof data === "object"
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function handleStreamInfo(msg: MessageEvent): void {
  const data = readControl(msg);
  const nextStreamId =
    typeof data?.streamId === "string" ? data.streamId : null;
  if (!nextStreamId) return;
  if (streamId != null && streamId !== nextStreamId) {
    lastEventId = 0;
    stationVersions.clear();
  }
  streamId = nextStreamId;
}

function startSnapshotRecovery(): void {
  const request = pendingSnapshotRequest;
  if (!request || snapshotRecovery || snapshotListeners.size === 0) return;
  const listeners = [...snapshotListeners];
  snapshotRecovery = Promise.all(
    listeners.map((listener) => Promise.resolve(listener(request))),
  )
    .then(() => {
      lastEventId = Math.max(lastEventId, request.cursor);
      pendingSnapshotRequest = null;
      snapshotRecovery = null;
      maybeMarkReady();
    })
    .catch(() => {
      snapshotRecovery = null;
      setHealthy(false);
      es?.close();
      es = null;
      scheduleReconnect();
    });
}

function handleSnapshotRequired(msg: MessageEvent): void {
  const data = readControl(msg);
  pendingSnapshotRequest = {
    cursor: parsePositiveInteger(data?.cursor) ?? 0,
    // Any explicit fallback is authoritative, not an ordinary racing REST
    // poll. Clear process-local cache versions and stranded provisional state
    // before merging the snapshot, even when the server epoch is unchanged.
    resetVersions: true,
  };
  startSnapshotRecovery();
}

function handleStreamReady(msg: MessageEvent): void {
  const data = readControl(msg);
  const cursor = parsePositiveInteger(data?.cursor);
  if (cursor != null && !pendingSnapshotRequest) {
    lastEventId = Math.max(lastEventId, cursor);
  }
  readyReceived = true;
  maybeMarkReady();
}

function parseSpinMessage(msg: MessageEvent): SpinStreamEvent | null {
  try {
    const data = JSON.parse(msg.data as string) as Partial<SpinStreamEvent>;
    if (typeof data.stationSlug !== "string" || !data.stationSlug) return null;
    const eventId =
      parsePositiveInteger(data.eventId) ??
      parsePositiveInteger(msg.lastEventId);
    const stationVersion = parsePositiveInteger(data.stationVersion);

    // Acknowledge the global cursor even when the per-station frame is stale:
    // reconnect should resume after every frame successfully received.
    if (eventId != null) {
      if (eventId <= lastEventId) return null;
      lastEventId = eventId;
    }
    if (stationVersion != null) {
      const current = stationVersions.get(data.stationSlug) ?? 0;
      if (stationVersion <= current) return null;
      stationVersions.set(data.stationSlug, stationVersion);
    }

    return {
      stationSlug: data.stationSlug,
      rawArtist: data.rawArtist ?? "",
      rawTitle: data.rawTitle ?? "",
      mbid: data.mbid ?? null,
      ...(data.type === "spin-raw" ||
      data.type === "spin-raw-failed" ||
      data.type === "spin-changed"
        ? { type: data.type }
        : {}),
      ...(data.provisional === true ? { provisional: true } : {}),
      ...(data.observedAt ? { observedAt: data.observedAt } : {}),
      ...(data.confidence ? { confidence: data.confidence } : {}),
      ...(data.durationMs != null ? { durationMs: data.durationMs } : {}),
      ...(data.artworkUrl !== undefined
        ? { artworkUrl: data.artworkUrl }
        : {}),
      ...(data.isLibraryHit != null
        ? { isLibraryHit: data.isLibraryHit }
        : {}),
      ...(data.isArtistHit != null
        ? { isArtistHit: data.isArtistHit }
        : {}),
      ...(data.artistMbid != null ? { artistMbid: data.artistMbid } : {}),
      ...(data.releaseGroupMbid != null
        ? { releaseGroupMbid: data.releaseGroupMbid }
        : {}),
      ...(data.releaseYear != null ? { releaseYear: data.releaseYear } : {}),
      ...(data.releaseDate != null ? { releaseDate: data.releaseDate } : {}),
      ...(data.isFirstSpin != null ? { isFirstSpin: data.isFirstSpin } : {}),
      ...(eventId != null ? { eventId } : {}),
      ...(stationVersion != null ? { stationVersion } : {}),
    };
  } catch {
    return null;
  }
}

function openStream(): void {
  if (es || typeof EventSource === "undefined") return;
  if (!hasSubscribers()) return;

  readyReceived = false;
  const source = new EventSource(streamUrl());
  es = source;

  source.onopen = () => {
    consecutiveFailures = 0;
  };

  source.onmessage = (msg: MessageEvent) => {
    const ev = parseSpinMessage(msg);
    if (!ev) return;
    for (const cb of spinListeners) cb(ev);
  };
  source.addEventListener("stream-info", handleStreamInfo as EventListener);
  source.addEventListener(
    "snapshot-required",
    handleSnapshotRequired as EventListener,
  );
  source.addEventListener("stream-ready", handleStreamReady as EventListener);

  source.onerror = () => {
    // Take over reconnection: close the native source (its built-in retry has
    // no backoff) and schedule our own attempt.
    source.close();
    if (es === source) es = null;
    consecutiveFailures += 1;
    if (consecutiveFailures >= STREAM_DEGRADED_AFTER_FAILURES) setHealthy(false);
    scheduleReconnect();
  };
}

function hasSubscribers(): boolean {
  return (
    spinListeners.size > 0 ||
    healthListeners.size > 0 ||
    snapshotListeners.size > 0 ||
    catchUpListeners.size > 0
  );
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (!hasSubscribers()) return;
  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1),
    RECONNECT_MAX_MS,
  );
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openStream();
  }, delay);
}

function runLifecycleCatchUp(): void {
  if (!hasSubscribers()) return;
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    return;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  es?.close();
  es = null;
  setHealthy(false);
  openStream();
  for (const listener of catchUpListeners) {
    void Promise.resolve(listener()).catch(() => undefined);
  }
}

function scheduleLifecycleCatchUp(): void {
  if (lifecycleTimer) clearTimeout(lifecycleTimer);
  lifecycleTimer = setTimeout(() => {
    lifecycleTimer = null;
    runLifecycleCatchUp();
  }, 150);
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") scheduleLifecycleCatchUp();
}

function ensureLifecycleListeners(): void {
  if (lifecycleListening || typeof window === "undefined") return;
  lifecycleListening = true;
  window.addEventListener("online", scheduleLifecycleCatchUp);
  window.addEventListener("pageshow", scheduleLifecycleCatchUp);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function removeLifecycleListeners(): void {
  if (!lifecycleListening || typeof window === "undefined") return;
  lifecycleListening = false;
  window.removeEventListener("online", scheduleLifecycleCatchUp);
  window.removeEventListener("pageshow", scheduleLifecycleCatchUp);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (lifecycleTimer) {
    clearTimeout(lifecycleTimer);
    lifecycleTimer = null;
  }
}

function maybeClose(): void {
  if (hasSubscribers()) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  es?.close();
  es = null;
  consecutiveFailures = 0;
  readyReceived = false;
  snapshotRecovery = null;
  setHealthy(false);
  removeLifecycleListeners();
}

/** Subscribe to pushed spin changes. Opens the shared stream on first subscriber. */
export function subscribeSpinStream(listener: SpinListener): () => void {
  spinListeners.add(listener);
  ensureLifecycleListeners();
  openStream();
  return () => {
    spinListeners.delete(listener);
    maybeClose();
  };
}

/** Subscribe to stream health transitions (healthy ⇄ degraded). */
export function subscribeStreamHealth(listener: HealthListener): () => void {
  healthListeners.add(listener);
  ensureLifecycleListeners();
  openStream();
  return () => {
    healthListeners.delete(listener);
    maybeClose();
  };
}

/** Subscribe to explicit REST snapshot recovery requests from the SSE server. */
export function subscribeStreamSnapshot(
  listener: SnapshotListener,
): () => void {
  snapshotListeners.add(listener);
  ensureLifecycleListeners();
  openStream();
  startSnapshotRecovery();
  return () => {
    snapshotListeners.delete(listener);
    maybeClose();
  };
}

/** Subscribe to debounced online/pageshow/foreground catch-up requests. */
export function subscribeStreamCatchUp(
  listener: CatchUpListener,
): () => void {
  catchUpListeners.add(listener);
  ensureLifecycleListeners();
  openStream();
  return () => {
    catchUpListeners.delete(listener);
    maybeClose();
  };
}

/** Tests only: tear down all module state. */
export function _testOnly_resetStream(): void {
  spinListeners.clear();
  healthListeners.clear();
  snapshotListeners.clear();
  catchUpListeners.clear();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  es?.close();
  es = null;
  consecutiveFailures = 0;
  healthy = false;
  streamId = null;
  lastEventId = 0;
  readyReceived = false;
  snapshotRecovery = null;
  pendingSnapshotRequest = null;
  stationVersions.clear();
  removeLifecycleListeners();
}

// ---------------------------------------------------------------------------
// Cache merge — pure, exported for tests
// ---------------------------------------------------------------------------

/** How many "earlier" artists a row keeps after a push update. */
const EARLIER_MAX = 3;

/**
 * Merge one pushed spin change into the cached /api/player/onair response.
 * Returns the previous object untouched (same reference) when nothing
 * changes, so repeated deliveries of the same event never cause re-renders.
 *
 * Stations absent from the cached list (previously off-air) are left for the
 * next poll to pick up — the push payload lacks the full station record.
 */
export function mergeSpinIntoOnAir(
  prev: WpOnAirResponse | undefined,
  ev: SpinStreamEvent,
): WpOnAirResponse | undefined {
  if (!prev) return prev;
  const idx = prev.items.findIndex((i) => i.station.slug === ev.stationSlug);
  if (idx < 0) return prev;
  const item = prev.items[idx]!;
  const currentVersion = item.now.stationVersion ?? 0;
  const incomingVersion = ev.stationVersion ?? 0;
  if (
    incomingVersion > 0 &&
    (incomingVersion < currentVersion ||
      (incomingVersion === currentVersion &&
        (ev.eventId ?? 0) <= (item.now.eventId ?? 0)))
  ) {
    return prev;
  }

  // Terminal failure frame: the provisional track never persisted, so no
  // spin-changed is coming. Revert the row to the stashed pre-provisional
  // state (the last persisted spin). No-op unless the row currently shows the
  // matching provisional track — a failure frame for an already-upgraded or
  // never-provisional row must not clobber it.
  if (ev.type === "spin-raw-failed") {
    if (
      !item.now.resolving ||
      item.now.artist !== ev.rawArtist ||
      item.now.title !== ev.rawTitle
    ) {
      return prev;
    }
    const items = [...prev.items];
    const stash = item.now.revertTo;
    items[idx] = stash
      ? {
          ...item,
          now: {
            ...stash.now,
            ...(ev.eventId != null ? { eventId: ev.eventId } : {}),
            ...(ev.stationVersion != null
              ? { stationVersion: ev.stationVersion }
              : {}),
          },
          earlier: stash.earlier,
        }
      : {
          ...item,
          now: {
            ...item.now,
            resolving: false,
            ...(ev.eventId != null ? { eventId: ev.eventId } : {}),
            ...(ev.stationVersion != null
              ? { stationVersion: ev.stationVersion }
              : {}),
          },
        };
    return { ...prev, items };
  }

  const provisional = ev.provisional === true;

  const sameTrack =
    item.now.artist === ev.rawArtist &&
    item.now.title === ev.rawTitle &&
    item.now.mbid === (ev.mbid ?? null);
  if (sameTrack) {
    // A resolved (non-provisional) frame for the track currently shown as
    // provisional still completes the fast path when resolution FAILED —
    // the final spin-changed carries mbid: null, making it artist/title/mbid
    // identical to the provisional row. Clear the resolving flag and refresh
    // the observation metadata so the "resolving" cue never sticks forever.
    if (!provisional && item.now.resolving) {
      const items = [...prev.items];
      items[idx] = {
        ...item,
        now: {
          ...item.now,
          resolving: false,
          // Terminal frame reached — the failure-revert stash is obsolete.
          revertTo: undefined,
          observedAt: ev.observedAt ?? item.now.observedAt,
          freshness: "fresh",
          serverTime: ev.observedAt ?? item.now.serverTime,
          timestampKind: "receipt",
          timingReason: "receipt_only",
          timingUncertaintyMs: null,
          sourceStartedAt: null,
          estimatedRemainingMs: null,
          likelyExpiring: false,
          timingConfidence: "unknown",
          ...(ev.eventId != null ? { eventId: ev.eventId } : {}),
          ...(ev.stationVersion != null
            ? { stationVersion: ev.stationVersion }
            : {}),
        },
      };
      return { ...prev, items };
    }
    return prev;
  }

  // A provisional frame carries mbid: null, so sameTrack misses when the
  // display already shows this track RESOLVED — never downgrade a resolved
  // row back to resolving on a duplicate raw observation.
  if (
    provisional &&
    item.now.resolved &&
    item.now.artist === ev.rawArtist &&
    item.now.title === ev.rawTitle
  ) {
    return prev;
  }

  const observedAt = ev.observedAt ?? new Date().toISOString();

  // Promote the outgoing artist into the "earlier" strip, deduped and capped.
  const prevArtist = item.now.artist;
  const earlier =
    prevArtist && prevArtist !== ev.rawArtist && !item.earlier.includes(prevArtist)
      ? [prevArtist, ...item.earlier].slice(0, EARLIER_MAX)
      : item.earlier;

  const items = [...prev.items];
  items[idx] = {
    ...item,
    now: {
      mbid: ev.mbid ?? null,
      title: ev.rawTitle,
      artist: ev.rawArtist,
      // Resolved push events carry the recording's stored artwork. Provisional
      // frames do not have it yet and continue to degrade gracefully.
      artworkUrl: ev.artworkUrl ?? null,
      playedAt: observedAt,
      observedAt,
      freshness: "fresh",
      resolved: ev.mbid != null,
      serverTime: observedAt,
      // SSE reports when Lore observed the change, not when the broadcast
      // started. Withhold expiry until a full read-model response supplies
      // server-authoritative timing provenance.
      timestampKind: "receipt",
      timingReason: "receipt_only",
      timingUncertaintyMs: null,
      sourceStartedAt: null,
      estimatedRemainingMs: null,
      likelyExpiring: false,
      timingConfidence: "unknown",
      // Provisional frames flag the row as still resolving; the matching
      // resolved spin-changed frame replaces it and clears the flag.
      resolving: provisional,
      ...(ev.eventId != null ? { eventId: ev.eventId } : {}),
      ...(ev.stationVersion != null
        ? { stationVersion: ev.stationVersion }
        : {}),
      // Stash the outgoing persisted row so a terminal spin-raw-failed frame
      // can revert to it. Chained provisional frames keep the ORIGINAL stash —
      // reverting to another provisional row would resurrect an unpersisted
      // track. Resolved frames build a fresh `now` without the field, so the
      // stash is dropped the moment a track is confirmed.
      ...(provisional
        ? {
            revertTo:
              item.now.revertTo ?? { now: item.now, earlier: item.earlier },
          }
        : {}),
    },
    earlier,
  };
  return { ...prev, items };
}

/**
 * Merge a completed REST request against cache state that may have advanced by
 * SSE while the request was in flight. Per-station versions decide; equal or
 * unversioned snapshots remain authoritative for compatibility.
 */
export function mergeOnAirSnapshot(
  current: WpOnAirResponse | undefined,
  incoming: WpOnAirResponse,
): WpOnAirResponse {
  if (!current) return incoming;
  const currentBySlug = new Map(
    current.items.map((item) => [item.station.slug, item]),
  );
  return {
    ...incoming,
    items: incoming.items.map((item) => {
      const cached = currentBySlug.get(item.station.slug);
      if (!cached) return item;
      const cachedVersion = cached.now.stationVersion ?? 0;
      const incomingVersion = item.now.stationVersion ?? 0;
      if (cachedVersion > incomingVersion) return cached;
      if (
        cachedVersion === incomingVersion &&
        (cached.now.eventId ?? 0) > (item.now.eventId ?? 0)
      ) {
        return cached;
      }
      return item;
    }),
  };
}

/** Clear only process-local ordering metadata after a server epoch change. */
export function resetOnAirStreamVersions(
  current: WpOnAirResponse | undefined,
): WpOnAirResponse | undefined {
  if (!current) return current;
  return {
    ...current,
    items: current.items.map((item) => ({
      ...item,
      now: {
        ...item.now,
        eventId: undefined,
        stationVersion: undefined,
      },
    })),
  };
}
