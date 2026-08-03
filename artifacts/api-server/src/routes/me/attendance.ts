import { Router, type IRouter } from "express";
import {
  db,
  listenSessionsTable,
  attendanceTable,
  attendanceRollupsTable,
  attendanceWeeklyRollupsTable,
  spinsTable,
  stationsTable,
  recordingsTable,
} from "@workspace/db";
import { eq, and, isNull, lt, desc, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// ISO week helpers
// ---------------------------------------------------------------------------

/**
 * Returns the Monday 00:00 UTC that begins the given ISO year + week number.
 * ISO weeks start on Monday; week 1 contains January 4th.
 */
function isoWeekToMonday(isoYear: number, isoWeek: number): Date {
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // 1=Mon … 7=Sun
  const week1Monday = new Date(jan4.getTime() - (dayOfWeek - 1) * 86_400_000);
  return new Date(week1Monday.getTime() + (isoWeek - 1) * 7 * 86_400_000);
}

/** Returns the ISO week label (YYYY-Www) for the Monday that starts the week. */
function mondayToIsoWeekLabel(monday: Date): string {
  // Thursday of the same week determines the ISO year (it never crosses a year boundary)
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dayOfWeek - 1) * 86_400_000);
  const week = Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 UTC for the current ISO week. */
function currentIsoWeekMonday(): Date {
  const now = new Date();
  const utcDay = now.getUTCDay() || 7; // 1=Mon … 7=Sun
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (utcDay - 1)));
}

/**
 * Returns the ISO week label ("YYYY-Www") for any given Date (UTC-based).
 * Used to place a spin's played_at into the correct weekly bucket so tracks
 * always belong to the week they aired on, not the week the heartbeat arrived.
 */
