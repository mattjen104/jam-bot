// @vitest-environment node
/**
 * Integration tests for the attendance heartbeat + counts flow.
 *
 * Covers:
 *   1. Happy path — two heartbeats spanning a known-duration spin → heardCount=1
 *   2. Zero-width first heartbeat — no dwell credited on session open
 *   3. Unknown-duration spin excluded when started before the window
 *   4. Unknown-duration spin credited when started inside the window with dwell ≥ gate
 *   5. Dwell gate — sub-threshold dwell not counted
 *   6. Dwell gate — exactly-at-threshold dwell counted
 *   7. Dwell accumulation — two sub-gate windows accumulate across heartbeats
 *
 * ATTENDANCE_DEDUP_CONFIRMED=1 is set at the start of this file so the
 * dwell-computation branch is always active.  Each test inserts its own spins
 * in its own body (so afterEach can wipe them), while recordings, the station,
 * and users are seeded once in beforeAll and torn down in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  stationsTable,
  spinsTable,
  recordingsTable,
  listenSessionsTable,
  attendanceTable,
  attendanceRollupsTable,
  attendanceWeeklyRollupsTable,
} from "@workspace/db";
import app from "../src/app.js";

// Enable the feature flag for the entire file before any modules are evaluated.
process.env["ATTENDANCE_DEDUP_CONFIRMED"] = "1";

const run = randomUUID().slice(0, 8);

// ── Session cookies (double as deviceKey) ──────────────────────────────────────
// Three independent users — one per concern — so tests within a describe block
// that share a user can be cleaned up by afterEach without cross-describe noise.
const SID_MAIN  = `test-att-main-${run}`;   // happy path + zero-width
const SID_NODUR = `test-att-nodur-${run}`;  // unknown-duration scenarios
const SID_GATE  = `test-att-gate-${run}`;   // dwell gate scenarios

// ── Recordings ─────────────────────────────────────────────────────────────────
const MBID_KNOWN  = `ta-known-${run}`;   // durationMs = 300 000 ms (5 min)
const MBID_NODUR  = `ta-nodur-${run}`;   // durationMs = null
const MBID_SHORT  = `ta-short-${run}`;   // durationMs =  60 000 ms (60 s)
const MBID_XWEEK  = `ta-xweek-${run}`;  // durationMs = 900 000 ms (15 min) — cross-week test

const STATION_SLUG = `test-att-sta-${run}`;

// ── State ──────────────────────────────────────────────────────────────────────
let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";

let stationId: number | null = null;
let userMainId: number | null = null;
let userNodurId: number | null = null;
let userGateId: number | null = null;

// ── HTTP helpers ───────────────────────────────────────────────────────────────
async function post(path: string, body: unknown, sid: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cookie": `lore_sid=${sid}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as unknown };
}

async function get(path: string, sid: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "cookie": `lore_sid=${sid}` },
  });
  return { status: res.status, body: await res.json() as unknown };
}

// ── Setup ──────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Spotify connections (FK required by lore_users)
  for (const sid of [SID_MAIN, SID_NODUR, SID_GATE]) {
    await db.insert(spotifyConnectionsTable).values({
      sid,
      accessToken: "t",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  // Lore users — deviceKey doubles as the session cookie value
  const [uMain] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `att-main-${run}`, spotifyConnectionId: SID_MAIN, deviceKey: SID_MAIN })
    .returning({ id: loreUsersTable.id });
  userMainId = uMain!.id;

  const [uNodur] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `att-nodur-${run}`, spotifyConnectionId: SID_NODUR, deviceKey: SID_NODUR })
    .returning({ id: loreUsersTable.id });
  userNodurId = uNodur!.id;

  const [uGate] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `att-gate-${run}`, spotifyConnectionId: SID_GATE, deviceKey: SID_GATE })
    .returning({ id: loreUsersTable.id });
  userGateId = uGate!.id;

  // Recordings — seeded once; spins (which reference them) are per-test
  await db.insert(recordingsTable).values([
    { mbid: MBID_KNOWN, title: `Known Dur Track ${run}`, artist: `Artist ${run}`, durationMs: 300_000 },
    { mbid: MBID_NODUR, title: `No Dur Track ${run}`,   artist: `Artist ${run}` },          // null duration
    { mbid: MBID_SHORT, title: `Short Track ${run}`,    artist: `Artist ${run}`, durationMs:  60_000 },
    { mbid: MBID_XWEEK, title: `XWeek Track ${run}`,   artist: `Artist ${run}`, durationMs: 900_000 }, // 15 min
  ]);

  // Station
  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG,
      name: `Test Attendance Station ${run}`,
      streamUrl: "http://example.invalid/att",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  // HTTP server
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

// ── Per-test cleanup ───────────────────────────────────────────────────────────
// Wipe sessions, audit rows, rollups, and spins between tests so each starts clean.
// Recordings and users are stable across all tests.
afterEach(async () => {
  if (!dbAvailable) return;
  for (const userId of [userMainId, userNodurId, userGateId]) {
    if (userId == null) continue;
    await db.delete(attendanceWeeklyRollupsTable).where(eq(attendanceWeeklyRollupsTable.userId, userId));
    await db.delete(attendanceRollupsTable).where(eq(attendanceRollupsTable.userId, userId));
    await db.delete(attendanceTable).where(eq(attendanceTable.userId, userId));
    await db.delete(listenSessionsTable).where(eq(listenSessionsTable.userId, userId));
  }
  if (stationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
  }
});

// ── Suite teardown ─────────────────────────────────────────────────────────────
afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  // Users (cascade-deletes sessions + attendance via FK)
  for (const userId of [userMainId, userNodurId, userGateId]) {
    if (userId != null) {
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
    }
  }

  // Station + its spins (afterEach cleared test-body spins; station row remains)
  if (stationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }

  // Recordings
  for (const mbid of [MBID_KNOWN, MBID_NODUR, MBID_SHORT, MBID_XWEEK]) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }

  // Spotify connections
  for (const sid of [SID_MAIN, SID_NODUR, SID_GATE]) {
    await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, sid));
  }
});

const TEST_TIMEOUT = 30_000;

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("heartbeat → counts — happy path (known-duration spin)", () => {
  it(
    "returns heardCount=1 after two heartbeats whose window fully overlaps a spin past the dwell gate",
    async () => {
      if (!dbAvailable) return;

      const now = new Date();

      // Spin played 60 s ago with 5-min duration — still playing across the window.
      await db.insert(spinsTable).values({
        stationId: stationId!,
        mbid: MBID_KNOWN,
        confidence: "recording_id",
        rawTitle: "t",
        rawArtist: "a",
        playedAt: new Date(now.getTime() - 60_000),
      });

      // Heartbeat 1: creates session, zero-width window (prevHeartbeatAt = now).
      const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
      expect(hb1.status).toBe(200);
      const { sessionId } = hb1.body as { sessionId: number };
      expect(typeof sessionId).toBe("number");

      // Back-date lastHeartbeatAt to simulate a 90 s window for the next heartbeat.
      // window = [now-90s, now]; spin = [now-60s, now+4min]; overlap = 60 s.
      // Gate = LEAST(300 × 0.5, 60) = LEAST(150, 60) = 60 s.  60 ≥ 60 → qualifies.
      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 90_000) })
        .where(eq(listenSessionsTable.id, sessionId));

      const hb2 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
      expect(hb2.status).toBe(200);

      const { status, body } = await get("/api/me/attendance/counts", SID_MAIN);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      const entry = (body as Array<{ mbid: string; heardCount: number }>)
        .find((r) => r.mbid === MBID_KNOWN);
      expect(entry).toBeDefined();
      expect(entry!.heardCount).toBe(1);
    },
    TEST_TIMEOUT,
  );

  it(
    "caps a long heartbeat gap at the maximum attendance credit window",
    async () => {
      if (!dbAvailable) return;

      const now = new Date();

      // The spin began three minutes ago and is still playing. Without the
      // bound, a heartbeat after a ten-minute gap would credit ~180 seconds.
      await db.insert(spinsTable).values({
        stationId: stationId!,
        mbid: MBID_KNOWN,
        confidence: "recording_id",
        rawTitle: "t",
        rawArtist: "a",
        playedAt: new Date(now.getTime() - 180_000),
      });

      const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
      expect(hb1.status).toBe(200);
      const { sessionId } = hb1.body as { sessionId: number };

      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 10 * 60_000) })
        .where(eq(listenSessionsTable.id, sessionId));

      const hb2 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
      expect(hb2.status).toBe(200);

      const [row] = await db
        .select({ dwellSeconds: attendanceTable.dwellSeconds })
        .from(attendanceTable)
        .where(eq(attendanceTable.userId, userMainId!));

      // Allow a small amount for request timing, but never permit the old
      // three-minute overlap to appear.
      expect(row).toBeDefined();
      expect(row!.dwellSeconds).toBeGreaterThanOrEqual(118);
      expect(row!.dwellSeconds).toBeLessThanOrEqual(120);
    },
    TEST_TIMEOUT,
  );
});

describe("heartbeat → counts — zero-width first heartbeat", () => {
  it(
    "does not credit any attendance on the very first heartbeat of a new session",
    async () => {
      if (!dbAvailable) return;

      const now = new Date();

      // Spin already playing well before the user arrived.
      await db.insert(spinsTable).values({
        stationId: stationId!,
        mbid: MBID_KNOWN,
        confidence: "recording_id",
        rawTitle: "t",
        rawArtist: "a",
        playedAt: new Date(now.getTime() - 120_000),
      });

      // Single heartbeat: prevHeartbeatAt = now (fresh session), so windowEndMs === windowStartMs.
      // The handler short-circuits immediately — no attendance rows should be written.
      const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
      expect(hb1.status).toBe(200);
      expect(typeof (hb1.body as { sessionId: number }).sessionId).toBe("number");

      const { status, body } = await get("/api/me/attendance/counts", SID_MAIN);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      const entry = (body as Array<{ mbid: string; heardCount: number }>)
        .find((r) => r.mbid === MBID_KNOWN);
      // Zero-width window → nothing credited
      expect(entry).toBeUndefined();
    },
    TEST_TIMEOUT,
  );
});

describe("heartbeat → counts — unknown-duration spins", () => {
  it(
    "excludes an unknown-duration spin that started before the heartbeat window",
    async () => {
      if (!dbAvailable) return;

      const now = new Date();

      // Spin played 120 s ago — before the 90 s window start.
      // SQL filter: durationMs IS NULL AND playedAt >= windowStart → excluded entirely.
      await db.insert(spinsTable).values({
        stationId: stationId!,
        mbid: MBID_NODUR,
        confidence: "text",
        rawTitle: "t",
        rawArtist: "a",
        playedAt: new Date(now.getTime() - 120_000),
      });

      const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_NODUR);
      expect(hb1.status).toBe(200);
      const { sessionId } = hb1.body as { sessionId: number };

      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 90_000) })
        .where(eq(listenSessionsTable.id, sessionId));

      await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_NODUR);

      const { status, body } = await get("/api/me/attendance/counts", SID_NODUR);
      expect(status).toBe(200);

      const entry = (body as Array<{ mbid: string; heardCount: number }>)
        .find((r) => r.mbid === MBID_NODUR);
      // Spin predates the window → no attendance row written → not counted
      expect(entry).toBeUndefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "credits an unknown-duration spin that started inside the window with dwell ≥ 60 s gate",
    async () => {
      if (!dbAvailable) return;

      const now = new Date();

      // Spin played 85 s ago; window = [now-90s, now].
      // playedAt (now-85s) >= windowStart (now-90s) → included.
      // dwell = windowEnd - playedAt = now - (now-85s) = 85 s.
      // Gate for null-duration = 60 s absolute.  85 ≥ 60 → qualifies.
      await db.insert(spinsTable).values({
        stationId: stationId!,
        mbid: MBID_NODUR,
        confidence: "text",
        rawTitle: "t",
        rawArtist: "a",
        playedAt: new Date(now.getTime() - 85_000),
      });

      const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_NODUR);
      expect(hb1.status).toBe(200);
      const { sessionId } = hb1.body as { sessionId: number };

      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 90_000) })
        .where(eq(listenSessionsTable.id, sessionId));

      await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_NODUR);

      const { status, body } = await get("/api/me/attendance/counts", SID_NODUR);
      expect(status).toBe(200);

      const entry = (body as Array<{ mbid: string; heardCount: number }>)
        .find((r) => r.mbid === MBID_NODUR);
      expect(entry).toBeDefined();
      expect(entry!.heardCount).toBe(1);
    },
    TEST_TIMEOUT,
  );
});

// ── ISO week helpers (mirrors the implementation, for assertions) ──────────────

function mondayToIsoWeekLabel(monday: Date): string {
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dayOfWeek - 1) * 86_400_000);
  const week = Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function dateToIsoWeekLabel(date: Date): string {
  const utcDay = date.getUTCDay() || 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (utcDay - 1)));
  return mondayToIsoWeekLabel(monday);
}

describe("heartbeat → counts — dwell gate", () => {
  it(
    "does not count a spin whose dwell falls below the fractional gate threshold",
    async () => {
      if (!dbAvailable) return;

      const now = new Date();

      // MBID_SHORT: durationMs = 60 000 ms.
      // Gate = LEAST(60 × 0.5, 60) = LEAST(30, 60) = 30 s.
      // Window = 25 s; spin started 25 s ago → overlap = 25 s.
      // 25 < 30 → below gate → not counted.
      await db.insert(spinsTable).values({
        stationId: stationId!,
        mbid: MBID_SHORT,
        confidence: "text",
        rawTitle: "t",
        rawArtist: "a",
        playedAt: new Date(now.getTime() - 25_000),
      });

      const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);
      expect(hb1.status).toBe(200);
      const { sessionId } = hb1.body as { sessionId: number };

      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 25_000) })
        .where(eq(listenSessionsTable.id, sessionId));

      await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);

      const { status, body } = await get("/api/me/attendance/counts", SID_GATE);
      expect(status).toBe(200);

      const entry = (body as Array<{ mbid: string; heardCount: number }>)
        .find((r) => r.mbid === MBID_SHORT);
      // 25 s dwell < 30 s gate → not counted
      expect(entry).toBeUndefined();
    },
    TEST_TIMEOUT,
  );

  it(
    "does not credit an unknown-duration spin from before the bounded window",
    async () => {
      if (!dbAvailable) return;

      const now = new Date();

      // This spin is inside the ten-minute heartbeat gap, but outside the
      // recent bounded credit window. Unknown-duration spins cannot be
      // credited unless their start is inside that final window.
      await db.insert(spinsTable).values({
        stationId: stationId!,
        mbid: MBID_NODUR,
        confidence: "text",
        rawTitle: "t",
        rawArtist: "a",
        playedAt: new Date(now.getTime() - 180_000),
      });

      const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_NODUR);
      expect(hb1.status).toBe(200);
      const { sessionId } = hb1.body as { sessionId: number };

      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 10 * 60_000) })
        .where(eq(listenSessionsTable.id, sessionId));

      const hb2 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_NODUR);
      expect(hb2.status).toBe(200);

      const rows = await db
        .select({ id: attendanceTable.id })
        .from(attendanceTable)
        .where(eq(attendanceTable.userId, userNodurId!));
      expect(rows).toHaveLength(0);
    },
    TEST_TIMEOUT,
  );

  it(
    "counts a spin whose dwell exactly meets the fractional gate threshold",
    async () => {
      if (!dbAvailable) return;

      const now = new Date();

      // MBID_SHORT: gate = 30 s.  Window = 30 s; spin started right at window start.
      // overlap = 30 s.  30 ≥ 30 → passes.
      await db.insert(spinsTable).values({
        stationId: stationId!,
        mbid: MBID_SHORT,
        confidence: "text",
        rawTitle: "t",
        rawArtist: "a",
        playedAt: new Date(now.getTime() - 30_000),
      });

      const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);
      expect(hb1.status).toBe(200);
      const { sessionId } = hb1.body as { sessionId: number };

      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 30_000) })
        .where(eq(listenSessionsTable.id, sessionId));

      await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);

      const { status, body } = await get("/api/me/attendance/counts", SID_GATE);
      expect(status).toBe(200);

      const entry = (body as Array<{ mbid: string; heardCount: number }>)
        .find((r) => r.mbid === MBID_SHORT);
      // 30 s dwell ≥ 30 s gate → counted
      expect(entry).toBeDefined();
      expect(entry!.heardCount).toBe(1);
    },
    TEST_TIMEOUT,
  );

  it(
    "accumulates dwell across multiple sub-gate heartbeat windows before the gate is crossed",
    async () => {
      if (!dbAvailable) return;

      const now = new Date();

      // Use MBID_KNOWN: durationMs = 300 000 ms (5 min).
      // Gate = LEAST(300 × 0.5, 60) = LEAST(150, 60) = 60 s.
      //
      // Each heartbeat rewinds lastHeartbeatAt to 20 s ago so the server sees a
      // ~20 s incremental window.  The onConflictDoUpdate accumulator adds each
      // window's dwell on top of the running total:
      //   after window 2: ~20 s  < 60 s gate → not counted
      //   after window 3: ~40 s  < 60 s gate → not counted
      //   after window 4: ~60 s ≥ 60 s gate → counted
      await db.insert(spinsTable).values({
        stationId: stationId!,
        mbid: MBID_KNOWN,
        confidence: "text",
        rawTitle: "t",
        rawArtist: "a",
        playedAt: new Date(now.getTime() - 300_000), // 5 min ago — fully inside every window
      });

      // Heartbeat 1 — opens session (zero-width, no dwell credited)
      const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);
      expect(hb1.status).toBe(200);
      const { sessionId } = hb1.body as { sessionId: number };

      // Window 2 — rewind to 20 s ago → credits ~20 s
      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 20_000) })
        .where(eq(listenSessionsTable.id, sessionId));
      await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);

      // Window 3 — rewind to 20 s ago again → cumulative ≈ 40 s
      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 20_000) })
        .where(eq(listenSessionsTable.id, sessionId));
      await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);

      // Mid-point: ~40 s accumulated < 60 s gate → not counted yet
      const mid = await get("/api/me/attendance/counts", SID_GATE);
      expect(mid.status).toBe(200);
      const midEntry = (mid.body as Array<{ mbid: string; heardCount: number }>)
        .find((r) => r.mbid === MBID_KNOWN);
      expect(midEntry).toBeUndefined();

      // Window 4 — rewind once more → cumulative ≈ 60 s → crosses gate
      await db
        .update(listenSessionsTable)
        .set({ lastHeartbeatAt: new Date(now.getTime() - 20_000) })
        .where(eq(listenSessionsTable.id, sessionId));
      await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);

      const { status, body } = await get("/api/me/attendance/counts", SID_GATE);
      expect(status).toBe(200);
      const entry = (body as Array<{ mbid: string; heardCount: number }>)
        .find((r) => r.mbid === MBID_KNOWN);
      // ~60 s accumulated dwell ≥ 60 s gate → counted
      expect(entry).toBeDefined();
      expect(entry!.heardCount).toBe(1);
    },
    TEST_TIMEOUT,
  );
});

// ── Cross-week heartbeat ───────────────────────────────────────────────────────
//
// The heartbeat write path uses the spin's played_at (not the heartbeat
// timestamp) to compute the ISO week for the weekly rollup.  A heartbeat that
// arrives on Monday morning must still credit Sunday-night spins into the
// Sunday's week bucket.
//
// Scenario (time-frozen with vi.useFakeTimers):
//   • Spin played_at  = 2026-01-18 23:58 UTC  (Sunday, ISO week 2026-W03)
//   • Spin durationMs = 900 000 ms (15 min)   → ends 2026-01-19 00:13 UTC
//   • Fake "now"      = 2026-01-19 00:10 UTC  (Monday, ISO week 2026-W04)
//   • Window          = [00:08:30, 00:10:00]  (prevHb back-dated 90 s)
//   • Overlap         = 90 s  ≥  gate (LEAST(900×0.5,60) = 60 s)  → qualifies
//
// Expected: weekly rollup row in 2026-W03 with dwellTotal ≥ 90 and spinCount=1.
//           No row in 2026-W04 for that spin.

describe("heartbeat → weekly rollup — cross-week-boundary heartbeat", () => {
  // Fixed "Monday 00:10 UTC" — the heartbeat arrives in W04 but the spin is W03.
  const FAKE_NOW = new Date("2026-01-19T00:10:00.000Z");
  // Base fake-now for the sub-gate accumulation test.
  // 00:12:00 UTC is Monday territory (W04) and still inside the spin window
  // (spin ends at 00:13:00 UTC), so each 20-second heartbeat window overlaps.
  const FAKE_NOW_MULTI_BASE = new Date("2026-01-19T00:12:00.000Z");

  // 2026-01-18 is a Sunday → ISO week 2026-W03
  const SPIN_PLAYED_AT = new Date("2026-01-18T23:58:00.000Z");
  const SPIN_WEEK = dateToIsoWeekLabel(SPIN_PLAYED_AT);      // "2026-W03"
  const HEARTBEAT_WEEK = dateToIsoWeekLabel(FAKE_NOW);       // "2026-W04"

  it(
    "places a Sunday-night spin in its own ISO week when the heartbeat arrives on Monday",
    async () => {
      if (!dbAvailable) return;

      // Freeze Date so the handler's `new Date()` returns FAKE_NOW.
      // Only fake Date itself — leaving setTimeout/setInterval real keeps the
      // HTTP server, connection pool, and test timeouts working normally.
      vi.useFakeTimers({ now: FAKE_NOW, toFake: ["Date"] });

      try {
        // Seed the spin — played on Sunday at 23:58 UTC.
        await db.insert(spinsTable).values({
          stationId: stationId!,
          mbid: MBID_XWEEK,
          confidence: "recording_id",
          rawTitle: "Sunday Night Track",
          rawArtist: "Artist",
          playedAt: SPIN_PLAYED_AT,
        });

        // Heartbeat 1: creates the session (zero-width window, no dwell credited).
        const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
        expect(hb1.status).toBe(200);
        const { sessionId } = hb1.body as { sessionId: number };
        expect(typeof sessionId).toBe("number");

        // Back-date lastHeartbeatAt to 90 s before FAKE_NOW to open a 90-second
        // window.  The spin ends at 00:13 UTC so it still overlaps [00:08:30, 00:10].
        // Overlap = 90 s ≥ 60 s gate → qualifies.
        await db
          .update(listenSessionsTable)
          .set({ lastHeartbeatAt: new Date(FAKE_NOW.getTime() - 90_000) })
          .where(eq(listenSessionsTable.id, sessionId));

        // Heartbeat 2: "Monday morning" heartbeat that should credit the Sunday spin.
        const hb2 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
        expect(hb2.status).toBe(200);

        // ── Assert weekly rollup week bucket ────────────────────────────────
        // The spin's week (W03) must contain the row; the heartbeat's week (W04)
        // must not — this is the core property under test.

        const allRows = await db
          .select({
            isoWeek: attendanceWeeklyRollupsTable.isoWeek,
            dwellTotal: attendanceWeeklyRollupsTable.dwellTotal,
            spinCount: attendanceWeeklyRollupsTable.spinCount,
          })
          .from(attendanceWeeklyRollupsTable)
          .where(
            eq(attendanceWeeklyRollupsTable.userId, userMainId!),
          );

        // Spin's week (2026-W03) must have exactly one row for MBID_XWEEK.
        const spinWeekRow = allRows.find((r) => r.isoWeek === SPIN_WEEK);
        expect(spinWeekRow).toBeDefined();
        expect(spinWeekRow!.spinCount).toBe(1);
        expect(spinWeekRow!.dwellTotal).toBeGreaterThanOrEqual(90);

        // Heartbeat's week (2026-W04) must have no row for this spin.
        const heartbeatWeekRow = allRows.find((r) => r.isoWeek === HEARTBEAT_WEEK);
        expect(heartbeatWeekRow).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "does not double-count dwell when the same Sunday-night window is replayed a second time",
    async () => {
      if (!dbAvailable) return;

      vi.useFakeTimers({ now: FAKE_NOW, toFake: ["Date"] });

      try {
        // Seed the Sunday-night spin (same scenario as the cross-week test above).
        await db.insert(spinsTable).values({
          stationId: stationId!,
          mbid: MBID_XWEEK,
          confidence: "recording_id",
          rawTitle: "Sunday Night Track Replay",
          rawArtist: "Artist",
          playedAt: SPIN_PLAYED_AT,
        });

        // Heartbeat 1: opens the session (zero-width window, no dwell credited).
        const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
        expect(hb1.status).toBe(200);
        const { sessionId } = hb1.body as { sessionId: number };
        expect(typeof sessionId).toBe("number");

        // Back-date lastHeartbeatAt 90 s before FAKE_NOW so the next heartbeat
        // sees a 90-second window.  Spin ends at 00:13 UTC → overlaps [00:08:30, 00:10].
        // Overlap = 90 s ≥ 60 s gate → qualifies.
        const prevHbTimestamp = new Date(FAKE_NOW.getTime() - 90_000);
        await db
          .update(listenSessionsTable)
          .set({ lastHeartbeatAt: prevHbTimestamp })
          .where(eq(listenSessionsTable.id, sessionId));

        // Heartbeat 2: first (real) write — credits the 90-second window.
        const hb2 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
        expect(hb2.status).toBe(200);

        // Snapshot the rollup immediately after the first credit.
        const rowsAfterFirst = await db
          .select({
            isoWeek: attendanceWeeklyRollupsTable.isoWeek,
            dwellTotal: attendanceWeeklyRollupsTable.dwellTotal,
            spinCount: attendanceWeeklyRollupsTable.spinCount,
          })
          .from(attendanceWeeklyRollupsTable)
          .where(eq(attendanceWeeklyRollupsTable.userId, userMainId!));

        const spinWeekRowFirst = rowsAfterFirst.find((r) => r.isoWeek === SPIN_WEEK);
        expect(spinWeekRowFirst).toBeDefined();
        expect(spinWeekRowFirst!.spinCount).toBe(1);
        expect(spinWeekRowFirst!.dwellTotal).toBeGreaterThanOrEqual(90);

        const dwellAfterFirst = spinWeekRowFirst!.dwellTotal;

        // ── Replay the same window ─────────────────────────────────────────
        // Reset lastHeartbeatAt back to the same pre-hb2 value.  The handler will
        // compute the identical [prevHbTimestamp, FAKE_NOW] window and attempt to
        // credit 90 s again.  The credited_through guard must prevent any addition.
        await db
          .update(listenSessionsTable)
          .set({ lastHeartbeatAt: prevHbTimestamp })
          .where(eq(listenSessionsTable.id, sessionId));

        // Heartbeat 3: replay — should be a no-op for the rollup.
        const hb3 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_MAIN);
        expect(hb3.status).toBe(200);

        // ── Assert the rollup is unchanged after the replay ────────────────
        const rowsAfterReplay = await db
          .select({
            isoWeek: attendanceWeeklyRollupsTable.isoWeek,
            dwellTotal: attendanceWeeklyRollupsTable.dwellTotal,
            spinCount: attendanceWeeklyRollupsTable.spinCount,
          })
          .from(attendanceWeeklyRollupsTable)
          .where(eq(attendanceWeeklyRollupsTable.userId, userMainId!));

        const spinWeekRowReplay = rowsAfterReplay.find((r) => r.isoWeek === SPIN_WEEK);
        expect(spinWeekRowReplay).toBeDefined();

        // spinCount must stay at 1 — the replay must not increment it.
        expect(spinWeekRowReplay!.spinCount).toBe(1);

        // dwellTotal must not grow — the idempotency guard (credited_through) must
        // block re-accumulation of the same window-end timestamp.
        expect(spinWeekRowReplay!.dwellTotal).toBe(dwellAfterFirst);

        // Heartbeat's week (W04) must still have no row.
        const heartbeatWeekRow = rowsAfterReplay.find((r) => r.isoWeek === HEARTBEAT_WEEK);
        expect(heartbeatWeekRow).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "accumulates dwell into the spin's week across multiple sub-gate cross-week heartbeats",
    async () => {
      if (!dbAvailable) return;

      // Scenario:
      //   Spin played_at  = 2026-01-18 23:58 UTC  (Sunday, ISO week 2026-W03)
      //   Spin durationMs = 900 000 ms (15 min)   → ends 2026-01-19 00:13 UTC
      //   Fake "now"      = 2026-01-19 00:12 UTC  (Monday, ISO week 2026-W04)
      //
      //   Gate = LEAST(900 × 0.5, 60) = 60 s.
      //
      //   Three heartbeats arrive on Monday, each with a ~20 s window (below the
      //   60 s gate on their own).  The onConflictDoUpdate accumulator adds each
      //   slice to the running dwell total:
      //     after window 1: ~20 s < 60 s gate → not counted yet
      //     after window 2: ~40 s < 60 s gate → not counted yet
      //     after window 3: ~60 s ≥ 60 s gate → crosses gate → spinCount=1 in W03
      //
      //   The weekly rollup row must land in 2026-W03 (the spin's week), not
      //   2026-W04 (the heartbeat's week).

      // Spin played on Sunday at 23:58 UTC; ends at 00:13:00 UTC (15 min later).
      // FAKE_NOW_MULTI_BASE = 00:12:00 UTC is Monday (W04) but still inside the
      // spin window — each 20-second heartbeat window overlaps the active spin.
      const SPIN_PLAYED_AT_MULTI = new Date("2026-01-18T23:58:00.000Z");
      const SPIN_WEEK_MULTI = dateToIsoWeekLabel(SPIN_PLAYED_AT_MULTI);        // "2026-W03"
      const HEARTBEAT_WEEK_MULTI = dateToIsoWeekLabel(FAKE_NOW_MULTI_BASE);    // "2026-W04"

      // Freeze Date at the base "Monday" instant.
      vi.useFakeTimers({ now: FAKE_NOW_MULTI_BASE, toFake: ["Date"] });

      try {
        await db.insert(spinsTable).values({
          stationId: stationId!,
          mbid: MBID_XWEEK,
          confidence: "recording_id",
          rawTitle: "Sunday Night Track Multi",
          rawArtist: "Artist",
          playedAt: SPIN_PLAYED_AT_MULTI,
        });

        // ── HB1: opens the session ────────────────────────────────────────────
        // fakeNow = T0.  Session opens with lastHeartbeatAt = T0 → zero-width
        // window (windowEnd === windowStart) → no dwell credited.
        const hb1 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);
        expect(hb1.status).toBe(200);
        const { sessionId } = hb1.body as { sessionId: number };
        expect(typeof sessionId).toBe("number");

        // ── HB2 — window 1 (~20 s, below gate) ──────────────────────────────
        // Advance fakeNow by 1 s so this heartbeat's credited_through (T0+1 s)
        // is strictly greater than the initial value and will be stored.
        vi.setSystemTime(new Date(FAKE_NOW_MULTI_BASE.getTime() + 1_000));
        const t1 = new Date(FAKE_NOW_MULTI_BASE.getTime() + 1_000);
        await db
          .update(listenSessionsTable)
          .set({ lastHeartbeatAt: new Date(t1.getTime() - 20_000) })
          .where(eq(listenSessionsTable.id, sessionId));
        const hb2 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);
        expect(hb2.status).toBe(200);

        // ── HB3 — window 2 (~20 s, cumulative ~40 s, still below gate) ──────
        // Advance fakeNow by another second so credited_through (T0+2 s) is
        // strictly greater than the T0+1 s mark — accumulation proceeds.
        vi.setSystemTime(new Date(FAKE_NOW_MULTI_BASE.getTime() + 2_000));
        const t2 = new Date(FAKE_NOW_MULTI_BASE.getTime() + 2_000);
        await db
          .update(listenSessionsTable)
          .set({ lastHeartbeatAt: new Date(t2.getTime() - 20_000) })
          .where(eq(listenSessionsTable.id, sessionId));
        const hb3 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);
        expect(hb3.status).toBe(200);

        // Mid-point check: ~40 s total < 60 s gate → spinCount must still be 0.
        const midRows = await db
          .select({
            isoWeek: attendanceWeeklyRollupsTable.isoWeek,
            spinCount: attendanceWeeklyRollupsTable.spinCount,
          })
          .from(attendanceWeeklyRollupsTable)
          .where(eq(attendanceWeeklyRollupsTable.userId, userGateId!));
        const midSpinWeekRow = midRows.find((r) => r.isoWeek === SPIN_WEEK_MULTI);
        expect(midSpinWeekRow == null || midSpinWeekRow.spinCount === 0).toBe(true);

        // ── HB4 — window 3 (~20 s, cumulative ~63 s ≥ 60 s → crosses gate) ──
        vi.setSystemTime(new Date(FAKE_NOW_MULTI_BASE.getTime() + 3_000));
        const t3 = new Date(FAKE_NOW_MULTI_BASE.getTime() + 3_000);
        await db
          .update(listenSessionsTable)
          .set({ lastHeartbeatAt: new Date(t3.getTime() - 20_000) })
          .where(eq(listenSessionsTable.id, sessionId));
        const hb4 = await post("/api/me/attendance/heartbeat", { stationId: stationId! }, SID_GATE);
        expect(hb4.status).toBe(200);

        // ── Assert weekly rollup week bucket ──────────────────────────────────
        const allRows = await db
          .select({
            isoWeek: attendanceWeeklyRollupsTable.isoWeek,
            dwellTotal: attendanceWeeklyRollupsTable.dwellTotal,
            spinCount: attendanceWeeklyRollupsTable.spinCount,
          })
          .from(attendanceWeeklyRollupsTable)
          .where(eq(attendanceWeeklyRollupsTable.userId, userGateId!));

        // The spin's week (2026-W03) must contain spinCount=1 and dwell ≥ 60 s.
        const spinWeekRow = allRows.find((r) => r.isoWeek === SPIN_WEEK_MULTI);
        expect(spinWeekRow).toBeDefined();
        expect(spinWeekRow!.spinCount).toBe(1);
        expect(spinWeekRow!.dwellTotal).toBeGreaterThanOrEqual(60);

        // The heartbeat's week (2026-W04) must have no row for this spin.
        const heartbeatWeekRow = allRows.find((r) => r.isoWeek === HEARTBEAT_WEEK_MULTI);
        expect(heartbeatWeekRow).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    },
    TEST_TIMEOUT,
  );
});
