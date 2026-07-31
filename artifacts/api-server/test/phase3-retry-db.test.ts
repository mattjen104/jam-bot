/**
 * Integration tests for the off-peak Phase 3 retry scheduler.
 *
 * Confirms that runPhase3RetryPass:
 *   1. Creates a retry job and resolves un-cached tracks into library_items.
 *   2. Skips tracks whose keys already have a resolution_cache row (positive
 *      OR negative) — no retry job is created when all tracks are cached.
 *   3. Truly un-cached tracks get resolved and written to library_items +
 *      resolution_cache.
 *   4. Skips a user when a live import (status "running" or "pending") is
 *      already active for that user+service.
 *
 * Self-skips when no real DB is available.
 *
 * Performance note: runPhase3RetryPass is a global scan and may encounter jobs
 * from other test files (e.g. error-storm tracks that were never cached).  We
 * spy on setTimeout and immediately invoke 1100 ms rate-limit sleeps so the
 * extra processing is fast.  Abort-controller timers (4 s / 12 s) are left to
 * run naturally — the mocked resolveByText resolves as a microtask, so
 * clearTimeout cancels them well before they fire.
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, inArray, and } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  serviceConnectionsTable,
  libraryImportJobsTable,
  libraryItemsTable,
  recordingsTable,
  resolutionCacheTable,
} from "@workspace/db";

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const { mockResolveByText, mockResolveByIsrc } = vi.hoisted(() => ({
  mockResolveByText: vi.fn<[string, string, (AbortSignal | undefined)?], Promise<string | null>>(),
  mockResolveByIsrc: vi.fn<[string, (AbortSignal | undefined)?], Promise<string | null>>(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────

// Pass-through token crypto (not used by retry pass, but evaluated on module load).
vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

vi.mock("../src/lore/serviceConnector.js", () => ({
  getConnector: vi.fn().mockReturnValue({ importLibrary: vi.fn() }),
  getFreshServiceToken: vi.fn(),
  refreshServiceToken: vi.fn(),
}));

vi.mock("../src/lore/resolve.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lore/resolve.js")>();
  return { ...orig, resolveToMbid: vi.fn() };
});

// Phase 3 retry uses createMbResolver() — mock the factory to return controlled spies.
vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...orig,
    createMbResolver: vi.fn().mockReturnValue({
      resolveByIsrc: mockResolveByIsrc,
      resolveByText: mockResolveByText,
    }),
  };
});

// Stub transitive imports loaded when the me-router module initialises.
vi.mock("../src/lore/userSession.js", () => ({
  getUserFromSession: vi.fn(),
  sidFromRequest: vi.fn(),
  upsertLoreUserForSid: vi.fn(),
}));
vi.mock("../src/lore/spotifyConnect.js", () => ({
  fetchProfile: vi.fn(),
  resolveSpotifyTrack: vi.fn(),
  trackIdFromUri: vi.fn(),
}));
vi.mock("../src/lore/for-you.js", () => ({
  getForYouStations: vi.fn(),
  getForYouBlogs: vi.fn(),
}));

// ── Deferred imports ─────────────────────────────────────────────────────────

import * as resolveModule from "../src/lore/resolve.js";
import { runPhase3RetryPass } from "../src/routes/me/index.js";

// ── Test-run-scoped IDs ──────────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);

// Each describe block uses a distinct set of MBIDs and a distinct userId so
// runPhase3RetryPass (which scans all users) produces no cross-test interference.
const MBID_UNCACHED  = `retry-uc-${run}`;   // track that has no cache entry
const MBID_CACHED_P  = `retry-cp-${run}`;   // track with a POSITIVE cache entry
const MBID_CACHED_N  = `retry-cn-${run}`;   // track with a NEGATIVE cache entry
const MBID_BLOCKED   = `retry-bl-${run}`;   // track for the "blocked by live job" test

const ALL_TEST_MBIDS = [MBID_UNCACHED, MBID_CACHED_P, MBID_CACHED_N, MBID_BLOCKED];

const ARTIST = `RetryWorker ${run}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Spy on setTimeout and immediately fire callbacks whose delay is exactly
 * IMPORT_RESOLVE_DELAY_MS (1100 ms) — the per-track rate-limit sleep in both
 * the import worker and the retry pass.  Abort-controller timers (4 s / 12 s)
 * are left intact; the mocked resolvers resolve as micro-tasks so clearTimeout
 * cancels those timers before they ever fire.
 *
 * This is necessary because runPhase3RetryPass is a global scan and may pick up
 * jobs from other test users, each requiring a 1.1 s sleep per track.
 */
function installSleepBypass() {
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
    ((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (delay === 1100) {
        fn(...args);
        return 0 as unknown as NodeJS.Timeout;
      }
      return realSetTimeout(fn, delay, ...args);
    }) as typeof globalThis.setTimeout,
  );
  return spy;
}

// ── DB state ─────────────────────────────────────────────────────────────────

let dbAvailable = false;

