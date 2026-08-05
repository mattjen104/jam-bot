import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the lifetime crossings pre-compute cache.
 *
 * Creates `lifetime_crossings_cache` — a one-row-per-user table that stores
 * the result of the unbounded lifetime crossing-count computation run by the
 * background job in `lifetime-crossings-job.ts`.
 *
 * The hot-path GET /api/me/crossings handler reads from this table to avoid
 * a full spins-table scan on every request.
 *
 * Safe to run on every boot (CREATE TABLE IF NOT EXISTS).
 */
export async function applyLifetimeCrossingsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lifetime_crossings_cache (
      user_id   integer   PRIMARY KEY REFERENCES lore_users(id) ON DELETE CASCADE,
      data      jsonb     NOT NULL,
      built_at  timestamp NOT NULL
    )
  `);
}
