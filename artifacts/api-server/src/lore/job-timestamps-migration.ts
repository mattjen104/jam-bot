import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the `job_timestamps` table.
 *
 * Stores the last time each background job ran a full pass so that a server
 * restart within the pass window can skip re-running immediately — preventing
 * rate-limit bursts on external services (e.g. Pitchfork).
 *
 * Schema:
 *   key        — stable job identifier (e.g. 'pitchfork-pass')
 *   last_ran_at — when the job last started a pass (set at pass start so a
 *                 mid-pass restart also sees a recent timestamp)
 *
 * Safe to run on every boot — uses IF NOT EXISTS.
 */
export async function applyJobTimestampsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS job_timestamps (
      key         text        PRIMARY KEY,
      last_ran_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
