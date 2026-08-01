/**
 * End-to-end integration test: full import-then-retry cycle.
 *
 * Confirms the handoff between runImportWorker and runPhase3RetryPass:
 *
 *   1. runImportWorker with a MB resolver that throws (503 simulation) seeds
 *      an unresolved track as a soft row in spotify_library_items and finishes
 *      with total > resolved.
 *
 *   2. runPhase3RetryPass, given a resolver that now succeeds, promotes the
 *      track to library_items and removes the soft row from
 *      spotify_library_items.
 *
 *   3. Final state: spotify_library_items is empty for this user, library_items
 *      contains exactly the resolved track.
 *
 * A regression in the handoff (e.g. the retry pass skipping the user because
 * of a stale negative-cache entry written by the failed initial pass) would be
 * caught here but not by the existing isolated tests.
 *
 * Self-skips (dbAvailable / softTableAvailable = false) when no real DB is
 * reachable, matching the pattern in phase3-promote-db.test.ts.
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, and, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  serviceConnectionsTable,
  libraryImportJobsTable,
  libraryItemsTable,
  recordingsTable,
  resolutionCacheTable,
  spotifyLibraryItemsTable,
} from "@workspace/db";

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const { mockImportLibrary, mockResolveByText, mockResolveByIsrc } = vi.hoisted(() => ({
  mockImportLibrary: vi.fn(),
  mockResolveByText: vi.fn<[string, string, (AbortSignal | undefined)?], Promise<string | null>>(),
  mockResolveByIsrc: vi.fn<[string, (AbortSignal | undefined)?], Promise<string | null>>(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

vi.mock("../src/lore/serviceConnector.js", () => ({
  getConnector: vi.fn().mockReturnValue({ importLibrary: mockImportLibrary }),
  getFreshServiceToken: vi.fn(),
  refreshServiceToken: vi.fn(),
}));

vi.mock("../src/lore/resolve.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lore/resolve.js")>();
  return { ...orig, resolveToMbid: vi.fn() };
});

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

// ── Deferred imports ──────────────────────────────────────────────────────────

import * as resolveModule from "../src/lore/resolve.js";
import { runImportWorker, runPhase3RetryPass } from "../src/routes/me/index.js";

// ── Test-run isolation ────────────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);

// Non-22-char externalId so seedSpotifySoftRows skips the Spotify /v1/tracks
// fetch entirely (the function only batches IDs matching /^[A-Za-z0-9]{22}$/).
const EXTERNAL_ID = `sp-e2e-${run}`;
const ARTIST      = `E2EArtist ${run}`;
const TITLE       = `E2ETrack ${run}`;
const MBID        = `e2e-mbid-${run}`;

// Constants for the negative-cache scenario (second describe block).
const EXTERNAL_ID_NEG = `sp-e2e-neg-${run}`;
const ARTIST_NEG      = `E2ENegArtist ${run}`;
const TITLE_NEG       = `E2ENegTrack ${run}`;

// Constants for the ISRC-keyed negative-cache scenario (third describe block).
const EXTERNAL_ID_ISRC = `sp-e2e-isrc-${run}`;
const ARTIST_ISRC      = `E2EIsrcArtist ${run}`;
const TITLE_ISRC       = `E2EIsrcTrack ${run}`;
const ISRC_VAL         = `TST${run.toUpperCase().slice(0, 9)}`;

let dbAvailable        = false;
let softTableAvailable = false;

let userId:  number;
let connRow: typeof serviceConnectionsTable.$inferSelect;

// ── Sleep bypass ──────────────────────────────────────────────────────────────

/**
 * Skip the 1 100 ms rate-limit sleeps so the worker/pass completes quickly.
 * Abort-controller timers (4 s / 12 s) are left intact — the mocked resolvers
 * resolve/reject as microtasks, well before those timers fire.
 */
