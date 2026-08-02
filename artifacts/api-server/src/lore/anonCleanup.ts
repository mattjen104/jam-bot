/**
 * Anonymous session expiry — periodic hard-delete of ghost lore_users rows.
 *
 * Eligible rows must satisfy ALL three conditions:
 *   1. No linked Spotify account: `spotify_user_id IS NULL` AND no
 *      `service_connections` row (covers the legacy field + the new OAuth table).
 *   2. No library items: no `library_items` row.
 *   3. Idle for ≥ 90 days: `last_seen_at < now() - interval '90 days'`
 *      (rows with NULL last_seen_at are also swept — they were never touched
 *      after provisioning and therefore carry no meaningful data).
 *
 * Safety: explicit NOT EXISTS guards cover every non-cascading FK that
 * references lore_users.id so the DELETE can never fail with a FK violation
 * and can never silently remove rows that have meaningful linked data:
 *   - service_connections  (no cascade)
 *   - library_items        (no cascade)
 *   - selector_claims      (no cascade, nullable userId)
 *   - library_import_jobs  (no cascade)
 *   - import_items         (no cascade)
 *   - keep_targets         (no cascade)
 *   - library_sync_jobs    (no cascade)
 *
 * Tables with ON DELETE CASCADE (listen_sessions, attendance, listens,
 * spotify_library_items, crossings_cache, taste_seeds, pending_keeps,
 * user_source_affinity, picker_follows) are intentionally not guarded —
 * cascade delete is the correct behaviour for session-local data on an
 * anonymous row that has no other linked state.
 *
 * This is additive — it does not alter any schema columns or migration files.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** How long an anonymous row must be idle before it is eligible for deletion. */
const ANON_MAX_IDLE_DAYS = 90;

/** How often the scheduler runs (24 hours). */
const SCHEDULE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Core deletion query
// ---------------------------------------------------------------------------

/**
 * Delete eligible anonymous lore_users rows and return the count removed.
 *
 * All non-cascading FK dependents are covered by explicit NOT EXISTS guards,
 * so a row with ANY linked data is never deleted and the query can never fail
 * due to a FK violation.
 */
export async function runAnonCleanup(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM lore_users
    WHERE
      -- Condition 1: no legacy Spotify user id
      spotify_user_id IS NULL
      -- Condition 1b: no modern service_connections row (non-cascading FK)
      AND NOT EXISTS (
        SELECT 1 FROM service_connections
        WHERE user_id = lore_users.id
      )
      -- Condition 2: no library items (non-cascading FK)
      AND NOT EXISTS (
        SELECT 1 FROM library_items
        WHERE user_id = lore_users.id
      )
      -- Guard: no selector_claims row (nullable userId, non-cascading FK)
      AND NOT EXISTS (
        SELECT 1 FROM selector_claims
        WHERE user_id = lore_users.id
      )
      -- Guard: no library import job (non-cascading FK)
      AND NOT EXISTS (
        SELECT 1 FROM library_import_jobs
        WHERE user_id = lore_users.id
      )
      -- Guard: no import_items rows (non-cascading FK)
      AND NOT EXISTS (
        SELECT 1 FROM import_items
        WHERE user_id = lore_users.id
      )
      -- Guard: no keep_targets row (non-cascading FK)
      AND NOT EXISTS (
        SELECT 1 FROM keep_targets
        WHERE user_id = lore_users.id
      )
      -- Guard: no library_sync_jobs row (non-cascading FK)
      AND NOT EXISTS (
        SELECT 1 FROM library_sync_jobs
        WHERE user_id = lore_users.id
      )
      -- Condition 3: idle for ≥ 90 days (NULL = never touched after provisioning)
      AND (
        last_seen_at IS NULL
        OR last_seen_at < now() - interval '${sql.raw(String(ANON_MAX_IDLE_DAYS))} days'
      )
  `);

  // drizzle's execute() returns a QueryResult whose rowCount is the pg count.
  return (result as unknown as { rowCount: number | null }).rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let _handle: ReturnType<typeof setInterval> | null = null;

/**
 * Schedule the anonymous-session cleanup job to run every 24 hours.
 * Errors are swallowed with a warning log so a single DB failure never
 * crashes the process.
 *
 * Call once from server startup. Returns a cancel function for graceful
 * shutdown.
 */
export function scheduleAnonCleanup(): () => void {
  async function tick(): Promise<void> {
    try {
      const deleted = await runAnonCleanup();
      console.info(`[anonCleanup] deleted ${deleted} stale anonymous user row(s)`);
    } catch (err) {
      console.warn("[anonCleanup] cleanup run failed (non-fatal):", err);
    }
  }

  // Run once shortly after startup (5 min offset so boot migrations complete
  // first), then on the 24-hour cadence.
  const initialDelay = setTimeout(() => void tick(), 5 * 60 * 1_000);
  _handle = setInterval(() => void tick(), SCHEDULE_INTERVAL_MS);

  return () => {
    clearTimeout(initialDelay);
    if (_handle != null) {
      clearInterval(_handle);
      _handle = null;
    }
  };
}
