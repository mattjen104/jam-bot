import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for Ghost Replay's durable cross-service maps and jobs.
 * The manifest itself stays derived from spins; these tables contain only
 * enrichment assets and resumable user-requested work.
 */
export async function applyReplayResolutionMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS service_track_map (
      id                 serial PRIMARY KEY,
      recording_mbid     text NOT NULL REFERENCES recordings(mbid),
      service            text NOT NULL,
      external_id        text,
      url                text NOT NULL,
      method             text NOT NULL,
      confidence         text NOT NULL DEFAULT 'search',
      verification       text NOT NULL DEFAULT 'unverified',
      dead_link          boolean NOT NULL DEFAULT false,
      dead_at            timestamp,
      last_verified_at   timestamp,
      created_at         timestamp NOT NULL DEFAULT now(),
      updated_at         timestamp NOT NULL DEFAULT now(),
      CONSTRAINT service_track_map_recording_service_uq
        UNIQUE (recording_mbid, service)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS replay_materialization_jobs (
      id                serial PRIMARY KEY,
      user_id           integer NOT NULL REFERENCES lore_users(id),
      replay_id         integer NOT NULL,
      service           text NOT NULL,
      status            text NOT NULL DEFAULT 'pending',
      total             integer NOT NULL DEFAULT 0,
      processed         integer NOT NULL DEFAULT 0,
      accepted          integer NOT NULL DEFAULT 0,
      missing           integer NOT NULL DEFAULT 0,
      rejected         integer NOT NULL DEFAULT 0,
      retryable         integer NOT NULL DEFAULT 0,
      name              text NOT NULL,
      description       text NOT NULL,
      playlist_id       text,
      playlist_url      text,
      error             text,
      error_retryable   boolean NOT NULL DEFAULT false,
      finished_at       timestamp,
      created_at        timestamp NOT NULL DEFAULT now(),
      receipt           jsonb
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS replay_materialization_jobs_user_idx
      ON replay_materialization_jobs (user_id, created_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS replay_materialization_jobs_status_idx
      ON replay_materialization_jobs (status)
  `);
  // Only one active request may create a provider playlist for the same
  // listener, immutable replay, and destination. Terminal jobs are retained as
  // receipts and must not block a deliberate retry.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS replay_materialization_jobs_active_uq
      ON replay_materialization_jobs (user_id, replay_id, service)
      WHERE status IN ('pending', 'running')
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS service_track_map_service_external_idx
      ON service_track_map (service, external_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS service_track_map_recording_idx
      ON service_track_map (recording_mbid)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS replay_resolution_jobs (
      id                serial PRIMARY KEY,
      user_id           integer NOT NULL REFERENCES lore_users(id),
      replay_id         integer NOT NULL,
      status            text NOT NULL DEFAULT 'pending',
      total             integer NOT NULL DEFAULT 0,
      processed         integer NOT NULL DEFAULT 0,
      resolved          integer NOT NULL DEFAULT 0,
      missing           integer NOT NULL DEFAULT 0,
      failed            integer NOT NULL DEFAULT 0,
      committed_offset  integer NOT NULL DEFAULT 0,
      created_at        timestamp NOT NULL DEFAULT now(),
      started_at        timestamp NOT NULL DEFAULT now(),
      finished_at       timestamp,
      error             text,
      failures          jsonb
    )
  `);
  // Early deployments may have created the job table before failure details
  // were persisted. Keep this migration additive so an interrupted rollout can
  // resume jobs rather than failing on the first checkpoint update.
  await db.execute(sql`
    ALTER TABLE replay_resolution_jobs
      ADD COLUMN IF NOT EXISTS failures jsonb
  `);
  await db.execute(sql`
    ALTER TABLE replay_materialization_jobs
      ADD COLUMN IF NOT EXISTS error_retryable boolean NOT NULL DEFAULT false
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS replay_resolution_jobs_user_idx
      ON replay_resolution_jobs (user_id, started_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS replay_resolution_jobs_status_idx
      ON replay_resolution_jobs (status)
  `);

  // Negative-cache (embed_miss) columns.  url becomes nullable so that a
  // service="odesli" sentinel row can record "tried and found nothing" without
  // inventing a fake URL.  miss_reason and missed_at carry the reason and a TTL
  // anchor so the resolver can skip hopeless MBIDs for 30 days before retrying.
  await db.execute(sql`
    ALTER TABLE service_track_map
      ALTER COLUMN url DROP NOT NULL
  `);
  await db.execute(sql`
    ALTER TABLE service_track_map
      ADD COLUMN IF NOT EXISTS miss_reason text
  `);
  await db.execute(sql`
    ALTER TABLE service_track_map
      ADD COLUMN IF NOT EXISTS missed_at timestamptz
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS service_track_map_miss_idx
      ON service_track_map (recording_mbid, missed_at)
      WHERE miss_reason IS NOT NULL
  `);
}