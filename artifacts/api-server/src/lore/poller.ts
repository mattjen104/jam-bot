import { db, stationsTable, type Station } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getNowPlayingAdapter,
  getHistoryAdapter,
  isPollable,
} from "./adapters.js";
import { logSpinIfChanged, ingestRawSpins } from "./resolve.js";
import type { HistoryAdapter, RawSpin } from "./types.js";

/**
 * Minimal, safe ingestion poller. No background-worker infra exists in the
 * monorepo yet, so this is deliberately the smallest thing that works: one
 * in-process interval per station, staggered on boot so we never hammer sources
 * or MusicBrainz all at once. Every tick is wrapped so a single source failing
 * (or being silent) never throws, never blocks request handling, and never kills
 * the loop. A durable queue/worker can replace this later without touching the
 * adapters or resolver.
 *
 * Two ingest paths, chosen per source:
 *  - History adapters (KEXP/Spinitron/BBC) page recent plays newest-first and
 *    ingest idempotently against a per-station cursor. Every poll walks pages
 *    back until it reaches the last-seen cursor (bounded by a catch-up cap), so
 *    a gap longer than one page — e.g. after downtime — never silently drops
 *    plays. On first enroll (no cursor) it pages a bounded backfill window.
 *  - Now-playing adapters (Radio Paradise / station_page) fetch "the current
 *    track" and log on change.
 */

// Per-source poll cadence. History sources move at roughly song length; now-
// playing sources are cheap so they can be a touch tighter.
const POLL_INTERVALS_MS: Record<string, number> = {
  spinitron: 150_000, // 2.5 min
  spinitron_web: 150_000, // 2.5 min — HTML scrape, same cadence as API adapter
  kexp_api: 120_000, // 2 min
  bbc_api: 120_000, // 2 min
  somafm: 120_000, // 2 min — feed holds ~20 songs, no risk of gaps
  kcrw: 90_000, // 1.5 min — single current track, cheap endpoint
  station_page: 60_000, // 1 min
  radio_paradise: 60_000, // 1 min
  nts_live: 120_000, // 2 min — show-level, changes infrequently
  fip: 60_000, // 1 min — per-track metadata, songs ~3-5 min
  radio_browser_icy: 30_000, // 30 s — ICY metadata is cheap to fetch
  radiojar: 60_000, // 1 min — unauthenticated JSON now-playing endpoint
};
const DEFAULT_POLL_MS = 90_000;
const STAGGER_MS = 4_000;

// Paging: plays per page, and the max plays a single poll will walk back. A
// steady-state poll finds the cursor on page 0 (one request); the cap bounds
// catch-up after downtime and the first-enroll backfill. ingestRawSpins dedups
// the overlap, so a generous page size costs no extra MusicBrainz calls.
const PAGE_SIZE = 50;
const MAX_CATCHUP = 200;

let started = false;
const timers: NodeJS.Timeout[] = [];

/**
 * Station ids with a poll currently in flight. Prevents overlapping ticks
 * for the same station — e.g. a slow fetch on a tight interval (radio_browser_icy
 * is 30s) can otherwise let two ticks race: both read the same "last spin" before
 * either write commits, both pass the dedup check, and both insert an identical
 * spin. Skipping a tick that's still running is always safe (the next tick
 * picks up the current now-playing state anyway).
 */
const inFlight = new Set<number>();

/**
 * Per-station interval/kickoff handles, keyed by station id.
 * Populated by enrollStationPoller; cleared by unenrollStationPoller.
 * Allows DELETE to immediately stop polling without waiting for a restart.
 */
const stationTimers = new Map<number, NodeJS.Timeout[]>();

function trackStationTimer(stationId: number, handle: NodeJS.Timeout): void {
  const list = stationTimers.get(stationId) ?? [];
  list.push(handle);
  stationTimers.set(stationId, list);
}

function intervalFor(source: string | null | undefined): number {
  return (source && POLL_INTERVALS_MS[source]) || DEFAULT_POLL_MS;
}

/**
 * Page a history source newest-first until the batch reaches `cursor` (the
 * newest externalId we've already ingested), a page runs short (source has no
 * more history), or we hit `maxPlays`. Returns the union of pages; the ingest
 * path dedups the overlap. On first enroll (`cursor` null) it simply pages the
 * bounded backfill window. Never throws — a failed page just ends paging with
 * whatever was collected so far.
 */
export async function fetchPlaysUntilCursor(
  history: HistoryAdapter,
  config: Record<string, unknown>,
  cursor: string | null,
  maxPlays: number,
  pageSize: number = PAGE_SIZE,
): Promise<RawSpin[]> {
  const collected: RawSpin[] = [];
  for (let page = 0; collected.length < maxPlays; page++) {
    const limit = Math.min(pageSize, maxPlays - collected.length);
    let batch: RawSpin[];
    try {
      batch = await history(config, { limit, page });
    } catch (err) {
      console.error("[lore] history page fetch failed", page, err);
      break;
    }
    if (!batch.length) break;
    collected.push(...batch);
    // This page already contains the newest play we've ingested — everything
    // older is known, so stop.
    if (cursor && batch.some((s) => s.externalId === cursor)) break;
    // A short page means the source has no deeper history to walk.
    if (batch.length < limit) break;
  }
  return collected;
}

