// @vitest-environment node
/**
 * Integration tests for GET /api/me/attendance/weekly
 *
 * The endpoint reads from attendance_weekly_rollups (maintained by the
 * heartbeat write path), so tests seed that table directly rather than
 * going through raw attendance rows.
 *
 * Covers:
 *   1. Current-week default — tracks in the weekly rollup appear; totals correct
 *   2. Explicit ?week= param — returns only the named week's rollup rows
 *   3. Empty state — a week with no rollup rows returns tracks: []
 *   4. Cross-week isolation — last week's rollup row does NOT appear for this week
 *   5. spinCount=0 rows are excluded (dwell accumulated but gate not crossed)
 *   6. Bad ?week= values return 400
 *   7. Multiple rollup rows for the same week aggregate correctly via the maintained rollup
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
  attendanceRollupsTable,
  attendanceWeeklyRollupsTable,
} from "@workspace/db";
import app from "../src/app.js";

process.env["ATTENDANCE_DEDUP_CONFIRMED"] = "1";

const run = randomUUID().slice(0, 8);

const SID = `att-weekly-${run}`;
const MBID_A = `att-wk-a-${run}`;
const MBID_B = `att-wk-b-${run}`;
const STATION_SLUG = `att-wk-sta-${run}`;

// ── ISO week helpers (mirrors the implementation) ─────────────────────────────

function isoWeekToMonday(isoYear: number, isoWeek: number): Date {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dayOfWeek - 1) * 86_400_000);
  return new Date(week1Monday.getTime() + (isoWeek - 1) * 7 * 86_400_000);
}

function currentIsoWeekMonday(): Date {
  const now = new Date();
  const utcDay = now.getUTCDay() || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (utcDay - 1)));
}

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

/** Returns the ISO label for N weeks offset from today (negative = past). */
function isoWeekOffset(offset: number): string {
  const monday = new Date(currentIsoWeekMonday().getTime() + offset * 7 * 86_400_000);
  return mondayToIsoWeekLabel(monday);
}

// ── State ──────────────────────────────────────────────────────────────────────
let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";

let userId = 0;
let stationId = 0;
let sessionId = 0;

// ── HTTP helpers ───────────────────────────────────────────────────────────────
async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { cookie: `lore_sid=${SID}` },
  });
  return { status: res.status, body: await res.json() };
}

// ── Seed helpers ───────────────────────────────────────────────────────────────

/**
 * Seed the weekly rollup directly — this is the maintained table the endpoint
 * reads from. Mirrors what the heartbeat write path upserts when a spin crosses
 * the dwell gate.
 */
