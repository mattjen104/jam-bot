import { db, recordingsTable, spinsTable } from "@workspace/db";
import { isNull, and, sql, notLike, gte } from "drizzle-orm";
import { createMbResolver, musicbrainzEnabled } from "@workspace/song-enrichment";

/**
 * Release-year/-date backfill — fills `recordings.release_year` (and now the
 * full partial-ISO `release_date`) for recently-spun recordings that still
 * have no year after the genre-backfill pass.
 *
 * Two target sets, processed most-recently-spun first within one batch:
 *
 *   A. Year targets: `release_year IS NULL` AND `year_checked_at IS NULL`
 *      with at least one spin — the original target set. Rows processed here
 *      store BOTH year and full date going forward.
 *
 *   B. Date re-check targets (bounded): recordings whose
 *      `release_year >= currentYear - 1` AND `release_date IS NULL` AND
 *      `release_date_checked_at IS NULL` — regardless of how the year was
 *      obtained (the year backfill sets `year_checked_at`; the genre/live
 *      enrichment path writes `release_year` without it, and those rows must
 *      still converge). Only recently-released tracks can qualify as Dial
 *      "First" (premiere) plays, so these are the only rows whose missing
 *      date can change First-tier classification — the full back-catalog is
 *      deliberately NOT re-checked.
 *
 * Both sets exclude synthetic Spotify-only MBIDs (`sp:%` — they can never be
 * looked up on MusicBrainz).
 *
 * Uses an isolated MusicBrainz resolver chain (createMbResolver — own ≥1.1 s
 * pacing, wall-clock budget cap) so this job never competes with the import
 * worker or the live enrichment pipeline. Sentinel logic:
 *   - Definitive answer (data found OR genuine MB "no date") → set
 *     yearCheckedAt + releaseDateCheckedAt (don't retry)
 *   - MB 5xx / network error → do NOT set either sentinel (retry next tick)
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
  // Shared predicates for both target sets.
  const notSynthetic = notLike(recordingsTable.mbid, "sp:%");
  // Restrict to recordings that have actually aired — prioritises real
  // listener-facing content and avoids touching picker-only catalogue rows
  // that the genre-backfill will eventually reach in its own order.
  const hasSpins = sql`EXISTS (
    SELECT 1 FROM ${spinsTable}
    WHERE ${spinsTable.mbid} = ${recordingsTable.mbid}
  )`;

  const yearTarget = and(
    isNull(recordingsTable.releaseYear),
    isNull(recordingsTable.yearCheckedAt),
    notSynthetic,
    hasSpins,
  );

  // Set B: recent enough to ever be a premiere, and the date lookup hasn't
  // definitively answered yet. Deliberately NOT gated on year_checked_at:
  // the genre/live enrichment path persists release_year without that
  // sentinel, and those rows would otherwise never obtain a full date.
  const dateTarget = and(
    gte(recordingsTable.releaseYear, new Date().getFullYear() - 1),
    isNull(recordingsTable.releaseDate),
    isNull(recordingsTable.releaseDateCheckedAt),
    notSynthetic,
    hasSpins,
  );

  const targetWhere = sql`(${yearTarget}) OR (${dateTarget})`;

  // Order by most-recently-spun first so tracks currently in rotation get
  // years/dates before older historical recordings.
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
      const info = await resolver.fetchReleaseDateInfo(
        row.mbid,
        AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      );
      // Definitive answer (data found OR genuine MB "no date") — mark checked
      // so this row isn't re-queried on every tick. Both sentinels are set:
      // the lookup answered for year and date in a single call.
      if (info?.year != null || info?.releaseDate != null) found++;
      await db
        .update(recordingsTable)
        .set({
          ...(info?.year != null ? { releaseYear: info.year } : {}),
          ...(info?.releaseDate != null ? { releaseDate: info.releaseDate } : {}),
          yearCheckedAt: sql`now()`,
          releaseDateCheckedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(sql`${recordingsTable.mbid} = ${row.mbid}`);
    } catch (err) {
      // 5xx / network error — do NOT set the checked sentinels so the row is
      // retried on the next tick. Log and continue so one bad row doesn't
      // wedge the whole batch.
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
