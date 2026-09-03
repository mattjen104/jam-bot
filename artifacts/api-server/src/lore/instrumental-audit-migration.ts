import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Add the LRCLIB evidence state and durable instrumental-station audit ledger.
 * Existing lyric sentinel rows are migrated conservatively: real lines are
 * `lyrics_found`, -1 rows are `no_result`; no row remains `not_checked`.
 */
export async function applyInstrumentalAuditMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE recordings
      ADD COLUMN IF NOT EXISTS lyric_status text NOT NULL DEFAULT 'not_checked',
      ADD COLUMN IF NOT EXISTS lyric_checked_at timestamp,
      ADD COLUMN IF NOT EXISTS lyric_error text
  `);

  await db.execute(sql`
    UPDATE recordings r
    SET
      lyric_status = CASE
        WHEN EXISTS (
          SELECT 1 FROM lyric_lines l
          WHERE l.mbid = r.mbid AND l.offset_ms >= 0
        ) THEN 'lyrics_found'
        WHEN EXISTS (
          SELECT 1 FROM lyric_lines l
          WHERE l.mbid = r.mbid AND l.offset_ms = -1
        ) THEN 'no_result'
        ELSE r.lyric_status
      END,
      lyric_checked_at = CASE
        WHEN r.lyric_checked_at IS NULL
          AND EXISTS (SELECT 1 FROM lyric_lines l WHERE l.mbid = r.mbid)
        THEN COALESCE(r.updated_at, now())
        ELSE r.lyric_checked_at
      END
    WHERE r.lyric_status = 'not_checked'
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS instrumental_station_audits (
      station_id integer PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
      classification text NOT NULL,
      audited_at timestamp NOT NULL,
      sample_size integer NOT NULL DEFAULT 0,
      checked_count integer NOT NULL DEFAULT 0,
      instrumental_count integer NOT NULL DEFAULT 0,
      lyric_hit_count integer NOT NULL DEFAULT 0,
      report jsonb NOT NULL,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS instrumental_station_audits_classification_idx
      ON instrumental_station_audits(classification)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS instrumental_station_audits_audited_at_idx
      ON instrumental_station_audits(audited_at)
  `);
}