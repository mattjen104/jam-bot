/**
 * Regression tests for the `credited_through` high-water mark on the
 * attendance table.
 *
 * Goal: prove that the upsert in POST /api/me/attendance/heartbeat is
 * idempotent — replaying the same or an earlier window never inflates
 * dwell_seconds, and that a NULL credited_through (legacy row) transitions
 * correctly to a real value on the first conflict.
 *
 * We exercise the SQL directly (no HTTP server) so the tests are fast,
 * hermetically scoped, and unambiguous about what they're asserting.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  stationsTable,
  recordingsTable,
  spinsTable,
  listenSessionsTable,
  attendanceTable,
  attendanceRollupsTable,
} from "@workspace/db";
import { applyAttendanceMigration } from "../src/lore/attendance-migration.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);
const SID = `att-ct-${run}`;
const MBID = `att-ct-${run}`;
const SLUG = `att-ct-${run}`;

let dbAvailable = false;
let userId = 0;
let stationId = 0;
let spinId = 0;
let sessionId = 0;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Ensure the attendance tables (including the credited_through column) exist.
  await applyAttendanceMigration();

  // Spotify connection stub (required by lore_users FK).
  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "t",
    refreshToken: "r",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  // User.
  const [u] = await db
    .insert(loreUsersTable)
    .values({
      spotifyUserId: `att-ct-user-${run}`,
      spotifyConnectionId: SID,
      deviceKey: SID,
    })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // Station.
  const [st] = await db
    .insert(stationsTable)
    .values({ slug: SLUG, name: `Att CT ${run}`, streamUrl: "http://x.invalid", stationClass: "community" })
    .returning({ id: stationsTable.id });
  stationId = st!.id;

  // Recording with known duration (4 min = 240 000 ms).
  await db.insert(recordingsTable).values({ mbid: MBID, title: `T ${run}`, artist: `A ${run}`, durationMs: 240_000 });

  // Spin played at T-0 (5 minutes ago for headroom).
  const playedAt = new Date(Date.now() - 5 * 60 * 1000);
  const [sp] = await db
    .insert(spinsTable)
    .values({ stationId, mbid: MBID, confidence: "recording_id", rawArtist: "a", rawTitle: "t", playedAt })
    .returning({ id: spinsTable.id });
  spinId = sp!.id;

  // Listen session.
  const [sess] = await db
    .insert(listenSessionsTable)
    .values({ userId, stationId, startedAt: playedAt, lastHeartbeatAt: new Date() })
    .returning({ id: listenSessionsTable.id });
  sessionId = sess!.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(attendanceTable).where(eq(attendanceTable.userId, userId));
  await db.delete(attendanceRollupsTable).where(eq(attendanceRollupsTable.userId, userId));
  await db.delete(listenSessionsTable).where(eq(listenSessionsTable.id, sessionId));
  await db.delete(spinsTable).where(eq(spinsTable.id, spinId));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
}, 90_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Execute the exact same upsert the heartbeat handler uses. */
async function upsertAttendance(dwellSeconds: number, creditedThrough: Date) {
  await db
    .insert(attendanceTable)
    .values({ userId, spinId, sessionId, dwellSeconds, creditedThrough })
    .onConflictDoUpdate({
      target: [attendanceTable.userId, attendanceTable.spinId],
      set: {
        dwellSeconds: sql`attendance.dwell_seconds + CASE
          WHEN attendance.credited_through IS NULL
            OR excluded.credited_through > attendance.credited_through
          THEN excluded.dwell_seconds
          ELSE 0
        END`,
        creditedThrough: sql`COALESCE(
          GREATEST(attendance.credited_through, excluded.credited_through),
          excluded.credited_through
        )`,
        sessionId,
        spinDurationSeconds: sql`COALESCE(attendance.spin_duration_seconds, excluded.spin_duration_seconds)`,
      },
    });
}

