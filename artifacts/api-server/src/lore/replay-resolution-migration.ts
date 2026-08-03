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

  // Role-aware in-page embed facts deliberately live beside, not inside,
  // service_track_map. The latter remains the one-row-per-service source for
  // general streaming links and playlist materialization.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS embed_link (
      id                    serial PRIMARY KEY,
      recording_mbid        text NOT NULL REFERENCES recordings(mbid),
      provider              text NOT NULL,
      role                  text NOT NULL,
      rung                  integer NOT NULL,
      outcome               text NOT NULL,
      release_mbid          text,
      provider_release_id   text,
      provider_track_id     text,
      source_url            text,
      resolved_via          text NOT NULL,
      confidence            text NOT NULL,
      reason                text NOT NULL,
      previous_release_mbid text,
      release_changed_at    timestamp,
      fetched_at            timestamp NOT NULL DEFAULT now(),
      expires_at            timestamp NOT NULL,
      created_at            timestamp NOT NULL DEFAULT now(),
      updated_at            timestamp NOT NULL DEFAULT now(),
      CONSTRAINT embed_link_recording_provider_role_uq
        UNIQUE (recording_mbid, provider, role),
      CONSTRAINT embed_link_rung_ck
        CHECK (rung BETWEEN 1 AND 6),
      CONSTRAINT embed_link_provider_ck
        CHECK (provider IN ('bandcamp', 'youtube')),
      CONSTRAINT embed_link_role_ck
        CHECK (role IN ('provenance', 'control')),
      CONSTRAINT embed_link_outcome_ck
        CHECK (
          (outcome = 'embedded' AND rung BETWEEN 1 AND 4) OR
          (outcome = 'link_out' AND rung = 5) OR
          (outcome = 'no_link' AND rung = 6) OR
          (outcome = 'expired' AND rung BETWEEN 1 AND 5) OR
          (outcome = 'transient_failure' AND rung BETWEEN 1 AND 6)
        )
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embed_link_recording_idx
      ON embed_link (recording_mbid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embed_link_provider_role_idx
      ON embed_link (provider, role)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embed_link_expiry_idx
      ON embed_link (expires_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embed_link_metrics_idx
      ON embed_link (provider, role, rung, outcome, fetched_at)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS embed_resolution_queue (
      id                serial PRIMARY KEY,
      recording_mbid    text NOT NULL REFERENCES recordings(mbid) ON DELETE CASCADE,
      provider          text NOT NULL,
      role              text NOT NULL,
      status            text NOT NULL DEFAULT 'pending',
      priority          integer NOT NULL DEFAULT 50,
      attempts          integer NOT NULL DEFAULT 0,
      next_attempt_at   timestamp NOT NULL DEFAULT now(),
      locked_at         timestamp,
      last_error        text,
      station_id        integer REFERENCES stations(id) ON DELETE SET NULL,
      genre_cluster     text,
      requested_at      timestamp NOT NULL DEFAULT now(),
      expires_at        timestamp,
      metric_recorded_at timestamp,
      created_at        timestamp NOT NULL DEFAULT now(),
      updated_at        timestamp NOT NULL DEFAULT now(),
      CONSTRAINT embed_resolution_queue_identity_uq
        UNIQUE (recording_mbid, provider, role)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embed_resolution_queue_claim_idx
      ON embed_resolution_queue (status, next_attempt_at, priority, id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embed_resolution_queue_recording_idx
      ON embed_resolution_queue (recording_mbid)
  `);
  await db.execute(sql`
    ALTER TABLE embed_resolution_queue
      DROP CONSTRAINT IF EXISTS embed_resolution_queue_station_id_fkey
  `);
  await db.execute(sql`
    ALTER TABLE embed_resolution_queue
      ADD CONSTRAINT embed_resolution_queue_station_id_fkey
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE SET NULL
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS embed_resolution_metrics (
      id              serial PRIMARY KEY,
      station_id      integer NOT NULL DEFAULT 0,
      genre_cluster   text NOT NULL DEFAULT 'unknown',
      week_start      timestamp NOT NULL,
      provider        text NOT NULL,
      role            text NOT NULL,
      rung            integer NOT NULL,
      outcome         text NOT NULL,
      count           integer NOT NULL DEFAULT 0,
      updated_at      timestamp NOT NULL DEFAULT now(),
      CONSTRAINT embed_resolution_metrics_identity_uq
        UNIQUE (station_id, genre_cluster, week_start, provider, role, rung, outcome)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embed_resolution_metrics_week_idx
      ON embed_resolution_metrics (week_start)
  `);
  await db.execute(sql`
    ALTER TABLE embed_resolution_metrics
      DROP CONSTRAINT IF EXISTS embed_resolution_metrics_station_id_fkey
  `);
  await db.execute(sql`
    UPDATE embed_resolution_metrics
      SET station_id = 0 WHERE station_id IS NULL
  `);
  await db.execute(sql`
    UPDATE embed_resolution_metrics
      SET genre_cluster = 'unknown' WHERE genre_cluster IS NULL
  `);
  await db.execute(sql`
    ALTER TABLE embed_resolution_metrics
      ALTER COLUMN station_id SET DEFAULT 0,
      ALTER COLUMN station_id SET NOT NULL,
      ALTER COLUMN genre_cluster SET DEFAULT 'unknown',
      ALTER COLUMN genre_cluster SET NOT NULL
  `);
  // Refresh the outcome/rung invariant for installations that created the
  // table during an earlier boot of this additive migration.
  await db.execute(sql`
    ALTER TABLE embed_link
      DROP CONSTRAINT IF EXISTS embed_link_outcome_ck
  `);
  await db.execute(sql`
    ALTER TABLE embed_link
      ADD CONSTRAINT embed_link_outcome_ck
      CHECK (
        (outcome = 'embedded' AND rung BETWEEN 1 AND 4) OR
        (outcome = 'link_out' AND rung = 5) OR
        (outcome = 'no_link' AND rung = 6) OR
        (outcome = 'expired' AND rung BETWEEN 1 AND 5) OR
        (outcome = 'transient_failure' AND rung BETWEEN 1 AND 6)
      )
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
  // Surface network errors as a separate counter so operators can distinguish
  // transient Odesli outages from genuinely unresolvable tracks.
  await db.execute(sql`
    ALTER TABLE replay_resolution_jobs
      ADD COLUMN IF NOT EXISTS network_errors integer NOT NULL DEFAULT 0
  `);
}
