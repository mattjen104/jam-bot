/**
 * Integration tests for the retry-exhaustion state machine inside
 * runPhase3RetryPass.  Covers the three paths that the existing
 * phase3-retry-db.test.ts does not:
 *
 *   1. retryAttempts increments and retryExhausted is set to true after
 *      PHASE3_MAX_RETRY_ATTEMPTS (3) consecutive zero-resolved passes.
 *
 *   2. retryAttempts resets to 0 and retryExhausted clears when a pass
 *      resolves ≥ 1 track (MusicBrainz has recovered).
 *
 *   3. A hard MB error that causes the entire retry job to fail
 *      (retryPassFailed = true, outer try/catch) does NOT increment
 *      retryAttempts — the failure is infrastructure-level, not a
 *      definitive "not in MusicBrainz".
 *
 *   4. A source job with retryExhausted = true is excluded from the
 *      candidate query and no retry job is created for it.
 *
 * Self-skips when no real DB is available.
 *
 * Performance note: runPhase3RetryPass is a global DB scan and may pick up
 * other test users' jobs.  The 1100 ms rate-limit sleeps are fast-forwarded
 * by the installSleepBypass helper (same technique as phase3-retry-db.test.ts).
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, and, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  libraryImportJobsTable,
  libraryItemsTable,
  recordingsTable,
  resolutionCacheTable,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Hoisted mock factories — created before vi.mock() calls are evaluated.
// ---------------------------------------------------------------------------

const { mockResolveByText, mockResolveByIsrc, mockCreateMbResolver } = vi.hoisted(() => {
  const mockResolveByText = vi.fn<
    [string, string, (AbortSignal | undefined)?],
    Promise<string | null>
  >();
  const mockResolveByIsrc = vi.fn<
    [string, (AbortSignal | undefined)?],
    Promise<string | null>
  >();
  const mockCreateMbResolver = vi.fn(() => ({
    resolveByIsrc: mockResolveByIsrc,
    resolveByText: mockResolveByText,
  }));
  return { mockResolveByText, mockResolveByIsrc, mockCreateMbResolver };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return { ...orig, createMbResolver: mockCreateMbResolver };
});

vi.mock("../src/lore/userSession.js", () => ({
  getUserFromSession: vi.fn(),
  getOrCreateAnonymousUser: vi.fn(),
  recoverUserByServiceId: vi.fn(),
  sidFromRequest: vi.fn(),
  upsertLoreUserForSid: vi.fn(),
  SID_COOKIE: "lore_sid",
  SID_MAX_AGE_MS: 0,
  cookieSidOpts: vi.fn().mockReturnValue({}),
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

// ---------------------------------------------------------------------------
// Deferred imports — after all mocks are registered.
// ---------------------------------------------------------------------------

import * as resolveModule from "../src/lore/resolve.js";
import { runPhase3RetryPass } from "../src/routes/me/index.js";

// ---------------------------------------------------------------------------
// Per-run unique IDs — prevent cross-test or cross-run DB interference.
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);

const ARTIST = `ExhaustTest ${run}`;

/** One MBID per isolation group. */
const MBID_EXHAUST = `ex-exhaust-${run}`; // test 1: exhaustion path
const MBID_RESET   = `ex-reset-${run}`;   // test 2: success reset path
const MBID_HARDERR = `ex-harderr-${run}`; // test 3: hard error (outer try) path
const MBID_EXCL    = `ex-excl-${run}`;    // test 4: retryExhausted exclusion path

const ALL_MBIDS = [MBID_EXHAUST, MBID_RESET, MBID_HARDERR, MBID_EXCL];

/** Track titles per group — used to build resolution_cache keys in afterAll. */
const TITLES: Record<string, string> = {
  [MBID_EXHAUST]: "Exhaust Track",
  [MBID_RESET]:   "Reset Track",
  [MBID_HARDERR]: "HardErr Track",
  [MBID_EXCL]:    "Excl Track",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fast-forward setTimeout calls that carry the 1100 ms rate-limit delay used
 * between MB resolve calls, without touching AbortController timers.
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

/**
 * Insert a completed ("done") import job with the given buffer entries and
 * resolution counters, plus optional retry-exhaustion fields.
 */
async function insertDoneJob(
  userId: number,
  bufferEntries: Array<{ artist: string; title: string; externalId: string; isrc?: string }>,
  opts: {
    total: number;
    resolved: number;
    retryAttempts?: number;
    retryExhausted?: boolean;
  },
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
      retryAttempts: opts.retryAttempts ?? 0,
      retryExhausted: opts.retryExhausted ?? false,
      bufferJson: bufferEntries,
      startedAt: new Date(),
      finishedAt: new Date(),
    })
    .returning({ id: libraryImportJobsTable.id });
  return job!.id;
}