async function readRow() {
  const [row] = await db
    .select({
      dwellSeconds: attendanceTable.dwellSeconds,
      creditedThrough: attendanceTable.creditedThrough,
    })
    .from(attendanceTable)
    .where(and(eq(attendanceTable.userId, userId), eq(attendanceTable.spinId, spinId)));
  return row ?? null;
}

async function deleteRow() {
  await db
    .delete(attendanceTable)
    .where(and(eq(attendanceTable.userId, userId), eq(attendanceTable.spinId, spinId)));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("attendance credited_through idempotency guard", () => {
  it("inserts a fresh row with the supplied credited_through", async () => {
    if (!dbAvailable) return;

    const ct = new Date(Date.now() - 10_000); // 10 s ago
    await upsertAttendance(30, ct);

    const row = await readRow();
    expect(row).not.toBeNull();
    expect(row!.dwellSeconds).toBe(30);
    expect(row!.creditedThrough?.getTime()).toBe(ct.getTime());

    await deleteRow();
  });

  it("does NOT accumulate dwell when the same credited_through is replayed", async () => {
    if (!dbAvailable) return;

    const ct = new Date(Date.now() - 10_000);
    await upsertAttendance(30, ct);
    // Replay the exact same window — dwell must stay at 30.
    await upsertAttendance(30, ct);

    const row = await readRow();
    expect(row!.dwellSeconds).toBe(30);

    await deleteRow();
  });

  it("does NOT accumulate dwell when an earlier credited_through is replayed", async () => {
    if (!dbAvailable) return;

    const ct1 = new Date(Date.now() - 10_000);
    const ct0 = new Date(ct1.getTime() - 5_000); // earlier
    await upsertAttendance(30, ct1);
    // Attempt to replay an earlier window — dwell must stay at 30.
    await upsertAttendance(20, ct0);

    const row = await readRow();
    expect(row!.dwellSeconds).toBe(30);
    // High-water mark must not regress.
    expect(row!.creditedThrough?.getTime()).toBe(ct1.getTime());

    await deleteRow();
  });

  it("DOES accumulate dwell when a strictly later credited_through arrives", async () => {
    if (!dbAvailable) return;

    const ct1 = new Date(Date.now() - 10_000);
    const ct2 = new Date(ct1.getTime() + 5_000); // strictly later
    await upsertAttendance(30, ct1);
    await upsertAttendance(15, ct2);

    const row = await readRow();
    expect(row!.dwellSeconds).toBe(45); // 30 + 15
    expect(row!.creditedThrough?.getTime()).toBe(ct2.getTime());

    await deleteRow();
  });

  it("seeds credited_through on a legacy row where it was NULL", async () => {
    if (!dbAvailable) return;

    // Simulate a legacy row: insert without credited_through (column defaults to NULL).
    await db.insert(attendanceTable).values({ userId, spinId, sessionId, dwellSeconds: 20 });

    const before = await readRow();
    expect(before!.creditedThrough).toBeNull();

    // First conflict against the NULL row — should credit dwell AND set the mark.
    const ct = new Date(Date.now() - 5_000);
    await upsertAttendance(25, ct);

    const after = await readRow();
    expect(after!.dwellSeconds).toBe(45); // 20 + 25 (NULL row seeded)
    expect(after!.creditedThrough?.getTime()).toBe(ct.getTime());

    await deleteRow();
  });

  it("after NULL-to-value seeding, a replay of the same window does NOT double-count", async () => {
    if (!dbAvailable) return;

    // Legacy row.
    await db.insert(attendanceTable).values({ userId, spinId, sessionId, dwellSeconds: 20 });

    // Seed the high-water mark.
    const ct = new Date(Date.now() - 5_000);
    await upsertAttendance(25, ct);

    const afterSeed = await readRow();
    expect(afterSeed!.dwellSeconds).toBe(45);

    // Replay the same window — must not re-accumulate.
    await upsertAttendance(25, ct);

    const afterReplay = await readRow();
    expect(afterReplay!.dwellSeconds).toBe(45); // unchanged

    await deleteRow();
  });
});