// One lore_users row per isolation group so the global retry scan can't create
// cross-test interference via shared userId.
let userIdUncached: number;
let userIdCached: number;
let userIdBlocked: number;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Create three distinct users — one per isolation group.
  const [u1] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `retry-uc-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userIdUncached = u1!.id;

  const [u2] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `retry-cp-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userIdCached = u2!.id;

  const [u3] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `retry-bl-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userIdBlocked = u3!.id;

  // Insert recordings spine rows so library_items FK constraints are satisfied.
  await db.insert(recordingsTable).values([
    { mbid: MBID_UNCACHED, title: "Uncached Track", artist: ARTIST },
    { mbid: MBID_CACHED_P, title: "CachedPos Track", artist: ARTIST },
    { mbid: MBID_CACHED_N, title: "CachedNeg Track", artist: ARTIST },
    { mbid: MBID_BLOCKED,  title: "Blocked Track",   artist: ARTIST },
  ]);

  // Seed the resolution_cache entries used by the "cached" isolation group.
  const { normalizeKey } = resolveModule;
  await db
    .insert(resolutionCacheTable)
    .values([
      // Positive cache entry for CachedPos Track.
      { key: normalizeKey(ARTIST, "CachedPos Track"), mbid: MBID_CACHED_P },
      // Negative cache entry for CachedNeg Track (mbid = null → confirmed miss).
      { key: normalizeKey(ARTIST, "CachedNeg Track"), mbid: null },
    ])
    .onConflictDoNothing();
});

afterAll(async () => {
  if (!dbAvailable) return;

  const allUserIds = [userIdUncached, userIdCached, userIdBlocked].filter(Boolean);

  // Delete library_items for ALL users that reference any of our test MBIDs.
  // This covers rows inserted by runPhase3RetryPass for users outside our
  // three test accounts (e.g. pre-existing users that have un-cached tracks in
  // the shared test DB and were processed during the retry scan).
  await db
    .delete(libraryItemsTable)
    .where(inArray(libraryItemsTable.mbid, ALL_TEST_MBIDS));

  // Now clean up jobs and users.
  if (allUserIds.length > 0) {
    await db
      .delete(libraryImportJobsTable)
      .where(inArray(libraryImportJobsTable.userId, allUserIds));
    await db
      .delete(serviceConnectionsTable)
      .where(inArray(serviceConnectionsTable.userId, allUserIds));
  }

  const { normalizeKey } = resolveModule;
  await db
    .delete(resolutionCacheTable)
    .where(
      inArray(resolutionCacheTable.key, [
        normalizeKey(ARTIST, "CachedPos Track"),
        normalizeKey(ARTIST, "CachedNeg Track"),
        normalizeKey(ARTIST, "Uncached Track"),
        normalizeKey(ARTIST, "Blocked Track"),
      ]),
    );

  // Recordings can only be removed after all library_items referencing them are gone.
  await db
    .delete(recordingsTable)
    .where(inArray(recordingsTable.mbid, ALL_TEST_MBIDS));

  if (allUserIds.length > 0) {
    await db
      .delete(loreUsersTable)
      .where(inArray(loreUsersTable.id, allUserIds));
  }
});

// ── Helper ───────────────────────────────────────────────────────────────────

/** Insert a completed import job with the given buffer and resolution counters. */
async function insertDoneJob(
  userId: number,
  bufferEntries: Array<{ artist: string; title: string; isrc?: string; externalId: string }>,
  opts: { total: number; resolved: number },
): Promise<number> {
  const [job] = await db
    .insert(libraryImportJobsTable)
    .values({
      userId,
      service: "spotify",
      status: "done",
      phase: "resolve",
      total: opts.total,
      resolved: opts.resolved,
      bufferJson: bufferEntries,
      startedAt: new Date(),
      finishedAt: new Date(),
    })
    .returning({ id: libraryImportJobsTable.id });
  return job!.id;
}

// ── Test 1 + 3: retry triggered, un-cached track resolved ───────────────────
//
// A completed job with total > resolved and a bufferJson entry that has NO
// resolution_cache row should:
//   • trigger creation of a new retry job, AND
//   • resolve the track and write it to library_items + resolution_cache.

describe("runPhase3RetryPass — triggers retry job and resolves un-cached track", () => {
  it(
    "creates a retry job and writes the resolved track to library_items",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      // resolveByText finds the track; returning MBID_UNCACHED which exists in recordings.
      mockResolveByText.mockResolvedValue(MBID_UNCACHED);

      // Completed import: 1 track fetched, 0 resolved (MB was down originally).
      const sourceJobId = await insertDoneJob(
        userIdUncached,
        [{ artist: ARTIST, title: "Uncached Track", externalId: "sp-uc-1" }],
        { total: 1, resolved: 0 },
      );

      const spy = installSleepBypass();
      try {
        await runPhase3RetryPass();
      } finally {
        spy.mockRestore();
      }

      // A retry job should have been created for this user.
      const allJobs = await db
        .select({
          id: libraryImportJobsTable.id,
          status: libraryImportJobsTable.status,
          resolved: libraryImportJobsTable.resolved,
          total: libraryImportJobsTable.total,
        })
        .from(libraryImportJobsTable)
        .where(
          and(
            eq(libraryImportJobsTable.userId, userIdUncached),
            eq(libraryImportJobsTable.service, "spotify"),
          ),
        );

      // There should be the original source job PLUS the new retry job.
      const retryJob = allJobs.find((j) => j.id !== sourceJobId);
      expect(retryJob, "retry job should have been created").toBeDefined();
      expect(retryJob!.status).toBe("done");
      expect(retryJob!.total).toBe(1);
      expect(retryJob!.resolved).toBe(1);

      // The track must appear in library_items for this user.
      const items = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userIdUncached));
      expect(items.map((r) => r.mbid)).toContain(MBID_UNCACHED);

      // resolution_cache must have a positive entry for the track.
      const { normalizeKey } = resolveModule;
      const cacheRows = await db
        .select({ mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST, "Uncached Track")));
      expect(cacheRows.length).toBeGreaterThanOrEqual(1);
      expect(cacheRows[0]!.mbid).toBe(MBID_UNCACHED);
    },
    // With the 1100 ms sleep fast-forwarded, the only real time is DB round-trips.
    30_000,
  );
});

// ── Test 2: cached tracks (positive AND negative) are skipped ────────────────
//
// A completed job whose buffer tracks already have resolution_cache entries
// (one positive, one negative) should produce NO retry job — the pass skips
// because uncachedEntries.length === 0.

describe("runPhase3RetryPass — skips tracks already in resolution_cache", () => {
  it("does not create a retry job when all buffer tracks are already cached", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // Both tracks in the buffer have been seeded in resolution_cache (positive
    // for CachedPos, negative for CachedNeg — both count as "cached").
    const sourceJobId = await insertDoneJob(
      userIdCached,
      [
        { artist: ARTIST, title: "CachedPos Track", externalId: "sp-cp-1" },
        { artist: ARTIST, title: "CachedNeg Track", externalId: "sp-cn-1" },
      ],
      { total: 2, resolved: 0 },
    );

    const spy = installSleepBypass();
    try {
      await runPhase3RetryPass();
    } finally {
      spy.mockRestore();
    }

    // No retry job should have been created — only the original source job exists.
    const jobs = await db
      .select({ id: libraryImportJobsTable.id })
      .from(libraryImportJobsTable)
      .where(
        and(
          eq(libraryImportJobsTable.userId, userIdCached),
          eq(libraryImportJobsTable.service, "spotify"),
        ),
      );

    expect(jobs.length).toBe(1);
    expect(jobs[0]!.id).toBe(sourceJobId);

    // No resolve calls should have been made for this user's tracks.
    // (Other users' uncached tracks may still trigger calls from the global scan.)
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userIdCached));
    expect(items.map((r) => r.mbid)).not.toContain(MBID_CACHED_P);
    expect(items.map((r) => r.mbid)).not.toContain(MBID_CACHED_N);
  },
  30_000,
  );
});

// ── Test 4: live running import blocks the retry ─────────────────────────────
//
// When a "running" or "pending" import job already exists for the user+service,
// the retry pass must skip that user entirely — no new retry job is created.

describe("runPhase3RetryPass — skips when a live import is already running", () => {
  it("does not create a retry job when a live import job is active", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();
    mockResolveByText.mockResolvedValue(MBID_BLOCKED); // would resolve if not blocked

    // 1. The already-running import job (blocks the retry).
    const [liveJobRow] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId: userIdBlocked,
        service: "spotify",
        status: "running",
        total: 10,
        resolved: 5,
        startedAt: new Date(),
      })
      .returning({ id: libraryImportJobsTable.id });
    const liveJobId = liveJobRow!.id;

    // 2. The completed source job with un-cached tracks (would normally trigger retry).
    const sourceJobId = await insertDoneJob(
      userIdBlocked,
      [{ artist: ARTIST, title: "Blocked Track", externalId: "sp-bl-1" }],
      { total: 1, resolved: 0 },
    );

    const spy = installSleepBypass();
    try {
      await runPhase3RetryPass();
    } finally {
      spy.mockRestore();
    }

    // Only the live job and the source job must exist — no new retry job.
    const jobs = await db
      .select({ id: libraryImportJobsTable.id })
      .from(libraryImportJobsTable)
      .where(
        and(
          eq(libraryImportJobsTable.userId, userIdBlocked),
          eq(libraryImportJobsTable.service, "spotify"),
        ),
      );

    const ids = jobs.map((j) => j.id).sort((a, b) => a - b);
    const expectedIds = [liveJobId, sourceJobId].sort((a, b) => a - b);
    expect(ids).toEqual(expectedIds);

    // Blocked track must NOT appear in library_items for this user.
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userIdBlocked));
    expect(items.map((r) => r.mbid)).not.toContain(MBID_BLOCKED);
  },
  30_000,
  );
});
