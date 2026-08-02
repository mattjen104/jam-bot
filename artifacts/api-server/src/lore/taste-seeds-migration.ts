import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the `taste_seeds` table.
 * Stores listener-supplied artist names used to seed Zone 1 crossings
 * for users who haven't imported a full Spotify library yet.
 * Safe to run on every boot — all statements use IF NOT EXISTS.
 */
export async function applyTasteSeedsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS taste_seeds (
      id          serial PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      artist_name text    NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS taste_seeds_user_idx
      ON taste_seeds (user_id)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS taste_seeds_user_artist_uq
      ON taste_seeds (user_id, artist_name)
  `);
}
