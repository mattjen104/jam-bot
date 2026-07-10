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
  console.info("[migration] scraped_shows table: OK");
}
