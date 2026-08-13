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

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
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
