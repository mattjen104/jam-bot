import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the `pending_keeps` table.
 * Captures listener save-intent for spins that are not yet resolved to an MBID.
 * Safe to run on every boot — all statements use IF NOT EXISTS.
 */
export async function applyPendingKeepsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pending_keeps (
      id          serial PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      spin_id     integer NOT NULL REFERENCES spins(id) ON DELETE CASCADE,
      saved_at    timestamptz NOT NULL DEFAULT now(),
      promoted_at timestamptz
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pending_keeps_user_spin_idx
      ON pending_keeps (user_id, spin_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pending_keeps_spin_idx
      ON pending_keeps (spin_id)
      WHERE promoted_at IS NULL
  `);
}
