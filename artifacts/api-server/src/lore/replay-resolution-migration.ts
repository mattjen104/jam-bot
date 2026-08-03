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
    CREATE INDEX IF NOT EXISTS replay_resolution_jobs_user_idx
      ON replay_resolution_jobs (user_id, started_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS replay_resolution_jobs_status_idx
      ON replay_resolution_jobs (status)
  `);
  // Do not use a partial unique index here: the Drizzle schema is also used by
  // fresh databases. The worker-side active-job check is race-safe enough for
  // the anonymous device session model and keeps this migration portable.
}