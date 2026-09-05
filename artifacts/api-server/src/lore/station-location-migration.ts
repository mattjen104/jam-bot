import { db, stationsTable } from "@workspace/db";
import { eq, isNull, or, sql } from "drizzle-orm";
import { coarseUsCityLocation } from "./station-location.js";

/** Add station-base location evidence without storing any listener location. */
export async function applyStationLocationMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS latitude real,
      ADD COLUMN IF NOT EXISTS longitude real,
      ADD COLUMN IF NOT EXISTS location_source text,
      ADD COLUMN IF NOT EXISTS location_confidence text;

    ALTER TABLE stations
      DROP CONSTRAINT IF EXISTS stations_location_pair_check;
    ALTER TABLE stations
      ADD CONSTRAINT stations_location_pair_check CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (
          latitude BETWEEN -90 AND 90
          AND longitude BETWEEN -180 AND 180
          AND NOT (latitude = 0 AND longitude = 0)
        )
      );

    CREATE INDEX IF NOT EXISTS stations_location_usable_idx
      ON stations (latitude, longitude)
      WHERE active = true AND hidden = false
        AND latitude IS NOT NULL AND longitude IS NOT NULL;
  `);
}

/** Fill only missing curated US station coordinates from coarse city centroids. */
export async function backfillCoarseStationLocations(): Promise<number> {
  const rows = await db
    .select({
      id: stationsTable.id,
      city: stationsTable.city,
      region: stationsTable.region,
      country: stationsTable.country,
    })
    .from(stationsTable)
    .where(or(isNull(stationsTable.latitude), isNull(stationsTable.longitude)));
  let updated = 0;
  for (const row of rows) {
    const location = coarseUsCityLocation(row);
    if (!location) continue;
    await db
      .update(stationsTable)
      .set(location)
      .where(eq(stationsTable.id, row.id));
    updated++;
  }
  return updated;
}