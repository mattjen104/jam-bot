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
  kexp_api: 120_000, // 2 min
  bbc_api: 120_000, // 2 min
  station_page: 60_000, // 1 min
  radio_paradise: 60_000, // 1 min
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
    }, i * STAGGER_MS);
    timers.push(kickoff);
  });
}

/** Stop all pollers (used in tests / graceful shutdown). */
export function stopLorePoller(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
