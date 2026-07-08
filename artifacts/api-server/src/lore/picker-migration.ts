import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the blog picker discovery fields.
 *
 * Adds `health` (jsonb) and `tags` (text[]) to the `pickers` table using
 * `ADD COLUMN IF NOT EXISTS`. Safe to run on every boot — existing rows are
 * unaffected (both columns default to NULL).
 */
export async function applyPickerDiscoveryMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE pickers
      ADD COLUMN IF NOT EXISTS health jsonb,
      ADD COLUMN IF NOT EXISTS tags   text[]
  `);
  console.info("[migration] picker discovery fields: OK");
}
