import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Creates the album workflow tables without relying on deploy-time drizzle
 * ordering.  All columns intentionally use text states so adding a state does
 * not require a PostgreSQL enum migration.
 */
export async function applyAlbumWorkflowMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS album_workflow (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      release_group_mbid text NOT NULL,
      state text NOT NULL DEFAULT 'inbox',
      note text,
      picks jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT album_workflow_user_release_group_uq
        UNIQUE (user_id, release_group_mbid)
    );
    CREATE INDEX IF NOT EXISTS album_workflow_user_state_idx
      ON album_workflow (user_id, state);
    CREATE TABLE IF NOT EXISTS album_workflow_transitions (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      release_group_mbid text NOT NULL,
      from_state text,
      to_state text NOT NULL,
      note text,
      picks jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS album_workflow_transitions_user_release_group_idx
      ON album_workflow_transitions (user_id, release_group_mbid, created_at);
    INSERT INTO album_workflow (user_id, release_group_mbid, state, picks)
    SELECT DISTINCT li.user_id, rrg.release_group_mbid, 'inbox', '[]'::jsonb
    FROM library_items li
    JOIN recording_release_groups rrg
      ON rrg.recording_mbid = li.mbid AND rrg.is_primary = true
    WHERE li.removed_at IS NULL
    ON CONFLICT (user_id, release_group_mbid) DO NOTHING;
  `);
}