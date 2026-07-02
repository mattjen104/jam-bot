import { db, stationsTable, type Station } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getNowPlayingAdapter,
  getHistoryAdapter,
  isPollable,
} from "./adapters.js";
import { logSpinIfChanged, ingestRawSpins } from "./resolve.js";

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
 *  - History adapters (KEXP/Spinitron/BBC) fetch a batch of recent plays and
 *    ingest idempotently against a per-station cursor. On first enroll (no
 *    cursor yet) we pull a larger backfill window once, then poll a small
 *    increment.
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

// Live increment vs first-enroll backfill window (in plays).
const LIVE_LIMIT = 20;
const BACKFILL_LIMIT = 200;

let started = false;
const timers: NodeJS.Timeout[] = [];

function intervalFor(source: string | null | undefined): number {
  return (source && POLL_INTERVALS_MS[source]) || DEFAULT_POLL_MS;
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
      const firstEnroll = !current.lastSeenCursor;
      const limit = firstEnroll ? BACKFILL_LIMIT : LIVE_LIMIT;
      const spins = await history(current.nowPlayingConfig ?? {}, { limit });
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
