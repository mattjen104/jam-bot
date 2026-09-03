import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Durable, non-identifying playback-health rollups.
 *
 * Each row is one station/source/warmup combination for one UTC day. Counters
 * are incremented atomically and the latency arrays are kept as bounded
 * samples, which gives the admin read model a useful percentile approximation
 * without retaining individual playback events or any listener identity.
 */
export async function applyPlaybackHealthMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS playback_health_rollups (
      station_slug       text        NOT NULL,
      transport          text        NOT NULL,
      format             text        NOT NULL,
      warmed             boolean     NOT NULL DEFAULT false,
      bucket_started_at  timestamptz NOT NULL,
      playing_count      integer     NOT NULL DEFAULT 0 CHECK (playing_count >= 0),
      startup_failure_count integer  NOT NULL DEFAULT 0 CHECK (startup_failure_count >= 0),
      stall_count        integer     NOT NULL DEFAULT 0 CHECK (stall_count >= 0),
      recovery_count     integer     NOT NULL DEFAULT 0 CHECK (recovery_count >= 0),
      terminal_failure_count integer NOT NULL DEFAULT 0 CHECK (terminal_failure_count >= 0),
      startup_samples    integer[]   NOT NULL DEFAULT ARRAY[]::integer[],
      stall_samples      integer[]   NOT NULL DEFAULT ARRAY[]::integer[],
      first_sample_at    timestamptz NOT NULL,
      last_sample_at     timestamptz NOT NULL,
      PRIMARY KEY (station_slug, transport, format, warmed, bucket_started_at)
    )
  `);
  await db.execute(sql`
    ALTER TABLE playback_health_rollups
      ADD COLUMN IF NOT EXISTS warmed boolean NOT NULL DEFAULT false
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'playback_health_rollups'::regclass
          AND conname = 'playback_health_rollups_pkey'
          AND pg_get_constraintdef(oid) NOT LIKE '%warmed%'
      ) THEN
        ALTER TABLE playback_health_rollups
          DROP CONSTRAINT playback_health_rollups_pkey;
        ALTER TABLE playback_health_rollups
          ADD CONSTRAINT playback_health_rollups_pkey
          PRIMARY KEY (station_slug, transport, format, warmed, bucket_started_at);
      END IF;
    END
    $$
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS playback_health_rollups_bucket_idx
      ON playback_health_rollups (bucket_started_at)
  `);
}