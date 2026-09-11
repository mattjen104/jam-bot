import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the release-year backfill feature:
 * - `recordings.year_checked_at` — sentinel timestamp set after a definitive
 *   MusicBrainz lookup (hit or legitimate miss). NOT set on 5xx errors so
 *   transient failures are retried on the next tick.
 * Safe to run on every boot — the statement uses IF NOT EXISTS.
 */
export async function applyReleaseYearMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE recordings ADD COLUMN IF NOT EXISTS year_checked_at timestamp
  `);
  await db.execute(sql`
    ALTER TABLE recordings
      ADD COLUMN IF NOT EXISTS release_enrichment_status text NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS release_enrichment_attempted_at timestamp,
      ADD COLUMN IF NOT EXISTS release_enrichment_error text
  `);
  await db.execute(sql`
    UPDATE recordings
    SET release_enrichment_status = CASE
      WHEN year_checked_at IS NULL THEN 'pending'
      WHEN release_year IS NULL THEN 'canonical_miss'
      ELSE 'canonical_found'
    END
    WHERE release_enrichment_status = 'pending'
      AND year_checked_at IS NOT NULL
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS recording_release_evidence (
      id bigserial PRIMARY KEY,
      provider text NOT NULL,
      provider_track_id text NOT NULL,
      provider_release_id text,
      isrc text,
      release_date text,
      precision text NOT NULL,
      confidence text NOT NULL DEFAULT 'exact_provider_track',
      recording_mbid text,
      observed_at timestamp NOT NULL DEFAULT now(),
      linked_at timestamp,
      status text NOT NULL DEFAULT 'provisional',
      last_error text,
      updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (provider, provider_track_id)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS recording_release_evidence_recording_idx ON recording_release_evidence(recording_mbid)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS recording_release_evidence_isrc_idx ON recording_release_evidence(isrc)`);
  await db.execute(sql`
    DO $$
    DECLARE fk record;
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'recording_release_evidence'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'recordings'::regclass
          AND c.confdeltype = 'n'
      ) THEN
        FOR fk IN
          SELECT c.conname
          FROM pg_constraint c
          WHERE c.conrelid = 'recording_release_evidence'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'recordings'::regclass
        LOOP
          EXECUTE format(
            'ALTER TABLE recording_release_evidence DROP CONSTRAINT %I',
            fk.conname
          );
        END LOOP;
        ALTER TABLE recording_release_evidence
          ADD CONSTRAINT recording_release_evidence_recording_mbid_recordings_mbid_fk
          FOREIGN KEY (recording_mbid) REFERENCES recordings(mbid) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
}
