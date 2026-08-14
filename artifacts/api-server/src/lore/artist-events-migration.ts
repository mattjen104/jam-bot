import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the `artist_events_cache` and `artist_events` tables
 * that back the Shows lens (Bandsintown event data).
 *
 * All statements use IF NOT EXISTS so the migration is safe to re-run on
 * every boot — it is a no-op once the tables exist.
 *
 * The two CREATE UNIQUE INDEX statements below also REPAIR drifted
 * environments: CREATE TABLE IF NOT EXISTS never retrofits constraints onto
 * a pre-existing table, so a database whose tables predate the UNIQUE
 * clauses would 42P10 on every cache upsert. The IF NOT EXISTS indexes
 * double as the upsert arbiters, closing that gap on the next boot.
 */
export async function applyArtistEventsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS artist_events_cache (
      id          serial PRIMARY KEY,
      artist_key  text    NOT NULL UNIQUE,
      fetched_at  timestamptz NOT NULL DEFAULT now(),
      event_count integer NOT NULL DEFAULT 0
    )
  `);

  // Drift repair: CREATE TABLE IF NOT EXISTS never adds the UNIQUE constraint
  // to a table that pre-existed without it, and the fetcher's
  // ON CONFLICT (artist_key) upsert then fails with 42P10. A unique index
  // serves as the conflict arbiter; IF NOT EXISTS keeps this a no-op once
  // present.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS artist_events_cache_artist_key_uq
      ON artist_events_cache (artist_key)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS artist_events (
      id              serial  PRIMARY KEY,
      artist_key      text    NOT NULL,
      event_id        text    NOT NULL,
      event_datetime  timestamptz NOT NULL,
      event_date      text    NOT NULL,
      venue_name      text,
      venue_city      text    NOT NULL,
      venue_region    text,
      venue_country   text,
      ticket_url      text,
      fetched_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT artist_events_key_id_uq UNIQUE (artist_key, event_id)
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS artist_events_cache_artist_key_uq
      ON artist_events_cache (artist_key)
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS artist_events_key_id_uq
      ON artist_events (artist_key, event_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artist_events_key_idx
      ON artist_events (artist_key)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artist_events_datetime_idx
      ON artist_events (event_datetime)
  `);
}