function installSleepBypass() {
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  return vi.spyOn(globalThis, "setTimeout").mockImplementation(
    ((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (delay === 1100) {
        fn(...args);
        return 0 as unknown as NodeJS.Timeout;
      }
      return realSetTimeout(fn, delay, ...args);
    }) as typeof globalThis.setTimeout,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  try {
    await db.execute(sql`select 1 from spotify_library_items limit 0`);
    softTableAvailable = true;
  } catch {
    softTableAvailable = false;
    return;
  }

  // Isolated user for this test run.
  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `e2e-retry-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // Service connection (crypto is mocked to pass-through so plaintext token is fine).
  const [c] = await db
    .insert(serviceConnectionsTable)
    .values({
      userId,
      service: "spotify",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: "user-library-read",
      canWrite: false,
    })
    .returning();
  connRow = c!;
});

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (!dbAvailable || !softTableAvailable) return;

  // Remove soft rows (may already be gone if test passed).
  await db
    .delete(spotifyLibraryItemsTable)
    .where(eq(spotifyLibraryItemsTable.userId, userId))
    .catch(() => {});

  // Remove library_items for our MBID across all users (retry pass wrote it
  // for candidate.userId which equals userId).
  await db
    .delete(libraryItemsTable)
    .where(inArray(libraryItemsTable.mbid, [MBID]))
    .catch(() => {});

  // Remove all import jobs for this user.
  await db
    .delete(libraryImportJobsTable)
    .where(eq(libraryImportJobsTable.userId, userId))
    .catch(() => {});

  // Remove the resolution-cache entry written by the retry pass.
  const { normalizeKey } = resolveModule;
  await db
    .delete(resolutionCacheTable)
    .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST, TITLE)))
    .catch(() => {});

  // Remove the recordings row created by the retry pass.
  await db
    .delete(recordingsTable)
    .where(eq(recordingsTable.mbid, MBID))
    .catch(() => {});

  // Remove the service connection.
  if (connRow) {
    await db
      .delete(serviceConnectionsTable)
      .where(eq(serviceConnectionsTable.id, connRow.id))
      .catch(() => {});
  }

  // Remove the user.
  await db
    .delete(loreUsersTable)
    .where(eq(loreUsersTable.id, userId))
    .catch(() => {});
});

// ── Test ──────────────────────────────────────────────────────────────────────

const TEST_TIMEOUT = 30_000;

describe("end-to-end: confirmed negative-cache entry blocks retry pass (soft row kept)", () => {
  /**
   * When the initial import returns null (not a throw) for a track, it writes a
   * negative cache entry (mbid = null).  The retry pass must recognise that as
   * already-cached and not create a retry job.  The soft row must remain visible
   * in spotify_library_items rather than being silently orphaned.
   */
  afterAll(async () => {
    if (!dbAvailable || !softTableAvailable) return;
    // Clean up the negative cache entry written during this scenario.
    const { normalizeKey } = resolveModule;
    await db
      .delete(resolutionCacheTable)
      .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST_NEG, TITLE_NEG)))
      .catch(() => {});
    // Soft row and import jobs for userId are cleaned by the outer afterAll.
  });

  it(
    "keeps the soft row and skips the retry job when a negative cache entry exists",
    async () => {
      if (!dbAvailable || !softTableAvailable) return;

      // ── Step 1: initial import — MB returns null (confirmed miss).
      //    This writes a negative cache entry (mbid = null) and leaves the
      //    track as an unresolved soft row in spotify_library_items. ─────────

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // Confirmed miss: resolveByText returns null (not a throw).
      // Unlike the sibling test, this WILL write a negative cache entry.
      mockResolveByText.mockResolvedValue(null);
      mockResolveByIsrc.mockResolvedValue(null);

      mockImportLibrary.mockImplementation(async function* () {
        yield { artist: ARTIST_NEG, title: TITLE_NEG, externalId: EXTERNAL_ID_NEG };
      });

      const [j] = await db
        .insert(libraryImportJobsTable)
        .values({
          userId,
          service: "spotify",
          status: "pending",
          total: 0,
          resolved: 0,
          startedAt: new Date(),
        })
        .returning({ id: libraryImportJobsTable.id });
      const jobId = j!.id;

      const sleepSpy1 = installSleepBypass();
      try {
        await runImportWorker(jobId, userId, "spotify", connRow);
      } finally {
        sleepSpy1.mockRestore();
      }

      // ── Step 1 assertions ─────────────────────────────────────────────────

      // Import job must have finished with total > resolved (track unresolved).
      const [importJob] = await db
        .select({
          status:   libraryImportJobsTable.status,
          total:    libraryImportJobsTable.total,
          resolved: libraryImportJobsTable.resolved,
        })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jobId));
      expect(importJob!.status).toBe("done");
      expect(importJob!.total).toBe(1);
      expect(importJob!.resolved).toBe(0);

      // The soft row must be present.
      const softAfterImport = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.spotifyId, EXTERNAL_ID_NEG),
          ),
        );
      expect(softAfterImport.length).toBe(1);

      // The track must NOT be in library_items.
      const libAfterImport = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      const mbidsAfterImport = libAfterImport.map((r) => r.mbid);
      // No positive MBID was resolved, so library_items must be empty for user.
      expect(mbidsAfterImport.length).toBe(0);

      // A negative cache entry (mbid = null) must exist for the track key.
      const { normalizeKey } = resolveModule;
      const cacheAfterImport = await db
        .select({ mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST_NEG, TITLE_NEG)));
      expect(cacheAfterImport.length).toBe(1);
      expect(cacheAfterImport[0]!.mbid).toBeNull();

      // ── Step 2: retry pass — the negative cache entry must prevent a retry
      //    job from being created; the soft row must survive intact. ──────────

      // Count jobs before the pass to detect any new insertions.
      const jobsBefore = await db
        .select({ id: libraryImportJobsTable.id })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.userId, userId));
      const jobCountBefore = jobsBefore.length;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      const sleepSpy2 = installSleepBypass();
      try {
        await runPhase3RetryPass();
      } finally {
        sleepSpy2.mockRestore();
      }

      // ── Step 2 assertions ─────────────────────────────────────────────────

      // No new import job must have been created for this user.
      const jobsAfter = await db
        .select({ id: libraryImportJobsTable.id })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.userId, userId));
      expect(jobsAfter.length).toBe(jobCountBefore);

      // The soft row must still be present (not silently orphaned).
      const softAfterRetry = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.spotifyId, EXTERNAL_ID_NEG),
          ),
        );
      expect(softAfterRetry.length).toBe(1);

      // library_items must still not contain the track.
      const libAfterRetry = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libAfterRetry.length).toBe(0);

      // Resolver must not have been called (track was served from cache).
      expect(mockResolveByText).not.toHaveBeenCalled();
      expect(mockResolveByIsrc).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT,
  );
});

describe("end-to-end: ISRC-keyed negative cache entry blocks retry pass (soft row kept)", () => {
  /**
   * When the initial import resolves a track via ISRC and resolveByIsrc returns
   * null, it writes a negative cache entry keyed by isrcKey(isrc).  The retry
   * pass must recognise that ISRC-keyed entry as already-cached and not create
   * a retry job.  The soft row must remain intact.
   */
  afterAll(async () => {
    if (!dbAvailable || !softTableAvailable) return;
    const { isrcKey } = resolveModule;
    await db
      .delete(resolutionCacheTable)
      .where(eq(resolutionCacheTable.key, isrcKey(ISRC_VAL)))
      .catch(() => {});
    const { normalizeKey } = resolveModule;
    await db
      .delete(resolutionCacheTable)
      .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST_ISRC, TITLE_ISRC)))
      .catch(() => {});
    // Soft row and import jobs for userId are cleaned by the outer afterAll.
  });

  it(
    "keeps the soft row and skips the retry job when only an ISRC-keyed negative cache entry exists",
    async () => {
      if (!dbAvailable || !softTableAvailable) return;

      // ── Step 1: initial import — resolveByIsrc returns null (confirmed miss).
      //    This writes a negative cache entry keyed by isrcKey(isrc) and leaves
      //    the track as an unresolved soft row in spotify_library_items. ───────

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // Confirmed miss via ISRC path: resolveByIsrc returns null (not a throw).
      // resolveByText also returns null so both negative entries are written.
      mockResolveByIsrc.mockResolvedValue(null);
      mockResolveByText.mockResolvedValue(null);

      mockImportLibrary.mockImplementation(async function* () {
        yield {
          artist:     ARTIST_ISRC,
          title:      TITLE_ISRC,
          externalId: EXTERNAL_ID_ISRC,
          isrc:       ISRC_VAL,
        };
      });

      const [j] = await db
        .insert(libraryImportJobsTable)
        .values({
          userId,
          service:   "spotify",
          status:    "pending",
          total:     0,
          resolved:  0,
          startedAt: new Date(),
        })
        .returning({ id: libraryImportJobsTable.id });
      const jobId = j!.id;

      const sleepSpy1 = installSleepBypass();
      try {
        await runImportWorker(jobId, userId, "spotify", connRow);
      } finally {
        sleepSpy1.mockRestore();
      }

      // ── Step 1 assertions ─────────────────────────────────────────────────

      const [importJob] = await db
        .select({
          status:   libraryImportJobsTable.status,
          total:    libraryImportJobsTable.total,
          resolved: libraryImportJobsTable.resolved,
        })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jobId));
      expect(importJob!.status).toBe("done");
      expect(importJob!.total).toBe(1);
      expect(importJob!.resolved).toBe(0);

      // The soft row must be present.
      const softAfterImport = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.spotifyId, EXTERNAL_ID_ISRC),
          ),
        );
      expect(softAfterImport.length).toBe(1);

      // The ISRC-keyed negative cache entry must exist (mbid = null).
      const { isrcKey } = resolveModule;
      const isrcCacheAfterImport = await db
        .select({ mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, isrcKey(ISRC_VAL)));
      expect(isrcCacheAfterImport.length).toBe(1);
      expect(isrcCacheAfterImport[0]!.mbid).toBeNull();

      // Remove the artist+title text-key entry so the retry pass must rely
      // solely on the ISRC key to determine the track is cached.
      const { normalizeKey: normalizeKeyLocal } = resolveModule;
      await db
        .delete(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, normalizeKeyLocal(ARTIST_ISRC, TITLE_ISRC)));

      // Confirm the text key is gone before the retry pass runs.
      const textCacheAfterPrune = await db
        .select({ key: resolutionCacheTable.key })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, normalizeKeyLocal(ARTIST_ISRC, TITLE_ISRC)));
      expect(textCacheAfterPrune.length).toBe(0);

      // Confirm the ISRC key is still present — this is the sole cache signal.
      const isrcCacheBeforeRetry = await db
        .select({ mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, isrcKey(ISRC_VAL)));
      expect(isrcCacheBeforeRetry.length).toBe(1);
      expect(isrcCacheBeforeRetry[0]!.mbid).toBeNull();

      // ── Step 2: retry pass — the ISRC-keyed negative cache entry must prevent
      //    a retry job from being created; the soft row must survive. ──────────

      const jobsBefore = await db
        .select({ id: libraryImportJobsTable.id })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.userId, userId));
      const jobCountBefore = jobsBefore.length;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      const sleepSpy2 = installSleepBypass();
      try {
        await runPhase3RetryPass();
      } finally {
        sleepSpy2.mockRestore();
      }

      // ── Step 2 assertions ─────────────────────────────────────────────────

      // No new import job must have been created for this user.
      const jobsAfter = await db
        .select({ id: libraryImportJobsTable.id })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.userId, userId));
      expect(jobsAfter.length).toBe(jobCountBefore);

      // The soft row must still be present (not silently orphaned).
      const softAfterRetry = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.spotifyId, EXTERNAL_ID_ISRC),
          ),
        );
      expect(softAfterRetry.length).toBe(1);

      // library_items must not contain this track.
      const libAfterRetry = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libAfterRetry.length).toBe(0);

      // Resolver must not have been called (track was served from cache).
      expect(mockResolveByText).not.toHaveBeenCalled();
      expect(mockResolveByIsrc).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT,
  );
});

describe("end-to-end: import worker seeds soft row, retry pass promotes it", () => {
  it(
    "leaves spotify_library_items empty and library_items populated after a full cycle",
    async () => {
      if (!dbAvailable || !softTableAvailable) return;

      // ── Step 1: initial import — MB throws (503), so no negative cache is
      //    written and the track ends up as an unresolved soft row. ─────────

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // Simulate a transient MB failure so the import worker sets
      // resolveErrored=true and does NOT write a negative cache entry.
      // Without this guard, the retry pass would see a cached miss and skip
      // the track, which is the regression this test defends against.
      mockResolveByText.mockRejectedValue(new Error("MB 503 – simulated transient failure"));
      mockResolveByIsrc.mockResolvedValue(null);

      // Connector yields one track. EXTERNAL_ID is intentionally short
      // (non-22-char) so seedSpotifySoftRows bypasses the Spotify /v1/tracks
      // API call and inserts the row with null artwork directly.
      mockImportLibrary.mockImplementation(async function* () {
        yield { artist: ARTIST, title: TITLE, externalId: EXTERNAL_ID };
      });

      // Create a pending job as the route handler would.
      const [j] = await db
        .insert(libraryImportJobsTable)
        .values({
          userId,
          service: "spotify",
          status: "pending",
          total: 0,
          resolved: 0,
          startedAt: new Date(),
        })
        .returning({ id: libraryImportJobsTable.id });
      const jobId = j!.id;

      const sleepSpy1 = installSleepBypass();
      try {
        await runImportWorker(jobId, userId, "spotify", connRow);
      } finally {
        sleepSpy1.mockRestore();
      }

      // ── Step 1 assertions ─────────────────────────────────────────────────

      // The import job must have finished with total > resolved.
      const [importJob] = await db
        .select({
          status:   libraryImportJobsTable.status,
          total:    libraryImportJobsTable.total,
          resolved: libraryImportJobsTable.resolved,
        })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jobId));
      expect(importJob!.status).toBe("done");
      expect(importJob!.total).toBe(1);
      expect(importJob!.resolved).toBe(0);

      // The unresolved track must appear as a soft row.
      const softAfterImport = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.spotifyId, EXTERNAL_ID),
          ),
        );
      expect(softAfterImport.length).toBe(1);

      // The track must NOT yet be in library_items.
      const libAfterImport = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libAfterImport.map((r) => r.mbid)).not.toContain(MBID);

      // No negative cache entry must exist (a cached miss would prevent the
      // retry pass from picking up the track).
      const { normalizeKey } = resolveModule;
      const cacheAfterImport = await db
        .select({ mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST, TITLE)));
      expect(cacheAfterImport.length).toBe(0);

      // ── Step 2: retry pass — MB now succeeds, promoting the soft row. ─────

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      mockResolveByText.mockResolvedValue(MBID);
      mockResolveByIsrc.mockResolvedValue(null);

      const sleepSpy2 = installSleepBypass();
      try {
        await runPhase3RetryPass();
      } finally {
        sleepSpy2.mockRestore();
      }

      // ── Step 2 assertions ─────────────────────────────────────────────────

      // The soft row must be gone.
      const softAfterRetry = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.spotifyId, EXTERNAL_ID),
          ),
        );
      expect(softAfterRetry.length).toBe(0);

      // The track must now be in library_items.
      const libAfterRetry = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, userId),
            eq(libraryItemsTable.mbid, MBID),
          ),
        );
      expect(libAfterRetry.length).toBe(1);
      expect(libAfterRetry[0]!.mbid).toBe(MBID);

      // A positive resolution-cache entry must have been written.
      const cacheAfterRetry = await db
        .select({ mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST, TITLE)));
      expect(cacheAfterRetry.length).toBeGreaterThanOrEqual(1);
      expect(cacheAfterRetry[0]!.mbid).toBe(MBID);
    },
    TEST_TIMEOUT,
  );
});
