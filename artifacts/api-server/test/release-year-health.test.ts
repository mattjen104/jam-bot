// @vitest-environment node
/**
 * Unit/integration tests for:
 *
 *   1. GET /admin/release-year-health — verifies the three-bucket COUNT query
 *      maps to the correct response fields (totalNull, inQueue, permMiss).
 *      Drizzle is mocked so no real DB is needed.
 *
 *   2. backfillReleaseYearBatch — verifies that a transient MB 5xx / network
 *      error does NOT advance year_checked_at (the retry-sentinel stays NULL).
 *      Both drizzle and the MB resolver are mocked so no real DB is needed.
 *
 * DB state modelled by the endpoint assertions:
 *   - Row A: release_year set                          → appears in NO bucket
 *   - Row B: release_year NULL + year_checked_at NULL  → appears in inQueue
 *   - Row C: release_year NULL + year_checked_at set   → appears in permMiss
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { createServer } from "node:http";

// ---------------------------------------------------------------------------
// Hoist mocks — must be evaluated before the module graph is resolved.
// ---------------------------------------------------------------------------

const { mockFetchReleaseYear } = vi.hoisted(() => ({
  mockFetchReleaseYear: vi.fn<[string, AbortSignal?], Promise<number | null>>(),
}));

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: mockDbSelect,
      update: mockDbUpdate,
      insert: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
    },
  };
});

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...actual,
    musicbrainzEnabled: () => true,
    createMbResolver: () => ({
      fetchReleaseYear: mockFetchReleaseYear,
      fetchIsrcByMbid: vi.fn().mockResolvedValue(null),
      resolveByIsrc: vi.fn().mockResolvedValue(null),
      resolveByText: vi.fn().mockResolvedValue(null),
      resolveByTextWithScore: vi.fn().mockResolvedValue(null),
    }),
  };
});

// ---------------------------------------------------------------------------
// Spin up the admin router on a local HTTP server.
// LORE_ADMIN_TOKEN must be set before the module is imported so the auth
// middleware closes over the configured value.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = `test-ryh-${randomUUID().slice(0, 8)}`;
process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

let serverUrl = "";
let server: ReturnType<typeof createServer> | null = null;

beforeAll(async () => {
  const { default: adminRouter } = await import("../src/routes/lore/admin.js");
  const app = express();
  app.use(express.json());
  app.use(adminRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper — set up a single db.select().from() mock return.
// The endpoint chain is: db.select({...}).from(recordingsTable) → rows[]
// ---------------------------------------------------------------------------

function mockHealthSelect(rows: Record<string, unknown>[]) {
  mockDbSelect.mockReturnValueOnce({
    from: () => Promise.resolve(rows),
  });
}

// ===========================================================================
// GET /admin/release-year-health
// ===========================================================================

describe("GET /admin/release-year-health", () => {
  it("maps DB totals to the correct response fields", async () => {
    // DB state: Row A (year set), Row B (inQueue), Row C (permMiss)
    // The three-bucket SQL counts only the null-year rows.
    mockHealthSelect([
      {
        totalNull: 2,        // Row B + Row C
        inQueue: 1,          // Row B only (null year, null checked_at, eligible)
        permMiss: 1,         // Row C only (null year, checked_at set)
        ineligible: 0,
        lastCheckedAt: null,
      },
    ]);

    const res = await fetch(`${serverUrl}/admin/release-year-health`, {
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // Row A (release_year set) must NOT appear in any bucket.
    expect(body.totalNull).toBe(2);
    // Row B (null year + null checked_at + has a spin) → inQueue
    expect(body.inQueue).toBe(1);
    // Row C (null year + checked_at set) → permMiss
    expect(body.permMiss).toBe(1);
    expect(body.ineligible).toBe(0);
    expect(body.lastCheckedAt).toBeNull();
  });

  it("exposes lastCheckedAt when the backfill has run at least once", async () => {
    const checkedAt = "2026-08-10T12:00:00.000Z";
    mockHealthSelect([
      {
        totalNull: 3,
        inQueue: 2,
        permMiss: 1,
        ineligible: 0,
        lastCheckedAt: checkedAt,
      },
    ]);

    const res = await fetch(`${serverUrl}/admin/release-year-health`, {
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.lastCheckedAt).toBe(checkedAt);
    expect(body.totalNull).toBe(3);
    expect(body.inQueue).toBe(2);
    expect(body.permMiss).toBe(1);
  });

  it("returns all-zero counts when every recording already has a release_year", async () => {
    mockHealthSelect([
      {
        totalNull: 0,
        inQueue: 0,
        permMiss: 0,
        ineligible: 0,
        lastCheckedAt: "2026-08-13T00:00:00.000Z",
      },
    ]);

    const res = await fetch(`${serverUrl}/admin/release-year-health`, {
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totalNull).toBe(0);
    expect(body.inQueue).toBe(0);
    expect(body.permMiss).toBe(0);
  });

  it("falls back to zero counts when the DB returns no rows", async () => {
    // Defensive: the ?? 0 coalescion in the handler guards against an empty
    // result set (e.g. recordings table is completely empty).
    mockHealthSelect([]);

    const res = await fetch(`${serverUrl}/admin/release-year-health`, {
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totalNull).toBe(0);
    expect(body.inQueue).toBe(0);
    expect(body.permMiss).toBe(0);
    expect(body.ineligible).toBe(0);
    expect(body.lastCheckedAt).toBeNull();
  });

  it("requires a valid admin token (auth gate)", async () => {
    const res = await fetch(`${serverUrl}/admin/release-year-health`, {
      headers: { "x-admin-token": "wrong-token" },
    });
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// backfillReleaseYearBatch — transient errors must not advance year_checked_at
// ===========================================================================

describe("backfillReleaseYearBatch — MB transient error does not advance sentinel", () => {
  it("does NOT call db.update when MB resolver throws a 5xx error", async () => {
    const { backfillReleaseYearBatch } = await import(
      "../src/lore/release-year-backfill.js"
    );

    // First select: target rows to process
    // Chain: db.select({mbid}).from().where().orderBy().limit() → rows[]
    mockDbSelect
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([{ mbid: "test-ryh-503-unit" }]),
            }),
          }),
        }),
      })
      // Second select: remaining count query after the loop
      // Chain: db.select({count}).from().where() → rows[]
      .mockReturnValueOnce({
        from: () => ({
          where: () => Promise.resolve([{ count: 1 }]),
        }),
      });

    // Simulate a transient MB 503 — should be treated as a retryable error.
    mockFetchReleaseYear.mockRejectedValueOnce(
      new Error("MusicBrainz 503 Service Unavailable"),
    );

    await backfillReleaseYearBatch(10);

    // The catch block must swallow the error and skip db.update entirely,
    // leaving year_checked_at NULL so the row is retried on the next tick.
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("does NOT call db.update when MB resolver throws a network error", async () => {
    const { backfillReleaseYearBatch } = await import(
      "../src/lore/release-year-backfill.js"
    );

    mockDbSelect
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([{ mbid: "test-ryh-net-unit" }]),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => Promise.resolve([{ count: 1 }]),
        }),
      });

    mockFetchReleaseYear.mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"));

    await backfillReleaseYearBatch(10);

    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("DOES call db.update with yearCheckedAt (but no releaseYear) when MB returns null (genuine no-date)", async () => {
    const { backfillReleaseYearBatch } = await import(
      "../src/lore/release-year-backfill.js"
    );

    const mockSet = vi.fn().mockReturnValue({ where: () => Promise.resolve() });
    mockDbUpdate.mockReturnValue({ set: mockSet });

    mockDbSelect
      // First select: one row to process
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([{ mbid: "test-ryh-nodate-unit" }]),
            }),
          }),
        }),
      })
      // Second select: remaining count — must still run after the null case
      .mockReturnValueOnce({
        from: () => ({
          where: () => Promise.resolve([{ count: 5 }]),
        }),
      });

    // Genuine MB "no date" — not an error, resolver resolved with null.
    mockFetchReleaseYear.mockResolvedValueOnce(null);

    const result = await backfillReleaseYearBatch(10);

    // Sentinel must be stamped — db.update called once.
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);

    const setPayload = mockSet.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(setPayload).toBeDefined();

    // yearCheckedAt MUST be set so the row is never re-queried.
    expect(setPayload).toHaveProperty("yearCheckedAt");

    // releaseYear must NOT be present — MB confirmed there is no date.
    expect(setPayload).not.toHaveProperty("releaseYear");

    // found counter stays 0 because no year was discovered.
    expect(result.found).toBe(0);

    // The remaining-count query must have run — result.remaining reflects it.
    expect(result.remaining).toBe(5);
  });

  it("DOES call db.update when MB resolver returns a definitive year", async () => {
    const { backfillReleaseYearBatch } = await import(
      "../src/lore/release-year-backfill.js"
    );

    const mockSet = vi.fn().mockReturnValue({ where: () => Promise.resolve() });
    mockDbUpdate.mockReturnValue({ set: mockSet });

    mockDbSelect
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([{ mbid: "test-ryh-hit-unit" }]),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => Promise.resolve([{ count: 0 }]),
        }),
      });

    mockFetchReleaseYear.mockResolvedValueOnce(1977);

    await backfillReleaseYearBatch(10);

    // db.update should have been called to stamp both releaseYear and yearCheckedAt.
    expect(mockDbUpdate).toHaveBeenCalled();
    const setCall = mockSet.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(setCall).toBeDefined();
    expect(setCall).toHaveProperty("releaseYear", 1977);
    expect(setCall).toHaveProperty("yearCheckedAt");
  });
});

// ===========================================================================
// startReleaseYearBackfillJob — tick scheduling
// ===========================================================================

describe("startReleaseYearBackfillJob — tick scheduling", () => {
  // Each test uses fake timers so we never wait for real 15s / 10min intervals.
  // vi.resetModules() ensures 'running' is reset to false between tests so
  // startReleaseYearBackfillJob() actually starts the loop each time.

  afterEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reschedules at ACTIVE_TICK_MS (15 s) when remaining > 0", async () => {
    vi.useFakeTimers();

    // --- DB mock for backfillReleaseYearBatch when remaining > 0 ---
    // Tick 1 — first select: one row to process, second select: 3 still remaining.
    const mockSet = vi.fn().mockReturnValue({ where: () => Promise.resolve() });
    mockDbUpdate.mockReturnValue({ set: mockSet });

    mockDbSelect
      // select rows to process
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([{ mbid: "test-sched-active" }]),
            }),
          }),
        }),
      })
      // remaining count after the loop → still work to do
      .mockReturnValueOnce({
        from: () => ({
          where: () => Promise.resolve([{ count: 3 }]),
        }),
      });

    mockFetchReleaseYear.mockResolvedValueOnce(1984);

    // Fresh module import so 'running = false' and the scheduler starts cleanly.
    const { startReleaseYearBackfillJob } = await import(
      "../src/lore/release-year-backfill.js"
    );

    // Spy on setTimeout to capture the delay used for the NEXT tick after
    // backfillReleaseYearBatch resolves inside the first scheduled tick.
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    startReleaseYearBackfillJob();

    // Capture the tick function from the very first setTimeout call (the boot
    // delay). The job creates tick once and reuses the same reference for every
    // reschedule, whereas AbortSignal.timeout() registers a different internal
    // callback. Matching by function identity therefore proves a real reschedule
    // rather than an abort-signal timer.
    const tickFn = setTimeoutSpy.mock.calls[0]?.[0];
    expect(tickFn).toBeTypeOf("function");

    // Advance past the initial ACTIVE_TICK_MS boot delay so the first tick runs.
    await vi.advanceTimersByTimeAsync(15_000);

    // Filter all setTimeout calls to those that used the tick function.
    // There must be exactly 2: the boot delay and the active reschedule.
    const tickCalls = setTimeoutSpy.mock.calls.filter((c) => c[0] === tickFn);
    expect(tickCalls).toHaveLength(2);
    // The second (reschedule) call must use ACTIVE_TICK_MS because remaining > 0.
    expect(tickCalls[1]?.[1]).toBe(15_000); // ACTIVE_TICK_MS
  });

  it("reschedules at IDLE_TICK_MS (10 min) when remaining === 0", async () => {
    vi.useFakeTimers();

    // Tick 1 — no rows to process, remaining = 0.
    mockDbSelect
      // select rows: empty batch
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      })
      // remaining count → queue is empty
      .mockReturnValueOnce({
        from: () => ({
          where: () => Promise.resolve([{ count: 0 }]),
        }),
      });

    const { startReleaseYearBackfillJob } = await import(
      "../src/lore/release-year-backfill.js"
    );

    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    startReleaseYearBackfillJob();

    await vi.advanceTimersByTimeAsync(15_000);

    const delays = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
    const rescheduleDelay = delays.at(-1);
    // remaining === 0 → job should idle at 10 minutes (600 000 ms)
    expect(rescheduleDelay).toBe(10 * 60_000); // IDLE_TICK_MS
  });
});