async function seedWeeklyRollup(
  mbid: string,
  playedAt: Date,
  spinCount: number,
  dwellTotal: number,
): Promise<void> {
  const isoWeek = dateToIsoWeekLabel(playedAt);
  await db
    .insert(attendanceWeeklyRollupsTable)
    .values({
      userId,
      recordingMbid: mbid,
      isoWeek,
      spinCount,
      dwellTotal,
      firstHeard: spinCount > 0 ? playedAt : undefined,
      lastHeard: spinCount > 0 ? playedAt : undefined,
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

// ── Setup ──────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await db.insert(spotifyConnectionsTable).values({
    sid: SID, accessToken: "t", refreshToken: "r",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [user] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `att-wk-user-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  const [station] = await db
    .insert(stationsTable)
    .values({ slug: STATION_SLUG, name: `Att Weekly Station ${run}`, streamUrl: "http://example.invalid/wk" })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBID_A, title: `Track A ${run}`, artist: `Artist A ${run}`, durationMs: 240_000 },
    { mbid: MBID_B, title: `Track B ${run}`, artist: `Artist B ${run}`, durationMs: 180_000 },
  ]);

  const [sess] = await db
    .insert(listenSessionsTable)
    .values({ userId, stationId, startedAt: new Date(), lastHeartbeatAt: new Date() })
    .returning({ id: listenSessionsTable.id });
  sessionId = sess!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  if (!dbAvailable) return;
  await db
    .delete(attendanceWeeklyRollupsTable)
    .where(eq(attendanceWeeklyRollupsTable.userId, userId));
  await db.delete(attendanceRollupsTable).where(eq(attendanceRollupsTable.userId, userId));
  await db.delete(attendanceTable).where(eq(attendanceTable.userId, userId));
  await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;
  await db.delete(listenSessionsTable).where(eq(listenSessionsTable.id, sessionId));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_A));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_B));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
}, 30_000);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /api/me/attendance/weekly", () => {
  it("reads from the maintained weekly rollup for the current week by default", async () => {
    if (!dbAvailable) return;
    const thisWeekMonday = currentIsoWeekMonday();
    const playedAt = new Date(thisWeekMonday.getTime() + 2 * 3_600_000); // Mon +2h
    await seedWeeklyRollup(MBID_A, playedAt, 1, 120);

    const { status, body } = await get("/api/me/attendance/weekly");
    expect(status).toBe(200);
    const result = body as {
      week: string;
      weekStart: string;
      weekEnd: string;
      tracks: Array<{ mbid: string; spinCount: number; dwellSeconds: number; firstHeard: string; lastHeard: string }>;
      totalTracks: number;
      totalDwellSeconds: number;
    };
    expect(result.week).toBe(mondayToIsoWeekLabel(thisWeekMonday));
    const track = result.tracks.find((t) => t.mbid === MBID_A);
    expect(track).toBeDefined();
    expect(track!.spinCount).toBe(1);
    expect(track!.dwellSeconds).toBe(120);
    expect(result.totalTracks).toBeGreaterThanOrEqual(1);
    expect(result.totalDwellSeconds).toBeGreaterThanOrEqual(120);
  });

  it("returns the named week's rollup when ?week= is specified", async () => {
    if (!dbAvailable) return;
    const lastWeekLabel = isoWeekOffset(-1);
    const lastWeekMonday = isoWeekToMonday(
      parseInt(lastWeekLabel.slice(0, 4), 10),
      parseInt(lastWeekLabel.slice(6), 10),
    );
    await seedWeeklyRollup(MBID_B, new Date(lastWeekMonday.getTime() + 10 * 3_600_000), 2, 300);

    const { status, body } = await get(`/api/me/attendance/weekly?week=${lastWeekLabel}`);
    expect(status).toBe(200);
    const result = body as { week: string; tracks: Array<{ mbid: string; spinCount: number }> };
    expect(result.week).toBe(lastWeekLabel);
    const track = result.tracks.find((t) => t.mbid === MBID_B);
    expect(track).toBeDefined();
    expect(track!.spinCount).toBe(2);
  });

  it("returns an honest empty state for a week with no rollup rows", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/attendance/weekly?week=2019-W01");
    expect(status).toBe(200);
    const result = body as { tracks: unknown[]; totalTracks: number; totalDwellSeconds: number };
    expect(result.tracks).toEqual([]);
    expect(result.totalTracks).toBe(0);
    expect(result.totalDwellSeconds).toBe(0);
  });

  it("does not expose last week's rollup rows when querying this week", async () => {
    if (!dbAvailable) return;
    // Seed only in last week
    const lastWeekLabel = isoWeekOffset(-1);
    const lastWeekMonday = isoWeekToMonday(
      parseInt(lastWeekLabel.slice(0, 4), 10),
      parseInt(lastWeekLabel.slice(6), 10),
    );
    await seedWeeklyRollup(MBID_A, new Date(lastWeekMonday.getTime() + 3_600_000), 1, 90);

    // Query this week — MBID_A must not appear
    const thisWeekLabel = isoWeekOffset(0);
    const { status, body } = await get(`/api/me/attendance/weekly?week=${thisWeekLabel}`);
    expect(status).toBe(200);
    const result = body as { tracks: Array<{ mbid: string }> };
    expect(result.tracks.find((t) => t.mbid === MBID_A)).toBeUndefined();
  });

  it("excludes weekly rollup rows where spinCount=0 (dwell accumulated, gate not crossed)", async () => {
    if (!dbAvailable) return;
    const thisWeekMonday = currentIsoWeekMonday();
    // spinCount=0 means the gate was not crossed — should be invisible
    await seedWeeklyRollup(MBID_A, new Date(thisWeekMonday.getTime() + 3_600_000), 0, 30);

    const { status, body } = await get("/api/me/attendance/weekly");
    expect(status).toBe(200);
    const result = body as { tracks: Array<{ mbid: string }> };
    expect(result.tracks.find((t) => t.mbid === MBID_A)).toBeUndefined();
  });

  it("returns 400 for a malformed ?week= value", async () => {
    if (!dbAvailable) return;
    const { status } = await get("/api/me/attendance/weekly?week=not-a-week");
    expect(status).toBe(400);
  });

  it("returns 400 for an out-of-range week number", async () => {
    if (!dbAvailable) return;
    const { status } = await get("/api/me/attendance/weekly?week=2026-W99");
    expect(status).toBe(400);
  });

  it("weekly rollup totals accumulate when the write path upserts the same week twice", async () => {
    if (!dbAvailable) return;
    const thisWeekMonday = currentIsoWeekMonday();
    // Two separate gate-crossing spins of MBID_A in the same week
    const play1 = new Date(thisWeekMonday.getTime() + 1 * 3_600_000);
    const play2 = new Date(thisWeekMonday.getTime() + 25 * 3_600_000); // +25h, still this week
    await seedWeeklyRollup(MBID_A, play1, 1, 80);
    await seedWeeklyRollup(MBID_A, play2, 1, 100);

    const { status, body } = await get("/api/me/attendance/weekly");
    expect(status).toBe(200);
    const result = body as { tracks: Array<{ mbid: string; spinCount: number; dwellSeconds: number }> };
    const track = result.tracks.find((t) => t.mbid === MBID_A);
    expect(track).toBeDefined();
    expect(track!.spinCount).toBe(2);
    expect(track!.dwellSeconds).toBe(180);
  });
});
