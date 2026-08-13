import { db, recordingsTable, spinsTable } from "@workspace/db";
import { isNull, and, sql, notLike } from "drizzle-orm";
import { createMbResolver, musicbrainzEnabled } from "@workspace/song-enrichment";

/**
 * Release-year backfill — fills `recordings.release_year` for recently-spun
 * recordings that still have no year after the genre-backfill pass.
 *
 * Target set: recordings with `release_year IS NULL` AND `year_checked_at IS NULL`
 * that have at least one spin AND are not synthetic Spotify-only MBIDs (those
 * can never be looked up on MusicBrainz).
 *
 * Uses an isolated MusicBrainz resolver chain (createMbResolver — own ≥1.1 s
 * pacing, wall-clock budget cap) so this job never competes with the import
 * worker or the live enrichment pipeline. Sentinel logic:
 *   - Year found or legitimate MB "no date"  → set yearCheckedAt (don't retry)
 *   - MB 5xx / network error                 → do NOT set yearCheckedAt (retry)
 */

const resolver = createMbResolver();

/** Per-lookup hard cap so one hung call can't wedge the batch. */
const LOOKUP_TIMEOUT_MS = 15_000;

/** Wall-clock budget for the whole batch — prevents one slow run bleeding over. */
const BATCH_BUDGET_MS = 60_000;

export async function backfillReleaseYearBatch(batchSize = 20): Promise<{
  scanned: number;
  found: number;
  remaining: number;
}> {
  const targetWhere = and(
    isNull(recordingsTable.releaseYear),
    isNull(recordingsTable.yearCheckedAt),
    // Synthetic `sp:` MBIDs can't be looked up on MusicBrainz — skip them.
    notLike(recordingsTable.mbid, "sp:%"),
    // Restrict to recordings that have actually aired — prioritises real
    // listener-facing content and avoids touching picker-only catalogue rows
    // that the genre-backfill will eventually reach in its own order.
    sql`EXISTS (
      SELECT 1 FROM ${spinsTable}
      WHERE ${spinsTable.mbid} = ${recordingsTable.mbid}
    )`,
  );

  // Order by most-recently-spun first so tracks currently in rotation get
  // years before older historical recordings.
  const rows = await db
    .select({ mbid: recordingsTable.mbid })
    .from(recordingsTable)
    .where(targetWhere)
    .orderBy(
      sql`(SELECT MAX(played_at) FROM spins WHERE spins.mbid = ${recordingsTable.mbid}) DESC NULLS LAST`,
    )
    .limit(batchSize);

  let found = 0;
  const batchDeadline = Date.now() + BATCH_BUDGET_MS;

  for (const row of rows) {
    if (Date.now() > batchDeadline) {
      console.warn("[lore] release-year backfill: batch budget exceeded, stopping early");
      break;
    }
    try {
      const year = await resolver.fetchReleaseYear(
        row.mbid,
        AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      );
      // Definitive answer (year found OR genuine MB "no date") — mark checked
      // so this row isn't re-queried on every tick.
      if (year != null) found++;
      await db
        .update(recordingsTable)
        .set({
          ...(year != null ? { releaseYear: year } : {}),
          yearCheckedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(sql`${recordingsTable.mbid} = ${row.mbid}`);
    } catch (err) {
      // 5xx / network error — do NOT set yearCheckedAt so the row is retried
      // on the next tick. Log and continue so one bad row doesn't wedge the
      // whole batch.
      console.error("[lore] release-year backfill row failed", row.mbid, err);
    }
  }

  const [remainingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordingsTable)
    .where(targetWhere);

  return { scanned: rows.length, found, remaining: remainingRow?.count ?? 0 };
}

/**
 * Self-rescheduling loop. New spins land continuously, so when the unchecked
 * set empties this idles on a slow tick rather than exiting — matching the
 * ISRC enrichment job's behaviour.
 */
const ACTIVE_TICK_MS = 15_000;
const IDLE_TICK_MS = 10 * 60_000;
let running = false;

export function startReleaseYearBackfillJob(): void {
  if (running) return;
  if (!musicbrainzEnabled()) {
    console.warn("[lore] release-year backfill disabled: MusicBrainz not configured");
    return;
  }
  running = true;
  const tick = async () => {
    let nextMs = IDLE_TICK_MS;
    try {
      const result = await backfillReleaseYearBatch();
      if (result.remaining > 0) nextMs = ACTIVE_TICK_MS;
    } catch (err) {
      console.error("[lore] release-year backfill tick failed", err);
    }
    setTimeout(tick, nextMs);
  };
  // Small initial delay so the job doesn't compete with boot-time DB pressure.
  setTimeout(tick, ACTIVE_TICK_MS);
}
