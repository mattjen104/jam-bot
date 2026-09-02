import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Runtime DDL for the station-history audit/provenance tables. These tables
 * are declared in lib/db so schema tooling sees them, while boot migration
 * keeps existing deployments safe without requiring a destructive push.
 */
export async function applyHistoryBackfillMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS station_history_backfill (
      station_id integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      source text NOT NULL,
      family text NOT NULL,
      surface text NOT NULL,
      cursor_mode text NOT NULL,
      supports_backfill boolean NOT NULL DEFAULT false,
      stable_identity text NOT NULL,
      reported_timestamp text NOT NULL,
      archive_citation text NOT NULL,
      source_url text,
      status text NOT NULL DEFAULT 'unverified',
      supported_depth_days integer,
      oldest_published_at timestamp,
      last_successful_page integer,
      accepted_count integer NOT NULL DEFAULT 0,
      rejected_count integer NOT NULL DEFAULT 0,
      duplicate_count integer NOT NULL DEFAULT 0,
      imported_count integer NOT NULL DEFAULT 0,
      last_attempt_at timestamp,
      last_success_at timestamp,
      last_failure_at timestamp,
      last_failure_reason text,
      updated_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (station_id, source)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS station_history_backfill_status_idx
      ON station_history_backfill (status)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS spin_source_provenance (
      spin_id integer PRIMARY KEY REFERENCES spins(id) ON DELETE CASCADE,
      station_id integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      source text NOT NULL,
      family text NOT NULL,
      source_url text NOT NULL,
      archive_url text,
      external_id text,
      reported_played_at timestamp,
      ingested_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS spin_source_provenance_station_idx
      ON spin_source_provenance (station_id, reported_played_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS spin_source_provenance_source_idx
      ON spin_source_provenance (source, external_id)
  `);
}