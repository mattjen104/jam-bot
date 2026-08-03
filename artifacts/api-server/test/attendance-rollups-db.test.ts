/**
 * Database-backed coverage for the maintained attendance rollup.
 *
 * The migration rebuild is deliberately tested by clearing its completion
 * marker between assertions; production uses that marker to avoid rescanning
 * attendance on every boot.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  attendanceRollupsTable,
  attendanceTable,
  db,
  listenSessionsTable,
  loreUsersTable,
  recordingsTable,
  spinsTable,
  spotifyConnectionsTable,
  stationsTable,
} from "@workspace/db";
import { applyAttendanceMigration } from "../src/lore/attendance-migration.js";

const run = randomUUID().slice(0, 8);
const SID = `att-rollup-${run}`;
const MBID = `att-rollup-mbid-${run}`;
const SLUG = `att-rollup-station-${run}`;
let dbAvailable = false;
let userId = 0;
let stationId = 0;
let sessionId = 0;
let spinOneId = 0;
let spinTwoId = 0;
const firstPlayedAt = new Date(Date.now() - 10 * 60_000);
const lastPlayedAt = new Date(Date.now() - 5 * 60_000);

async function clearRollup() {
  await db.delete(attendanceRollupsTable).where(eq(attendanceRollupsTable.userId, userId));
  await db.execute(sql`
    DELETE FROM migration_completions WHERE name = 'applyAttendanceRollupBackfill'
  `);
}

async function readRollup() {
  const [rollup] = await db
    .select()
    .from(attendanceRollupsTable)
    .where(
      and(
        eq(attendanceRollupsTable.userId, userId),
        eq(attendanceRollupsTable.recordingMbid, MBID),
      ),
    );
  return rollup;
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await db.execute(sql`DELETE FROM migration_completions WHERE name = 'applyAttendanceRollupBackfill'`);
  await applyAttendanceMigration();

  await db.insert(spotifyConnectionsTable).values({
    sid: SID, accessToken: "t", refreshToken: "r", expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [user] = await db.insert(loreUsersTable).values({
    spotifyUserId: `att-rollup-user-${run}`, spotifyConnectionId: SID, deviceKey: SID,
  }).returning({ id: loreUsersTable.id });
  userId = user!.id;
  const [station] = await db.insert(stationsTable).values({
    slug: SLUG, name: `Attendance rollup ${run}`, streamUrl: "http://example.invalid/rollup",
  }).returning({ id: stationsTable.id });
  stationId = station!.id;
  await db.insert(recordingsTable).values({
    mbid: MBID, title: `Rollup title ${run}`, artist: `Rollup artist ${run}`, durationMs: 240_000,
  });
  const [session] = await db.insert(listenSessionsTable).values({
    userId, stationId, startedAt: firstPlayedAt, lastHeartbeatAt: new Date(),
  }).returning({ id: listenSessionsTable.id });
  sessionId = session!.id;
  const [spinOne] = await db.insert(spinsTable).values({
    stationId, mbid: MBID, confidence: "recording_id", playedAt: firstPlayedAt,
  }).returning({ id: spinsTable.id });
  spinOneId = spinOne!.id;
  const [spinTwo] = await db.insert(spinsTable).values({
    stationId, mbid: MBID, confidence: "recording_id", playedAt: lastPlayedAt,
  }).returning({ id: spinsTable.id });
  spinTwoId = spinTwo!.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(attendanceRollupsTable).where(eq(attendanceRollupsTable.userId, userId));
  await db.delete(attendanceTable).where(eq(attendanceTable.userId, userId));
  await db.delete(listenSessionsTable).where(eq(listenSessionsTable.id, sessionId));
  await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
}, 30_000);

describe("attendance rollup backfill", () => {
  it("aggregates dwell, distinct qualifying spins, and first/last air time", async () => {
    if (!dbAvailable) return;
    await db.delete(attendanceTable).where(eq(attendanceTable.userId, userId));
    await clearRollup();
    await db.insert(attendanceTable).values([
      { userId, sessionId, spinId: spinOneId, dwellSeconds: 25, spinDurationSeconds: 240 },
      { userId, sessionId, spinId: spinTwoId, dwellSeconds: 60, spinDurationSeconds: 240 },
    ]);

    await applyAttendanceMigration();
    const rollup = await readRollup();
    expect(rollup).toMatchObject({ dwellTotal: 85, spinCount: 1 });
    expect(rollup!.firstHeard?.getTime()).toBe(lastPlayedAt.getTime());
    expect(rollup!.lastHeard?.getTime()).toBe(lastPlayedAt.getTime());
  });

  it("is safe to rerun without inflating legacy aggregates", async () => {
    if (!dbAvailable) return;
    const before = await readRollup();
    await db.execute(sql`
      DELETE FROM migration_completions WHERE name = 'applyAttendanceRollupBackfill'
    `);
    await applyAttendanceMigration();
    const after = await readRollup();
    expect(after).toMatchObject({
      dwellTotal: before!.dwellTotal,
      spinCount: before!.spinCount,
      firstHeard: before!.firstHeard,
      lastHeard: before!.lastHeard,
    });
  });
});