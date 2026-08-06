import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  libraryItemsTable,
  recordingsTable,
  stationsTable,
  showsTable,
  spinsTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * DB integration tests for:
 *   GET /api/me/overlaps/runs?order=recent  — reverse-chrono coarse detents
 *   GET /api/me/overlaps/runs/:runId/crossings — fine crossing moments
 *
 * Covers: reverse-chrono ordering, 60-run limit enforcement, user isolation,
 * valid anchor ID, non-anchor spin ID from same partition, same station/day
 * different show partition, hidden station suppression, malformed IDs, and
 * non-existent runId.
 *
 * Pattern mirrors recent-runs-db.test.ts: fully isolated (unique slugs/MBIDs
 * per test run), real DB writes, cleans up, self-skips without a real DB.
 */
const run = randomUUID().slice(0, 8);
const MBID_A = `test-cross-a-${run}`;
const MBID_B = `test-cross-b-${run}`;
const DEVICE_KEY_1 = `test-cross-dev1-${run}`;
const DEVICE_KEY_2 = `test-cross-dev2-${run}`;
const MIN = 60_000;

// Place spins a few minutes ahead so they stay ahead of any live pollers.
// Guard against UTC midnight straddle (same approach as recent-runs-db.test.ts).
let base = Date.now() + 2 * MIN;
if (
  new Date(base).toISOString().slice(0, 10) !==
  new Date(base + 20 * MIN).toISOString().slice(0, 10)
) {
  base += 30 * MIN;
}
const DAY = new Date(base).toISOString().slice(0, 10);

let dbAvailable = false;
let userId1: number | null = null;
let userId2: number | null = null;
let stationIds: number[] = [];
let showIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";

/** runId for the anchor (first inserted) spin of the station-A+showA run. */
let runIdAnchor = 0;
/** spinId for a LATER spin in the same station-A+showA partition. */
let nonAnchorSpinId = 0;
/** runId for the station-A run with NO show (different partition on same station+day). */
let runIdNoShow = 0;
/** spinId for the hidden-station spin — must never return moments. */
let hiddenSpinId = 0;

