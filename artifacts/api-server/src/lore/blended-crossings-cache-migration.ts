import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the blended crossings L2 cache.
 *
 * Creates `blended_crossings_cache` — a single-row Postgres table (id = 1)
 * that persists the anonymous blended crossings aggregate from
 * `routes/me/crossings.ts`. On a server restart the blended handler reads
 * the row from here so the first request within the TTL never pays for the
 * two heavy aggregate queries.
 *
 * Safe to run on every boot (CREATE TABLE IF NOT EXISTS).
 */
export async function applyBlendedCrossingsCacheMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS blended_crossings_cache (
      id        integer   PRIMARY KEY,
      data      jsonb     NOT NULL,
      built_at  timestamp NOT NULL
    )
  `);
}
