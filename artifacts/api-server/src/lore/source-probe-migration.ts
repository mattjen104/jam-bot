import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Boot migration: create the station_source_probes table.
 *
 * Persists the most recent free public-metadata probe outcome per station
 * (the source-coverage ledger) so probe evidence survives restarts and the
 * admin coverage surface can distinguish "never probed" from "probed, no
 * public track source". The table is also declared in
 * lib/db/src/schema/lore.ts (stationSourceProbesTable) so drizzle-kit push
 * does not try to drop it.
 *
 * Idempotent — CREATE TABLE IF NOT EXISTS.
 */
export async function applyStationSourceProbeMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS station_source_probes (
      station_id integer PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
      probe_kind text NOT NULL,
      outcome text NOT NULL,
      detail text,
      resolved_url text,
      sample_artist text,
      sample_title text,
      probed_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
}
