/**
 * Migration: create the `apple_library_items` staging table.
 *
 * Mirrors `spotify_library_items` but for Apple Music. Rows are inserted
 * client-driven (MusicKit JS paginates the user's library in the browser
 * and POSTs each page to the server). ISRC-to-MBID resolution happens
 * server-side when the batch is received.
 *
 * Safe to run on every boot — uses CREATE TABLE / INDEX IF NOT EXISTS.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function applyAppleLibraryItemsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS apple_library_items (
      id           serial PRIMARY KEY,
      user_id      integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      apple_id     text    NOT NULL,
      title        text    NOT NULL,
      artist       text    NOT NULL,
      album_name   text,
      artwork_url  text,
      isrc         text,
      added_at     timestamp NOT NULL DEFAULT now(),
      mbid         text REFERENCES recordings(mbid)
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS apple_library_items_user_apple_idx
      ON apple_library_items (user_id, apple_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS apple_library_items_user_added_idx
      ON apple_library_items (user_id, added_at)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS apple_library_items_isrc_idx
      ON apple_library_items (isrc)
  `);
}
