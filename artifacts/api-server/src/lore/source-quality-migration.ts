import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Restart-safe runtime source-quality funnel. Probe evidence remains in
 * station_source_probes; this table records ordinary probe/poll/watcher
 * attempts per station and configured source.
 */
export async function applyStationSourceQualityMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS station_source_quality (
      station_id integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      source text NOT NULL,
      capability text NOT NULL,
      last_outcome text NOT NULL,
      last_detail text,
      last_attempt_at timestamp NOT NULL,
      last_response_at timestamp,
      last_usable_at timestamp,
      last_usable_artist text,
      last_usable_title text,
      window_started_at timestamp NOT NULL DEFAULT now(),
      outcome_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (station_id, source)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS station_source_quality_attempt_idx
      ON station_source_quality (last_attempt_at DESC)
  `);
}