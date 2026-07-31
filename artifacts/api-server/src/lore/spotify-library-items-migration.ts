import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the spotify_library_items staging table.
 *
 * This table holds unresolved Spotify library tracks — rows that were fetched
 * from Spotify but could not yet be matched to a MusicBrainz recording MBID.
 * Once resolved, a library_items row is created and the staging row is deleted.
 *
 * Safe to run on every boot — uses CREATE TABLE / INDEX IF NOT EXISTS.
 */
export async function applySpotifyLibraryItemsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS spotify_library_items (
      id          serial PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      spotify_id  text NOT NULL,
      title       text NOT NULL,
      artist      text NOT NULL,
      album_name  text,
      artwork_url text,
      isrc        text,
      added_at    timestamp NOT NULL DEFAULT now(),
      mbid        text REFERENCES recordings(mbid)
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS spotify_library_items_user_spotify_idx
      ON spotify_library_items (user_id, spotify_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS spotify_library_items_user_added_idx
      ON spotify_library_items (user_id, added_at)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS spotify_library_items_isrc_idx
      ON spotify_library_items (isrc)
  `);
}
