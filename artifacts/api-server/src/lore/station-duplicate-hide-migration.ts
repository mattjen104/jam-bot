import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Soft-hide redundant Radio Browser rows that resolve to the exact same stream.
 *
 * A curated row always wins over a Radio Browser duplicate. When every copy is
 * from Radio Browser, prefer a healthy row with metadata and stronger directory
 * evidence. Only Radio Browser rows are hidden; manually curated rows are never
 * changed, and spin/history rows remain intact.
 *
 * Idempotent: hidden rows leave the ranked candidate set, while the surviving
 * canonical row remains visible on later runs.
 */
export async function applyStationDuplicateHideMigration(
  database: Pick<typeof db, "execute"> = db,
): Promise<void> {
  const result = await database.execute(sql`
    WITH ranked AS (
      SELECT
        id,
        source,
        FIRST_VALUE(id) OVER (
          PARTITION BY LOWER(BTRIM(stream_url))
          ORDER BY
            CASE WHEN source = 'radio_browser' THEN 1 ELSE 0 END,
            CASE WHEN now_playing_source IS NULL THEN 1 ELSE 0 END,
            CASE WHEN active THEN 0 ELSE 1 END,
            CASE WHEN automation_class = 'human' THEN 0 ELSE 1 END,
            COALESCE(votes, 0) DESC,
            COALESCE(clickcount, 0) DESC,
            id
        ) AS canonical_id,
        ROW_NUMBER() OVER (
          PARTITION BY LOWER(BTRIM(stream_url))
          ORDER BY
            CASE WHEN source = 'radio_browser' THEN 1 ELSE 0 END,
            CASE WHEN now_playing_source IS NULL THEN 1 ELSE 0 END,
            CASE WHEN active THEN 0 ELSE 1 END,
            CASE WHEN automation_class = 'human' THEN 0 ELSE 1 END,
            COALESCE(votes, 0) DESC,
            COALESCE(clickcount, 0) DESC,
            id
        ) AS duplicate_rank
      FROM stations
      WHERE hidden = false
        AND stream_url IS NOT NULL
        AND BTRIM(stream_url) <> ''
    ),
    redundant AS (
      SELECT id, canonical_id
      FROM ranked
      WHERE duplicate_rank > 1
        AND source = 'radio_browser'
    )
    UPDATE stations
    SET
      hidden = true,
      automatic_cull_reason = 'duplicate_stream',
      automatic_cull_canonical_station_id = redundant.canonical_id
    FROM redundant
    WHERE stations.id = redundant.id
  `);

  // Older deployments hid duplicate rows before provenance was available.
  // Recover their visible canonical peer so operators can review the same
  // information after upgrading.
  const backfilled = await database.execute(sql`
    WITH visible_ranked AS (
      SELECT
        id,
        LOWER(BTRIM(stream_url)) AS stream_key,
        ROW_NUMBER() OVER (
          PARTITION BY LOWER(BTRIM(stream_url))
          ORDER BY
            CASE WHEN source = 'radio_browser' THEN 1 ELSE 0 END,
            CASE WHEN now_playing_source IS NULL THEN 1 ELSE 0 END,
            CASE WHEN active THEN 0 ELSE 1 END,
            CASE WHEN automation_class = 'human' THEN 0 ELSE 1 END,
            COALESCE(votes, 0) DESC,
            COALESCE(clickcount, 0) DESC,
            id
        ) AS duplicate_rank
      FROM stations
      WHERE hidden = false
        AND stream_url IS NOT NULL
        AND BTRIM(stream_url) <> ''
    )
    UPDATE stations hidden_duplicate
    SET
      automatic_cull_reason = 'duplicate_stream',
      automatic_cull_canonical_station_id = visible_ranked.id
    FROM visible_ranked
    WHERE hidden_duplicate.hidden = true
      AND hidden_duplicate.automatic_cull_reason IS NULL
      AND hidden_duplicate.source = 'radio_browser'
      AND hidden_duplicate.stream_url IS NOT NULL
      AND BTRIM(hidden_duplicate.stream_url) <> ''
      AND LOWER(BTRIM(hidden_duplicate.stream_url)) = visible_ranked.stream_key
      AND visible_ranked.duplicate_rank = 1
      AND hidden_duplicate.id <> visible_ranked.id
  `);

  console.info(
    JSON.stringify({
      severity: "info",
      migration: "applyStationDuplicateHideMigration",
      affectedRows: (result.rowCount ?? 0) + (backfilled.rowCount ?? 0),
      newlyHidden: result.rowCount ?? 0,
      provenanceBackfilled: backfilled.rowCount ?? 0,
    }),
  );
}