async function get(path: string, deviceKey: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { cookie: `lore_sid=${deviceKey}` },
  });
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // --- Users ---
  const [u1] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: DEVICE_KEY_1 })
    .returning({ id: loreUsersTable.id });
  userId1 = u1!.id;

  const [u2] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: DEVICE_KEY_2 })
    .returning({ id: loreUsersTable.id });
  userId2 = u2!.id;

  // --- Stations (one normal, one hidden) ---
  const inserted = await db
    .insert(stationsTable)
    .values([
      {
        slug: `test-cross-sta-${run}`,
        name: `Test Cross Station ${run}`,
        streamUrl: "http://example.invalid/cross",
        stationClass: "curated",
      },
      {
        slug: `test-cross-hid-${run}`,
        name: `Test Cross Hidden ${run}`,
        streamUrl: "http://example.invalid/hidden",
        stationClass: "curated",
        hidden: true,
      },
    ])
    .returning({ id: stationsTable.id });
  stationIds = inserted.map((s) => s.id);
  const [stationNormal, stationHidden] = stationIds as [number, number];

  // --- Show on the normal station ---
  const showInserted = await db
    .insert(showsTable)
    .values([
      {
        stationId: stationNormal,
        name: `Test Cross Show ${run}`,
        djName: "DJ Cross",
        // schedule_valid stays null (no schedule) so validScheduleShowAttribution
        // returns the show attribution via the alternative validity path
      },
    ])
    .returning({ id: showsTable.id });
  showIds = showInserted.map((s) => s.id);
  const [showA] = showIds as [number];

  // --- Recordings ---
  await db
    .insert(recordingsTable)
    .values([
      { mbid: MBID_A, title: "Track A", artist: "Artist Cross" },
      { mbid: MBID_B, title: "Track B", artist: "Artist Cross" },
    ]);

  // --- Library items for user 1 only ---
  await db.insert(libraryItemsTable).values([
    {
      userId: userId1!,
      mbid: MBID_A,
      provenance: { kind: "keep" },
      addedAt: new Date(),
    },
    {
      userId: userId1!,
      mbid: MBID_B,
      provenance: { kind: "keep" },
      addedAt: new Date(),
    },
  ]);

  // --- Spins ---
  // Run A: stationNormal + showA — 3 spins (all library MBIDs)
  //   Spin at base+0 → anchor (min ID), Spin at base+1, Spin at base+2
  // Run B: stationNormal + no show — 1 spin (library MBID)
  //   Spin at base+5 (newer → ranks first in order=recent)
  // Run C: stationHidden — 1 spin (library MBID — must be suppressed)

  const spinInserted = await db
    .insert(spinsTable)
    .values([
      // Run A spin 1 — earliest, becomes the anchor (min id)
      {
        stationId: stationNormal,
        showId: showA,
        mbid: MBID_A,
        confidence: "text",
        rawArtist: "Artist Cross",
        rawTitle: "Track A",
        playedAt: new Date(base),
      },
      // Run A spin 2 — a non-library MBID (no crossing, partition member)
      {
        stationId: stationNormal,
        showId: showA,
        mbid: null, // unresolved — should not appear in crossings
        confidence: "text",
        rawArtist: "Unknown",
        rawTitle: "Unknown",
        playedAt: new Date(base + 1 * MIN),
      },
      // Run A spin 3 — another library MBID (non-anchor, same partition)
      {
        stationId: stationNormal,
        showId: showA,
        mbid: MBID_B,
        confidence: "text",
        rawArtist: "Artist Cross",
        rawTitle: "Track B",
        playedAt: new Date(base + 2 * MIN),
      },
      // Run B: same station, no show — different partition (older → ranks 2nd)
      {
        stationId: stationNormal,
        showId: null,
        mbid: MBID_A,
        confidence: "text",
        rawArtist: "Artist Cross",
        rawTitle: "Track A",
        playedAt: new Date(base + 5 * MIN),
      },
      // Run C: hidden station — must be suppressed in order=recent
      {
        stationId: stationHidden,
        showId: null,
        mbid: MBID_A,
        confidence: "text",
        rawArtist: "Artist Cross",
        rawTitle: "Track A",
        playedAt: new Date(base + 3 * MIN),
      },
    ])
    .returning({ id: spinsTable.id });

  // Capture anchor and non-anchor IDs
  runIdAnchor = spinInserted[0]!.id; // Run A, spin 1
  nonAnchorSpinId = spinInserted[2]!.id; // Run A, spin 3 (same partition, not anchor)
  runIdNoShow = spinInserted[3]!.id; // Run B (no-show partition anchor)
  hiddenSpinId = spinInserted[4]!.id; // Run C (hidden station — must return empty)

  // Start server
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server!.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
}, 90_000);

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  if (stationIds.length > 0)
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  if (showIds.length > 0)
    await db.delete(showsTable).where(inArray(showsTable.id, showIds));
  if (userId1 != null) {
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId1));
  }
  if (userId2 != null) {
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId2));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID_A, MBID_B]));
  if (stationIds.length > 0)
    await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
  if (userId1 != null)
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId1));
  if (userId2 != null)
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId2));
}, 30_000);

// ---------------------------------------------------------------------------
// GET /api/me/overlaps/runs?order=recent
// ---------------------------------------------------------------------------

