import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the station_exclusions tombstone table.
 *
 * Records permanently removed stations so that:
 *   • the Radio Browser discovery worker never re-enrolls an excluded UUID;
 *   • seedStations() never re-creates/re-activates an excluded curated slug.
 *
 * Safe to run on every boot (CREATE TABLE IF NOT EXISTS). The UNIQUE
 * constraints double as the idempotency key for ON CONFLICT DO NOTHING
 * inserts from the permanent-remove endpoint.
 */
export async function applyStationExclusionsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS station_exclusions (
      id                 serial PRIMARY KEY,
      radio_browser_uuid text UNIQUE,
      station_slug       text UNIQUE,
      station_name       text NOT NULL,
      removed_at         timestamp NOT NULL DEFAULT now()
    )
  `);
  console.info("[migration] station exclusions table: OK");
}
