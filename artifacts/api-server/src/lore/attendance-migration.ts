import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the attendance system tables.
 *
 * Two tables:
 *   listen_sessions — one row per continuous listening session (user + station)
 *   attendance      — one row per spin the user was tuned for long enough
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

  if (stepErrors.length > 0) {
    const detail = stepErrors
      .map(({ step, err }) => `${step}: ${err instanceof Error ? err.message : String(err)}`)
      .join("; ");
    throw new Error(`partial failure — ${detail}`);
  }
}