/**
 * Poll one station once. History sources reload the station row first so the
 * cursor advanced by a previous tick is honored (and to detect first-enroll
 * backfill). Never throws.
 */
async function pollStation(station: Station): Promise<void> {
  if (inFlight.has(station.id)) return;
  inFlight.add(station.id);
  const source = station.nowPlayingSource;
  try {
    const history = getHistoryAdapter(source);
    if (history) {
      // Reload for the freshest cursor (advanced by prior ticks / enroll).
      const [fresh] = await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.id, station.id))
        .limit(1);
      const current = fresh ?? station;
      const cursor = current.lastSeenCursor ?? null;
      const firstEnroll = !cursor;
      const spins = await fetchPlaysUntilCursor(
        history,
        current.nowPlayingConfig ?? {},
        cursor,
        MAX_CATCHUP,
      );
      const logged = await ingestRawSpins(current, spins, source ?? "unknown");
      if (logged > 0) {
        console.info(
          `[lore] ${current.slug} ingested ${logged} spin(s)` +
            (firstEnroll ? " (backfill)" : ""),
        );
      }
      return;
    }

    const nowPlaying = getNowPlayingAdapter(source);
    if (!nowPlaying) return;
    const np = await nowPlaying(station.nowPlayingConfig ?? {});
    if (!np) return;
    const wrote = await logSpinIfChanged(station, np);
    if (wrote) {
      console.info(
        `[lore] ${station.slug} now playing: ${np.rawArtist} — ${np.rawTitle}`,
      );
    }
  } catch (err) {
    console.error("[lore] poll failed", station.slug, err);
  } finally {
    inFlight.delete(station.id);
  }
}

/**
 * Start per-station pollers. Idempotent — safe to call once at boot. Reads the
 * station list once, then schedules a staggered, per-source interval per
 * station. If the DB is unreachable at boot it logs and returns without
 * crashing the API.
 */
export async function startLorePoller(): Promise<void> {
  if (started) return;
  started = true;

  let stations: Station[];
  try {
    stations = await db.select().from(stationsTable);
  } catch (err) {
    console.error("[lore] poller could not load stations; not started", err);
    started = false;
    return;
  }

  const pollable = stations.filter((s) => isPollable(s.nowPlayingSource));
  console.info(`[lore] starting pollers for ${pollable.length} station(s)`);

  pollable.forEach((station, i) => {
    const period = intervalFor(station.nowPlayingSource);
    const kickoff = setTimeout(() => {
      void pollStation(station);
      const interval = setInterval(() => void pollStation(station), period);
      timers.push(interval);
      // Register in stationTimers so unenrollStationPoller can cancel
      // boot-time loops, not just runtime-enrolled ones.
      trackStationTimer(station.id, interval);
    }, i * STAGGER_MS);
    timers.push(kickoff);
    trackStationTimer(station.id, kickoff);
  });
}

/** Stop all pollers (used in tests / graceful shutdown). */
export function stopLorePoller(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}

/**
 * Register a newly enrolled station for live polling without restarting the
 * whole poller. Fires an immediate first poll and then schedules the recurring
 * interval at the source-appropriate cadence. Per-station timers are tracked
 * so that unenrollStationPoller can cancel them immediately.
 *
 * Calling this twice for the same station adds a second interval — callers
 * must ensure they call this once per enrollment (admin enroll endpoint does).
 *
 * Called by the admin enrollment endpoint immediately after inserting a new
 * radio_browser_icy station row so it starts appearing in timelines right away.
 */
export function enrollStationPoller(station: Station): void {
  if (!isPollable(station.nowPlayingSource)) return;
  // Clear any existing timers for this station so re-enrollment (e.g. admin
  // calling enroll twice for the same UUID) doesn't create duplicate loops.
  unenrollStationPoller(station.id);
  const period = intervalFor(station.nowPlayingSource);
  const kickoff = setTimeout(() => {
    void pollStation(station);
    const interval = setInterval(() => void pollStation(station), period);
    timers.push(interval);
    trackStationTimer(station.id, interval);
  }, 0);
  timers.push(kickoff);
  trackStationTimer(station.id, kickoff);
}

/**
 * Cancel all active poll timers for a station, taking effect immediately.
 * Called by the admin DELETE endpoint so removed stations stop being polled
 * without waiting for a process restart.
 */
export function unenrollStationPoller(stationId: number): void {
  const handles = stationTimers.get(stationId);
  if (!handles) return;
  for (const h of handles) clearTimeout(h);
  stationTimers.delete(stationId);
}
