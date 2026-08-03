import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the song_bottles feature.
 *
 * Changes:
 *   song_bottles — one row per listener annotation anchored to an MBID
 *   lore_users.avatar — the listener's chosen Halloween emoji avatar
 *   lore_users.avatar_* — the anonymous album-cover identity
 *
 * All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so this is safe
 * to run on every boot and in the global test setup.
 */
export async function applyBottlesMigration(): Promise<void> {
  const stepErrors: Array<{ step: string; err: unknown }> = [];

  // avatar column on lore_users — added for per-user emoji avatar provenance.
  try {
    await db.execute(sql`
      ALTER TABLE lore_users
        ADD COLUMN IF NOT EXISTS avatar varchar(10)
    `);
  } catch (err) {
    stepErrors.push({ step: "lore_users_add_avatar", err });
  }

  try {
    await db.execute(sql`
      ALTER TABLE lore_users
        ADD COLUMN IF NOT EXISTS avatar_recording_mbid text,
        ADD COLUMN IF NOT EXISTS avatar_release_group_mbid text,
        ADD COLUMN IF NOT EXISTS avatar_album_title text,
        ADD COLUMN IF NOT EXISTS avatar_artist text,
        ADD COLUMN IF NOT EXISTS avatar_artwork_url text,
        ADD COLUMN IF NOT EXISTS avatar_source text,
        ADD COLUMN IF NOT EXISTS avatar_visit_started_at timestamptz,
        ADD COLUMN IF NOT EXISTS avatar_visit_recording_mbid text
    `);
  } catch (err) {
    stepErrors.push({ step: "lore_users_add_album_avatar", err });
  }

  // song_bottles table — message-in-a-bottle annotations anchored to an MBID.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS song_bottles (
        id              serial       PRIMARY KEY,
        mbid            varchar(36)  NOT NULL REFERENCES recordings(mbid),
        station_id      integer      NOT NULL REFERENCES stations(id),
        user_id         integer      NOT NULL REFERENCES lore_users(id),
        handle          varchar(50)  NOT NULL,
        avatar          varchar(10)  NOT NULL,
        body            varchar(280),
        progress_ms     integer,
        plays_remaining smallint     NOT NULL DEFAULT 3,
        created_at      timestamptz  NOT NULL DEFAULT now(),
        body_archived_at timestamptz
      )
    `);
  } catch (err) {
    stepErrors.push({ step: "create_song_bottles", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS song_bottles_mbid_remaining_idx
        ON song_bottles (mbid, plays_remaining, created_at DESC)
    `);
  } catch (err) {
    stepErrors.push({ step: "song_bottles_mbid_remaining_idx", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS song_bottles_user_mbid_idx
        ON song_bottles (user_id, mbid)
    `);
  } catch (err) {
    stepErrors.push({ step: "song_bottles_user_mbid_idx", err });
  }

  if (stepErrors.length > 0) {
    const detail = stepErrors
      .map(({ step, err }) => `${step}: ${err instanceof Error ? err.message : String(err)}`)
      .join("; ");
    throw new Error(`bottles migration partial failure — ${detail}`);
  }
}
