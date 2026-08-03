import { Router, type IRouter } from "express";
import {
  db,
  listenSessionsTable,
  attendanceTable,
  attendanceRollupsTable,
  spinsTable,
  stationsTable,
  recordingsTable,
} from "@workspace/db";
import { eq, and, isNull, lt, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A session with no heartbeat for this long is considered ended. */
const SESSION_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Maximum amount of time a single heartbeat may credit as continuous
 * listening. The web player normally heartbeats every 45 seconds, but a
 * delayed request, paused tab, or stalled playback must not turn the whole
 * gap into attendance.
 */
export const MAX_ATTENDANCE_CREDIT_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Dwell gate: the user must have overlapped a spin for at least this many
 * seconds OR 50% of the spin's duration (whichever is lower) to earn an
 * attendance row.  Sub-threshold overlaps are discarded entirely.
 */
const DWELL_GATE_ABSOLUTE_S = 60;
const DWELL_GATE_FRACTION = 0.5;

/**
 * Feature flag — guards the spin-join dwell computation.  Set to true once
 * the spin-log dedupe fix is confirmed stable (task: make radio history never
 * double-count).  When false, the heartbeat still upserts the session but
 * does NOT write attendance rows (preventing double-counted heard counts).
 *
 * Check the env var first so it can be toggled without a deploy.
 */
function isDedupConfirmed(): boolean {
  const env = process.env["ATTENDANCE_DEDUP_CONFIRMED"];
  return env === "1" || env === "true";
}

// ---------------------------------------------------------------------------
// POST /api/me/attendance/heartbeat
// ---------------------------------------------------------------------------

/**
 * Heartbeat from the Lore web player.
 *
 * Body: { stationId: number }
 *
 * 1. Finds or creates an active listen_session for (userId, stationId).
 *    "Active" means ended_at IS NULL and last_heartbeat_at is within 4 h.
 * 2. Bumps last_heartbeat_at.
 * 3. If dedup is confirmed, joins the session window against spins for the
 *    station to compute dwell for each spin, and upserts qualifying attendance.
 * 4. Returns { sessionId }.
 */
router.post("/me/attendance/heartbeat", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const { stationId } = req.body as { stationId?: unknown };

  if (typeof stationId !== "number" || !Number.isInteger(stationId) || stationId <= 0) {
    return res.status(400).json({ error: "stationId must be a positive integer" });
  }

  const now = new Date();
  const expiryThreshold = new Date(now.getTime() - SESSION_EXPIRY_MS);

  // --- 1. Find or create active session (atomic read+bump) ---
  //
  // Wrapped in a transaction with SELECT … FOR UPDATE so concurrent heartbeats
  // from the same user cannot read the same prevHeartbeatAt and double-count
  // the same window.  Only one request holds the row lock at a time; the next
  // waits and then reads the already-bumped timestamp as its own window start.
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: listenSessionsTable.id,
        lastHeartbeatAt: listenSessionsTable.lastHeartbeatAt,
      })
      .from(listenSessionsTable)
      .where(
        and(
          eq(listenSessionsTable.userId, user.id),
          eq(listenSessionsTable.stationId, stationId),
          isNull(listenSessionsTable.endedAt),
          sql`${listenSessionsTable.lastHeartbeatAt} >= ${expiryThreshold}`,
        ),
      )
      .orderBy(sql`${listenSessionsTable.lastHeartbeatAt} DESC`)
      .limit(1)
      .for("update"); // lock the row — concurrent heartbeat must wait

    let sessionId: number;
    let prevHeartbeatAt: Date;
    if (existing) {
      sessionId = existing.id;
      prevHeartbeatAt = existing.lastHeartbeatAt;
      await tx
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: now })
        .where(eq(listenSessionsTable.id, existing.id));
    } else {
      const [created] = await tx
        .insert(listenSessionsTable)
        .values({
          userId: user.id,
          stationId,
          startedAt: now,
          lastHeartbeatAt: now,
        })
        .returning({ id: listenSessionsTable.id });
      if (!created) throw new Error("Failed to create listen session");
      sessionId = created.id;
      // Zero-width window on session open — no dwell credited yet.
      prevHeartbeatAt = now;
    }

    // --- 2. Dwell computation (guarded by feature flag) ---
    //
    // Incremental, bounded window: only a recent interval between the previous
    // confirmed heartbeat and this one counts as verified listening. Pauses, tab
    // hides, and station switches cannot make an arbitrarily long gap eligible.
    if (isDedupConfirmed()) {
      const windowEndMs = now.getTime();
      // Clamp before querying spins or calculating overlap. The heartbeat
      // timestamp remains the high-water mark for idempotency.
      const windowStartMs = Math.max(
        prevHeartbeatAt.getTime(),
        windowEndMs - MAX_ATTENDANCE_CREDIT_WINDOW_MS,
      );

    // Zero-width window (first heartbeat of a new session) — nothing to credit.
      if (windowEndMs <= windowStartMs) return { sessionId };

      const windowStart = new Date(windowStartMs);

    // Fetch spins that could overlap the incremental window:
    //  • Known-duration spins: started before window ends AND ended after window starts
    //    (i.e. played_at + duration_ms > windowStart).
    //  • Unknown-duration spins: ONLY when played_at is inside the window
    //    (played_at >= windowStart). We cannot know when they ended, so we
    //    refuse to credit them for windows that began before they started.
      const spinsInWindow = await tx
        .select({
          id: spinsTable.id,
          mbid: spinsTable.mbid,
          playedAt: spinsTable.playedAt,
          durationMs: recordingsTable.durationMs,
        })
        .from(spinsTable)
        .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
        .where(
          and(
            eq(spinsTable.stationId, stationId),
            sql`${spinsTable.mbid} IS NOT NULL`,
            sql`${spinsTable.playedAt} < ${now}`,
            sql`(
              (${recordingsTable.durationMs} IS NOT NULL
               AND ${spinsTable.playedAt} + (${recordingsTable.durationMs} * interval '1 millisecond') > ${windowStart})
              OR
              (${recordingsTable.durationMs} IS NULL
               AND ${spinsTable.playedAt} >= ${windowStart})
            )`,
          ),
        );

      for (const spin of spinsInWindow) {
        const spinStartMs = spin.playedAt.getTime();

        let overlapStart: number;
        let overlapEnd: number;

        if (spin.durationMs != null) {
          const spinEndMs = spinStartMs + spin.durationMs;
          overlapStart = Math.max(spinStartMs, windowStartMs);
          overlapEnd = Math.min(spinEndMs, windowEndMs);
        } else {
          overlapStart = spinStartMs;
          overlapEnd = windowEndMs;
        }

        if (overlapEnd <= overlapStart) continue;

        const dwellSeconds = Math.floor((overlapEnd - overlapStart) / 1000);
        if (dwellSeconds <= 0) continue;

        const spinDurationSeconds = spin.durationMs != null
          ? Math.floor(spin.durationMs / 1000)
          : null;

        // Always upsert positive overlap — no per-slice gate. The dwell gate is
        // applied after the rollup update so incremental slices accumulate
        // correctly across heartbeats.
      //
      // Idempotency guard: `credited_through` is the high-water mark of the
      // latest window-end that has been credited into this row.  On conflict we
      // only accumulate dwell when the incoming credited_through is strictly
      // greater than what is already stored, preventing double-counting if
      // ATTENDANCE_DEDUP_CONFIRMED is toggled off and on again.
      //
      // Legacy rows (credited_through IS NULL, written before this column was
      // added): we accept the first conflict write normally — this seeds the
      // high-water mark and brings the row under idempotency protection.
      // Subsequent replays of the same or earlier window are then no-ops.
      //
      // NOTE: Postgres GREATEST(NULL, x) returns NULL, so we must use
      // COALESCE(GREATEST(a, b), b) to guarantee the mark advances from NULL.
        const [previousAttendance] = await tx
          .select({
            creditedThrough: attendanceTable.creditedThrough,
          })
          .from(attendanceTable)
          .where(
            and(
              eq(attendanceTable.userId, user.id),
              eq(attendanceTable.spinId, spin.id),
            ),
          )
          .for("update");
        const shouldAccumulate =
          !previousAttendance ||
          previousAttendance.creditedThrough == null ||
          now > previousAttendance.creditedThrough;

        await tx
        .insert(attendanceTable)
        .values({
          userId: user.id,
          spinId: spin.id,
          sessionId,
          dwellSeconds,
          spinDurationSeconds,
          creditedThrough: now,
        })
          .onConflictDoUpdate({
          target: [attendanceTable.userId, attendanceTable.spinId],
          set: {
            // Accumulate dwell when:
            //   a) the stored high-water mark is NULL (legacy row — seed it), OR
            //   b) the incoming window-end extends beyond the stored mark.
            // Replaying the same or an earlier window-end adds 0 seconds.
            dwellSeconds: sql`attendance.dwell_seconds + CASE
              WHEN attendance.credited_through IS NULL
                OR excluded.credited_through > attendance.credited_through
              THEN excluded.dwell_seconds
              ELSE 0
            END`,
            // Advance the high-water mark; COALESCE handles the NULL→value
            // transition because GREATEST(NULL, x) = NULL in Postgres.
            creditedThrough: sql`COALESCE(
              GREATEST(attendance.credited_through, excluded.credited_through),
              excluded.credited_through
            )`,
            sessionId,
            spinDurationSeconds: sql`COALESCE(attendance.spin_duration_seconds, excluded.spin_duration_seconds)`,
          },
          });

        const [updatedAttendance] = await tx
          .select({
            dwellSeconds: attendanceTable.dwellSeconds,
            spinDurationSeconds: attendanceTable.spinDurationSeconds,
            rollupCounted: attendanceTable.rollupCounted,
          })
          .from(attendanceTable)
          .where(
            and(
              eq(attendanceTable.userId, user.id),
              eq(attendanceTable.spinId, spin.id),
            ),
          )
          .for("update");

        if (!updatedAttendance) {
          throw new Error("Attendance upsert did not return a row");
        }

        const gateSeconds = updatedAttendance.spinDurationSeconds != null
          ? Math.min(updatedAttendance.spinDurationSeconds * DWELL_GATE_FRACTION, DWELL_GATE_ABSOLUTE_S)
          : DWELL_GATE_ABSOLUTE_S;
        const crossesGate =
          !updatedAttendance.rollupCounted &&
          updatedAttendance.dwellSeconds >= gateSeconds;
        const dwellDelta = shouldAccumulate ? dwellSeconds : 0;

        // The attendance row is locked and updated in this same transaction as
        // the rollup. A retry with the same high-water mark has dwellDelta=0,
        // and rollupCounted prevents a second spin-count increment.
        if (dwellDelta > 0 || crossesGate) {
          await tx
            .insert(attendanceRollupsTable)
            .values({
              userId: user.id,
              recordingMbid: spin.mbid!,
              dwellTotal: dwellDelta,
              spinCount: crossesGate ? 1 : 0,
              firstHeard: crossesGate ? spin.playedAt : undefined,
              lastHeard: crossesGate ? spin.playedAt : undefined,
            })
            .onConflictDoUpdate({
              target: [
                attendanceRollupsTable.userId,
                attendanceRollupsTable.recordingMbid,
              ],
              set: {
                dwellTotal: sql`attendance_rollups.dwell_total + excluded.dwell_total`,
                spinCount: sql`attendance_rollups.spin_count + excluded.spin_count`,
                firstHeard: sql`CASE
                  WHEN excluded.first_heard IS NULL THEN attendance_rollups.first_heard
                  WHEN attendance_rollups.first_heard IS NULL THEN excluded.first_heard
                  ELSE LEAST(attendance_rollups.first_heard, excluded.first_heard)
                END`,
                lastHeard: sql`CASE
                  WHEN excluded.last_heard IS NULL THEN attendance_rollups.last_heard
                  WHEN attendance_rollups.last_heard IS NULL THEN excluded.last_heard
                  ELSE GREATEST(attendance_rollups.last_heard, excluded.last_heard)
                END`,
              },
            });
        }

        if (crossesGate) {
          await tx
            .update(attendanceTable)
            .set({ rollupCounted: true })
            .where(
              and(
                eq(attendanceTable.userId, user.id),
                eq(attendanceTable.spinId, spin.id),
              ),
            );
        }
      }
    }

    return { sessionId };
  }).then(({ sessionId }) => res.json({ sessionId }));
}));

