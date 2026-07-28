import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the donate-URL health-check column.
 * Safe to run on every boot — ADD COLUMN IF NOT EXISTS is a no-op when the
 * column already exists (drizzle-kit push will have added it in new installs;
 * this covers deployed instances that were created before the schema change).
 */
export async function applyDonateCheckerMigration(): Promise<void> {
  // Timestamp of the most recent HEAD-check against this station's donate_url,
  // regardless of outcome. Null = never checked. Re-checked on the same 30-day
  // cadence as homepage scraping.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS donate_checked_at timestamptz
  `);
  console.info("[migration] donate_checked_at column: OK");
}
