import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Additive DDL for grounded support facts and Bandcamp Friday holds. */
export async function applySupportHoldsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS recording_support_facts (
      id serial PRIMARY KEY,
      recording_mbid text NOT NULL REFERENCES recordings(mbid) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('artist_direct', 'label', 'discogs')),
      scope text NOT NULL DEFAULT 'release'
        CHECK (scope IN ('release', 'catalog', 'door')),
      provider_id text,
      release_mbid text,
      release_group_mbid text,
      url text NOT NULL,
      detail text,
      note text,
      verification text NOT NULL DEFAULT 'trusted'
        CHECK (verification IN ('exact', 'trusted')),
      source_url text,
      fetched_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_support_facts_recording_idx
      ON recording_support_facts (recording_mbid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_support_facts_kind_idx
      ON recording_support_facts (kind, recording_mbid)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS support_holds (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      recording_mbid text NOT NULL REFERENCES recordings(mbid) ON DELETE CASCADE,
      bandcamp_friday_date text NOT NULL,
      held_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT support_holds_date_ck
        CHECK (bandcamp_friday_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS support_holds_user_recording_date_uq
      ON support_holds (user_id, recording_mbid, bandcamp_friday_date)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS support_holds_user_idx ON support_holds (user_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS support_holds_recording_idx
      ON support_holds (recording_mbid)
  `);
}