// ---------------------------------------------------------------------------
// GET /api/me/attendance/counts
// ---------------------------------------------------------------------------

/**
 * Returns per-recording heard counts for the authenticated user.
 * Shape: Array<{ mbid: string; heardCount: number }>
 *
 * Used by crossing surfaces to show "heard 6×" bylines.
 */
router.get("/me/attendance/counts", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const rows = await db
    .select({
      mbid: attendanceRollupsTable.recordingMbid,
      heardCount: attendanceRollupsTable.spinCount,
    })
    .from(attendanceRollupsTable)
    .where(
      and(
        eq(attendanceRollupsTable.userId, user.id),
        sql`${attendanceRollupsTable.spinCount} > 0`,
      ),
    )
  const counts = rows.map((r) => ({ mbid: r.mbid, heardCount: r.heardCount }));

  return res.json(counts);
}));

// ---------------------------------------------------------------------------
// Session expiry worker
// ---------------------------------------------------------------------------

let _expiryTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Close sessions that have had no heartbeat for > 4 h.
 * Runs on a 15-minute cadence.  Never throws — failures are logged.
 */
async function runSessionExpiryPass(): Promise<void> {
  try {
    const threshold = new Date(Date.now() - SESSION_EXPIRY_MS);
    const result = await db
      .update(listenSessionsTable)
      .set({
        endedAt: new Date(),
        endReason: "expired",
      })
      .where(
        and(
          isNull(listenSessionsTable.endedAt),
          lt(listenSessionsTable.lastHeartbeatAt, threshold),
        ),
      )
      .returning({ id: listenSessionsTable.id });

    if (result.length > 0) {
      console.log(`[attendance] expired ${result.length} idle session(s)`);
    }
  } catch (err) {
    console.error("[attendance] session expiry pass failed", err);
  }
}

/** Start the 15-minute session expiry scheduler. Idempotent. */
export function startSessionExpiryWorker(): void {
  if (_expiryTimer) return;
  const INTERVAL_MS = 15 * 60 * 1000;
  // Run once at startup to catch any sessions that expired during downtime.
  void runSessionExpiryPass();
  _expiryTimer = setInterval(() => void runSessionExpiryPass(), INTERVAL_MS);
  _expiryTimer.unref?.();
  console.log("[attendance] session expiry worker started");
}

export default router;