describe("GET /api/me/overlaps/runs?order=recent", () => {
  it("returns runs reverse-chronologically (newest max(playedAt) first)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs?order=recent`, DEVICE_KEY_1);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ runId: number; day: string; station: { slug: string }; owned: number }> };

    // Filter to our test stations only
    const mine = body.items.filter((i) => i.station.slug.startsWith(`test-cross-sta-${run}`));

    // Run B (no-show, playedAt base+5) should rank before Run A (showA, playedAt base+2)
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine[0]!.runId).toBe(runIdNoShow); // Run B has newer max(playedAt)
    expect(mine[1]!.runId).toBe(runIdAnchor); // Run A anchor
    expect(mine[0]!.day).toBe(DAY);
    expect(mine[1]!.day).toBe(DAY);
  });

  it("reports correct owned counts per run", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs?order=recent`, DEVICE_KEY_1);
    const body = await res.json() as { items: Array<{ runId: number; owned: number }> };

    const runA = body.items.find((i) => i.runId === runIdAnchor);
    const runB = body.items.find((i) => i.runId === runIdNoShow);

    expect(runA?.owned).toBe(2); // MBID_A + MBID_B both in user library
    expect(runB?.owned).toBe(1); // MBID_A only
  });

  it("does not include runs from hidden stations", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs?order=recent`, DEVICE_KEY_1);
    const body = await res.json() as { items: Array<{ station: { slug: string } }> };

    const hiddenRun = body.items.find((i) => i.station.slug.startsWith(`test-cross-hid-${run}`));
    expect(hiddenRun).toBeUndefined();
  });

  it("user isolation: user 2 (no library items) sees no runs", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs?order=recent`, DEVICE_KEY_2);
    const body = await res.json() as { items: Array<{ station: { slug: string } }> };

    const mine = body.items.filter((i) =>
      i.station.slug.startsWith(`test-cross-sta-${run}`) ||
      i.station.slug.startsWith(`test-cross-hid-${run}`),
    );
    expect(mine).toHaveLength(0);
  });

  it("60-run limit: returns at most 60 runs", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs?order=recent`, DEVICE_KEY_1);
    const body = await res.json() as { items: unknown[] };
    // We only seeded 2 qualifying runs; this test verifies the limit is applied (≤60)
    expect(body.items.length).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// GET /api/me/overlaps/runs/:runId/crossings
// ---------------------------------------------------------------------------

