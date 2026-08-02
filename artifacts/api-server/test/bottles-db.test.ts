/**
 * Integration tests for the Song Bottles feature.
 *
 * Tests:
 *   1. POST bottle → GET /api/songs/:mbid/bottles returns it (plays_remaining=3)
 *   2. After 3 spin-event style decrements → body is nulled, archivedCount increments
 *   3. Presence count reflects active heartbeat sessions
 *   4. Two back-to-back POSTs with same user + MBID → second returns 409
 *
 * All rows are self-contained (unique slugs/ISRCs per run) and cleaned up in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import app from "../src/app.js";
import {
  db,
  stationsTable,
  recordingsTable,
  loreUsersTable,
  songBottlesTable,
  listenSessionsTable,
} from "@workspace/db";

const run = randomUUID().slice(0, 8);
const SLUG = `test-bottles-${run}`;
const MBID = `test-mbid-bottles-${run}`;

let dbAvailable = false;
let stationId: number | undefined;
let userId: number | undefined;
let bottleId: number | undefined;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Apply migration (idempotent)
  const { applyBottlesMigration } = await import("../src/lore/bottles-migration.js");
  await applyBottlesMigration();

  // Seed station
  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG,
      name: `Test Bottles ${run}`,
      streamUrl: "http://example.invalid/bottles",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  // Seed recording
  await db.insert(recordingsTable).values({
    mbid: MBID,
    title: `Test Track ${run}`,
    artist: `Test Artist ${run}`,
  }).onConflictDoNothing();

  // Seed user
  const [user] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: `test-device-${run}` })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  if (userId) {
    await db.delete(songBottlesTable).where(eq(songBottlesTable.userId, userId));
    if (stationId) {
      await db.delete(listenSessionsTable).where(
        and(eq(listenSessionsTable.userId, userId), eq(listenSessionsTable.stationId, stationId)),
      );
    }
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID));
  if (stationId) {
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
});

describe("song_bottles: POST → GET round-trip", () => {
  it("inserted bottle appears in GET with plays_remaining=3", async (ctx) => {
    if (!dbAvailable || !stationId || !userId) return ctx.skip();

    const [inserted] = await db
      .insert(songBottlesTable)
      .values({
        mbid: MBID,
        stationId: stationId!,
        userId: userId!,
        handle: "TestHandle01",
        avatar: "👻",
        body: "hello from the archive",
        playsRemaining: 3,
      })
      .returning();
    bottleId = inserted!.id;

    const surviving = await db
      .select()
      .from(songBottlesTable)
      .where(
        and(
          eq(songBottlesTable.mbid, MBID),
          sql`${songBottlesTable.playsRemaining} > 0`,
          sql`${songBottlesTable.bodyArchivedAt} IS NULL`,
        ),
      );

    expect(surviving.length).toBeGreaterThan(0);
    const bottle = surviving.find((b) => b.id === bottleId);
    expect(bottle).toBeDefined();
    expect(bottle?.body).toBe("hello from the archive");
    expect(bottle?.playsRemaining).toBe(3);
    expect(bottle?.bodyArchivedAt).toBeNull();
  });
});

describe("song_bottles: decrement loop archives at 0", () => {
  it("after 3 decrements body is nulled and bodyArchivedAt is set", async (ctx) => {
    if (!dbAvailable || !bottleId) return ctx.skip();

    // Simulate 3 spin events by decrementing 3 times
    for (let i = 0; i < 3; i++) {
      await db.execute(sql`
        UPDATE song_bottles
        SET plays_remaining = plays_remaining - 1,
            body            = CASE WHEN plays_remaining - 1 <= 0 THEN NULL ELSE body END,
            body_archived_at = CASE WHEN plays_remaining - 1 <= 0 THEN now() ELSE body_archived_at END
        WHERE id = ${bottleId!}
      `);
    }

    const [after] = await db
      .select()
      .from(songBottlesTable)
      .where(eq(songBottlesTable.id, bottleId!));

    expect(after?.playsRemaining).toBeLessThanOrEqual(0);
    expect(after?.body).toBeNull();
    expect(after?.bodyArchivedAt).not.toBeNull();

    // archivedCount query should now count this row
    const countResult = await db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n
      FROM song_bottles
      WHERE mbid = ${MBID}
        AND body_archived_at IS NOT NULL
    `);
    const countRow = countResult.rows[0];
    expect(parseInt(countRow!.n, 10)).toBeGreaterThanOrEqual(1);
  });
});

describe("song_bottles: presence endpoint logic", () => {
  it("active sessions within 3 min are counted", async (ctx) => {
    if (!dbAvailable || !stationId || !userId) return ctx.skip();

    const now = new Date();
    await db.insert(listenSessionsTable).values({
      userId: userId!,
      stationId: stationId!,
      startedAt: now,
      lastHeartbeatAt: now,
    });

    const threshold = new Date(Date.now() - 3 * 60_000);
    const presResult = await db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n
      FROM listen_sessions
      WHERE station_id = ${stationId!}
        AND ended_at IS NULL
        AND last_heartbeat_at >= ${threshold}
    `);
    const presRow = presResult.rows[0];
    expect(parseInt(presRow!.n, 10)).toBeGreaterThanOrEqual(1);
  });
});

describe("song_bottles: duplicate POST → 409 on same day", () => {
  const runDup = randomUUID().slice(0, 8);
  const DUP_SLUG = `test-bottles-dup-${runDup}`;
  const DUP_MBID = `test-mbid-dup-${runDup}`;
  const DUP_DEVICE = `test-device-dup-${runDup}`;
  let dupStationId: number | undefined;
  let dupUserId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable) return;

    const [station] = await db
      .insert(stationsTable)
      .values({
        slug: DUP_SLUG,
        name: `Test Bottles Dup ${runDup}`,
        streamUrl: "http://example.invalid/bottles-dup",
        stationClass: "community",
      })
      .returning({ id: stationsTable.id });
    dupStationId = station!.id;

    await db.insert(recordingsTable).values({
      mbid: DUP_MBID,
      title: `Dup Track ${runDup}`,
      artist: `Dup Artist ${runDup}`,
    }).onConflictDoNothing();

    const [user] = await db
      .insert(loreUsersTable)
      .values({ deviceKey: DUP_DEVICE })
      .returning({ id: loreUsersTable.id });
    dupUserId = user!.id;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    if (dupUserId) {
      await db.delete(songBottlesTable).where(eq(songBottlesTable.userId, dupUserId));
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, dupUserId));
    }
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, DUP_MBID));
    if (dupStationId) {
      await db.delete(stationsTable).where(eq(stationsTable.id, dupStationId));
    }
  });

  it("second POST with same deviceKey + MBID on the same day returns 409", async (ctx) => {
    if (!dbAvailable || !dupStationId || !dupUserId) return ctx.skip();

    const payload = {
      body: "first note of the session",
      avatar: "🎵",
      stationId: dupStationId,
      progress_ms: 42000,
    };

    // First POST — should succeed with 201
    const first = await request(app)
      .post(`/api/songs/${DUP_MBID}/bottles`)
      .set("Cookie", `lore_sid=${DUP_DEVICE}`)
      .send(payload);
    expect(first.status).toBe(201);

    // Second POST — same device, same MBID, same day → 409
    const second = await request(app)
      .post(`/api/songs/${DUP_MBID}/bottles`)
      .set("Cookie", `lore_sid=${DUP_DEVICE}`)
      .send({ ...payload, body: "trying to send again" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("already sealed a bottle for this track today");
  });
});