function dateToIsoWeekLabel(date: Date): string {
  const utcDay = date.getUTCDay() || 7; // 1=Mon … 7=Sun
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (utcDay - 1)));
  return mondayToIsoWeekLabel(monday);
}
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
          // --- Lifetime rollup ---
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

          // --- Weekly rollup ---
          // The ISO week is derived from the spin's played_at so the track is
          // placed in the week it actually aired, not the heartbeat week.
          const spinIsoWeek = dateToIsoWeekLabel(spin.playedAt);
          await tx
            .insert(attendanceWeeklyRollupsTable)
            .values({
              userId: user.id,
              recordingMbid: spin.mbid!,
              isoWeek: spinIsoWeek,
              dwellTotal: dwellDelta,
              spinCount: crossesGate ? 1 : 0,
              firstHeard: crossesGate ? spin.playedAt : undefined,
              lastHeard: crossesGate ? spin.playedAt : undefined,
            })
            .onConflictDoUpdate({
              target: [
                attendanceWeeklyRollupsTable.userId,
                attendanceWeeklyRollupsTable.recordingMbid,
                attendanceWeeklyRollupsTable.isoWeek,
              ],
              set: {
                dwellTotal: sql`attendance_weekly_rollups.dwell_total + excluded.dwell_total`,
                spinCount: sql`attendance_weekly_rollups.spin_count + excluded.spin_count`,
                firstHeard: sql`CASE
                  WHEN excluded.first_heard IS NULL THEN attendance_weekly_rollups.first_heard
                  WHEN attendance_weekly_rollups.first_heard IS NULL THEN excluded.first_heard
                  ELSE LEAST(attendance_weekly_rollups.first_heard, excluded.first_heard)
                END`,
                lastHeard: sql`CASE
                  WHEN excluded.last_heard IS NULL THEN attendance_weekly_rollups.last_heard
                  WHEN attendance_weekly_rollups.last_heard IS NULL THEN excluded.last_heard
                  ELSE GREATEST(attendance_weekly_rollups.last_heard, excluded.last_heard)
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
// GET /api/me/attendance/weekly
// ---------------------------------------------------------------------------

/**
 * Returns the listener's confirmed-hearing summary for a single ISO week.
 *
 * Query param:
 *   week  — ISO week label, e.g. "2026-W31". Defaults to the current week.
 *
 * A track appears in the response only when its attendance row has
 * `rollupCounted = true` (i.e. the dwell gate was met) and the spin's
 * `played_at` falls inside the requested week.
 *
 * Shape:
 *   {
 *     week: "2026-W31",
 *     weekStart: "<ISO>",   // Monday 00:00 UTC
 *     weekEnd:   "<ISO>",   // Sunday 23:59:59.999 UTC (inclusive)
 *     tracks: Array<{
 *       mbid, title, artist, artworkUrl,
 *       spinCount, dwellSeconds,
 *       firstHeard, lastHeard   // ISO timestamps of first/last qualifying spin
 *     }>,
 *     totalTracks: number,
 *     totalDwellSeconds: number,
 *   }
 *
 * Weeks with no confirmed listening return an honest empty `tracks` array —
 * no error, no null.
 */
router.get("/me/attendance/weekly", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  // --- Parse & validate the week param ---
  const weekParam = typeof req.query["week"] === "string" ? req.query["week"] : undefined;

  let weekMonday: Date;
  let weekLabel: string;

  if (weekParam !== undefined) {
    const match = /^(\d{4})-W(\d{2})$/.exec(weekParam);
    if (!match) {
      return res.status(400).json({ error: "week must be in YYYY-Www format, e.g. 2026-W31" });
    }
    const isoYear = parseInt(match[1]!, 10);
    const isoWeek = parseInt(match[2]!, 10);
    if (isoWeek < 1 || isoWeek > 53) {
      return res.status(400).json({ error: "week number must be between 1 and 53" });
    }
    weekMonday = isoWeekToMonday(isoYear, isoWeek);
    // Round-trip through the helper so the label is canonical (guards edge-case
    // inputs like week 53 in a year that only has 52 — the Monday lands in the
    // previous year's week 52 space, and we return whatever the canonical label
    // is for that Monday rather than echoing back a malformed label).
    weekLabel = mondayToIsoWeekLabel(weekMonday);
  } else {
    weekMonday = currentIsoWeekMonday();
    weekLabel = mondayToIsoWeekLabel(weekMonday);
  }

  // Inclusive end (last millisecond of Sunday) for the response only.
  const weekEndInclusive = new Date(weekMonday.getTime() + 7 * 86_400_000 - 1);

  // --- Read from the maintained weekly rollup (constant-time lookup) ---
  //
  // The heartbeat write path upserts into attendance_weekly_rollups whenever
  // dwell advances or a new spin crosses the gate, so this endpoint never
  // re-aggregates raw rows. The query is an index scan on (user_id, iso_week)
  // followed by a lookup join on recordings — O(tracks heard that week).
  const rows = await db
    .select({
      mbid: attendanceWeeklyRollupsTable.recordingMbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      spinCount: attendanceWeeklyRollupsTable.spinCount,
      dwellSeconds: attendanceWeeklyRollupsTable.dwellTotal,
      firstHeard: attendanceWeeklyRollupsTable.firstHeard,
      lastHeard: attendanceWeeklyRollupsTable.lastHeard,
    })
    .from(attendanceWeeklyRollupsTable)
    .innerJoin(
      recordingsTable,
      eq(attendanceWeeklyRollupsTable.recordingMbid, recordingsTable.mbid),
    )
    .where(
      and(
        eq(attendanceWeeklyRollupsTable.userId, user.id),
        eq(attendanceWeeklyRollupsTable.isoWeek, weekLabel),
        sql`${attendanceWeeklyRollupsTable.spinCount} > 0`,
      ),
    )
    .orderBy(
      desc(attendanceWeeklyRollupsTable.spinCount),
      desc(attendanceWeeklyRollupsTable.lastHeard),
    );

  const totalDwellSeconds = rows.reduce((acc, r) => acc + r.dwellSeconds, 0);

  return res.json({
    week: weekLabel,
    weekStart: weekMonday.toISOString(),
    weekEnd: weekEndInclusive.toISOString(),
    tracks: rows.map((r) => ({
      mbid: r.mbid,
      title: r.title,
      artist: r.artist,
      artworkUrl: r.artworkUrl ?? null,
      spinCount: r.spinCount,
      dwellSeconds: r.dwellSeconds,
      firstHeard: r.firstHeard,
      lastHeard: r.lastHeard,
    })),
    totalTracks: rows.length,
    totalDwellSeconds,
  });
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
