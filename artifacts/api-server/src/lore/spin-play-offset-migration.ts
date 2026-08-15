import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Adds `spins.play_offset_ms` + `spins.offset_captured_at` — the ACR
 * fingerprint's play offset (how far into the song the captured clip was)
 * and the capture timestamp. Only fingerprint-derived spins carry them;
 * every other row stays NULL. They feed the track-expiry estimate as the
 * strongest position signal. Safe to run on every boot.
 */
export async function applySpinPlayOffsetMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE spins
      ADD COLUMN IF NOT EXISTS play_offset_ms integer,
      ADD COLUMN IF NOT EXISTS offset_captured_at timestamp
  `);
}
