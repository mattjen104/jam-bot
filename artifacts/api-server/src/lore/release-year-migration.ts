import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the release-year backfill feature:
 * - `recordings.year_checked_at` — sentinel timestamp set after a definitive
 *   MusicBrainz lookup (hit or legitimate miss). NOT set on 5xx errors so
 *   transient failures are retried on the next tick.
 * Safe to run on every boot — the statement uses IF NOT EXISTS.
 */
export async function applyReleaseYearMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE recordings ADD COLUMN IF NOT EXISTS year_checked_at timestamp
  `);
}
