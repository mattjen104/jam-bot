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

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
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
// Wipe sessions, attendance, and spins between tests so each test starts clean.
// Recordings and users are stable across all tests.
afterEach(async () => {
  if (!dbAvailable) return;
  for (const userId of [userMainId, userNodurId, userGateId]) {
    if (userId == null) continue;
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
  for (const mbid of [MBID_KNOWN, MBID_NODUR, MBID_SHORT]) {
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
