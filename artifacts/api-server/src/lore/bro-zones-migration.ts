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

export type BroZonesCandidateAudit = {
  slug: string;
  station: string;
  zone: (typeof BRO_ZONES_REVIEWED)[number];
  qualified: boolean;
  access:
    | {
        provider: "spinitron";
        secretName: `SPINITRON_KEY_${string}`;
      }
    | {
        provider: "cadence";
        secretName: `CADENCE_KEY_${string}`;
      }
    | null;
  identityUrl: string;
  streamUrl: string | null;
  scheduleUrl: string;
  historyUrl: string;
  auditNote: string;
};

/**
 * Reproduced 2026-09-11 against station-owned pages and endpoints. A candidate
 * qualifies only when its official stream and schedule are accompanied by
 * machine-readable track history with both a stable play id and timestamp.
 */
export const BRO_ZONES_CANDIDATE_AUDIT = [
  {
    slug: "knkx",
    station: "KNKX",
    zone: "seattle",
    qualified: false,
    access: { provider: "cadence", secretName: "CADENCE_KEY_KNKX" },
    identityUrl: "https://www.knkx.org/",
    streamUrl:
      "https://knkx-live-a.edge.audiocdn.com/6284_128k?aw_0_1st.playerid=knkx.org",
    scheduleUrl: "https://www.knkx.org/schedule",
    historyUrl: "https://www.knkx.org/playlist",
    auditNote:
      "The public Cadence playlist is backed by authenticated history endpoints; the station RSS feed contains no track rows.",
  },
  {
    slug: "kbcs",
    station: "KBCS",
    zone: "seattle",
    qualified: false,
    access: { provider: "spinitron", secretName: "SPINITRON_KEY_KBCS" },
    identityUrl: "https://www.kbcs.fm/",
    streamUrl: "https://stream.pacificaservice.org:9000/kbcs",
    scheduleUrl: "https://www.kbcs.fm/program/",
    historyUrl: "https://spinitron.com/KBCS/",
    auditNote:
      "Public Spinitron HTML is a rolling display, not the authenticated, timestamped history API supported by the adapter.",
  },
  {
    slug: "kboo",
    station: "KBOO",
    zone: "portland",
    qualified: false,
    access: { provider: "spinitron", secretName: "SPINITRON_KEY_KBOO" },
    identityUrl: "https://kboo.fm/",
    streamUrl: null,
    scheduleUrl: "https://kboo.fm/program/",
    historyUrl: "https://kboo.fm/program/playlists",
    auditNote:
      "Official playlist pages do not expose a stable play id and timestamp through a supported machine-readable endpoint.",
  },
  {
    slug: "kmhd",
    station: "KMHD",
    zone: "portland",
    qualified: false,
    access: null,
    identityUrl: "https://www.kmhd.org/",
    streamUrl: null,
    scheduleUrl: "https://www.kmhd.org/schedule/",
    historyUrl: "https://www.kmhd.org/playlist/",
    auditNote:
      "Embedded playlist JSON has timestamps but no stable per-play identity, so replay would not be safely idempotent.",
  },
  {
    slug: "kgnu",
    station: "KGNU",
    zone: "denver",
    qualified: false,
    access: null,
    identityUrl: "https://kgnu.org/",
    streamUrl: "https://kgnu.streamguys1.com/kgnu",
    scheduleUrl: "https://kgnu.org/program-schedule/",
    historyUrl:
      "https://kgnu.org/wp-content/plugins/kgnu_comrad/src/kgnu_ajax.php",
    auditNote:
      "Official playlist responses include Unix times but no stable per-play identity.",
  },
  {
    slug: "wjcu",
    station: "WJCU",
    zone: "cleveland",
    qualified: true,
    access: null,
    identityUrl: "https://www.wjcu.org/",
    streamUrl:
      "https://streaming.jcu.edu/listen/wjcu_radio/wjcu-aac-hi",
    scheduleUrl: "https://www.wjcu.org/programs/schedule",
    historyUrl:
      "https://studio.creek.org/api/tracks?include=broadcast&studioId=s-wjcu",
    auditNote:
      "Official Creek JSON supplies stable track ids, UTC start timestamps, track metadata, ISRCs, and recording MBIDs.",
  },
  {
    slug: "the-socal-sound",
    station: "The SoCal Sound",
    zone: "redlands-inland-empire",
    qualified: false,
    access: null,
    identityUrl: "https://www.thesocalsound.org/",
    streamUrl: "https://www.streamvortex.com:8444/s/12200",
    scheduleUrl: "https://www.thesocalsound.org/programs/",
    historyUrl:
      "https://www.thesocalsound.org/on-the-socal-sound/playlist/",
    auditNote:
      "Official playlist rows have timestamps but no stable per-play identity.",
  },
  {
    slug: "wowd",
    station: "Takoma Radio",
    zone: "washington-dc",
    qualified: false,
    access: { provider: "spinitron", secretName: "SPINITRON_KEY_WOWD" },
    identityUrl: "https://takomaradio.org/",
    streamUrl: null,
    scheduleUrl: "https://takomaradio.org/schedule",
    historyUrl:
      "https://widgets.spinitron.com/widget/now-playing-v2?station=wowd",
    auditNote:
      "The official page exposes only a recent-play Spinitron widget; durable API history requires authentication.",
  },
  {
    slug: "wncw",
    station: "WNCW",
    zone: "north-carolina",
    qualified: false,
    access: { provider: "cadence", secretName: "CADENCE_KEY_WNCW" },
    identityUrl: "https://www.wncw.org/",
    streamUrl: "https://wncw-live-a.edge.audiocdn.com/6286_56k.aac",
    scheduleUrl: "https://www.wncw.org/listen-live-radio-schedule",
    historyUrl: "https://www.wncw.org/playlist-search",
    auditNote:
      "The public Cadence playlist UI does not expose its stable track history endpoint without authentication.",
  },
] as const satisfies readonly BroZonesCandidateAudit[];

