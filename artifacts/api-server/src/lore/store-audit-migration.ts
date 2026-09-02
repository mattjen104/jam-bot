import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Adds the durable, operator-only homepage store evidence columns.
 * The status is text rather than a database enum so the scraper can evolve
 * its failure vocabulary without coupling deploy order to enum migrations.
 */
export async function applyStoreAuditMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS store_url text,
      ADD COLUMN IF NOT EXISTS store_label text,
      ADD COLUMN IF NOT EXISTS store_signal text,
      ADD COLUMN IF NOT EXISTS store_status text,
      ADD COLUMN IF NOT EXISTS store_checked_at timestamptz
  `);
  console.info("[migration] station store audit fields: OK");
}