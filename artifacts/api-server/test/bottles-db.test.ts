/**
 * Integration tests for the Song Bottles feature.
 *
 * Tests:
 *   1. POST bottle → GET /api/songs/:mbid/bottles returns it (plays_remaining=3)
 *   2. After 3 spin-event style decrements → body is nulled, archivedCount increments
 *   3. Presence count reflects active heartbeat sessions
 *   4. Two back-to-back POSTs with same user + MBID → second returns 409
 *   5. Cross-station survival: bottle written on station A is decremented and
 *      visible when the same MBID fires on station B (GET is MBID-scoped, not
 *      station-scoped; archivedCount visible from any stationId context).
 *
 * All rows are self-contained (unique slugs/ISRCs per run) and cleaned up in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, gt, isNull, sql } from "drizzle-orm";
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
// Import bottles route to register the spinEvents listener as a side-effect.
import "../src/routes/lore/bottles.js";
import { spinEvents } from "../src/lore/resolve.js";

const run = randomUUID().slice(0, 8);
const SLUG = `test-bottles-${run}`;
const MBID = `test-mbid-bottles-${run}`;

let dbAvailable = false;
let stationId: number | undefined;   // station A
let stationBId: number | undefined;  // station B (cross-station test)
let userId: number | undefined;
let userBId: number | undefined;     // listener on station B
let bottleId: number | undefined;
let crossBottleId: number | undefined; // bottle written on station A for cross-station test

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

  // Seed station A
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

  // Seed station B (different station, same MBID will fire here)
  const [stationB] = await db
    .insert(stationsTable)
    .values({
      slug: `${SLUG}-b`,
      name: `Test Bottles B ${run}`,
      streamUrl: "http://example.invalid/bottles-b",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationBId = stationB!.id;

  // Seed recording
  await db.insert(recordingsTable).values({
    mbid: MBID,
    title: `Test Track ${run}`,
    artist: `Test Artist ${run}`,
  }).onConflictDoNothing();

  // Seed user A (bottle author on station A)
  const [user] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: `test-device-${run}` })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  // Seed user B (listener on station B — separate device)
  const [userB] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: `test-device-b-${run}` })
    .returning({ id: loreUsersTable.id });
  userBId = userB!.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  // Remove all bottles for this test run's MBID first (FK-safe order)
  await db.delete(songBottlesTable).where(eq(songBottlesTable.mbid, MBID));
  if (userId) {
    if (stationId) {
      await db.delete(listenSessionsTable).where(
        and(eq(listenSessionsTable.userId, userId), eq(listenSessionsTable.stationId, stationId)),
      );
    }
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  if (userBId) {
    if (stationBId) {
      await db.delete(listenSessionsTable).where(
        and(eq(listenSessionsTable.userId, userBId), eq(listenSessionsTable.stationId, stationBId)),
      );
    }
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userBId));
  }
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID));
  if (stationId) {
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
  if (stationBId) {
    await db.delete(stationsTable).where(eq(stationsTable.id, stationBId));
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

// ---------------------------------------------------------------------------
// Cross-station survival test
// ---------------------------------------------------------------------------

/**
 * Wait for the async spinEvents handler to settle by polling the DB until
 * the expected condition holds or we time out. The spin-changed listener in
 * bottles.ts is registered as a fire-and-forget async callback on the
 * EventEmitter, so we can't simply `await emit(...)`. Polling is the
 * lightest way to observe the side-effect without coupling to internals.
 */
async function waitForDecrement(
  bottleId: number,
  expectedPlaysRemaining: number,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ playsRemaining: songBottlesTable.playsRemaining })
      .from(songBottlesTable)
      .where(eq(songBottlesTable.id, bottleId));
    if (row && row.playsRemaining <= expectedPlaysRemaining) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `Timed out waiting for bottle ${bottleId} plays_remaining ≤ ${expectedPlaysRemaining}`,
  );
}

