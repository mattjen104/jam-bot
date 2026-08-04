import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for multi-DJ show attribution.
 *
 * Adds `dj_names` (text[]) to the `shows` table using `ADD COLUMN IF NOT
 * EXISTS`. Safe to run on every boot — existing rows are unaffected (column
 * defaults to NULL, preserving the legacy single-string `dj_name` path).
 *
 * When the ingestion layer populates this column for co-hosted shows the
 * attribution cascade in Dial suppresses individual DJ names and falls back
 * to the show-level sentence automatically — no further code change required.
 */
export async function applyShowDjNamesMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE shows
      ADD COLUMN IF NOT EXISTS dj_names text[]
  `);
  console.info("[migration] shows.dj_names: OK");
}
