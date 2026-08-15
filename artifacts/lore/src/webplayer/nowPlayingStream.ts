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
 * their normal 30-second polling cadence as the backstop. A successful open
 * resets the failure count and marks the stream healthy, letting polling
 * stretch its interval.
 */

import type { WpOnAirResponse } from "./hooks";

/** Compact per-station spin-change payload (mirrors the server's SpinChangedEvent). */
export interface SpinStreamEvent {
  stationSlug: string;
  rawArtist: string;
  rawTitle: string;
  mbid: string | null;
  /** ISO timestamp of when the server observed the spin. Best-effort field. */
  observedAt?: string;
  /** Resolution confidence tier ("recording_id" | "isrc" | "text" | "spotify" | "unresolved"). */
  confidence?: string;
  isLibraryHit?: boolean;
  isArtistHit?: boolean;
}

type SpinListener = (ev: SpinStreamEvent) => void;
type HealthListener = (healthy: boolean) => void;

/** Consecutive connection failures before the stream is declared degraded. */
export const STREAM_DEGRADED_AFTER_FAILURES = 3;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

const STREAM_URL = "/api/stations/now-playing/stream";

const spinListeners = new Set<SpinListener>();
const healthListeners = new Set<HealthListener>();

let es: EventSource | null = null;
let healthy = false;
let consecutiveFailures = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function setHealthy(next: boolean): void {
  if (healthy === next) return;
  healthy = next;
  for (const cb of healthListeners) cb(next);
}

/** True when the SSE stream is currently open and delivering events. */
export function getStreamHealthy(): boolean {
  return healthy;
}

function openStream(): void {
  if (es || typeof EventSource === "undefined") return;
  if (spinListeners.size === 0 && healthListeners.size === 0) return;

  const source = new EventSource(STREAM_URL);
  es = source;

  source.onopen = () => {
    consecutiveFailures = 0;
    setHealthy(true);
  };

  source.onmessage = (msg: MessageEvent) => {
    let ev: SpinStreamEvent | null = null;
    try {
      const data = JSON.parse(msg.data as string) as Partial<SpinStreamEvent>;
      if (typeof data.stationSlug === "string" && data.stationSlug) {
        ev = {
          stationSlug: data.stationSlug,
          rawArtist: data.rawArtist ?? "",
          rawTitle: data.rawTitle ?? "",
          mbid: data.mbid ?? null,
          ...(data.observedAt ? { observedAt: data.observedAt } : {}),
          ...(data.confidence ? { confidence: data.confidence } : {}),
          ...(data.isLibraryHit != null ? { isLibraryHit: data.isLibraryHit } : {}),
          ...(data.isArtistHit != null ? { isArtistHit: data.isArtistHit } : {}),
        };
      }
    } catch {
      // Unparseable frame (keep-alive comments never reach onmessage, but be safe).
    }
    if (!ev) return;
    for (const cb of spinListeners) cb(ev);
  };

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

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (spinListeners.size === 0 && healthListeners.size === 0) return;
  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1),
    RECONNECT_MAX_MS,
  );
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openStream();
  }, delay);
}

function maybeClose(): void {
  if (spinListeners.size > 0 || healthListeners.size > 0) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  es?.close();
  es = null;
  consecutiveFailures = 0;
  setHealthy(false);
}

/** Subscribe to pushed spin changes. Opens the shared stream on first subscriber. */
export function subscribeSpinStream(listener: SpinListener): () => void {
  spinListeners.add(listener);
  openStream();
  return () => {
    spinListeners.delete(listener);
    maybeClose();
  };
}

/** Subscribe to stream health transitions (healthy ⇄ degraded). */
export function subscribeStreamHealth(listener: HealthListener): () => void {
  healthListeners.add(listener);
  openStream();
  return () => {
    healthListeners.delete(listener);
    maybeClose();
  };
}

/** Tests only: tear down all module state. */
export function _testOnly_resetStream(): void {
  spinListeners.clear();
  healthListeners.clear();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  es?.close();
  es = null;
  consecutiveFailures = 0;
  healthy = false;
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

  const sameTrack =
    item.now.artist === ev.rawArtist &&
    item.now.title === ev.rawTitle &&
    item.now.mbid === (ev.mbid ?? null);
  if (sameTrack) return prev;

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
      // Artwork for the new track is unknown until the next poll — the UI
      // already degrades gracefully on missing art.
      artworkUrl: null,
      playedAt: observedAt,
      observedAt,
      freshness: "fresh",
      resolved: ev.mbid != null,
    },
    earlier,
  };
  return { ...prev, items };
}
