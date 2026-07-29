import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the library-export feature:
 * - `recordings.isrc_checked_at` — ISRC enrichment attempt marker.
 * - `library_items.spin_id` — provenance link back to the spin a keep came from.
 * Safe to run on every boot — all statements use IF NOT EXISTS.
 */
export async function applyLibraryExportMigration(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE recordings ADD COLUMN IF NOT EXISTS isrc_checked_at timestamp
    `);
    await db.execute(sql`
      ALTER TABLE library_items ADD COLUMN IF NOT EXISTS spin_id integer REFERENCES spins(id)
    `);
    console.log("[migration] library export fields: OK");
  } catch (err) {
    console.error("[lore] applyLibraryExportMigration failed", err);
  }
}
