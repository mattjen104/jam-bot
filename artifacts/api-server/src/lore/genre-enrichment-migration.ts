import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Add the durable genre-enrichment funnel fields and classify rows that were
 * processed before the funnel existed.
 *
 * `genre_enriched_at` already represented a definitive answer in the old
 * schema. Existing rows can therefore be safely split into found/no_result;
 * rows without it remain pending. Synthetic Spotify rows are explicitly
 * ineligible so future backfill passes never send them to a provider.
 */
export async function applyGenreEnrichmentMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE recordings
      ADD COLUMN IF NOT EXISTS genre_enrichment_status text NOT NULL DEFAULT 'pending'
  `);
  await db.execute(sql`
    ALTER TABLE recordings
      ADD COLUMN IF NOT EXISTS genre_enrichment_attempted_at timestamp
  `);
  await db.execute(sql`
    ALTER TABLE recordings
      ADD COLUMN IF NOT EXISTS genre_enrichment_error text
  `);

  await db.execute(sql`
    UPDATE recordings
    SET
      genre_enrichment_status = CASE
        WHEN mbid LIKE 'sp:%' THEN 'ineligible'
        WHEN genre_enriched_at IS NOT NULL
          AND genres IS NOT NULL
          AND cardinality(genres) > 0 THEN 'found'
        WHEN genre_enriched_at IS NOT NULL THEN 'no_result'
        ELSE genre_enrichment_status
      END,
      genre_enrichment_attempted_at = CASE
        WHEN genre_enriched_at IS NOT NULL
          AND genre_enrichment_attempted_at IS NULL
        THEN genre_enriched_at
        ELSE genre_enrichment_attempted_at
      END
    WHERE genre_enrichment_status = 'pending'
      AND (
        mbid LIKE 'sp:%'
        OR genre_enriched_at IS NOT NULL
      )
  `);
}