import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the `artist_events_cache` and `artist_events` tables
 * that back the Shows lens (Bandsintown event data).
 *
 * All statements use IF NOT EXISTS so the migration is safe to re-run on
 * every boot — it is a no-op once the tables exist.
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
    CREATE INDEX IF NOT EXISTS artist_events_key_idx
      ON artist_events (artist_key)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artist_events_datetime_idx
      ON artist_events (event_datetime)
  `);
}