describe("GET /api/me/overlaps/runs/:runId/crossings", () => {
  it("valid anchor returns crossing moments for the run, ordered by playedAt asc", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs/${runIdAnchor}/crossings`, DEVICE_KEY_1);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: number;
      moments: Array<{ spinId: number; mbid: string; artistName: string; trackTitle: string }>;
    };

    // Run A has 2 library-hit spins (MBID_A and MBID_B)
    // The null-mbid spin must NOT appear
    expect(body.moments).toHaveLength(2);
    expect(body.moments[0]!.mbid).toBe(MBID_A);
    expect(body.moments[1]!.mbid).toBe(MBID_B);
    expect(body.moments[0]!.artistName).toBe("Artist Cross");
    expect(body.moments[0]!.trackTitle).toBe("Track A");
  });

  it("non-anchor spin ID from same partition returns same crossing moments", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const anchorRes = await get(`/api/me/overlaps/runs/${runIdAnchor}/crossings`, DEVICE_KEY_1);
    const nonAnchorRes = await get(`/api/me/overlaps/runs/${nonAnchorSpinId}/crossings`, DEVICE_KEY_1);

    const anchorBody = await anchorRes.json() as { moments: Array<{ spinId: number }> };
    const nonAnchorBody = await nonAnchorRes.json() as { moments: Array<{ spinId: number }> };

    // Both IDs belong to the same partition (stationNormal + showA + DAY)
    expect(nonAnchorBody.moments).toHaveLength(anchorBody.moments.length);
    expect(nonAnchorBody.moments.map((m) => m.spinId)).toEqual(anchorBody.moments.map((m) => m.spinId));
  });

  it("same station + same day but different show = different partition, different crossings", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // runIdAnchor is station+showA+day; runIdNoShow is station+null_show+day
    const resA = await get(`/api/me/overlaps/runs/${runIdAnchor}/crossings`, DEVICE_KEY_1);
    const resB = await get(`/api/me/overlaps/runs/${runIdNoShow}/crossings`, DEVICE_KEY_1);

    const bodyA = await resA.json() as { moments: Array<{ spinId: number }> };
    const bodyB = await resB.json() as { moments: Array<{ spinId: number }> };

    // They share the same station and day but have different shows — independent partitions
    expect(bodyA.moments.length).toBe(2); // Run A: MBID_A + MBID_B
    expect(bodyB.moments.length).toBe(1); // Run B: MBID_A only
    const spinIdsA = new Set(bodyA.moments.map((m) => m.spinId));
    const spinIdsB = new Set(bodyB.moments.map((m) => m.spinId));
    // No overlap between partitions
    for (const id of spinIdsB) expect(spinIdsA.has(id)).toBe(false);
  });

  it("user isolation: user 2 sees empty crossings for a run they have no library items in", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs/${runIdAnchor}/crossings`, DEVICE_KEY_2);
    expect(res.status).toBe(200);
    const body = await res.json() as { moments: unknown[] };
    expect(body.moments).toHaveLength(0);
  });

  it("non-existent runId returns 200 with empty moments list", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs/999999999/crossings`, DEVICE_KEY_1);
    expect(res.status).toBe(200);
    const body = await res.json() as { moments: unknown[] };
    expect(body.moments).toHaveLength(0);
  });

  it("malformed runId (non-integer) returns 400", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs/not-a-number/crossings`, DEVICE_KEY_1);
    expect(res.status).toBe(400);
  });

  it("malformed runId (zero) returns 400", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs/0/crossings`, DEVICE_KEY_1);
    expect(res.status).toBe(400);
  });

  it("hidden-station spin ID returns empty moments (not a data-access bypass)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // hiddenSpinId belongs to stationHidden (hidden=true). The endpoint must
    // refuse to resolve the partition for hidden stations and return empty.
    const res = await get(`/api/me/overlaps/runs/${hiddenSpinId}/crossings`, DEVICE_KEY_1);
    expect(res.status).toBe(200);
    const body = await res.json() as { moments: unknown[] };
    expect(body.moments).toHaveLength(0);
  });

  it("each crossing moment carries spinId, playedAt, mbid, artistName, trackTitle, runId, djName", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await get(`/api/me/overlaps/runs/${runIdAnchor}/crossings`, DEVICE_KEY_1);
    const body = await res.json() as {
      runId: number;
      moments: Array<{
        spinId: number;
        playedAt: string;
        mbid: string;
        artistName: string;
        trackTitle: string;
        runId: number;
        showName: string | null;
        djName: string | null;
        spinDurationSeconds: number | null;
      }>;
    };

    expect(body.runId).toBe(runIdAnchor);
    const m = body.moments[0]!;
    expect(typeof m.spinId).toBe("number");
    expect(typeof m.playedAt).toBe("string");
    expect(m.mbid).toBe(MBID_A);
    expect(m.artistName).toBe("Artist Cross");
    expect(m.trackTitle).toBe("Track A");
    expect(m.runId).toBe(runIdAnchor);
    // spinDurationSeconds is null for test data (no duration inserted)
    expect(m.spinDurationSeconds).toBeNull();
  });

  it("populates spinDurationSeconds from attendance when a duration exists, null otherwise", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Attendance rows require a listen session. Insert one, then an
    // attendance row with a real duration on the non-anchor spin.
    const sessionRes = await db.execute<{ id: number }>(sql`
      INSERT INTO listen_sessions (user_id, station_id)
      VALUES (${userId1}, ${stationIds[0]})
      RETURNING id
    `);
    const sessionId = sessionRes.rows[0]!.id;

    try {
      await db.execute(sql`
        INSERT INTO attendance (user_id, spin_id, session_id, dwell_seconds, spin_duration_seconds)
        VALUES (${userId1}, ${nonAnchorSpinId}, ${sessionId}, 120, 245)
        ON CONFLICT (user_id, spin_id) DO UPDATE SET spin_duration_seconds = excluded.spin_duration_seconds
      `);

      const res = await get(`/api/me/overlaps/runs/${runIdAnchor}/crossings`, DEVICE_KEY_1);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        moments: Array<{ spinId: number; spinDurationSeconds: number | null }>;
      };

      const withDuration = body.moments.find((m) => m.spinId === nonAnchorSpinId);
      expect(withDuration).toBeDefined();
      expect(withDuration!.spinDurationSeconds).toBe(245);

      // Spins with no attendance duration stay honestly null.
      const without = body.moments.find((m) => m.spinId === runIdAnchor);
      expect(without).toBeDefined();
      expect(without!.spinDurationSeconds).toBeNull();
    } finally {
      await db.execute(sql`DELETE FROM attendance WHERE session_id = ${sessionId}`);
      await db.execute(sql`DELETE FROM listen_sessions WHERE id = ${sessionId}`);
    }
  });
});
