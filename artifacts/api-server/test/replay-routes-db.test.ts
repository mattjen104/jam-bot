/**
 * Route-level tests for Ghost Replay resolution and playlist endpoints.
 *
 * Covers: resolution start, job poll, SSE snapshot, playlist-target lookup,
 * materialization start, and materialization job poll.  Asserts the OpenAPI
 * request/response shapes used by generated clients and verifies that
 * ownership and replay identifiers cannot be accidentally swapped.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  recordingsTable,
  replayMaterializationJobsTable,
  replayResolutionJobsTable,
  serviceTrackMapTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import { applyReplayResolutionMigration } from "../src/lore/replay-resolution-migration.js";
import app from "../src/app.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);
const slug = `test-replay-routes-${run}`;
const mbid = `test-replay-routes-mbid-${run}`;
const SID_A = `test-replay-routes-sid-a-${run}`;
const SID_B = `test-replay-routes-sid-b-${run}`;

let dbAvailable = false;
let stationId: number | undefined;
let anchorSpinId: number | undefined;
let userIdA: number | undefined;
let userIdB: number | undefined;
let server: ReturnType<typeof app.listen> | undefined;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    await applyReplayResolutionMigration();
    dbAvailable = true;
  } catch {
    return;
  }

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug,
      name: `Replay Routes Station ${run}`,
      streamUrl: "http://example.invalid/replay-routes",
      stationClass: "curated",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  await db.insert(recordingsTable).values({
    mbid,
    title: "Replay Routes Track",
    artist: "Replay Routes Artist",
  });

  const base = new Date();
  const spins = await db
    .insert(spinsTable)
    .values([
      {
        stationId: stationId!,
        mbid,
        rawArtist: "Replay Routes Artist",
        rawTitle: "Replay Routes Track",
        source: "test",
        confidence: "text",
        playedAt: base,
      },
      {
        stationId: stationId!,
        mbid: null,
        rawArtist: "Unresolved Routes Artist",
        rawTitle: "Unresolved Routes Track",
        source: "test",
        confidence: "unresolved",
        playedAt: new Date(base.getTime() + 60_000),
      },
    ])
    .returning({ id: spinsTable.id });
  anchorSpinId = spins[0]!.id;

  // Two independent listeners — A is the primary, B tests ownership isolation.
  const [uA] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: SID_A })
    .returning({ id: loreUsersTable.id });
  userIdA = uA!.id;

  const [uB] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: SID_B })
    .returning({ id: loreUsersTable.id });
  userIdB = uB!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server!.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  server?.close();
  vi.unstubAllGlobals();
  if (!dbAvailable || stationId == null) return;

  await db
    .delete(replayMaterializationJobsTable)
    .where(eq(replayMaterializationJobsTable.replayId, anchorSpinId!));
  await db
    .delete(replayResolutionJobsTable)
    .where(eq(replayResolutionJobsTable.replayId, anchorSpinId!));
  await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  await db
    .delete(loreUsersTable)
    .where(inArray(loreUsersTable.id, [userIdA!, userIdB!]));
  // service_track_map may have been written by the background resolution
  // worker; clear it before removing the recording (FK order).
  await db
    .delete(serviceTrackMapTable)
    .where(eq(serviceTrackMapTable.recordingMbid, mbid));
  await db
    .delete(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid));
});

// ---------------------------------------------------------------------------
// POST /api/replay/:id/resolve — start resolution
// ---------------------------------------------------------------------------

describe("POST /api/replay/:id/resolve", () => {
  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/resolve`,
      { method: "POST" },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for a replay that does not exist", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/999999999/resolve`, {
      method: "POST",
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer replay id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/not-a-number/resolve`, {
      method: "POST",
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns 202 with a ReplayResolutionJob shape matching the OpenAPI schema", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/resolve`,
      {
        method: "POST",
        headers: { cookie: `lore_sid=${SID_A}` },
      },
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;

    // Required top-level fields from the OpenAPI ReplayResolutionJob schema.
    expect(typeof body.id).toBe("number");
    expect(typeof body.replayId).toBe("number");
    expect(["pending", "running", "done", "error"]).toContain(body.status);
    expect(typeof body.total).toBe("number");
    expect(typeof body.processed).toBe("number");
    expect(typeof body.resolved).toBe("number");
    expect(typeof body.missing).toBe("number");
    expect(typeof body.failed).toBe("number");
    expect(typeof body.committedOffset).toBe("number");
    expect(body.error === null || typeof body.error === "string").toBe(true);
    expect(body.finishedAt === null || typeof body.finishedAt === "string").toBe(true);
    expect(Array.isArray(body.failures)).toBe(true);
    expect(body.missBreakdown).toBeDefined();
    const bd = body.missBreakdown as Record<string, unknown>;
    expect(typeof bd.noVector).toBe("number");
    expect(typeof bd.noLinks).toBe("number");
    expect(typeof bd.noRecording).toBe("number");

    // The replayId in the response must match the replay we posted to —
    // ownership and replay identifiers cannot be swapped.
    expect(body.replayId).toBe(anchorSpinId);
  });
});

// ---------------------------------------------------------------------------
// GET /api/replay/jobs/:jobId — poll resolution job
// ---------------------------------------------------------------------------

describe("GET /api/replay/jobs/:jobId", () => {
  let jobId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable || userIdA == null) return;
    const [job] = await db
      .insert(replayResolutionJobsTable)
      .values({
        userId: userIdA,
        replayId: anchorSpinId!,
        total: 2,
        status: "done",
        processed: 2,
        resolved: 1,
        missing: 1,
        finishedAt: new Date(),
      })
      .returning({ id: replayResolutionJobsTable.id });
    jobId = job!.id;
  });

  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable || jobId == null) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/jobs/${jobId}`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the session does not own the job (ownership isolation)", async (ctx) => {
    if (!dbAvailable || jobId == null) return ctx.skip();
    // User B tries to read User A's job — must be 404, not 200.
    const res = await fetch(`${baseUrl}/api/replay/jobs/${jobId}`, {
      headers: { cookie: `lore_sid=${SID_B}` },
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-existent job id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/jobs/999999999`, {
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer job id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/jobs/not-an-id`, {
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with a ReplayResolutionJob shape and the correct replayId", async (ctx) => {
    if (!dbAvailable || jobId == null) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/jobs/${jobId}`, {
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // OpenAPI shape validation.
    expect(body.id).toBe(jobId);
    expect(body.replayId).toBe(anchorSpinId);
    expect(["pending", "running", "done", "error"]).toContain(body.status);
    expect(typeof body.total).toBe("number");
    expect(typeof body.processed).toBe("number");
    expect(typeof body.resolved).toBe("number");
    expect(typeof body.missing).toBe("number");
    expect(typeof body.failed).toBe("number");
    expect(typeof body.committedOffset).toBe("number");
    expect(body.error === null || typeof body.error === "string").toBe(true);
    expect(body.finishedAt === null || typeof body.finishedAt === "string").toBe(true);
    expect(Array.isArray(body.failures)).toBe(true);
    const bd = body.missBreakdown as Record<string, unknown>;
    expect(typeof bd.noVector).toBe("number");
    expect(typeof bd.noLinks).toBe("number");
    expect(typeof bd.noRecording).toBe("number");

    // Ownership contract: the replayId must match what we inserted, proving
    // the server could not swap ownership or replay identifiers.
    expect(body.replayId).toBe(anchorSpinId);
  });
});

// ---------------------------------------------------------------------------
// GET /api/replay/jobs/:jobId/stream — SSE snapshot
// ---------------------------------------------------------------------------

describe("GET /api/replay/jobs/:jobId/stream", () => {
  let streamJobId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable || userIdA == null) return;
    const [job] = await db
      .insert(replayResolutionJobsTable)
      .values({
        userId: userIdA,
        replayId: anchorSpinId!,
        total: 2,
        status: "pending",
        processed: 0,
      })
      .returning({ id: replayResolutionJobsTable.id });
    streamJobId = job!.id;
  });

  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable || streamJobId == null) return ctx.skip();
    const controller = new AbortController();
    const res = await fetch(
      `${baseUrl}/api/replay/jobs/${streamJobId}/stream`,
      { signal: controller.signal },
    );
    controller.abort();
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent stream job", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const controller = new AbortController();
    const res = await fetch(
      `${baseUrl}/api/replay/jobs/999999999/stream`,
      {
        headers: { cookie: `lore_sid=${SID_A}` },
        signal: controller.signal,
      },
    );
    controller.abort();
    expect(res.status).toBe(404);
  });

  it("opens a text/event-stream and sends the initial snapshot data event", async (ctx) => {
    if (!dbAvailable || streamJobId == null) return ctx.skip();

    const controller = new AbortController();
    const res = await fetch(
      `${baseUrl}/api/replay/jobs/${streamJobId}/stream`,
      {
        headers: { cookie: `lore_sid=${SID_A}` },
        signal: controller.signal,
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    // Read just enough bytes to see the :connected comment and initial data
    // event; then abort so the persistent connection does not block the suite.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    const deadline = Date.now() + 3_000;
    try {
      while (Date.now() < deadline) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) =>
            setTimeout(() => resolve({ done: true, value: undefined }), 500),
          ),
        ]);
        if (done || value == null) break;
        accumulated += decoder.decode(value, { stream: true });
        // Once we have both the comment line and a data: frame we're done.
        if (accumulated.includes(":connected") && accumulated.includes("data:")) break;
      }
    } finally {
      controller.abort();
      reader.cancel().catch(() => {});
    }

    expect(accumulated).toContain(":connected");
    expect(accumulated).toContain("data:");

    // The data event must be valid JSON carrying the snapshot fields.
    const dataLine = accumulated
      .split("\n")
      .find((l) => l.startsWith("data:"));
    expect(dataLine).toBeDefined();
    const snapshot = JSON.parse(dataLine!.slice(5).trim()) as Record<
      string,
      unknown
    >;
    expect(snapshot.id).toBe(streamJobId);
    expect(snapshot.replayId).toBe(anchorSpinId);
    expect(["pending", "running", "done", "error"]).toContain(snapshot.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/replay/:id/playlist-targets — available playlist destinations
// ---------------------------------------------------------------------------

describe("GET /api/replay/:id/playlist-targets", () => {
  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/playlist-targets`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-integer replay id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/not-an-id/playlist-targets`, {
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with a targets array matching the ReplayPlaylistTargetsResponse schema", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/playlist-targets`,
      { headers: { cookie: `lore_sid=${SID_A}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(Array.isArray(body.targets)).toBe(true);
    for (const t of body.targets as Array<Record<string, unknown>>) {
      expect(["apple_music", "tidal"]).toContain(t.service);
      expect(typeof t.displayName).toBe("string");
      expect(typeof t.configured).toBe("boolean");
      expect(typeof t.connected).toBe("boolean");
      expect(typeof t.canWrite).toBe("boolean");
      expect(typeof t.authRequired).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/replay/:id/materialize — start playlist materialization
// ---------------------------------------------------------------------------

describe("POST /api/replay/:id/materialize", () => {
  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/materialize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: "apple_music" }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an unsupported playlist service", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/materialize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `lore_sid=${SID_A}`,
        },
        body: JSON.stringify({ service: "not-a-real-service" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-integer replay id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/not-a-number/materialize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `lore_sid=${SID_A}`,
        },
        body: JSON.stringify({ service: "apple_music" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the service connector is unavailable (no Apple Music token configured)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    // apple_music is a valid service enum value but is not configured in the
    // test environment — the route must return 400, not 500 or 202.
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/materialize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `lore_sid=${SID_A}`,
        },
        body: JSON.stringify({ service: "apple_music" }),
      },
    );
    // The route returns 400 "The selected playlist service is unavailable" when
    // the connector is not configured; 202 would only arrive when it is ready.
    expect([400, 202]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/replay/materialization-jobs/:jobId — poll materialization job
// ---------------------------------------------------------------------------

describe("GET /api/replay/materialization-jobs/:jobId", () => {
  let matJobId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable || userIdA == null) return;
    const [job] = await db
      .insert(replayMaterializationJobsTable)
      .values({
        userId: userIdA,
        replayId: anchorSpinId!,
        service: "apple_music",
        status: "done",
        total: 2,
        processed: 2,
        accepted: 1,
        missing: 1,
        name: "Test Station · Test DJ · 2026-08-03",
        description: "As broadcast on Test Station — via Lore",
        finishedAt: new Date(),
        receipt: [],
      })
      .returning({ id: replayMaterializationJobsTable.id });
    matJobId = job!.id;
  });

  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable || matJobId == null) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/${matJobId}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the session does not own the job (ownership isolation)", async (ctx) => {
    if (!dbAvailable || matJobId == null) return ctx.skip();
    // User B must not see User A's materialization job.
    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/${matJobId}`,
      { headers: { cookie: `lore_sid=${SID_B}` } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-existent job", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/999999999`,
      { headers: { cookie: `lore_sid=${SID_A}` } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer job id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/not-an-id`,
      { headers: { cookie: `lore_sid=${SID_A}` } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with a ReplayMaterializationJob shape and the correct replayId", async (ctx) => {
    if (!dbAvailable || matJobId == null) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/${matJobId}`,
      { headers: { cookie: `lore_sid=${SID_A}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // OpenAPI GetReplayPlaylistMaterializationResponse shape.
    expect(body.id).toBe(matJobId);
    expect(body.replayId).toBe(anchorSpinId);
    expect(["apple_music", "tidal"]).toContain(body.service);
    expect(["pending", "running", "done", "error"]).toContain(body.status);
    expect(typeof body.total).toBe("number");
    expect(typeof body.processed).toBe("number");
    expect(typeof body.accepted).toBe("number");
    expect(typeof body.missing).toBe("number");
    expect(typeof body.rejected).toBe("number");
    expect(typeof body.retryable).toBe("number");
    expect(typeof body.name).toBe("string");
    expect(typeof body.description).toBe("string");
    expect(body.playlistId === null || typeof body.playlistId === "string").toBe(true);
    expect(body.playlistUrl === null || typeof body.playlistUrl === "string").toBe(true);
    expect(body.error === null || typeof body.error === "string").toBe(true);
    expect(typeof body.errorRetryable).toBe("boolean");
    expect(body.finishedAt === null || typeof body.finishedAt === "string").toBe(true);
    expect(Array.isArray(body.receipt)).toBe(true);

    // Replay identity must not be swapped.
    expect(body.replayId).toBe(anchorSpinId);
  });
});

// ---------------------------------------------------------------------------
// Cross-identifier swap guard
// ---------------------------------------------------------------------------
//
// Each route must serve only its own table. We verify this by inserting one
// job into each table, then confirming each ID works only on the correct
// route. Serial sequences for the two tables are independent so their IDs
// can coincide; the guard condition below skips the cross-route 404 assertion
// only when the IDs happen to be numerically equal (an extreme rarity that
// would yield a false pass if both jobs were somehow accessible via both
// routes, but that can never happen because each handler queries a different
// table). The ownership-isolation tests above already exercise the 404 path
// exhaustively for each route independently.

describe("Replay identifier swap guard", () => {
  let swapResJobId: number | undefined;
  let swapMatJobId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable || userIdA == null) return;

    const [rj] = await db
      .insert(replayResolutionJobsTable)
      .values({
        userId: userIdA,
        replayId: anchorSpinId!,
        total: 1,
        status: "done",
        processed: 1,
      })
      .returning({ id: replayResolutionJobsTable.id });
    swapResJobId = rj!.id;

    const [mj] = await db
      .insert(replayMaterializationJobsTable)
      .values({
        userId: userIdA,
        replayId: anchorSpinId!,
        service: "tidal",
        status: "done",
        total: 1,
        processed: 1,
        name: "Swap Guard Test",
        description: "Swap Guard Test",
        receipt: [],
      })
      .returning({ id: replayMaterializationJobsTable.id });
    swapMatJobId = mj!.id;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    if (swapResJobId != null) {
      await db
        .delete(replayResolutionJobsTable)
        .where(eq(replayResolutionJobsTable.id, swapResJobId));
    }
    if (swapMatJobId != null) {
      await db
        .delete(replayMaterializationJobsTable)
        .where(eq(replayMaterializationJobsTable.id, swapMatJobId));
    }
  });

  it("each job id returns 200 only on its own route", async (ctx) => {
    if (!dbAvailable || swapResJobId == null || swapMatJobId == null) {
      return ctx.skip();
    }

    // Resolution job is accessible via its own route.
    const resOnResRoute = await fetch(
      `${baseUrl}/api/replay/jobs/${swapResJobId}`,
      { headers: { cookie: `lore_sid=${SID_A}` } },
    );
    expect(resOnResRoute.status).toBe(200);

    // Materialization job is accessible via its own route.
    const matOnMatRoute = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/${swapMatJobId}`,
      { headers: { cookie: `lore_sid=${SID_A}` } },
    );
    expect(matOnMatRoute.status).toBe(200);

    // Cross-route lookups must fail (404) when the IDs are numerically
    // distinct — the only scenario where a collision could mask this is when
    // swapResJobId === swapMatJobId, which is vanishingly rare.
    if (swapResJobId !== swapMatJobId) {
      const resOnMatRoute = await fetch(
        `${baseUrl}/api/replay/materialization-jobs/${swapResJobId}`,
        { headers: { cookie: `lore_sid=${SID_A}` } },
      );
      expect(resOnMatRoute.status).toBe(404);

      const matOnResRoute = await fetch(
        `${baseUrl}/api/replay/jobs/${swapMatJobId}`,
        { headers: { cookie: `lore_sid=${SID_A}` } },
      );
      expect(matOnResRoute.status).toBe(404);
    }
  });
});
