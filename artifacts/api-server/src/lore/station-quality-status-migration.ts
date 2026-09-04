import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Adds durable recompute outcome fields and makes scoring fields nullable.
 * Null metrics/tier/sample/computed_at mean that scoring has never completed,
 * rather than a fabricated zero-observation measurement.
 */
export async function applyStationQualityStatusMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE station_quality
      ADD COLUMN IF NOT EXISTS recompute_status text NOT NULL DEFAULT 'ok',
      ADD COLUMN IF NOT EXISTS recompute_error text,
      ADD COLUMN IF NOT EXISTS recompute_failed_at timestamp,
      ALTER COLUMN sample_count DROP NOT NULL,
      ALTER COLUMN sample_count DROP DEFAULT,
      ALTER COLUMN quality_tier DROP NOT NULL,
      ALTER COLUMN quality_tier DROP DEFAULT,
      ALTER COLUMN computed_at DROP NOT NULL,
      ALTER COLUMN computed_at DROP DEFAULT
  `);
}