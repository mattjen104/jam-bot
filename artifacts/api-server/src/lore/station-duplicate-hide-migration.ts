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
export async function applyStationDuplicateHideMigration(): Promise<void> {
  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT
        id,
        source,
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
      SELECT id
      FROM ranked
      WHERE duplicate_rank > 1
        AND source = 'radio_browser'
    )
    UPDATE stations
    SET hidden = true
    WHERE id IN (SELECT id FROM redundant)
  `);

  console.info(
    JSON.stringify({
      severity: "info",
      migration: "applyStationDuplicateHideMigration",
      affectedRows: result.rowCount ?? 0,
    }),
  );
}