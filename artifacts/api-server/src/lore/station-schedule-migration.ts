import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the scraped-schedule table. Uses
 * `CREATE TABLE IF NOT EXISTS` so it is safe to run on every server boot.
 *
 * `scraped_shows` holds the station's own published weekly programming grid
 * (LLM-extracted from its homepage/schedule page) — distinct from `shows`,
 * which is derived from actually-logged spins.
 */
export async function applyStationScheduleMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scraped_shows (
      id            serial PRIMARY KEY,
      station_id    integer NOT NULL REFERENCES stations(id),
      show_name     text NOT NULL,
      day_of_week   text NOT NULL,
      start_time    text NOT NULL,
      end_time      text NOT NULL,
      dj_name       text,
      scraped_at    timestamptz NOT NULL DEFAULT now(),
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS scraped_shows_slot_uq
      ON scraped_shows (station_id, day_of_week, start_time, show_name)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS scraped_shows_station_idx
      ON scraped_shows (station_id)
  `);
  // Freshness marker set on every successful schedule scrape (including a
  // legitimate empty result) — see stationsTable.scheduleScrapedAt for why
  // this can't be derived from scraped_shows row presence.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS schedule_scraped_at timestamptz
  `);
  // Attempt marker (success OR failure) — drives the failure-retry backoff
  // so a persistently-failing station isn't retried every tick forever.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS schedule_attempted_at timestamptz
  `);
  // Denormalized show count — written in the same transaction as each full
  // scraped_shows replace, so the Featured tab never needs a second join.
  // NOT NULL DEFAULT 0: Postgres adds this as a catalog-only default (instant,
  // no table rewrite on Postgres 11+), so all existing rows immediately read 0.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS upcoming_show_count integer NOT NULL DEFAULT 0
  `);
  // Backfill: stations that already have scraped_shows rows would stay at 0
  // until their next weekly re-scrape without this one-time fix. Running the
  // UPDATE unconditionally is safe — it is idempotent, cheap (index scan on
  // station_id), and stations that have never been scraped correctly stay 0.
  await db.execute(sql`
    UPDATE stations s
    SET upcoming_show_count = (
      SELECT count(*)::int FROM scraped_shows ss WHERE ss.station_id = s.id
    )
    WHERE upcoming_show_count = 0
  `);
  // Pre-known schedule page URL — when set, the scraper fetches this directly
  // and skips the homepage + link-discovery step. Null = fall back to discovery.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS schedule_url text
  `);
  // Stored IANA timezone — inferred from city + country by the seed and
  // backfill, so the upcoming-schedule endpoint never re-computes it at
  // query time. Null = inference was not confident enough (UI degrades to
  // "station's local time"). ADD COLUMN IF NOT EXISTS ensures idempotency
  // across all environments regardless of when drizzle-kit push was last run.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS iana_timezone text
  `);
  console.info("[migration] scraped_shows table: OK");
}
