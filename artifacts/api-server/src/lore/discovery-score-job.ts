import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
  showsTable,
  pickersTable,
  picksTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { computeDiscoveryScore, computeGenreBreakdown } from "./genre-insights.js";

/**
 * Cache insights (discovery score + cumulative genre profile) onto stations,
 * shows, and pickers so list pages — the dial sort, the schedule calendar's
 * per-slot genre chips, picker directories — can read them without
 * recomputing over full spin/pick history on every request. Mirrors the
 * genre-backfill job's shape: a small budgeted batch per tick, self-
 * rescheduling, never throws. Recomputes ALL rows once per pass (not just
 * ones missing data) since rotations drift over time as new spins log.
 *
 * A pass walks stations first, then shows, then pickers, then sleeps.
 */

const BATCH_SIZE = 10;
const TICK_MS = 10_000;
// Once a full pass finishes, wait this long before starting the next one —
// these are slow-moving signals, not worth recomputing constantly.
const PASS_INTERVAL_MS = 6 * 60 * 60 * 1000;
const WARMUP_MS = 45_000;

async function scoreStationBatch(offset: number, limit: number): Promise<number> {
  const stations = await db
    .select({ id: stationsTable.id, slug: stationsTable.slug })
    .from(stationsTable)
    .where(eq(stationsTable.active, true))
    .orderBy(asc(stationsTable.id))
    .limit(limit)
    .offset(offset);

  for (const station of stations) {
    try {
      const rows = await db
        .select({
          genres: recordingsTable.genres,
          releaseYear: recordingsTable.releaseYear,
          playedAt: spinsTable.playedAt,
        })
        .from(spinsTable)
        .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
        .where(and(eq(spinsTable.stationId, station.id)));

      const discovery = computeDiscoveryScore(
        rows.map((r) => ({ releaseYear: r.releaseYear, airedAt: r.playedAt })),
      );
      const genreProfile = rows.length > 0 ? computeGenreBreakdown(rows) : null;

      await db
        .update(stationsTable)
        .set({
          discoveryScore: discovery.score,
          genreProfile,
          updatedAt: sql`now()`,
        })
        .where(eq(stationsTable.id, station.id));
    } catch (err) {
      console.error("[lore] insights job failed for station", station.slug, err);
    }
  }
  return stations.length;
}

async function scoreShowBatch(offset: number, limit: number): Promise<number> {
  const shows = await db
    .select({ id: showsTable.id, name: showsTable.name })
    .from(showsTable)
    .orderBy(asc(showsTable.id))
    .limit(limit)
    .offset(offset);

  for (const show of shows) {
    try {
      const rows = await db
        .select({
          genres: recordingsTable.genres,
          releaseYear: recordingsTable.releaseYear,
          playedAt: spinsTable.playedAt,
        })
        .from(spinsTable)
        .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
        .where(eq(spinsTable.showId, show.id));

      const discovery = computeDiscoveryScore(
        rows.map((r) => ({ releaseYear: r.releaseYear, airedAt: r.playedAt })),
      );
      const genreProfile = rows.length > 0 ? computeGenreBreakdown(rows) : null;

      await db
        .update(showsTable)
        .set({
          discoveryScore: discovery.score,
          genreProfile,
          insightsUpdatedAt: sql`now()`,
        })
        .where(eq(showsTable.id, show.id));
    } catch (err) {
      console.error("[lore] insights job failed for show", show.id, show.name, err);
    }
  }
  return shows.length;
}

async function scorePickerBatch(offset: number, limit: number): Promise<number> {
  const pickers = await db
    .select({ id: pickersTable.id, handle: pickersTable.handle })
    .from(pickersTable)
    .where(eq(pickersTable.active, true))
    .orderBy(asc(pickersTable.id))
    .limit(limit)
    .offset(offset);

  for (const picker of pickers) {
    try {
      const rows = await db
        .select({
          genres: recordingsTable.genres,
          releaseYear: recordingsTable.releaseYear,
          pickedAt: picksTable.pickedAt,
        })
        .from(picksTable)
        .innerJoin(recordingsTable, eq(picksTable.mbid, recordingsTable.mbid))
        .where(eq(picksTable.pickerId, picker.id));

      const discovery = computeDiscoveryScore(
        rows
          .filter((r): r is typeof r & { pickedAt: Date } => r.pickedAt != null)
          .map((r) => ({ releaseYear: r.releaseYear, airedAt: r.pickedAt })),
      );
      const genreProfile = rows.length > 0 ? computeGenreBreakdown(rows) : null;

      await db
        .update(pickersTable)
        .set({
          discoveryScore: discovery.score,
          genreProfile,
          insightsUpdatedAt: sql`now()`,
        })
        .where(eq(pickersTable.id, picker.id));
    } catch (err) {
      console.error("[lore] insights job failed for picker", picker.handle, err);
    }
  }
  return pickers.length;
}

type Phase = "stations" | "shows" | "pickers";
const PHASES: Record<Phase, (offset: number, limit: number) => Promise<number>> = {
  stations: scoreStationBatch,
  shows: scoreShowBatch,
  pickers: scorePickerBatch,
};
const PHASE_ORDER: Phase[] = ["stations", "shows", "pickers"];

let running = false;

/** Start the insights (discovery score + genre profile) caching job. Idempotent. */
export function startDiscoveryScoreJob(): void {
  if (running) return;
  running = true;

  let phaseIdx = 0;
  let offset = 0;
  const tick = async () => {
    try {
      const phase = PHASE_ORDER[phaseIdx]!;
      const scored = await PHASES[phase](offset, BATCH_SIZE);
      if (scored < BATCH_SIZE) {
        // Reached the end of this phase's row set — advance to the next
        // phase, or pause before the next full pass after the last one.
        offset = 0;
        phaseIdx++;
        if (phaseIdx >= PHASE_ORDER.length) {
          phaseIdx = 0;
          setTimeout(tick, PASS_INTERVAL_MS);
          return;
        }
      } else {
        offset += scored;
      }
    } catch (err) {
      console.error("[lore] insights job tick failed", err);
    }
    setTimeout(tick, TICK_MS);
  };
  setTimeout(tick, WARMUP_MS);
}
