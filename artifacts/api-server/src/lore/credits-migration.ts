import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { acquireMigrationLock, MIGRATION_LOCK_KEYS } from "./migration-advisory-lock.js";

/**
 * Durable schema for kept-music credits.  This intentionally uses plain text
 * status fields: MusicBrainz can add relationship/status values without
 * requiring a deploy-ordered PostgreSQL enum change.
 *
 * Every statement is idempotent so a partially completed boot can safely be
 * retried.  Foreign keys are included here (rather than relying on drizzle
 * push) because production API boots do not run drizzle migrations.
 */
export async function applyCreditsMigration(): Promise<void> {
  await db.transaction(async (db) => {
  await db.execute(acquireMigrationLock(MIGRATION_LOCK_KEYS.credits));
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS musicbrainz_works (
      mbid text PRIMARY KEY,
      title text,
      language text,
      source text NOT NULL DEFAULT 'musicbrainz',
      parser_version text NOT NULL DEFAULT 'credits-v1',
      provenance jsonb,
      completeness text NOT NULL DEFAULT 'partial',
      fetched_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS recording_works (
      recording_mbid text NOT NULL REFERENCES recordings(mbid) ON DELETE CASCADE,
      work_mbid text NOT NULL REFERENCES musicbrainz_works(mbid) ON DELETE CASCADE,
      position integer,
      source text NOT NULL DEFAULT 'musicbrainz',
      provenance jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (recording_mbid, work_mbid)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS musicbrainz_releases (
      mbid text PRIMARY KEY,
      release_group_mbid text,
      title text,
      release_date text,
      status text,
      country text,
      source text NOT NULL DEFAULT 'musicbrainz',
      parser_version text NOT NULL DEFAULT 'credits-v1',
      provenance jsonb,
      completeness text NOT NULL DEFAULT 'partial',
      fetched_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS musicbrainz_labels (
      mbid text PRIMARY KEY,
      name text,
      source text NOT NULL DEFAULT 'musicbrainz',
      fetched_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS release_labels (
      release_mbid text NOT NULL REFERENCES musicbrainz_releases(mbid) ON DELETE CASCADE,
      label_mbid text NOT NULL REFERENCES musicbrainz_labels(mbid) ON DELETE CASCADE,
      label_name text,
      catalog_number text,
      source text NOT NULL DEFAULT 'musicbrainz',
      provenance jsonb,
      parser_version text NOT NULL DEFAULT 'credits-v1',
      fetched_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (release_mbid, label_mbid)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS recording_credits (
      credit_key text PRIMARY KEY,
      recording_mbid text NOT NULL REFERENCES recordings(mbid) ON DELETE CASCADE,
      work_mbid text REFERENCES musicbrainz_works(mbid) ON DELETE SET NULL,
      artist_mbid text,
      credited_name text NOT NULL,
      role text NOT NULL,
      role_group text NOT NULL DEFAULT 'other',
      source text NOT NULL DEFAULT 'musicbrainz',
      source_url text,
      provenance jsonb,
      parser_version text NOT NULL DEFAULT 'credits-v1',
      completeness text NOT NULL DEFAULT 'partial',
      attempt_status text NOT NULL DEFAULT 'success',
      fetched_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS credit_enrichment_queue (
      recording_mbid text PRIMARY KEY REFERENCES recordings(mbid) ON DELETE CASCADE,
      scope text NOT NULL DEFAULT 'recording',
      status text NOT NULL DEFAULT 'pending',
      priority integer NOT NULL DEFAULT 100,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamp NOT NULL DEFAULT now(),
      last_attempt_at timestamp,
      completed_at timestamp,
      last_error text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS album_enrichment_queue (
      recording_mbid text PRIMARY KEY REFERENCES recordings(mbid) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'pending',
      priority integer NOT NULL DEFAULT 100,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamp NOT NULL DEFAULT now(),
      last_attempt_at timestamp,
      completed_at timestamp,
      last_error text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    ALTER TABLE musicbrainz_works
      ADD COLUMN IF NOT EXISTS parser_version text NOT NULL DEFAULT 'credits-v1'
  `);
  await db.execute(sql`
    ALTER TABLE musicbrainz_works ADD COLUMN IF NOT EXISTS provenance jsonb
  `);
  await db.execute(sql`
    ALTER TABLE musicbrainz_releases
      ADD COLUMN IF NOT EXISTS parser_version text NOT NULL DEFAULT 'credits-v1'
  `);
  await db.execute(sql`
    ALTER TABLE musicbrainz_releases ADD COLUMN IF NOT EXISTS provenance jsonb
  `);
  await db.execute(sql`
    ALTER TABLE recording_credits
      ADD COLUMN IF NOT EXISTS parser_version text NOT NULL DEFAULT 'credits-v1'
  `);
  await db.execute(sql`
    ALTER TABLE release_labels
      ADD COLUMN IF NOT EXISTS parser_version text NOT NULL DEFAULT 'credits-v1',
      ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now()
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_works_work_idx ON recording_works(work_mbid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS musicbrainz_releases_group_idx
      ON musicbrainz_releases(release_group_mbid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS release_labels_label_idx ON release_labels(label_mbid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_credits_recording_idx
      ON recording_credits(recording_mbid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_credits_artist_idx
      ON recording_credits(artist_mbid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_credits_work_idx ON recording_credits(work_mbid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recording_credits_role_group_idx
      ON recording_credits(role_group)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS credit_enrichment_queue_ready_idx
      ON credit_enrichment_queue(status, next_attempt_at, priority)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS album_enrichment_queue_ready_idx
      ON album_enrichment_queue(status, next_attempt_at, priority)
  `);
  });
}