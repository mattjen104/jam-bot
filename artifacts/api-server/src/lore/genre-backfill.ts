import { db, recordingsTable, spinsTable } from "@workspace/db";
import {
  and,
  eq,
  notInArray,
  notLike,
  or,
  sql,
} from "drizzle-orm";
import { fetchGenreAndYear } from "@workspace/song-enrichment";

export const GENRE_RECENT_WINDOW_DAYS = 30;
export const GENRE_TRANSIENT_RETRY_MINUTES = 15;
const FRONT_DOOR_STATION_SHARE = 1;

type GenreCandidate = {
  mbid: string;
  artist: string;
  artistMbid: string | null;
  stationId: number | null;
  lastPlayedAt: Date | null;
};

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
  const rows = await selectFairGenreCandidates(batchSize);

  let updated = 0;
  for (const row of rows) {
    const attemptedAt = new Date();
    try {
      const g = await fetchGenreAndYear(row.mbid, row.artist, row.artistMbid);
      const outcome =
        g.status ?? (g.genres.length > 0 ? "found" : "no_result");
      if (outcome === "found") updated++;
      await db
        .update(recordingsTable)
        .set({
          ...(g.genres.length ? { genres: g.genres } : {}),
          ...(g.year != null ? { releaseYear: g.year } : {}),
          // Store the full partial-ISO date alongside the year so premiere
          // (First-tier) detection isn't limited to whole-year comparisons.
          ...(g.releaseDate != null ? { releaseDate: g.releaseDate } : {}),
          genreEnrichmentStatus: outcome,
          genreEnrichmentAttemptedAt: attemptedAt,
          genreEnrichmentError:
            outcome === "transient_failure"
              ? "Music metadata provider did not respond"
              : null,
          ...(outcome !== "transient_failure"
            ? { genreEnrichedAt: attemptedAt }
            : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(recordingsTable.mbid, row.mbid));
    } catch (err) {
      console.error("[lore] genre backfill row failed", row.mbid, err);
      await db
        .update(recordingsTable)
        .set({
          genreEnrichmentStatus: "transient_failure",
          genreEnrichmentAttemptedAt: attemptedAt,
          genreEnrichmentError:
            err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
          updatedAt: sql`now()`,
        })
        .where(eq(recordingsTable.mbid, row.mbid));
    }
  }

  const [remainingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordingsTable)
    .where(
      and(
        or(
          eq(recordingsTable.genreEnrichmentStatus, "pending"),
          eq(recordingsTable.genreEnrichmentStatus, "transient_failure"),
        ),
        notLike(recordingsTable.mbid, "sp:%"),
      ),
    );

  return {
    scanned: rows.length,
    updated,
    remaining: remainingRow?.count ?? 0,
  };
}

/**
 * Return a recent-first batch with a bounded share for each active,
 * non-hidden, crossing-eligible station. The SQL window gives every station
 * the same first-slot opportunity even when one station has many more spins.
 * A global fallback fills unused slots with the remaining recent queue and
 * picker-only rows, preserving eventual historical convergence.
 */
async function selectFairGenreCandidates(batchSize: number): Promise<GenreCandidate[]> {
  if (batchSize <= 0) return [];

  const fairResult = await db.execute(sql`
    WITH front_door AS (
      SELECT id
      FROM stations
      WHERE active = true
        AND hidden = false
        AND crossing_eligible = true
    ),
    ranked AS (
      SELECT
        r.mbid AS "mbid",
        r.artist AS "artist",
        r.artist_mbid AS "artistMbid",
        s.station_id AS "stationId",
        max(s.played_at) AS "lastPlayedAt",
        row_number() OVER (
          PARTITION BY s.station_id
          ORDER BY max(s.played_at) DESC, r.mbid
        ) AS station_rank
      FROM recordings r
      INNER JOIN spins s ON s.mbid = r.mbid
      INNER JOIN front_door fd ON fd.id = s.station_id
      WHERE (
          r.genre_enrichment_status = 'pending'
          OR (
            r.genre_enrichment_status = 'transient_failure'
            AND (
              r.genre_enrichment_attempted_at IS NULL
              OR r.genre_enrichment_attempted_at <=
                now() - (${GENRE_TRANSIENT_RETRY_MINUTES} * interval '1 minute')
            )
          )
        )
        AND r.mbid NOT LIKE 'sp:%'
        AND s.played_at >=
          now() - (${GENRE_RECENT_WINDOW_DAYS} * interval '1 day')
      GROUP BY r.mbid, r.artist, r.artist_mbid, s.station_id
    )
    SELECT "mbid", "artist", "artistMbid", "stationId", "lastPlayedAt"
    FROM ranked
    WHERE station_rank <= GREATEST(
      ${FRONT_DOOR_STATION_SHARE},
      CEIL(
        ${batchSize}::numeric /
        GREATEST((SELECT count(*) FROM front_door), 1)
      )
    )
    ORDER BY station_rank, "lastPlayedAt" DESC NULLS LAST, "stationId", "mbid"
    LIMIT ${batchSize}
  `);

  const fairRows: GenreCandidate[] = [];
  const fairMbids = new Set<string>();
  for (const row of (fairResult?.rows ?? []) as GenreCandidate[]) {
    if (fairMbids.has(row.mbid)) continue;
    fairMbids.add(row.mbid);
    fairRows.push(row);
  }
  const chosen = new Set(fairRows.map((row) => row.mbid));
  const remaining = batchSize - chosen.size;
  if (remaining <= 0) return fairRows.slice(0, batchSize);

  const fallbackRows = await db
    .select({
      mbid: recordingsTable.mbid,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      stationId: sql<number | null>`(
        SELECT s.station_id
        FROM ${spinsTable} s
        WHERE s.mbid = ${recordingsTable.mbid}
        ORDER BY s.played_at DESC
        LIMIT 1
      )`,
      lastPlayedAt: sql<Date | null>`(
        SELECT max(s.played_at)
        FROM ${spinsTable} s
        WHERE s.mbid = ${recordingsTable.mbid}
      )`,
    })
    .from(recordingsTable)
    .where(
      and(
        or(
          eq(recordingsTable.genreEnrichmentStatus, "pending"),
          and(
            eq(recordingsTable.genreEnrichmentStatus, "transient_failure"),
            sql`(
              ${recordingsTable.genreEnrichmentAttemptedAt} IS NULL
              OR ${recordingsTable.genreEnrichmentAttemptedAt} <=
                now() - (${GENRE_TRANSIENT_RETRY_MINUTES} * interval '1 minute')
            )`,
          ),
        ),
        notLike(recordingsTable.mbid, "sp:%"),
        chosen.size > 0
          ? notInArray(recordingsTable.mbid, [...chosen])
          : undefined,
      ),
    )
    .orderBy(sql`(
      SELECT max(s.played_at)
      FROM ${spinsTable} s
      WHERE s.mbid = ${recordingsTable.mbid}
    ) DESC NULLS LAST`)
    .limit(remaining);

  return [...fairRows, ...fallbackRows].slice(0, batchSize);
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
