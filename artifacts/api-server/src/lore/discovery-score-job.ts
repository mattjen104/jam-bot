import { db, stationsTable, spinsTable, recordingsTable } from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { computeDiscoveryScore } from "./genre-insights.js";

/**
 * Cache each active station's discovery score onto `stations.discovery_score`
 * so the dial can sort by "newest-leaning rotation" without recomputing it
 * over every station's full spin history on every list request. Mirrors the
 * genre-backfill job's shape: a small budgeted batch per tick, self-
 * rescheduling, never throws. Recomputes ALL active stations once per pass
 * (not just ones missing a score) since a station's rotation — and therefore
 * its score — drifts over time as new spins log.
 */

const BATCH_SIZE = 10;
const TICK_MS = 10_000;
// Once a full pass finishes, wait this long before starting the next one —
// discovery score is a slow-moving signal, not worth recomputing constantly.
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
          releaseYear: recordingsTable.releaseYear,
          playedAt: spinsTable.playedAt,
        })
        .from(spinsTable)
        .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
        .where(and(eq(spinsTable.stationId, station.id)));

      const result = computeDiscoveryScore(
        rows.map((r) => ({ releaseYear: r.releaseYear, airedAt: r.playedAt })),
      );

      await db
        .update(stationsTable)
        .set({ discoveryScore: result.score, updatedAt: sql`now()` })
        .where(eq(stationsTable.id, station.id));
    } catch (err) {
      console.error("[lore] discovery-score job failed for station", station.slug, err);
    }
  }
  return stations.length;
}

let running = false;

/** Start the discovery-score caching job. Idempotent — safe on every boot. */
export function startDiscoveryScoreJob(): void {
  if (running) return;
  running = true;

  let offset = 0;
  const tick = async () => {
    try {
      const scored = await scoreStationBatch(offset, BATCH_SIZE);
      if (scored < BATCH_SIZE) {
        // Reached the end of the active-station set — pause before the next pass.
        offset = 0;
        setTimeout(tick, PASS_INTERVAL_MS);
        return;
      }
      offset += scored;
    } catch (err) {
      console.error("[lore] discovery-score job tick failed", err);
    }
    setTimeout(tick, TICK_MS);
  };
  setTimeout(tick, WARMUP_MS);
}
