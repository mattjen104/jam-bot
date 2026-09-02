import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Idempotent boot DDL for private Apple Music rooms and room-scoped helpers. */
export async function applyAppleMusicJamsMigration(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7_233_141_510)`);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS apple_music_jams (
        id serial PRIMARY KEY,
        code text NOT NULL UNIQUE,
        invite_token text NOT NULL UNIQUE,
        host_user_id integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'active',
        revision integer NOT NULL DEFAULT 0,
        snapshot jsonb NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS apple_music_jams_host_idx ON apple_music_jams(host_user_id);
      CREATE INDEX IF NOT EXISTS apple_music_jams_expiry_idx ON apple_music_jams(expires_at)
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS apple_music_jam_members (
        id serial PRIMARY KEY,
        jam_id integer NOT NULL REFERENCES apple_music_jams(id) ON DELETE CASCADE,
        user_id integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'listener',
        joined_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(jam_id, user_id)
      )
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS apple_music_jam_members_jam_idx ON apple_music_jam_members(jam_id)
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS apple_music_jam_events (
        id serial PRIMARY KEY,
        jam_id integer NOT NULL REFERENCES apple_music_jams(id) ON DELETE CASCADE,
        revision integer NOT NULL,
        type text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(jam_id, revision)
      )
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS apple_music_jam_events_jam_id_idx
        ON apple_music_jam_events(jam_id, id)
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS apple_music_jam_helpers (
        id serial PRIMARY KEY,
        jam_id integer NOT NULL REFERENCES apple_music_jams(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        last_seen_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.execute(sql`
      ALTER TABLE apple_music_jam_helpers
        ADD COLUMN IF NOT EXISTS last_seen_at timestamptz
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS apple_music_jam_helpers_jam_idx
        ON apple_music_jam_helpers(jam_id)
    `);
  });
}