import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the library-sync feature:
 * - `library_sync_jobs` table (push Lore library → streaming service).
 * - Resume columns: `committed_offset`, `resumed_from`, `matched_json`.
 * Safe to run on every boot — uses CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
 */
export async function applyLibrarySyncMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS library_sync_jobs (
        id            serial PRIMARY KEY,
        user_id       integer NOT NULL REFERENCES lore_users(id),
        service       text NOT NULL,
        status        text NOT NULL DEFAULT 'pending',
        phase         text,
        total         integer NOT NULL DEFAULT 0,
        processed     integer NOT NULL DEFAULT 0,
        started_at    timestamp NOT NULL DEFAULT now(),
        finished_at   timestamp,
        error         text,
        results       jsonb
      )
    `);

    // Resume-support columns — added after initial rollout; idempotent.
    await db.execute(sql`
      ALTER TABLE library_sync_jobs
        ADD COLUMN IF NOT EXISTS committed_offset integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS resumed_from     integer,
        ADD COLUMN IF NOT EXISTS matched_json     jsonb
    `);

    console.log("[migration] library sync jobs table: OK");
  } catch (err) {
    console.error("[lore] applyLibrarySyncMigration failed", err);
  }
}
