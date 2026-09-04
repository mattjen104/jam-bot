import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Adds show-attribution provenance without guessing at historical rows.
 * Existing show_id values remain provenance-null because their original source
 * cannot be reconstructed reliably after the fact.
 */
export async function applySpinShowAttributionMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE spins
      ADD COLUMN IF NOT EXISTS show_attribution_source text
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'spins_show_attribution_source_ck'
      ) THEN
        ALTER TABLE spins
          ADD CONSTRAINT spins_show_attribution_source_ck
          CHECK (
            show_attribution_source IS NULL
            OR show_attribution_source IN (
              'stream_metadata',
              'source_api',
              'schedule_match',
              'manual'
            )
          );
      END IF;
    END
    $$
  `);
}