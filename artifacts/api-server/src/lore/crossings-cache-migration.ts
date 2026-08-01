import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the shared crossings cache.
 *
 * Creates `crossings_cache` — a one-row-per-user Postgres table that acts as
 * a persistent L2 cache for the expensive dial-crossings computation in
 * `routes/me/crossings.ts`.  On a server restart the handler reads the most
 * recent row from here so users never hit a cold full-table scan just because
 * a deploy happened.
 *
 * Safe to run on every boot (CREATE TABLE IF NOT EXISTS).
 */
export async function applyCrossingsCacheMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crossings_cache (
      user_id   integer   PRIMARY KEY REFERENCES lore_users(id) ON DELETE CASCADE,
      data      jsonb     NOT NULL,
      built_at  timestamp NOT NULL
    )
  `);
}
