import { Router, type IRouter } from "express";
import {
  db,
  listenSessionsTable,
  attendanceTable,
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
  const { sessionId, prevHeartbeatAt } = await db.transaction(async (tx) => {
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

    if (existing) {
      const prev = existing.lastHeartbeatAt;
      await tx
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: now })
        .where(eq(listenSessionsTable.id, existing.id));
      return { sessionId: existing.id, prevHeartbeatAt: prev };
    }

    // No active session — start a fresh one.
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
    // Zero-width window on session open — no dwell credited yet.
    return { sessionId: created.id, prevHeartbeatAt: now };
  });

  // --- 2. Dwell computation (guarded by feature flag) ---
  //
  // Incremental window [prevHeartbeatAt, now]: only the interval between the
  // previous confirmed heartbeat and this one counts as verified listening.
  // Pauses, tab hides, and station switches all create gaps that are simply
  // never covered by a heartbeat window, so those periods are never credited.
  if (isDedupConfirmed()) {
    const windowStartMs = prevHeartbeatAt.getTime();
    const windowEndMs = now.getTime();

    // Zero-width window (first heartbeat of a new session) — nothing to credit.
    if (windowEndMs <= windowStartMs) {
      return res.json({ sessionId });
    }

    const windowStart = prevHeartbeatAt;

    // Fetch spins that could overlap the incremental window:
    //  • Known-duration spins: started before window ends AND ended after window starts
    //    (i.e. played_at + duration_ms > windowStart).
    //  • Unknown-duration spins: ONLY when played_at is inside the window
    //    (played_at >= windowStart). We cannot know when they ended, so we
    //    refuse to credit them for windows that began before they started.
    const spinsInWindow = await db
      .select({
        id: spinsTable.id,
        playedAt: spinsTable.playedAt,
        durationMs: recordingsTable.durationMs,
      })
      .from(spinsTable)
      .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
      .where(
        and(
          eq(spinsTable.stationId, stationId),
          sql`${spinsTable.mbid} IS NOT NULL`,
          // Spin started before this window closed.
          sql`${spinsTable.playedAt} < ${now}`,
          // Either:
          //   a) Known duration and spin end is after window start, OR
          //   b) Unknown duration and spin started inside this window (safe to credit).
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
        // Known duration: clip overlap to both the spin's bounds and the window.
        const spinEndMs = spinStartMs + spin.durationMs;
        overlapStart = Math.max(spinStartMs, windowStartMs);
        overlapEnd = Math.min(spinEndMs, windowEndMs);
      } else {
        // Unknown duration: spin started inside this window (enforced by SQL).
        // Credit from spin start to window end — conservative upper bound.
        overlapStart = spinStartMs; // always >= windowStart per SQL filter
        overlapEnd = windowEndMs;
      }

      if (overlapEnd <= overlapStart) continue;

      const dwellSeconds = Math.floor((overlapEnd - overlapStart) / 1000);
      if (dwellSeconds <= 0) continue;

      const spinDurationSeconds = spin.durationMs != null
        ? Math.floor(spin.durationMs / 1000)
        : null;

      // Always upsert positive overlap — no per-slice gate.  The dwell gate is
      // applied at READ time in GET /api/me/attendance/counts so incremental
      // slices accumulate correctly across heartbeats.
      await db
        .insert(attendanceTable)
        .values({
          userId: user.id,
          spinId: spin.id,
          sessionId,
          dwellSeconds,
          spinDurationSeconds,
        })
        .onConflictDoUpdate({
          target: [attendanceTable.userId, attendanceTable.spinId],
          set: {
            // Accumulate each incremental slice into the running total.
            dwellSeconds: sql`attendance.dwell_seconds + excluded.dwell_seconds`,
            sessionId,
            spinDurationSeconds: sql`COALESCE(attendance.spin_duration_seconds, excluded.spin_duration_seconds)`,
          },
        });
    }
  }

  return res.json({ sessionId });
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

  // Gate applied here at read time — only count rows whose accumulated dwell
  // meets the threshold: dwell >= min(spin_duration * 0.5, 60s).
  // When spin_duration is unknown the absolute 60s gate applies.
  const rows = await db
    .select({
      mbid: spinsTable.mbid,
      heardCount: sql<number>`count(${attendanceTable.id})::int`,
    })
    .from(attendanceTable)
    .innerJoin(spinsTable, eq(attendanceTable.spinId, spinsTable.id))
    .where(
      and(
        eq(attendanceTable.userId, user.id),
        sql`${spinsTable.mbid} IS NOT NULL`,
        // Dwell gate: accumulated dwell must meet the threshold.
        sql`
          ${attendanceTable.dwellSeconds} >= CASE
            WHEN ${attendanceTable.spinDurationSeconds} IS NOT NULL
              THEN LEAST(${attendanceTable.spinDurationSeconds} * ${DWELL_GATE_FRACTION}, ${DWELL_GATE_ABSOLUTE_S})
            ELSE ${DWELL_GATE_ABSOLUTE_S}
          END
        `,
      ),
    )
    .groupBy(spinsTable.mbid);

  // Filter out null MBIDs at the TypeScript level (SQL guard above covers DB).
  const counts = rows
    .filter((r): r is { mbid: string; heardCount: number } => r.mbid != null)
    .map((r) => ({ mbid: r.mbid, heardCount: r.heardCount }));

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
