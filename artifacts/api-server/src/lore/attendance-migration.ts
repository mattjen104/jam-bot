import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the attendance system tables.
 *
 * Two tables:
 *   listen_sessions — one row per continuous listening session (user + station)
 *   attendance      — one row per spin the user was tuned for long enough
 *   attendance_rollups — maintained per-listener, per-recording read model
 *
 * All statements use IF NOT EXISTS / IF NOT EXISTS so this is safe on every boot.
 */
export async function applyAttendanceMigration(): Promise<void> {
  const stepErrors: Array<{ step: string; err: unknown }> = [];

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS listen_sessions (
        id                  serial       PRIMARY KEY,
        user_id             integer      NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
        station_id          integer      NOT NULL REFERENCES stations(id),
        started_at          timestamptz  NOT NULL DEFAULT now(),
        last_heartbeat_at   timestamptz  NOT NULL DEFAULT now(),
        ended_at            timestamptz,
        end_reason          text
      )
    `);
  } catch (err) {
    stepErrors.push({ step: "create_listen_sessions", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS listen_sessions_user_station_idx
        ON listen_sessions (user_id, station_id)
    `);
  } catch (err) {
    stepErrors.push({ step: "listen_sessions_user_station_idx", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS listen_sessions_last_heartbeat_idx
        ON listen_sessions (last_heartbeat_at)
    `);
  } catch (err) {
    stepErrors.push({ step: "listen_sessions_last_heartbeat_idx", err });
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance (
        id                    serial       PRIMARY KEY,
        user_id               integer      NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
        spin_id               integer      NOT NULL REFERENCES spins(id),
        session_id            integer      NOT NULL REFERENCES listen_sessions(id),
        dwell_seconds         integer      NOT NULL,
        spin_duration_seconds integer,
        created_at            timestamptz  NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    stepErrors.push({ step: "create_attendance", err });
  }

  try {
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS attendance_user_spin_uq
        ON attendance (user_id, spin_id)
    `);
  } catch (err) {
    stepErrors.push({ step: "attendance_user_spin_uq", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS attendance_user_idx
        ON attendance (user_id)
    `);
  } catch (err) {
    stepErrors.push({ step: "attendance_user_idx", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS attendance_session_idx
        ON attendance (session_id)
    `);
  } catch (err) {
    stepErrors.push({ step: "attendance_session_idx", err });
  }

  // credited_through column — added to make attendance upserts idempotent
  // against ATTENDANCE_DEDUP_CONFIRMED toggle replays.  Safe to run on an
  // existing table (ADD COLUMN IF NOT EXISTS).  Legacy rows keep NULL, which
  // is handled conservatively by the upsert guard in attendance.ts.
  try {
    await db.execute(sql`
      ALTER TABLE attendance
        ADD COLUMN IF NOT EXISTS credited_through timestamptz
    `);
  } catch (err) {
    stepErrors.push({ step: "attendance_add_credited_through", err });
  }

  try {
    await db.execute(sql`
      ALTER TABLE attendance
        ADD COLUMN IF NOT EXISTS rollup_counted boolean NOT NULL DEFAULT false
    `);
  } catch (err) {
    stepErrors.push({ step: "attendance_add_rollup_counted", err });
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_rollups (
        user_id        integer      NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
        recording_mbid text         NOT NULL REFERENCES recordings(mbid),
        dwell_total    integer      NOT NULL DEFAULT 0 CHECK (dwell_total >= 0),
        spin_count     integer      NOT NULL DEFAULT 0 CHECK (spin_count >= 0),
        first_heard    timestamptz,
        last_heard     timestamptz,
        PRIMARY KEY (user_id, recording_mbid)
      )
    `);
  } catch (err) {
    stepErrors.push({ step: "create_attendance_rollups", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS attendance_rollups_user_idx
        ON attendance_rollups (user_id)
    `);
  } catch (err) {
    stepErrors.push({ step: "attendance_rollups_user_idx", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS attendance_rollups_recording_idx
        ON attendance_rollups (recording_mbid)
    `);
  } catch (err) {
    stepErrors.push({ step: "attendance_rollups_recording_idx", err });
  }

  // Rebuild from the immutable attendance audit rows rather than adding to
  // existing totals. This makes a manual rerun idempotent and lets an
  // operator repair a rollup after correcting a legacy attendance row.
  //
  // Once the completion ledger is available, skip this full-table backfill on
  // subsequent boots. Older/test databases may not have the ledger yet; in
  // that case we still run the safe idempotent rebuild.
  let rollupBackfillComplete = false;
  try {
    const completion = await db.execute(sql`
      SELECT 1
      FROM migration_completions
      WHERE name = 'applyAttendanceRollupBackfill'
      LIMIT 1
    `);
    rollupBackfillComplete = (completion.rows?.length ?? 0) > 0;
  } catch {
    // The completion ledger is created earlier during normal boot. A test or
    // legacy database without it still gets the safe idempotent rebuild below.
  }

  if (!rollupBackfillComplete) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
        INSERT INTO attendance_rollups (
          user_id,
          recording_mbid,
          dwell_total,
          spin_count,
          first_heard,
          last_heard
        )
        SELECT
          a.user_id,
          s.mbid,
          SUM(a.dwell_seconds)::integer,
          COUNT(*) FILTER (
            WHERE a.dwell_seconds >= CASE
              WHEN a.spin_duration_seconds IS NOT NULL
                THEN LEAST(a.spin_duration_seconds::numeric * 0.5, 60)
              ELSE 60
            END
          )::integer,
          MIN(s.played_at) FILTER (
            WHERE a.dwell_seconds >= CASE
              WHEN a.spin_duration_seconds IS NOT NULL
                THEN LEAST(a.spin_duration_seconds::numeric * 0.5, 60)
              ELSE 60
            END
          ),
          MAX(s.played_at) FILTER (
            WHERE a.dwell_seconds >= CASE
              WHEN a.spin_duration_seconds IS NOT NULL
                THEN LEAST(a.spin_duration_seconds::numeric * 0.5, 60)
              ELSE 60
            END
          )
        FROM attendance a
        INNER JOIN spins s ON s.id = a.spin_id
        INNER JOIN recordings r ON r.mbid = s.mbid
        WHERE s.mbid IS NOT NULL
        GROUP BY a.user_id, s.mbid
        ON CONFLICT (user_id, recording_mbid) DO UPDATE SET
          dwell_total = excluded.dwell_total,
          spin_count = excluded.spin_count,
          first_heard = excluded.first_heard,
          last_heard = excluded.last_heard
        `);

        // Mark the audit rows that supplied the spin count. This marker makes a
        // later heartbeat able to distinguish a first gate crossing from a
        // dwell-only increment.
        await tx.execute(sql`
        UPDATE attendance a
        SET rollup_counted = (
          a.dwell_seconds >= CASE
            WHEN a.spin_duration_seconds IS NOT NULL
              THEN LEAST(a.spin_duration_seconds::numeric * 0.5, 60)
            ELSE 60
          END
          AND EXISTS (
            SELECT 1
            FROM spins s
            INNER JOIN recordings r ON r.mbid = s.mbid
            WHERE s.id = a.spin_id
              AND s.mbid IS NOT NULL
          )
        )
        `);

        // `migration_completions` exists in the normal boot order. If it is
        // absent in an isolated legacy/test database, fail the transaction so
        // the idempotent rebuild is retried rather than leaving partial state.
        await tx.execute(sql`
          INSERT INTO migration_completions (name)
          VALUES ('applyAttendanceRollupBackfill')
          ON CONFLICT (name) DO NOTHING
        `);
      });
    } catch (err) {
      stepErrors.push({ step: "backfill_attendance_rollups", err });
    }
  }

  if (stepErrors.length > 0) {
    const detail = stepErrors
      .map(({ step, err }) => `${step}: ${err instanceof Error ? err.message : String(err)}`)
      .join("; ");
    throw new Error(`partial failure — ${detail}`);
  }
}
