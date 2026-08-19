import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Boot migration: create the fingerprint_scout_tallies table.
 *
 * Persists per-station sample/recognition counts for the rotating audio
 * fingerprint scout so the admin scout report survives restarts. The table
 * is also declared in lib/db/src/schema/lore.ts (fingerprintScoutTalliesTable)
 * so drizzle-kit push does not try to drop it.
 *
 * Idempotent — CREATE TABLE IF NOT EXISTS.
 */
export async function applyFingerprintScoutMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fingerprint_scout_tallies (
      station_id integer PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
      samples integer NOT NULL DEFAULT 0,
      recognitions integer NOT NULL DEFAULT 0,
      last_sampled_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  // Earlier task builds may have created the table with the default restrictive
  // FK. Replace it idempotently so station purge/removal never fails because a
  // historical scout tally still points at the station.
  await db.execute(sql`
    ALTER TABLE fingerprint_scout_tallies
      DROP CONSTRAINT IF EXISTS fingerprint_scout_tallies_station_id_fkey
  `);
  await db.execute(sql`
    ALTER TABLE fingerprint_scout_tallies
      ADD CONSTRAINT fingerprint_scout_tallies_station_id_fkey
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
  `);
}
