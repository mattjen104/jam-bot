import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const BRO_ZONES_REVIEWED = [
  "seattle",
  "portland",
  "denver",
  "cleveland",
  "los-angeles",
  "redlands-inland-empire",
  "washington-dc",
  "north-carolina",
] as const;

/** Create only the tables needed by station-directory reads. This runs before
 * HTTP readiness; location repairs and memberships remain in the full boot
 * migration after the station/location schema and curated seed are ready. */
export async function ensureBroZonesSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS station_collections (
      id serial PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS station_collection_memberships (
      collection_id integer NOT NULL REFERENCES station_collections(id) ON DELETE CASCADE,
      station_id integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      zone text,
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      evidence_url text,
      PRIMARY KEY (collection_id, station_id)
    );
    CREATE INDEX IF NOT EXISTS station_collection_memberships_station_idx
      ON station_collection_memberships(station_id);
    CREATE INDEX IF NOT EXISTS station_collection_memberships_zone_idx
      ON station_collection_memberships(collection_id, zone);
  `);
}

/**
 * Creates the reviewed geographic collection without changing the mutually
 * exclusive editorial taxonomy. Membership is deliberately slug based and
 * only inserts rows for stations already present in the database.
 */
export async function applyBroZonesMigration(): Promise<void> {
  await ensureBroZonesSchema();
  await db.execute(sql`
    INSERT INTO station_collections (slug, name, description)
      VALUES ('bro-zones', 'Bro Zones',
        'Reviewed geographic collection covering eight North American music-radio zones')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

    -- Verified location repairs for existing reviewed rows. These are
    -- intentionally conservative: no candidate is created by this migration.
    UPDATE stations SET city = 'Los Angeles', region = 'CA', country = 'US',
      location_source = 'curated', location_confidence = 'verified', updated_at = now()
      WHERE slug = 'rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f';
    UPDATE stations SET city = 'Riverside', region = 'CA', country = 'US',
      location_source = 'curated', location_confidence = 'verified', updated_at = now()
      WHERE slug = 'kucr';
    UPDATE stations SET city = 'Washington', region = 'DC', country = 'US',
      location_source = 'curated', location_confidence = 'verified', updated_at = now()
      WHERE slug = 'wpfw';
    UPDATE stations SET city = 'Raleigh', region = 'NC', country = 'US',
      location_source = 'curated', location_confidence = 'verified', updated_at = now()
      WHERE slug = 'wknc';
    UPDATE stations SET city = 'Durham', region = 'NC', country = 'US',
      location_source = 'curated', location_confidence = 'verified', updated_at = now()
      WHERE slug = 'wxdu';
    UPDATE stations SET city = 'Chapel Hill', region = 'NC', country = 'US',
      location_source = 'curated', location_confidence = 'verified', updated_at = now()
      WHERE slug = 'wxyc';
    UPDATE stations SET city = 'Portland', region = 'OR', country = 'US',
      location_source = 'curated', location_confidence = 'verified', updated_at = now()
      WHERE slug = 'xray-fm';
    UPDATE stations SET city = 'Denver', region = 'CO', country = 'US',
      location_source = 'curated', location_confidence = 'verified', updated_at = now()
      WHERE slug = 'kuvo';
    UPDATE stations SET city = 'Cleveland', region = 'OH', country = 'US',
      location_source = 'curated', location_confidence = 'verified', updated_at = now()
      WHERE slug = 'wruw';

    WITH reviewed(slug, zone, evidence_url) AS (
      VALUES
        ('kexp','seattle','https://kexp.org/'),
        ('dublab','los-angeles','https://dublab.com/'),
        ('kcrw-eclectic24','los-angeles','https://www.kcrw.com/'),
        ('kxlu','los-angeles','https://kxlu.com/'),
        ('rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f','los-angeles','https://kchungradio.org/'),
        ('kucr','redlands-inland-empire','https://ucr.edu/'),
        ('wpfw','washington-dc','https://www.wpfw.org/'),
        ('wknc','north-carolina','https://wknc.org/'),
        ('wxdu','north-carolina','https://wxdu.duke.edu/'),
        ('wxyc','north-carolina','https://wxyc.org/'),
        ('xray-fm','portland','https://xray.fm/'),
        ('kuvo','denver','https://www.kuvo.org/'),
        ('wruw','cleveland','https://wruw.org/')
    )
    INSERT INTO station_collection_memberships
      (collection_id, station_id, zone, evidence_url)
    SELECT c.id, s.id, r.zone, r.evidence_url
    FROM reviewed r
    JOIN stations s ON s.slug = r.slug
    CROSS JOIN station_collections c
    WHERE c.slug = 'bro-zones'
    ON CONFLICT (collection_id, station_id) DO UPDATE SET
      zone = EXCLUDED.zone, evidence_url = EXCLUDED.evidence_url,
      reviewed_at = now();
  `);
}