export const BRO_ZONES_MEMBERSHIPS = [
  { slug: "kexp", zone: "seattle", evidenceUrl: "https://kexp.org/" },
  { slug: "dublab", zone: "los-angeles", evidenceUrl: "https://dublab.com/" },
  { slug: "kcrw-eclectic24", zone: "los-angeles", evidenceUrl: "https://www.kcrw.com/" },
  { slug: "kxlu", zone: "los-angeles", evidenceUrl: "https://kxlu.com/" },
  { slug: "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f", zone: "los-angeles", evidenceUrl: "https://kchungradio.org/" },
  { slug: "kucr", zone: "redlands-inland-empire", evidenceUrl: "https://ucr.edu/" },
  { slug: "wpfw", zone: "washington-dc", evidenceUrl: "https://www.wpfw.org/" },
  { slug: "wknc", zone: "north-carolina", evidenceUrl: "https://wknc.org/" },
  { slug: "wxdu", zone: "north-carolina", evidenceUrl: "https://wxdu.duke.edu/" },
  { slug: "wxyc", zone: "north-carolina", evidenceUrl: "https://wxyc.org/" },
  { slug: "xray-fm", zone: "portland", evidenceUrl: "https://xray.fm/" },
  { slug: "kuvo", zone: "denver", evidenceUrl: "https://www.kuvo.org/" },
  { slug: "wruw", zone: "cleveland", evidenceUrl: "https://wruw.org/" },
  { slug: "wjcu", zone: "cleveland", evidenceUrl: "https://www.wjcu.org/programs/playlists" },
] as const;

/** Create only the tables needed by station-directory reads. This runs before
 * HTTP readiness; location repairs and memberships remain in the full boot
 * migration after the station/location schema and curated seed are ready. */
export async function ensureBroZonesSchema(
  database: Pick<typeof db, "execute"> = db,
): Promise<void> {
  await database.execute(sql`
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
export async function applyBroZonesMigration(
  database: Pick<typeof db, "execute"> = db,
): Promise<void> {
  await ensureBroZonesSchema(database);
  await database.execute(sql`
    INSERT INTO station_collections (slug, name, description)
      VALUES ('bro-zones', 'Bro Zones',
        'Reviewed geographic collection covering eight North American music-radio zones')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;
  `);

  // Keep each execute call to one SQL command: node-postgres rejects
  // parameterized multi-command prepared statements.
  await database.execute(sql`
    WITH reviewed_locations(slug, city, region, country) AS (
      VALUES
        ('rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f', 'Los Angeles', 'CA', 'US'),
        ('kucr', 'Riverside', 'CA', 'US'),
        ('wpfw', 'Washington', 'DC', 'US'),
        ('wknc', 'Raleigh', 'NC', 'US'),
        ('wxdu', 'Durham', 'NC', 'US'),
        ('wxyc', 'Chapel Hill', 'NC', 'US'),
        ('xray-fm', 'Portland', 'OR', 'US'),
        ('kuvo', 'Denver', 'CO', 'US'),
        ('wruw', 'Cleveland', 'OH', 'US'),
        ('wjcu', 'University Heights', 'OH', 'US')
    )
    UPDATE stations AS station
    SET city = reviewed.city,
      region = reviewed.region,
      country = reviewed.country,
      location_source = 'curated',
      location_confidence = 'verified',
      updated_at = now()
    FROM reviewed_locations AS reviewed
    WHERE station.slug = reviewed.slug;
  `);

  await database.execute(sql`
    WITH reviewed(slug, zone, evidence_url) AS (
      VALUES ${sql.join(
        BRO_ZONES_MEMBERSHIPS.map(
          ({ slug, zone, evidenceUrl }) =>
            sql`(${slug}, ${zone}, ${evidenceUrl})`,
        ),
        sql`, `,
      )}
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