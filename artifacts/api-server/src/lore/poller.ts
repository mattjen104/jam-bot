import { db, stationsTable, type Station } from "@workspace/db";
import { getAdapter } from "./adapters.js";
import { logSpinIfChanged } from "./resolve.js";

/**
 * Minimal, safe now-playing poller runtime. No background-worker infra exists in
 * the monorepo yet, so this is deliberately the smallest thing that works: one
 * in-process interval per station, staggered on boot so we don't hammer sources
 * or MusicBrainz all at once. Every tick is wrapped so a single source failing
 * (or being silent) never throws, never blocks request handling, and never kills
 * the loop. This is Phase 1 — a durable queue/worker can replace it later
 * without touching the adapters or resolver.
 */

const DEFAULT_POLL_MS = 45_000;
const STAGGER_MS = 4_000;

let started = false;
const timers: NodeJS.Timeout[] = [];

async function pollStation(station: Station): Promise<void> {
  const adapter = getAdapter(station.nowPlayingSource);
  if (!adapter) return;
  try {
    const np = await adapter(station.nowPlayingConfig ?? {});
    if (!np) return;
    const logged = await logSpinIfChanged(station, np);
    if (logged) {
      console.info(
        `[lore] ${station.slug} now playing: ${np.rawArtist} — ${np.rawTitle}`,
      );
    }
  } catch (err) {
    // Adapters shouldn't throw, but be defensive: one bad tick is a no-op.
    console.error("[lore] poll failed", station.slug, err);
  }
}

/**
 * Start per-station now-playing pollers. Idempotent — safe to call once at boot.
 * Reads the station list once, then schedules a staggered interval per station.
 * If the DB is unreachable at boot it logs and returns without crashing the API.
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

  const pollable = stations.filter((s) => getAdapter(s.nowPlayingSource));
  console.info(`[lore] starting pollers for ${pollable.length} station(s)`);

  pollable.forEach((station, i) => {
    // Stagger the first tick, then run on a fixed interval.
    const kickoff = setTimeout(() => {
      void pollStation(station);
      const interval = setInterval(() => void pollStation(station), DEFAULT_POLL_MS);
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
