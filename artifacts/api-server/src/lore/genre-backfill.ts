import { db, recordingsTable } from "@workspace/db";
import { and, isNull, sql, desc } from "drizzle-orm";
import { fetchGenreAndYear } from "@workspace/song-enrichment";

/**
 * Genre/release-year backfill — converges historical recordings that landed
 * via a deep-history backfill slice (`enrichLinks: false`, see resolve.ts)
 * or a picker pick (never link-enriched at all), and so never got a chance
 * to pick up genre/year on ingest.
 *
 * Every row in `recordings` was created by a resolved spin or pick, so
 * "recordings missing genre/year" is exactly the backfill target set — no
 * separate spins/picks scan needed.
 *
 * Runs a small budgeted batch per call (paced by MusicBrainz's ~1 req/sec
 * limit via `fetchGenreAndYear`'s internal MB gate) so it can be driven by a
 * slow self-rescheduling loop or an admin-triggered one-shot, same shape as
 * the station history backfill. Never throws; per-row failures are logged and
 * skipped so one bad recording can't wedge the whole batch.
 */
export async function backfillGenreBatch(batchSize = 25): Promise<{
  scanned: number;
  updated: number;
  remaining: number;
}> {
  // Target set is rows never *attempted*, not rows currently null — a
  // legitimate "MusicBrainz/Last.fm had nothing" result still counts as
  // converged (marked via `genreEnrichedAt`) and must not be re-selected
  // forever, or this job would never reach `remaining === 0` and would keep
  // hammering MusicBrainz/Last.fm for the same permanently-unknown rows.
  // Order by most-recently-spun first so the tracks currently visible in the
  // schedule get genres before the long tail of historical recordings. Recordings
  // with no spins at all (picker-only entries) sink to the bottom via NULLS LAST.
  const rows = await db
    .select({
      mbid: recordingsTable.mbid,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
    })
    .from(recordingsTable)
    .where(isNull(recordingsTable.genreEnrichedAt))
    .orderBy(
      sql`(SELECT MAX(played_at) FROM spins WHERE spins.mbid = ${recordingsTable.mbid}) DESC NULLS LAST`,
    )
    .limit(batchSize);

  let updated = 0;
  for (const row of rows) {
    try {
      const g = await fetchGenreAndYear(row.mbid, row.artist, row.artistMbid);
      if (g.genres.length) updated++;
      await db
        .update(recordingsTable)
        .set({
          ...(g.genres.length ? { genres: g.genres } : {}),
          ...(g.year != null ? { releaseYear: g.year } : {}),
          genreEnrichedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(sql`${recordingsTable.mbid} = ${row.mbid}`));
    } catch (err) {
      console.error("[lore] genre backfill row failed", row.mbid, err);
    }
  }

  const [remainingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordingsTable)
    .where(isNull(recordingsTable.genreEnrichedAt));

  return {
    scanned: rows.length,
    updated,
    remaining: remainingRow?.count ?? 0,
  };
}

/**
 * Self-rescheduling loop: one budgeted batch per tick until the whole table
 * has converged, then stops (idempotent — a later call with fresh unconverged
 * rows, e.g. after new spins, will pick back up). Mirrors the station-history
 * backfill job's shape (see backfill.ts) so operational behavior is familiar.
 */
const TICK_MS = 15_000;
let running = false;

export function startGenreBackfillJob(): void {
  if (running) return;
  running = true;
  const tick = async () => {
    try {
      const result = await backfillGenreBatch();
      if (result.remaining === 0) {
        running = false;
        return;
      }
    } catch (err) {
      console.error("[lore] genre backfill tick failed", err);
    }
    setTimeout(tick, TICK_MS);
  };
  setTimeout(tick, TICK_MS);
}