// ---------------------------------------------------------------------------
// DB state
// ---------------------------------------------------------------------------

let dbAvailable = false;

let userIdExhaust: number;
let userIdReset: number;
let userIdHardErr: number;
let userIdExcl: number;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const insertUser = async (tag: string): Promise<number> => {
    const [u] = await db
      .insert(loreUsersTable)
      .values({ spotifyUserId: `ex-${tag}-${run}`, deviceKey: randomUUID() })
      .returning({ id: loreUsersTable.id });
    return u!.id;
  };

  userIdExhaust = await insertUser("exhaust");
  userIdReset   = await insertUser("reset");
  userIdHardErr = await insertUser("harderr");
  userIdExcl    = await insertUser("excl");

  // Seed spine rows so library_items FK constraints are satisfied.
  await db.insert(recordingsTable).values(
    ALL_MBIDS.map((mbid) => ({ mbid, title: TITLES[mbid]!, artist: ARTIST })),
  );
});

afterAll(async () => {
  if (!dbAvailable) return;

  const userIds = [userIdExhaust, userIdReset, userIdHardErr, userIdExcl].filter(Boolean);

  // library_items first (FK to recordings).
  await db.delete(libraryItemsTable).where(inArray(libraryItemsTable.mbid, ALL_MBIDS));

  // Import jobs (FK to lore_users).
  if (userIds.length > 0) {
    await db
      .delete(libraryImportJobsTable)
      .where(inArray(libraryImportJobsTable.userId, userIds));
  }

  // resolution_cache keys written during the passes.
  const { normalizeKey } = resolveModule;
  await db
    .delete(resolutionCacheTable)
    .where(
      inArray(
        resolutionCacheTable.key,
        ALL_MBIDS.map((mbid) => normalizeKey(ARTIST, TITLES[mbid]!)),
      ),
    );

  // recordings — must come after library_items deletion.
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, ALL_MBIDS));

  // lore_users last.
  if (userIds.length > 0) {
    await db.delete(loreUsersTable).where(inArray(loreUsersTable.id, userIds));
  }
});

// ---------------------------------------------------------------------------
// Test 1 — Exhaustion: retryAttempts increments and retryExhausted is set
// ---------------------------------------------------------------------------
//
// A source job whose retryAttempts is already at PHASE3_MAX_RETRY_ATTEMPTS - 1
// (2) receives a zero-resolved pass (resolveByText returns null).  After the
// pass the source job must have retryAttempts = 3 and retryExhausted = true.

describe("runPhase3RetryPass — exhaustion: increments retryAttempts and sets retryExhausted after max zero-resolved passes", () => {
  it(
    "sets retryAttempts=3 and retryExhausted=true after the third consecutive zero-resolved pass",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      // MB returns no match — zero tracks resolved.
      mockResolveByText.mockResolvedValue(null);
      mockResolveByIsrc.mockResolvedValue(null);

      // Source job is already at attempt 2 (two prior failed passes).
      const sourceJobId = await insertDoneJob(
        userIdExhaust,
        [{ artist: ARTIST, title: "Exhaust Track", externalId: "sp-ex-1" }],
        { total: 1, resolved: 0, retryAttempts: 2 },
      );

      const spy = installSleepBypass();
      try {
        await runPhase3RetryPass();
      } finally {
        spy.mockRestore();
      }

      // The source job must now be marked exhausted.
      const [sourceJob] = await db
        .select({
          retryAttempts: libraryImportJobsTable.retryAttempts,
          retryExhausted: libraryImportJobsTable.retryExhausted,
        })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, sourceJobId));

      expect(sourceJob, "source job should still exist").toBeDefined();
      expect(sourceJob!.retryAttempts).toBe(3);
      expect(sourceJob!.retryExhausted).toBe(true);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Test 2 — Success reset: retryAttempts → 0, retryExhausted → false
// ---------------------------------------------------------------------------
//
// A source job at retryAttempts = 2 receives a pass that resolves ≥ 1 track
// (MusicBrainz has recovered).  retryAttempts must reset to 0 and
// retryExhausted must be cleared to false.

describe("runPhase3RetryPass — success reset: clears retryAttempts and retryExhausted when pass resolves ≥ 1 track", () => {
  it(
    "resets retryAttempts to 0 and retryExhausted to false after a successful pass",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      // MB now returns the MBID — one track resolved.
      mockResolveByText.mockResolvedValue(MBID_RESET);
      mockResolveByIsrc.mockResolvedValue(null);

      // Source job at attempt 2 — would be exhausted on the next zero-resolved pass.
      const sourceJobId = await insertDoneJob(
        userIdReset,
        [{ artist: ARTIST, title: "Reset Track", externalId: "sp-re-1" }],
        { total: 1, resolved: 0, retryAttempts: 2 },
      );

      const spy = installSleepBypass();
      try {
        await runPhase3RetryPass();
      } finally {
        spy.mockRestore();
      }

      // Source job counter must be cleared.
      const [sourceJob] = await db
        .select({
          retryAttempts: libraryImportJobsTable.retryAttempts,
          retryExhausted: libraryImportJobsTable.retryExhausted,
        })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, sourceJobId));

      expect(sourceJob, "source job should still exist").toBeDefined();
      expect(sourceJob!.retryAttempts).toBe(0);
      expect(sourceJob!.retryExhausted).toBe(false);

      // Bonus: the track must appear in library_items.
      const items = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, userIdReset),
            eq(libraryItemsTable.mbid, MBID_RESET),
          ),
        );
      expect(items.length).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Test 3 — Hard MB error: retryPassFailed = true → retryAttempts unchanged
