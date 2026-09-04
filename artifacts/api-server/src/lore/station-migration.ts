import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const DISCOVERY_COLUMNS = [
  "active",
  "source",
  "tier",
  "tags",
  "last_alive_at",
  "resolution_rate",
  "clickcount",
  "votes",
  "bitrate",
  "codec",
  "health_failures",
  "discovery_score",
  "homepage_blurb",
  "homepage_scraped_at",
  "favorite",
  "hidden",
  "crossing_eligible",
  "region",
] as const;

/**
 * Idempotent DDL migration for the station discovery fields.
 *
 * Check the catalog before issuing ALTER TABLE. `ADD COLUMN IF NOT EXISTS`
 * still takes an ACCESS EXCLUSIVE lock even when every column is already
 * present, which can block listener reads behind a busy station poller on
 * every API restart. Existing rows receive the column DEFAULT when the ALTER
 * genuinely is needed, so no separate UPDATE/backfill is needed.
 *
 * Safe defaults for existing curated rows:
 *   active=true, source='curated', tier='flagship', clickcount=0, votes=0,
 *   health_failures=0. All nullable columns stay NULL.
 */
export async function applyStationDiscoveryMigration(): Promise<void> {
  const existing = await db.execute<{ column_name: string }>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stations'
      AND column_name = ANY(
        ARRAY[
          'active', 'source', 'tier', 'tags', 'last_alive_at',
          'resolution_rate', 'clickcount', 'votes', 'bitrate', 'codec',
          'health_failures', 'discovery_score', 'homepage_blurb',
          'homepage_scraped_at', 'favorite', 'hidden', 'crossing_eligible',
          'region'
        ]::text[]
      )
  `);
  if (existing.rows.length === DISCOVERY_COLUMNS.length) {
    console.info("[migration] station discovery fields: already present");
    return;
  }

  await db.execute(sql`
    ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS active          boolean  NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS source          text     NOT NULL DEFAULT 'curated',
      ADD COLUMN IF NOT EXISTS tier            text     NOT NULL DEFAULT 'flagship',
      ADD COLUMN IF NOT EXISTS tags            jsonb,
      ADD COLUMN IF NOT EXISTS last_alive_at   timestamptz,
      ADD COLUMN IF NOT EXISTS resolution_rate real,
      ADD COLUMN IF NOT EXISTS clickcount      integer  NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS votes           integer  NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS bitrate         integer,
      ADD COLUMN IF NOT EXISTS codec           text,
      ADD COLUMN IF NOT EXISTS health_failures integer  NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discovery_score      real,
      ADD COLUMN IF NOT EXISTS homepage_blurb       text,
      ADD COLUMN IF NOT EXISTS homepage_scraped_at  timestamptz,
      ADD COLUMN IF NOT EXISTS favorite           boolean  NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS hidden             boolean  NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS crossing_eligible  boolean  NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS region             text
  `);
  console.info("[migration] station discovery fields: OK");
}
