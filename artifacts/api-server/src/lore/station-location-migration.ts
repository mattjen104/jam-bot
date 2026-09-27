import { db, stationsTable } from "@workspace/db";
import { eq, isNull, or, sql } from "drizzle-orm";
import { coarseUsCityLocation } from "./station-location.js";

/** Add station-base location evidence without storing any listener location. */
export async function applyStationLocationMigration(): Promise<void> {
  // ALTER TABLE takes ACCESS EXCLUSIVE even when every column already exists.
  // Recreating the location constraint on each boot can queue behind long
  // listener reads and block subsequent station requests and test migrations.
  const existing = await db.execute<{
    column_count: number;
    has_constraint: boolean;
    has_index: boolean;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM pg_attribute
       WHERE attrelid = 'stations'::regclass
         AND attname IN ('latitude', 'longitude', 'location_source', 'location_confidence')
         AND NOT attisdropped) AS column_count,
      EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'stations'::regclass
                AND conname = 'stations_location_pair_check') AS has_constraint,
      EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = current_schema()
                AND tablename = 'stations'
                AND indexname = 'stations_location_usable_idx') AS has_index
  `);
  const schema = existing.rows[0];
  if (schema?.column_count === 4 && schema.has_constraint && schema.has_index) return;

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