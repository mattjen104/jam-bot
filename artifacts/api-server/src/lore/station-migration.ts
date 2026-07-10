import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the station discovery fields.
 *
 * Uses `ADD COLUMN IF NOT EXISTS` so it is safe to run on every server boot —
 * columns that already exist are silently skipped; existing rows receive the
 * column DEFAULT, so no separate UPDATE/backfill is needed.
 *
 * Safe defaults for existing curated rows:
 *   active=true, source='curated', tier='flagship', clickcount=0, votes=0,
 *   health_failures=0. All nullable columns stay NULL.
 */
export async function applyStationDiscoveryMigration(): Promise<void> {
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
      ADD COLUMN IF NOT EXISTS homepage_scraped_at  timestamptz
  `);
  console.info("[migration] station discovery fields: OK");
}
