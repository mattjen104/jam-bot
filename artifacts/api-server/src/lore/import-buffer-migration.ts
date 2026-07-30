import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the import buffer persistence feature:
 * - Adds `buffer_json` (jsonb) to `library_import_jobs` so the fetched track
 *   list survives server restarts and a resumed import can skip re-fetching.
 */
export async function applyImportBufferMigration(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE library_import_jobs
        ADD COLUMN IF NOT EXISTS buffer_json jsonb
    `);
    console.log("[migration] import buffer column: OK");
  } catch (err) {
    console.error("[lore] applyImportBufferMigration failed", err);
  }
}
