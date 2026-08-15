import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Adds `spins.observed_at` — when Lore actually received the metadata, as
 * opposed to `played_at` (station-reported start time). New rows get a
 * `now()` default; pre-existing rows stay NULL deliberately (readers coalesce
 * to `created_at`), avoiding a full-table UPDATE on the largest table in the
 * schema. Safe to run on every boot.
 */
export async function applySpinObservedAtMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE spins ADD COLUMN IF NOT EXISTS observed_at timestamp
  `);
  await db.execute(sql`
    ALTER TABLE spins ALTER COLUMN observed_at SET DEFAULT now()
  `);
}