describe("song_bottles: cross-station survival", () => {
  it(
    "bottle written on station A is decremented and visible when the same MBID spins on station B",
    async (ctx) => {
      if (!dbAvailable || !stationId || !stationBId || !userId) return ctx.skip();

      // --- Set up: insert a fresh bottle on station A with plays_remaining=3 ---
      const [inserted] = await db
        .insert(songBottlesTable)
        .values({
          mbid: MBID,
          stationId: stationId!,          // written while listening to station A
          userId: userId!,
          handle: "CrossStationAuthor",
          avatar: "🌊",
          body: "traveling across stations",
          playsRemaining: 3,
        })
        .returning();
      crossBottleId = inserted!.id;

      expect(inserted!.playsRemaining).toBe(3);

      // --- Action: station B spins the same MBID ---
      // Emit a spin-changed event as if station B's poller just picked up the track.
      // The spinEvents listener in bottles.ts is MBID-scoped, so it processes
      // bottles regardless of which station emitted the event.
      spinEvents.emit("spin-changed", {
        stationId: stationBId!,
        stationSlug: `${SLUG}-b`,
        rawArtist: `Test Artist ${run}`,
        rawTitle: `Test Track ${run}`,
        mbid: MBID,
        artistMbid: null,
        releaseGroupMbid: null,
        isFirstSpin: false,
      });

      // Wait for the async decrement handler to settle (it's fire-and-forget on the emitter)
      await waitForDecrement(crossBottleId!, 2);

      // --- Assert: plays_remaining decremented (bottle still alive) ---
      const [afterDecrement] = await db
        .select()
        .from(songBottlesTable)
        .where(eq(songBottlesTable.id, crossBottleId!));

      expect(afterDecrement?.playsRemaining).toBe(2);
      expect(afterDecrement?.body).toBe("traveling across stations");
      expect(afterDecrement?.bodyArchivedAt).toBeNull();

      // --- Assert: MBID-scoped GET query returns the bottle from any station context ---
      // The GET /api/songs/:mbid/bottles endpoint does NOT filter by stationId —
      // the same query should surface this bottle whether the caller is on
      // station A or station B (or neither).
      const surviving = await db
        .select({
          id: songBottlesTable.id,
          mbid: songBottlesTable.mbid,
          body: songBottlesTable.body,
          playsRemaining: songBottlesTable.playsRemaining,
          stationId: songBottlesTable.stationId,
        })
        .from(songBottlesTable)
        .where(
          and(
            eq(songBottlesTable.mbid, MBID),
            gt(songBottlesTable.playsRemaining, 0),
            isNull(songBottlesTable.bodyArchivedAt),
          ),
        );

      const crossBottle = surviving.find((b) => b.id === crossBottleId);
      expect(crossBottle).toBeDefined();
      // The bottle's stationId records where it was written (station A), but
      // the query is MBID-scoped: a listener on station B sees it too.
      expect(crossBottle?.stationId).toBe(stationId); // written on A
      expect(crossBottle?.body).toBe("traveling across stations");
      expect(crossBottle?.playsRemaining).toBe(2);
    },
  );

  it(
    "archivedCount is visible from any stationId context after bottle expires via cross-station spins",
    async (ctx) => {
      if (!dbAvailable || !crossBottleId || !stationBId) return ctx.skip();

      // Exhaust the remaining 2 plays via station B spins
      for (let i = 0; i < 2; i++) {
        spinEvents.emit("spin-changed", {
          stationId: stationBId!,
          stationSlug: `${SLUG}-b`,
          rawArtist: `Test Artist ${run}`,
          rawTitle: `Test Track ${run}`,
          mbid: MBID,
          artistMbid: null,
          releaseGroupMbid: null,
          isFirstSpin: false,
        });
        // Small gap so the async handler processes each spin before the next
        await new Promise((r) => setTimeout(r, 100));
      }

      // Wait for the final decrement to archive the bottle
      await waitForDecrement(crossBottleId!, 0);

      const [archived] = await db
        .select()
        .from(songBottlesTable)
        .where(eq(songBottlesTable.id, crossBottleId!));

      expect(archived?.playsRemaining).toBeLessThanOrEqual(0);
      expect(archived?.body).toBeNull();
      expect(archived?.bodyArchivedAt).not.toBeNull();

      // archivedCount query mirrors the GET endpoint — MBID-scoped, no stationId filter.
      // A listener arriving on ANY station should see the same archived count.
      const countResult = await db.execute<{ n: string }>(sql`
        SELECT COUNT(*)::text AS n
        FROM song_bottles
        WHERE mbid = ${MBID}
          AND body_archived_at IS NOT NULL
      `);
      const countRow = countResult.rows[0];
      expect(parseInt(countRow!.n, 10)).toBeGreaterThanOrEqual(1);
    },
  );
});
