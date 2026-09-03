import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Additive sentinel used by the resumable duration backfill. */
export async function applyDurationBackfillMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE recordings
      ADD COLUMN IF NOT EXISTS duration_checked_at timestamp
  `);
}