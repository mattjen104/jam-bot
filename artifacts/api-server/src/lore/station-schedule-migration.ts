import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { INVISIBLE_CHARS_PG_CLASS } from "./schedule-name-sanitizer.js";

// The shared invisible-char class, as a quoted Postgres string literal.
// Derived from the same range list as the parse-time sanitizer in
// schedule-scraper.ts so the two implementations cannot drift; interpolated
// with sql.raw because it is a compile-time constant, never user input.
const INVISIBLE_CLASS = sql.raw(`'${INVISIBLE_CHARS_PG_CLASS}'`);

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

  await cleanupInvisibleCharactersInShowNames();
}

/**
 * One-time (but idempotent) data cleanup: rows written before the parse-time
 * sanitizer landed can still hold zero-width characters in show_name/dj_name
 * (e.g. "Morning\u200BJazz"), which render without a space and break text
 * matching until the station happens to be re-scraped.
 *
 * Applies the same normalization as `sanitizeName` in schedule-scraper.ts:
 * invisible/odd whitespace (see schedule-name-sanitizer.ts for the full
 * codepoint list) → space, whitespace collapsed, trimmed. Because (station_id, day_of_week, start_time, show_name) is a
 * unique key, a dirty row whose cleaned name collides with an existing row
 * (or with another dirty row normalizing to the same name) is deleted
 * instead of updated.
 *
 * Postgres AREs support \uXXXX escapes, so the pattern (interpolated from
 * INVISIBLE_CHARS_PG_CLASS) mirrors the JS regex exactly.
 */
async function cleanupInvisibleCharactersInShowNames(): Promise<void> {
  // 1) Delete dirty show_name rows whose cleaned name would collide with an
  //    already-clean row, or with a lower-id dirty sibling normalizing to the
  //    same slot key (keep the lowest id among those siblings).
  const deleted = await db.execute(sql`
    WITH cleaned AS (
      SELECT id, station_id, day_of_week, start_time, show_name,
             btrim(regexp_replace(regexp_replace(show_name,
               ${INVISIBLE_CLASS}, ' ', 'g'), '\\s+', ' ', 'g')) AS clean_name
      FROM scraped_shows
      WHERE show_name ~ ${INVISIBLE_CLASS}
    )
    DELETE FROM scraped_shows s
    USING cleaned c
    WHERE s.id = c.id
      AND (
        EXISTS (
          SELECT 1 FROM scraped_shows o
          WHERE o.station_id = c.station_id
            AND o.day_of_week = c.day_of_week
            AND o.start_time = c.start_time
            AND o.show_name = c.clean_name
        )
        OR EXISTS (
          SELECT 1 FROM cleaned o
          WHERE o.station_id = c.station_id
            AND o.day_of_week = c.day_of_week
            AND o.start_time = c.start_time
            AND o.clean_name = c.clean_name
            AND o.id < c.id
        )
      )
  `);
  // 2) Rewrite the surviving dirty show_name rows in place.
  const updatedShows = await db.execute(sql`
    UPDATE scraped_shows
    SET show_name = btrim(regexp_replace(regexp_replace(show_name,
      ${INVISIBLE_CLASS}, ' ', 'g'), '\\s+', ' ', 'g'))
    WHERE show_name ~ ${INVISIBLE_CLASS}
  `);
  // 3) dj_name is not part of the unique key, so a plain rewrite suffices;
  //    a name that cleans down to nothing becomes NULL (matching the parser,
  //    which stores null for empty DJ names).
  const updatedDjs = await db.execute(sql`
    UPDATE scraped_shows
    SET dj_name = nullif(btrim(regexp_replace(regexp_replace(dj_name,
      ${INVISIBLE_CLASS}, ' ', 'g'), '\\s+', ' ', 'g')), '')
    WHERE dj_name IS NOT NULL AND dj_name ~ ${INVISIBLE_CLASS}
  `);
  const total =
    (deleted.rowCount ?? 0) +
    (updatedShows.rowCount ?? 0) +
    (updatedDjs.rowCount ?? 0);
  if (total > 0) {
    console.info(
      `[migration] scraped_shows zero-width cleanup: ${deleted.rowCount ?? 0} duplicate(s) deleted, ${updatedShows.rowCount ?? 0} show name(s) rewritten, ${updatedDjs.rowCount ?? 0} DJ name(s) rewritten`,
    );
  }
}