// ---------------------------------------------------------------------------
//
// When createMbResolver() itself throws (simulating a hard infrastructure
// failure — connection refused, etc.), the outer try/catch in
// runPhase3RetryPass sets retryPassFailed = true.  The exhaustion counter
// (retryAttempts) must NOT be incremented because the failure is not a
// definitive "not in MusicBrainz"; we want to retry on the next off-peak night.

describe("runPhase3RetryPass — hard MB error: does not increment retryAttempts when the pass itself fails", () => {
  beforeEach(() => {
    // Override createMbResolver to throw on every call for this describe block.
    // This simulates a hard infrastructure failure (e.g. MB connection refused)
    // that crashes the entire retry job rather than individual track lookups.
    mockCreateMbResolver.mockImplementation(() => {
      throw new Error("MB connection refused (test)");
    });
  });

  afterEach(() => {
    // Restore to the default: return a resolver using the shared mock fns.
    mockCreateMbResolver.mockReset();
    mockCreateMbResolver.mockImplementation(() => ({
      resolveByIsrc: mockResolveByIsrc,
      resolveByText: mockResolveByText,
    }));
  });

  it(
    "leaves retryAttempts unchanged when createMbResolver throws (retryPassFailed = true)",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // Source job starts at attempt 0; the hard error must not push it to 1.
      const sourceJobId = await insertDoneJob(
        userIdHardErr,
        [{ artist: ARTIST, title: "HardErr Track", externalId: "sp-he-1" }],
        { total: 1, resolved: 0, retryAttempts: 0 },
      );

      const spy = installSleepBypass();
      try {
        await runPhase3RetryPass();
      } finally {
        spy.mockRestore();
      }

      // retryAttempts on the source job must still be 0 — hard errors are not
      // counted against the exhaustion limit.
      const [sourceJob] = await db
        .select({
          retryAttempts: libraryImportJobsTable.retryAttempts,
          retryExhausted: libraryImportJobsTable.retryExhausted,
        })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, sourceJobId));

      expect(sourceJob, "source job should still exist").toBeDefined();
      expect(sourceJob!.retryAttempts).toBe(0);
      expect(sourceJob!.retryExhausted).toBe(false);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Test 4 — Exclusion: retryExhausted = true is excluded from the candidate query
// ---------------------------------------------------------------------------
//
// A source job with retryExhausted = true must not appear in the candidates
// list that runPhase3RetryPass builds.  Even though the job has un-cached
// tracks in its buffer, no retry job should be created for it.

describe("runPhase3RetryPass — exclusion: skips source jobs where retryExhausted = true", () => {
  it(
    "does not create a retry job for a source job with retryExhausted = true",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      mockResolveByText.mockResolvedValue(MBID_EXCL); // would resolve if not excluded

      // Source job is already exhausted — the candidate query filters it out.
      const sourceJobId = await insertDoneJob(
        userIdExcl,
        [{ artist: ARTIST, title: "Excl Track", externalId: "sp-ex-excl-1" }],
        { total: 1, resolved: 0, retryAttempts: 3, retryExhausted: true },
      );

      const spy = installSleepBypass();
      try {
        await runPhase3RetryPass();
      } finally {
        spy.mockRestore();
      }

      // Only the original source job must exist — no retry job created.
      const jobs = await db
        .select({ id: libraryImportJobsTable.id })
        .from(libraryImportJobsTable)
        .where(
          and(
            eq(libraryImportJobsTable.userId, userIdExcl),
            eq(libraryImportJobsTable.service, "spotify"),
          ),
        );

      expect(jobs.length).toBe(1);
      expect(jobs[0]!.id).toBe(sourceJobId);

      // The track must NOT appear in library_items (pass was skipped entirely).
      const items = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userIdExcl));
      expect(items.map((r) => r.mbid)).not.toContain(MBID_EXCL);
    },
    30_000,
  );
});
