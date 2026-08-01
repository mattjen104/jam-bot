/**
 * Integration tests for the 3-phase import worker short-circuit logic.
 *
 * Confirms that:
 *   Phase 1 — tracks whose ISRC already appears in the recordings table are
 *             inserted into library_items with zero resolveToMbid calls.
 *   Phase 2 — tracks with a resolution_cache hit are inserted with zero
 *             resolveToMbid calls.
 *   Phase 3 — the remainder does call resolveToMbid; the 1.1 s MB sleep fires
 *             only when resolveToMbid returns fromCache=false, never when
 *             fromCache=true.
 *
 * Self-skips when no real DB is available (same pattern as reconcile-db.test.ts).
 */

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
  type LibraryItemProvenance,
} from "@workspace/db";

// ── Hoisted mock fns (created before vi.mock factories are evaluated) ────────

const { mockImportLibrary, mockResolveByText, mockResolveByIsrc } = vi.hoisted(() => ({
  mockImportLibrary: vi.fn(),
  mockResolveByText: vi.fn<[string, string, (AbortSignal | undefined)?], Promise<string | null>>(),
  mockResolveByIsrc: vi.fn<[string, (AbortSignal | undefined)?], Promise<string | null>>(),
}));

// ── Module mocks (vi.mock is hoisted before any import) ─────────────────────

// Pass-through token crypto so the worker gets a valid plaintext token from a
// fake encrypted value without requiring a real crypto environment.
vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

// Pluggable connector mock — importLibrary is set per-test via setupConnector().
vi.mock("../src/lore/serviceConnector.js", () => ({
  getConnector: vi.fn().mockReturnValue({ importLibrary: mockImportLibrary }),
  getFreshServiceToken: vi.fn(),
  refreshServiceToken: vi.fn(),
}));

// Keep real pure helpers (normalizeKey, isrcKey, …) but replace the network-
// bound resolveToMbid with a spy so Phase 1/2 tests can confirm it's never
// reached (it is no longer called in Phase 3 — that now uses createMbResolver).
vi.mock("../src/lore/resolve.js", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("../src/lore/resolve.js")>();
  return { ...orig, resolveToMbid: vi.fn() };
});

// Phase 3 of the import worker now calls createMbResolver() to get an
// isolated resolver.  Mock the factory to return controlled spies so tests
// can set return values and verify call counts without real MusicBrainz I/O.
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

// Stub transitive imports that have nothing to do with the import worker but
// are evaluated when the me-router module is loaded.
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

// ── Deferred imports (after mocks are registered) ───────────────────────────

// Import the mocked resolve module so we can call vi.mocked() on resolveToMbid.
import * as resolveModule from "../src/lore/resolve.js";
// Import the worker functions under test.
import { runImportWorker, runPhase3RetryPass } from "../src/routes/me/index.js";

// ── Test-run-scoped unique IDs ───────────────────────────────────────────────

const run = randomUUID().slice(0, 8);

const MBID_P1  = `test-iw-p1-${run}`;   // resolved via Phase 1 ISRC match
const MBID_P2  = `test-iw-p2-${run}`;   // resolved via Phase 2 cache hit
const MBID_P3A = `test-iw-p3a-${run}`;  // Phase 3, resolveToMbid fromCache=true
const MBID_P3B = `test-iw-p3b-${run}`;  // Phase 3, resolveToMbid fromCache=false
// FK-failure test: recording seeded so Phase 1 ISRC lookup finds it, then
// library_items insert is injected with a 23503 to confirm resilience.
const MBID_FK  = `test-iw-fk-${run}`;
// FK-failure test for Phase 2: recording seeded + resolution_cache entry so
// Phase 2 cache lookup finds it, then library_items insert is injected with
// a 23503 to confirm Phase 2 has the same resilience as Phase 1.
const MBID_FK2 = `test-iw-fk2-${run}`;
// FK-failure test for Phase 3: recording seeded so MB resolve can return the
// MBID, then library_items insert is injected with a 23503 to confirm Phase 3
// has the same resilience as Phase 1 and 2.
const MBID_FK3 = `test-iw-fk3-${run}`;
// Off-peak retry soft-row exclusion test: the retry pass seeds this recording
// itself (no need to pre-seed), but we need the MBID in MBIDS_ALL so afterAll
// can clean it up in the correct FK-safe order.
const MBID_RETRY_SOFT = `test-iw-rt-${run}`;
// 22-char alphanumeric externalId → uses the simple spotifyId deletion path
// in the retry promotion code (isRealSpotifyId branch).
const RETRY_EXT_ID = `SPRetry${run.toUpperCase()}0000000`.slice(0, 22);
// Removed-track guard test: MBID that should never appear in library_items
// because a newer import snapshot doesn't contain the track.
const MBID_REMOVED = `test-iw-rmv-${run}`;
const REMOVED_EXT_ID = `SPRemvd${run.toUpperCase()}0000000`.slice(0, 22);
// No-snapshot retry test: MBID for a track retried when no newer import job
// exists — the pass must resolve it unconditionally (currentLibraryKeys is null).
const MBID_NO_SNAP = `test-iw-ns-${run}`;
const NO_SNAP_EXT_ID = `SPNoSnap${run.toUpperCase()}00000`.slice(0, 22);
// Retry-pass FK-failure test: the retry pass resolves the MBID but the
// library_items insert throws a 23503 — the pass must still reach done and
// the track must stay absent from both library_items and spotify_library_items.
const MBID_RETRY_FK = `test-iw-rfk-${run}`;
const RETRY_FK_EXT_ID = `SPRetryFK${run.toUpperCase()}0000`.slice(0, 22);
const MBIDS_ALL = [MBID_P1, MBID_P2, MBID_P3A, MBID_P3B, MBID_FK, MBID_FK2, MBID_FK3, MBID_RETRY_SOFT, MBID_REMOVED, MBID_NO_SNAP, MBID_RETRY_FK];

// ISRC for the Phase 1 track (must be ≤ 12 chars and unique).
const ISRC_P1 = `TS${run.toUpperCase()}01`.slice(0, 12);
// ISRC for the FK-failure track (different prefix so no collision with ISRC_P1).
const ISRC_FK = `TF${run.toUpperCase()}01`.slice(0, 12);

const ARTIST = `ImportWorker ${run}`;

// ── DB state ────────────────────────────────────────────────────────────────

let dbAvailable = false;
let userId: number;
let connRow: typeof serviceConnectionsTable.$inferSelect;
let jobId: number;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // 1. lore_users row
  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `test-iw-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // 2. service_connections row (token is plaintext; crypto is mocked to pass-through)
  const [c] = await db
    .insert(serviceConnectionsTable)
    .values({
      userId,
      service: "spotify",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
      expiresAt: new Date(Date.now() + 3_600_000), // 1 hour out → no refresh path
      scopes: "user-library-read",
      canWrite: false,
    })
    .returning();
  connRow = c!;

  // 3. recordings rows — needed for Phase 1 ISRC match AND as FK targets for
  //    library_items inserts in all phases.  MBID_FK is seeded here so the
  //    FK-failure test's Phase 1 ISRC lookup can find the mbid, and so the
  //    outer afterAll can delete it in the correct FK-safe order.
  await db.insert(recordingsTable).values([
    { mbid: MBID_P1,  title: "Phase1 Track",   artist: ARTIST, isrc: ISRC_P1 },
    { mbid: MBID_P2,  title: "Phase2 Track",   artist: ARTIST },
    { mbid: MBID_P3A, title: "Phase3A Track",  artist: ARTIST },
    { mbid: MBID_P3B, title: "Phase3B Track",  artist: ARTIST },
    { mbid: MBID_FK,  title: "FK Fail Track",  artist: ARTIST, isrc: ISRC_FK },
    { mbid: MBID_FK2, title: "FK2 Fail Track", artist: ARTIST },
    { mbid: MBID_FK3, title: "FK3 Fail Track", artist: ARTIST },
  ]);

  // 4. resolution_cache entries:
  //    • Phase 2 happy-path track (text-key hit).
  //    • FK2-failure track (text-key hit used in the Phase 2 FK resilience test).
  const { normalizeKey } = resolveModule;
  await db.insert(resolutionCacheTable).values([
    { key: normalizeKey(ARTIST, "Phase2 Track"),   mbid: MBID_P2,  confidence: "text" },
    { key: normalizeKey(ARTIST, "FK2 Fail Track"), mbid: MBID_FK2, confidence: "text" },
  ]);
});

afterAll(async () => {
  if (!dbAvailable) return;
  // Clean up in reverse FK order.
  await db
    .delete(spotifyLibraryItemsTable)
    .where(eq(spotifyLibraryItemsTable.userId, userId));
  await db
    .delete(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, userId));
  await db
    .delete(libraryImportJobsTable)
    .where(eq(libraryImportJobsTable.userId, userId));
  await db
    .delete(serviceConnectionsTable)
    .where(eq(serviceConnectionsTable.id, connRow.id));
  const { normalizeKey } = resolveModule;
  await db
    .delete(resolutionCacheTable)
    .where(
      inArray(resolutionCacheTable.key, [
        normalizeKey(ARTIST, "Phase2 Track"),
        normalizeKey(ARTIST, "FK2 Fail Track"),
        // Written by Phase 3 during the soft-row exclusion test.
        normalizeKey(ARTIST, "Phase3Soft Track"),
        // Written (then deleted) during the off-peak retry soft-row test.
        normalizeKey(ARTIST, "Phase3Retry Track"),
        // Written by the retry pass during the no-newer-snapshot test.
        normalizeKey(ARTIST, "NoSnap Track"),
        // Written by the retry pass during the retry-FK-failure test.
        normalizeKey(ARTIST, "RetryFK Track"),
      ]),
    );
  await db
    .delete(recordingsTable)
    .where(inArray(recordingsTable.mbid, MBIDS_ALL));
  await db
    .delete(loreUsersTable)
    .where(eq(loreUsersTable.id, userId));
}, 30_000);

// ── Helper: create a fresh job row and return its id ────────────────────────

async function createJob(): Promise<number> {
  const [j] = await db
    .insert(libraryImportJobsTable)
    .values({ userId, service: "spotify", status: "pending", total: 0, resolved: 0, startedAt: new Date() })
    .returning({ id: libraryImportJobsTable.id });
  jobId = j!.id;
  return j!.id;
}

// ── Helper: make mockImportLibrary yield the given tracks ───────────────────

function setupConnector(
  tracks: Array<{ artist: string; title: string; isrc?: string; externalId: string }>,
) {
  mockImportLibrary.mockImplementation(async function* () {
    for (const t of tracks) yield t;
  });
}

// ── Phase 1 test ─────────────────────────────────────────────────────────────

describe("Phase 1 — ISRC bulk pre-match", () => {
  it("inserts the track into library_items without calling resolveToMbid", async () => {
    if (!dbAvailable) return;

    const resolveToMbid = vi.mocked(resolveModule.resolveToMbid);
    resolveToMbid.mockClear();
    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    setupConnector([
      { artist: ARTIST, title: "Phase1 Track", isrc: ISRC_P1, externalId: "sp-p1" },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // Neither old nor new resolver must have been called — Phase 3 was skipped.
    expect(resolveToMbid).not.toHaveBeenCalled();
    expect(mockResolveByText).not.toHaveBeenCalled();

    // The track should appear in library_items.
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));

    const mbids = items.map((r) => r.mbid);
    expect(mbids).toContain(MBID_P1);

    // Job should be marked done.
    const [job] = await db
      .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));
    expect(job!.status).toBe("done");
    expect(job!.resolved).toBe(1);
  });
});

// ── Phase 2 test ─────────────────────────────────────────────────────────────

describe("Phase 2 — resolution-cache bulk pre-check", () => {
  it("inserts the track into library_items without calling resolveToMbid", async () => {
    if (!dbAvailable) return;

    const resolveToMbid = vi.mocked(resolveModule.resolveToMbid);
    resolveToMbid.mockClear();
    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // Track has NO isrc, so Phase 1 won't pick it up.
    // Its artist+title normalises to the key we seeded in resolution_cache.
    setupConnector([
      { artist: ARTIST, title: "Phase2 Track", externalId: "sp-p2" },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    expect(resolveToMbid).not.toHaveBeenCalled();
    expect(mockResolveByText).not.toHaveBeenCalled();

    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));

    expect(items.map((r) => r.mbid)).toContain(MBID_P2);

    const [job] = await db
      .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));
    expect(job!.status).toBe("done");
    expect(job!.resolved).toBe(1);
  });
});

// ── Phase 3 test — resolveByText called, sleep fires ─────────────────────────
// Phase 3 now uses createMbResolver().resolveByText (not the old resolveToMbid).
// The 1.1 s rate-limit sleep fires after every Phase 3 attempt whose
// AbortController was not triggered (i.e. always for fast-resolving mocks).

describe("Phase 3 — MB resolution via createMbResolver", () => {
  it("calls resolveByText and schedules the 1100 ms rate-limit sleep", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // "Phase3X Track" is a unique title not used elsewhere — the cache stays
    // clean so subsequent tests (especially the Mixed test) aren't affected.
    // resolveByText returns MBID_P3A which exists in the recordings spine.
    mockResolveByText.mockResolvedValue(MBID_P3A);

    setupConnector([
      { artist: ARTIST, title: "Phase3X Track", externalId: "sp-p3x" },
    ]);

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // resolveByText must have been called for this track (no ISRC → no ISRC path).
    expect(mockResolveByText).toHaveBeenCalledTimes(1);
    expect(mockResolveByIsrc).not.toHaveBeenCalled();

    // The 1.1 s rate-limit sleep must have been scheduled.
    const sleepCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 1100,
    );
    expect(sleepCalls.length).toBeGreaterThanOrEqual(1);

    setTimeoutSpy.mockRestore();

    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    expect(items.map((r) => r.mbid)).toContain(MBID_P3A);
  });
});

// ── Phase 3 test — resolveByText returns null (track stays unresolved) ───────

describe("Phase 3 — unresolved track when resolveByText returns null", () => {
  it(
    "worker reaches done status even when resolveByText finds no match",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // "Phase3Y Track" — unique title so no cache pollution for the Mixed test.
      // resolveByText returns null — track is not found on MusicBrainz.
      mockResolveByText.mockResolvedValue(null);

      setupConnector([
        { artist: ARTIST, title: "Phase3Y Track", externalId: "sp-p3y" },
      ]);

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const jid = await createJob();
      // The worker sleeps 1100 ms after each Phase 3 attempt; let it complete.
      await runImportWorker(jid, userId, "spotify", connRow);

      // resolveByText was called (Phase 3 was reached).
      expect(mockResolveByText).toHaveBeenCalledTimes(1);

      // Sleep must still fire — the rate-limit gap applies regardless of result.
      const sleepCalls = setTimeoutSpy.mock.calls.filter(
        ([, delay]) => delay === 1100,
      );
      expect(sleepCalls.length).toBeGreaterThanOrEqual(1);

      setTimeoutSpy.mockRestore();

      // Unresolved track is NOT in library_items.
      const items = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(items.map((r) => r.mbid)).not.toContain(MBID_P3B);

      const [job] = await db
        .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jid));
      expect(job!.status).toBe("done");
      expect(job!.resolved).toBe(0); // nothing resolved in this run
    },
    // Allow up to 8 s: 1.1 s real sleep + DB round-trips.
    8_000,
  );
});

// ── Fast-path: all tracks already in spine (Phases 1+2 exhaust the buffer) ──

describe("Fast-path re-import — all tracks already resolved, Phase 3 skipped", () => {
  it("reaches 'done' immediately with resolved === total, never calls resolveToMbid", async () => {
    if (!dbAvailable) return;

    const resolveToMbid = vi.mocked(resolveModule.resolveToMbid);
    resolveToMbid.mockClear();

    // Two tracks: one resolved by Phase 1 (ISRC match), one by Phase 2 (cache).
    // Neither should fall through to Phase 3.
    setupConnector([
      { artist: ARTIST, title: "Phase1 Track", isrc: ISRC_P1, externalId: "sp-fast-p1" },
      { artist: ARTIST, title: "Phase2 Track",                externalId: "sp-fast-p2" },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // Phase 3 must have been completely skipped.
    expect(resolveToMbid).not.toHaveBeenCalled();

    // Job must finish as "done" with total=2 and resolved=2.
    const [job] = await db
      .select({
        status:   libraryImportJobsTable.status,
        total:    libraryImportJobsTable.total,
        resolved: libraryImportJobsTable.resolved,
        phase:    libraryImportJobsTable.phase,
      })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));

    expect(job!.status).toBe("done");
    expect(job!.total).toBe(2);
    expect(job!.resolved).toBe(2);
    // finishedAt must be set (not null) so the banner's isRecentlyFinished check passes.
    const [jobFull] = await db
      .select({ finishedAt: libraryImportJobsTable.finishedAt })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));
    expect(jobFull!.finishedAt).not.toBeNull();
  });
});

// ── Phase 3 error-storm back-off tests ──────────────────────────────────────
//
// Verify that:
//   1. Reaching PHASE3_503_THRESHOLD consecutive errors triggers a backoff
//      sleep and latches the `mbDegraded` flag.
//   2. The shorter PHASE3_HIGH_ERROR_TIMEOUT_MS (4 s) is used for all tracks
//      while MB is degraded — including those resolved after the backoff resets
//      `consecutiveErrors` to 0 (proving the latch persists).
//   3. `mbDegraded` is cleared only when MB delivers a clean definitive
//      response, after which the full 12 s timeout is restored.
//
// We do NOT use vi.useFakeTimers() here because the worker awaits real DB I/O
// that fake timers can't advance.  Instead we spy on `setTimeout` and
// immediately invoke the callback for long backoff sleeps (≥ 5 s) so the
// worker completes quickly.  Short abort-controller and rate-limit timers
// continue to use real timers (they are cleared by clearTimeout before firing
// because the mock resolvers resolve/reject as micro-tasks, well before any
// 4 s or 12 s timer would actually fire).

/** Spy on `setTimeout`, immediately invoking backoff callbacks (delay ≥ 5 s)
 *  while letting short timers (abort controllers, 1.1 s rate-limit sleeps) run
 *  normally.  Returns the spy so callers can check call args and restore it. */
function spyOnSetTimeoutFastBackoff() {
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  const calls: Array<{ delay: number }> = [];

  const spy = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation(((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      const d = delay ?? 0;
      calls.push({ delay: d });
      // Only intercept our Phase 3 backoff sleeps (≥ 20 s).  Smaller delays
      // include pg-pool's 10 s idle-timeout and the 12 s abort timer — firing
      // those immediately would close DB connections or abort real MB calls.
      if (d >= 20_000) {
        fn(...args);
        return 0 as unknown as NodeJS.Timeout;
      }
      return realSetTimeout(fn, d, ...args);
    }) as typeof globalThis.setTimeout);

  // Attach the captured-calls array to the spy object for easy inspection.
  (spy as typeof spy & { calls: Array<{ delay: number }> }).calls = calls;
  return spy as typeof spy & { calls: Array<{ delay: number }> };
}

describe("Phase 3 — MB 503 error-storm: backoff fires and degraded timeout latches", () => {
  it(
    "uses 4 s timeouts while degraded and triggers 30 s backoff at threshold",
    async () => {
      if (!dbAvailable) return;

      // Three tracks throw, crossing the threshold (3). Track 4 resolves while
      // mbDegraded is still true (consecutiveErrors was reset by the backoff,
      // but the latch must remain active until a clean resolve).
      mockResolveByText
        .mockRejectedValueOnce(new Error("MB 503"))   // track 1 → error
        .mockRejectedValueOnce(new Error("MB 503"))   // track 2 → error
        .mockRejectedValueOnce(new Error("MB 503"))   // track 3 → error, threshold
        .mockResolvedValueOnce(MBID_P3A);             // track 4 → resolves while degraded
      mockResolveByIsrc.mockResolvedValue(null);

      setupConnector([
        { artist: ARTIST, title: "Storm1 Track", externalId: "sp-storm-1" },
        { artist: ARTIST, title: "Storm2 Track", externalId: "sp-storm-2" },
        { artist: ARTIST, title: "Storm3 Track", externalId: "sp-storm-3" },
        { artist: ARTIST, title: "Storm4 Track", externalId: "sp-storm-4" },
      ]);

      const spy = spyOnSetTimeoutFastBackoff();

      const jid = await createJob();
      await runImportWorker(jid, userId, "spotify", connRow);

      // 30 s backoff must have been scheduled once (first threshold breach).
      const backoffCalls = spy.calls.filter((c) => c.delay === 30_000);
      expect(backoffCalls.length).toBeGreaterThanOrEqual(1);

      // 4 s abort timeout must appear for track 4 — it runs while mbDegraded is
      // still latched even though consecutiveErrors was reset to 0 by the backoff.
      const shortTimeoutCalls = spy.calls.filter((c) => c.delay === 4_000);
      expect(shortTimeoutCalls.length).toBeGreaterThanOrEqual(1);

      spy.mockRestore();

      // The job finishes cleanly; track 4 was resolved.
      const [job] = await db
        .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jid));
      expect(job!.status).toBe("done");
      expect(job!.resolved).toBe(1); // only track 4 resolved
    },
    15_000,
  );
});

describe("Phase 3 — MB 503 error-storm: degraded mode clears after clean resolve", () => {
  it(
    "restores 12 s timeout once MB responds cleanly after a degraded period",
    async () => {
      if (!dbAvailable) return;

      // Tracks 1–3 throw → threshold, mbDegraded=true.
      // Track 4 resolves cleanly → mbDegraded cleared.
      // Track 5 is attempted next → should use full 12 s timeout again.
      mockResolveByText
        .mockRejectedValueOnce(new Error("MB 503"))   // track 1
        .mockRejectedValueOnce(new Error("MB 503"))   // track 2
        .mockRejectedValueOnce(new Error("MB 503"))   // track 3 → threshold, mbDegraded=true
        .mockResolvedValueOnce(MBID_P3A)              // track 4 → clean resolve → mbDegraded=false
        .mockResolvedValueOnce(null);                 // track 5 → confirmed null (back to full timeout)
      mockResolveByIsrc.mockResolvedValue(null);

      setupConnector([
        { artist: ARTIST, title: "Recover1 Track", externalId: "sp-rec-1" },
        { artist: ARTIST, title: "Recover2 Track", externalId: "sp-rec-2" },
        { artist: ARTIST, title: "Recover3 Track", externalId: "sp-rec-3" },
        { artist: ARTIST, title: "Recover4 Track", externalId: "sp-rec-4" },
        { artist: ARTIST, title: "Recover5 Track", externalId: "sp-rec-5" },
      ]);

      const spy = spyOnSetTimeoutFastBackoff();

      const jid = await createJob();
      await runImportWorker(jid, userId, "spotify", connRow);

      // 4 s abort timeout must appear — used for track 4 (attempted while degraded).
      const shortTimeoutCalls = spy.calls.filter((c) => c.delay === 4_000);
      expect(shortTimeoutCalls.length).toBeGreaterThanOrEqual(1);

      // 12 s abort timeout must appear — used for track 5 after mbDegraded cleared.
      const fullTimeoutCalls = spy.calls.filter((c) => c.delay === 12_000);
      expect(fullTimeoutCalls.length).toBeGreaterThanOrEqual(1);

      spy.mockRestore();
    },
    15_000,
  );
});

// ── Soft-row exclusion: ISRC-resolved tracks must not appear in spotify_library_items ──

describe("Soft-row exclusion — Phase 1 ISRC-resolved track never written to spotify_library_items", () => {
  // Use a unique externalId so this test's soft-row assertions are not
  // polluted by any residual rows from other describe blocks.
  const SOFT_EXCL_EXT_ID = `sp-soft-excl-${run}`;

  it("leaves spotify_library_items empty after the first import run", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // A track with an ISRC already present in the recordings table → Phase 1 hit.
    setupConnector([
      { artist: ARTIST, title: "Phase1 Track", isrc: ISRC_P1, externalId: SOFT_EXCL_EXT_ID },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // Phase 3 must not have been reached.
    expect(mockResolveByText).not.toHaveBeenCalled();

    // The track must be in library_items (resolved via Phase 1).
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    expect(items.map((r) => r.mbid)).toContain(MBID_P1);

    // The resolved track must NOT appear as a soft row.
    const softRows = await db
      .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
      .from(spotifyLibraryItemsTable)
      .where(eq(spotifyLibraryItemsTable.userId, userId));
    const softIds = softRows.map((r) => r.spotifyId);
    expect(softIds).not.toContain(SOFT_EXCL_EXT_ID);

    const [job] = await db
      .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));
    expect(job!.status).toBe("done");
    expect(job!.resolved).toBe(1);
  });

  it("leaves spotify_library_items empty after a second re-import run", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // Same track, same ISRC — simulates the user triggering a re-import.
    setupConnector([
      { artist: ARTIST, title: "Phase1 Track", isrc: ISRC_P1, externalId: SOFT_EXCL_EXT_ID },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // Phase 3 must still have been skipped.
    expect(mockResolveByText).not.toHaveBeenCalled();

    // Soft table must remain clean after the re-import.
    const softRows = await db
      .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
      .from(spotifyLibraryItemsTable)
      .where(eq(spotifyLibraryItemsTable.userId, userId));
    const softIds = softRows.map((r) => r.spotifyId);
    expect(softIds).not.toContain(SOFT_EXCL_EXT_ID);

    const [job] = await db
      .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));
    expect(job!.status).toBe("done");
    expect(job!.resolved).toBe(1);
  });
});

// ── Soft-row exclusion: Phase 3 MB-resolved tracks must not appear in spotify_library_items ──

describe("Soft-row exclusion — Phase 3 MB-resolved track never written to spotify_library_items", () => {
  // Unique externalId so this block's soft-row assertions are not polluted by
  // residual rows from other describe blocks.
  const SOFT_P3_EXT_ID = `sp-soft-p3-${run}`;

  it("leaves spotify_library_items empty after the first import run", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // "Phase3Soft Track" has no ISRC and no resolution_cache entry, so it
    // falls through to Phase 3.  resolveByText returns MBID_P3A which is
    // already in the recordings spine (seeded in beforeAll).
    mockResolveByText.mockResolvedValue(MBID_P3A);

    setupConnector([
      { artist: ARTIST, title: "Phase3Soft Track", externalId: SOFT_P3_EXT_ID },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // Phase 3 must have been reached (no ISRC, no cache).
    expect(mockResolveByText).toHaveBeenCalledTimes(1);

    // The track must be in library_items (resolved via Phase 3 MB hit).
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    expect(items.map((r) => r.mbid)).toContain(MBID_P3A);

    // The resolved track must NOT appear as a soft row.
    const softRows = await db
      .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
      .from(spotifyLibraryItemsTable)
      .where(eq(spotifyLibraryItemsTable.userId, userId));
    expect(softRows.map((r) => r.spotifyId)).not.toContain(SOFT_P3_EXT_ID);

    const [job] = await db
      .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));
    expect(job!.status).toBe("done");
    expect(job!.resolved).toBe(1);
  });

  it("leaves spotify_library_items empty after a second re-import run", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // Same track — the first run wrote a resolution_cache entry for it, so
    // this run resolves via Phase 2 (cache hit) without reaching Phase 3.
    // The soft-row exclusion must still hold regardless of which phase resolved it.
    mockResolveByText.mockResolvedValue(MBID_P3A);

    setupConnector([
      { artist: ARTIST, title: "Phase3Soft Track", externalId: SOFT_P3_EXT_ID },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // Soft table must remain clean after the re-import.
    const softRows = await db
      .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
      .from(spotifyLibraryItemsTable)
      .where(eq(spotifyLibraryItemsTable.userId, userId));
    expect(softRows.map((r) => r.spotifyId)).not.toContain(SOFT_P3_EXT_ID);

    const [job] = await db
      .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));
    expect(job!.status).toBe("done");
    expect(job!.resolved).toBe(1);
  });
});

// ── FK-failure resilience: Phase 1 insert fails, track excluded from soft rows ──
//
// Simulates the race condition where a recordings row is deleted between Phase 1's
// bulk ISRC lookup and the subsequent library_items insert, producing a 23503 FK
// violation.  The worker must:
//   • catch the error and not crash (job reaches "done")
//   • exclude the track from spotify_library_items (resolvedMbidIdx prevents soft-row seeding)
//   • NOT insert into library_items (the insert genuinely failed)

describe("Phase 1 — library_items FK violation: worker reaches done, track excluded from soft rows", () => {
  // MBID_FK / ISRC_FK are declared at the top of this file; the recording is
  // seeded in the outer beforeAll and cleaned up in the outer afterAll in the
  // correct FK-safe order (library_items → recordings).
  const EXT_FK = `sp-fk-${run}`;

  it(
    "does not appear in spotify_library_items and job reaches done when Phase 1 library_items insert throws 23503",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      setupConnector([
        { artist: ARTIST, title: "FK Fail Track", isrc: ISRC_FK, externalId: EXT_FK },
      ]);

      // Build the FK error that Postgres emits on a foreign-key violation.
      const fkErr = Object.assign(
        new Error(
          'insert or update on table "library_items" violates foreign key ' +
          'constraint "library_items_mbid_fkey"',
        ),
        { code: "23503", constraint: "library_items_mbid_fkey" },
      );

      // Capture the real db.insert BEFORE vi.spyOn replaces it so the spy's
      // fall-through path can still reach the real DB.
      const origInsert = (db as any).insert.bind(db);
      let fkInjected = false;

      const insertSpy = vi
        .spyOn(db as any, "insert")
        .mockImplementation((table: unknown) => {
          // Inject the FK error exactly once, only for libraryItemsTable.
          if (!fkInjected && table === libraryItemsTable) {
            fkInjected = true;
            // Fake builder that mirrors drizzle's chaining API but rejects on await.
            const fakeBuilder: Record<string, unknown> = {};
            fakeBuilder["values"] = () => fakeBuilder;
            fakeBuilder["onConflictDoNothing"] = () => fakeBuilder;
            fakeBuilder["then"] = (
              onFulfilled: ((v: unknown) => unknown) | null | undefined,
              onRejected: ((e: unknown) => unknown) | null | undefined,
            ) => Promise.reject(fkErr).then(onFulfilled, onRejected);
            return fakeBuilder;
          }
          // All other inserts (job-status updates, serviceConnections, …) go
          // through the real DB so the worker can persist its state normally.
          return origInsert(table);
        });

      const jid = await createJob();
      await runImportWorker(jid, userId, "spotify", connRow);

      insertSpy.mockRestore();

      // library_items must NOT contain the track (the insert was rejected).
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libRows.map((r) => r.mbid)).not.toContain(MBID_FK);

      // The track must NOT appear as a soft row — Phase 1 confirmed the MBID
      // via ISRC and added the track to resolvedMbidIdx even though the insert
      // failed, preventing it from being silently demoted to spotify_library_items.
      const softRows = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(eq(spotifyLibraryItemsTable.userId, userId));
      expect(softRows.map((r) => r.spotifyId)).not.toContain(EXT_FK);

      // Job must reach "done" despite the FK failure.
      const [job] = await db
        .select({ status: libraryImportJobsTable.status })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jid));
      expect(job!.status).toBe("done");
    },
    10_000,
  );
});

// ── FK-failure resilience: Phase 2 cache-hit insert fails, track excluded from soft rows ──
//
// Simulates the race condition where a recordings row is deleted between Phase 2's
// resolution_cache lookup and the subsequent library_items insert, producing a 23503 FK
// violation.  The worker must:
//   • catch the error and not crash (job reaches "done")
//   • exclude the track from spotify_library_items (resolvedMbidIdx prevents soft-row seeding)
//   • NOT insert into library_items (the insert genuinely failed)

describe("Phase 2 — library_items FK violation: worker reaches done, track excluded from soft rows", () => {
  const EXT_FK2 = `sp-fk2-${run}`;

  it(
    "does not appear in library_items or spotify_library_items and job reaches done when Phase 2 library_items insert throws 23503",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // Track has no ISRC so Phase 1 won't pick it up; resolution_cache has an
      // entry for it (seeded in beforeAll) so Phase 2 finds it via cache lookup.
      setupConnector([
        { artist: ARTIST, title: "FK2 Fail Track", externalId: EXT_FK2 },
      ]);

      // Build the FK error that Postgres emits on a foreign-key violation.
      const fkErr = Object.assign(
        new Error(
          'insert or update on table "library_items" violates foreign key ' +
          'constraint "library_items_mbid_fkey"',
        ),
        { code: "23503", constraint: "library_items_mbid_fkey" },
      );

      const origInsert = (db as any).insert.bind(db);
      let fkInjected = false;

      const insertSpy = vi
        .spyOn(db as any, "insert")
        .mockImplementation((table: unknown) => {
          // Inject the FK error exactly once, only for libraryItemsTable.
          if (!fkInjected && table === libraryItemsTable) {
            fkInjected = true;
            const fakeBuilder: Record<string, unknown> = {};
            fakeBuilder["values"] = () => fakeBuilder;
            fakeBuilder["onConflictDoNothing"] = () => fakeBuilder;
            fakeBuilder["then"] = (
              onFulfilled: ((v: unknown) => unknown) | null | undefined,
              onRejected: ((e: unknown) => unknown) | null | undefined,
            ) => Promise.reject(fkErr).then(onFulfilled, onRejected);
            return fakeBuilder;
          }
          return origInsert(table);
        });

      const jid = await createJob();
      await runImportWorker(jid, userId, "spotify", connRow);

      insertSpy.mockRestore();

      // library_items must NOT contain the track (the insert was rejected).
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libRows.map((r) => r.mbid)).not.toContain(MBID_FK2);

      // The track must NOT appear as a soft row — Phase 2 confirmed the MBID
      // via cache and added the track to resolvedMbidIdx even though the insert
      // failed, preventing it from being silently demoted to spotify_library_items.
      const softRows = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(eq(spotifyLibraryItemsTable.userId, userId));
      expect(softRows.map((r) => r.spotifyId)).not.toContain(EXT_FK2);

      // Job must reach "done" despite the FK failure.
      const [job] = await db
        .select({ status: libraryImportJobsTable.status })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jid));
      expect(job!.status).toBe("done");
    },
    10_000,
  );
});

// ── FK-failure resilience: Phase 3 MB resolve succeeds then insert fails ──────
//
// Simulates the race condition where a recordings row is deleted between Phase 3's
// MB resolve (which seeds the spine row) and the subsequent library_items insert,
// producing a 23503 FK violation.  The worker must:
//   • catch the error and not crash (job reaches "done")
//   • exclude the track from spotify_library_items (resolvedMbidIdx prevents soft-row seeding)
//   • NOT insert into library_items (the insert genuinely failed)

describe("Phase 3 — library_items FK violation: worker reaches done, track excluded from soft rows", () => {
  const EXT_FK3 = `sp-fk3-${run}`;

  it(
    "does not appear in library_items or spotify_library_items and job reaches done when Phase 3 library_items insert throws 23503",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // Track has no ISRC (no Phase 1 hit) and no cache entry (no Phase 2 hit),
      // so it falls through to Phase 3.  resolveByText returns MBID_FK3 which
      // exists in the recordings spine (seeded in beforeAll).
      mockResolveByText.mockResolvedValue(MBID_FK3);

      setupConnector([
        { artist: ARTIST, title: "FK3 Fail Track", externalId: EXT_FK3 },
      ]);

      // Build the FK error that Postgres emits on a foreign-key violation.
      const fkErr = Object.assign(
        new Error(
          'insert or update on table "library_items" violates foreign key ' +
          'constraint "library_items_mbid_fkey"',
        ),
        { code: "23503", constraint: "library_items_mbid_fkey" },
      );

      const origInsert = (db as any).insert.bind(db);
      let fkInjected = false;

      const insertSpy = vi
        .spyOn(db as any, "insert")
        .mockImplementation((table: unknown) => {
          // Inject the FK error exactly once, only for libraryItemsTable.
          if (!fkInjected && table === libraryItemsTable) {
            fkInjected = true;
            const fakeBuilder: Record<string, unknown> = {};
            fakeBuilder["values"] = () => fakeBuilder;
            fakeBuilder["onConflictDoNothing"] = () => fakeBuilder;
            fakeBuilder["then"] = (
              onFulfilled: ((v: unknown) => unknown) | null | undefined,
              onRejected: ((e: unknown) => unknown) | null | undefined,
            ) => Promise.reject(fkErr).then(onFulfilled, onRejected);
            return fakeBuilder;
          }
          return origInsert(table);
        });

      const jid = await createJob();
      await runImportWorker(jid, userId, "spotify", connRow);

      insertSpy.mockRestore();

      // library_items must NOT contain the track (the insert was rejected).
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libRows.map((r) => r.mbid)).not.toContain(MBID_FK3);

      // The track must NOT appear as a soft row — Phase 3 confirmed the MBID
      // via MB resolve and added the track to resolvedMbidIdx even though the
      // insert failed, preventing it from being demoted to spotify_library_items.
      const softRows = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(eq(spotifyLibraryItemsTable.userId, userId));
      expect(softRows.map((r) => r.spotifyId)).not.toContain(EXT_FK3);

      // Job must reach "done" despite the FK failure.
      const [job] = await db
        .select({ status: libraryImportJobsTable.status })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jid));
      expect(job!.status).toBe("done");
    },
    10_000,
  );
});

// ── Mixed-phase regression test ──────────────────────────────────────────────

describe("Mixed all-3 phases — large re-import short-circuit", () => {
  it("resolves Phase1+Phase2 without resolveByText; calls it only for the Phase3 track", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // Phase 3 track: resolveByText returns the MBID.
    mockResolveByText.mockResolvedValue(MBID_P3A);

    // Buffer: one track from each phase.
    setupConnector([
      { artist: ARTIST, title: "Phase1 Track",  isrc: ISRC_P1, externalId: "sp-mix-p1"  },
      { artist: ARTIST, title: "Phase2 Track",                  externalId: "sp-mix-p2"  },
      { artist: ARTIST, title: "Phase3A Track",                 externalId: "sp-mix-p3a" },
    ]);

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // Only the Phase 3 track reached resolveByText.
    expect(mockResolveByText).toHaveBeenCalledTimes(1);

    // The 1.1 s sleep fires once for the Phase 3 track.
    const sleepCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 1100,
    );
    expect(sleepCalls.length).toBeGreaterThanOrEqual(1);

    setTimeoutSpy.mockRestore();

    // All three tracks should appear in library_items.
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    const mbids = items.map((r) => r.mbid);
    expect(mbids).toContain(MBID_P1);
    expect(mbids).toContain(MBID_P2);
    expect(mbids).toContain(MBID_P3A);

    const [job] = await db
      .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));
    expect(job!.status).toBe("done");
    expect(job!.resolved).toBe(3);
  });
});

// ── Cross-user soft-row exclusion ────────────────────────────────────────────
//
// When two different users import the same unresolved track:
//   • User 1's import falls through to Phase 3 (no cache entry yet) and writes
//     a resolution_cache entry once MB resolves it.
//   • User 2's import arrives after user 1's Phase 3 run and hits Phase 2
//     (resolution_cache already populated).
// Both users' spotify_library_items must remain empty for their respective
// externalIds — the cross-user cache-hit path must not seed a soft row.

describe("Cross-user soft-row exclusion — Phase 3 for user 1 populates cache; user 2 hits Phase 2", () => {
  const CROSS_EXT_ID_U1 = `sp-cross-u1-${run}`;
  const CROSS_EXT_ID_U2 = `sp-cross-u2-${run}`;
  // Unique title so it has no resolution_cache entry from any earlier test.
  const CROSS_TITLE = `CrossUser ${run} Track`;

  let userId2: number;
  let connRow2: typeof serviceConnectionsTable.$inferSelect;

  beforeAll(async () => {
    if (!dbAvailable) return;

    // Second lore_users row.
    const [u2] = await db
      .insert(loreUsersTable)
      .values({ spotifyUserId: `test-iw-cross-${run}`, deviceKey: randomUUID() })
      .returning({ id: loreUsersTable.id });
    userId2 = u2!.id;

    // Second service_connections row.
    const [c2] = await db
      .insert(serviceConnectionsTable)
      .values({
        userId: userId2,
        service: "spotify",
        accessToken: "fake-access-token-2",
        refreshToken: "fake-refresh-token-2",
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: "user-library-read",
        canWrite: false,
      })
      .returning();
    connRow2 = c2!;
  }, 30_000);

  afterAll(async () => {
    if (!dbAvailable) return;
    // Clean up user 2's rows in FK-safe order.
    await db
      .delete(spotifyLibraryItemsTable)
      .where(eq(spotifyLibraryItemsTable.userId, userId2));
    await db
      .delete(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId2));
    await db
      .delete(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.userId, userId2));
    await db
      .delete(serviceConnectionsTable)
      .where(eq(serviceConnectionsTable.id, connRow2.id));
    // Remove the resolution_cache entry written by user 1's Phase 3 run.
    const { normalizeKey } = resolveModule;
    await db
      .delete(resolutionCacheTable)
      .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST, CROSS_TITLE)));
    await db
      .delete(loreUsersTable)
      .where(eq(loreUsersTable.id, userId2));
  }, 30_000);

  it(
    "user 1 resolves via Phase 3; user 2 resolves via Phase 2 (cache hit); neither appears in spotify_library_items",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // ── User 1: CROSS_TITLE has no ISRC and no cache entry → Phase 3 ──────
      // resolveByText returns MBID_P3A (already in the recordings spine).
      mockResolveByText.mockResolvedValue(MBID_P3A);

      setupConnector([
        { artist: ARTIST, title: CROSS_TITLE, externalId: CROSS_EXT_ID_U1 },
      ]);

      const [j1Row] = await db
        .insert(libraryImportJobsTable)
        .values({ userId, service: "spotify", status: "pending", total: 0, resolved: 0, startedAt: new Date() })
        .returning({ id: libraryImportJobsTable.id });
      await runImportWorker(j1Row!.id, userId, "spotify", connRow);

      // Phase 3 must have been reached for user 1.
      expect(mockResolveByText).toHaveBeenCalledTimes(1);

      // User 1's soft table must be empty for this externalId.
      const softU1 = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(eq(spotifyLibraryItemsTable.userId, userId));
      expect(softU1.map((r) => r.spotifyId)).not.toContain(CROSS_EXT_ID_U1);

      // User 1 must be resolved and done.
      const [job1] = await db
        .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, j1Row!.id));
      expect(job1!.status).toBe("done");
      expect(job1!.resolved).toBe(1);

      // ── User 2: same track — resolution_cache now populated → Phase 2 hit ──
      mockResolveByText.mockClear();

      setupConnector([
        { artist: ARTIST, title: CROSS_TITLE, externalId: CROSS_EXT_ID_U2 },
      ]);

      const [j2Row] = await db
        .insert(libraryImportJobsTable)
        .values({ userId: userId2, service: "spotify", status: "pending", total: 0, resolved: 0, startedAt: new Date() })
        .returning({ id: libraryImportJobsTable.id });
      await runImportWorker(j2Row!.id, userId2, "spotify", connRow2);

      // Phase 3 must NOT have been reached for user 2 (cache hit in Phase 2).
      expect(mockResolveByText).not.toHaveBeenCalled();

      // User 2's soft table must be empty for this externalId.
      const softU2 = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(eq(spotifyLibraryItemsTable.userId, userId2));
      expect(softU2.map((r) => r.spotifyId)).not.toContain(CROSS_EXT_ID_U2);

      // User 2 must be resolved and done.
      const [job2] = await db
        .select({ status: libraryImportJobsTable.status, resolved: libraryImportJobsTable.resolved })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, j2Row!.id));
      expect(job2!.status).toBe("done");
      expect(job2!.resolved).toBe(1);
    },
    15_000,
  );
});

// ── Off-peak retry soft-row exclusion ────────────────────────────────────────
//
// Verifies that when the off-peak retry pass (runPhase3RetryPass) resolves a
// track that was previously unresolved (and therefore written as a soft row in
// spotify_library_items), the pass:
//   • promotes the track into library_items
//   • removes the soft row from spotify_library_items
//
// Setup:
//   1. A first runImportWorker call with resolveByText returning null seeds the
//      soft row and writes a negative resolution_cache entry.
//   2. The negative cache entry is deleted so the retry pass treats the track
//      as un-cached and retries it.
//   3. runPhase3RetryPass is called with resolveByText now returning MBID_RETRY_SOFT.
//   4. Assertions confirm the soft row is gone and library_items contains the track.

describe("Phase 3 off-peak retry — soft-row removed after retry promotion", () => {
  it(
    "first run: soft row seeded; retry run: soft row deleted, track in library_items",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // ── First run: resolveByText returns null ──────────────────────────────
      // The track has no ISRC and no resolution_cache entry, so it falls through
      // to Phase 3.  resolveByText returns null — unresolvable on this attempt.
      // The worker writes a negative cache entry and seeds the soft row.
      mockResolveByText.mockResolvedValue(null);

      setupConnector([
        { artist: ARTIST, title: "Phase3Retry Track", externalId: RETRY_EXT_ID },
      ]);

      const jid1 = await createJob();
      await runImportWorker(jid1, userId, "spotify", connRow);

      // Confirm the job shows total=1, resolved=0.
      const [job1] = await db
        .select({ status: libraryImportJobsTable.status, total: libraryImportJobsTable.total, resolved: libraryImportJobsTable.resolved })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jid1));
      expect(job1!.status).toBe("done");
      expect(job1!.total).toBe(1);
      expect(job1!.resolved).toBe(0);

      // Confirm the soft row was seeded.
      const softAfterRun1 = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.spotifyId, RETRY_EXT_ID),
          ),
        );
      expect(softAfterRun1.map((r) => r.spotifyId)).toContain(RETRY_EXT_ID);

      // ── Bridge: clear the negative cache entry ────────────────────────────
      // resolveByText returned null so the worker wrote a negative cache entry.
      // The retry pass (runPhase3RetryPass) only retries tracks with NO entry
      // in resolution_cache.  Deleting it simulates the cache being cleared or
      // expiring so the retry pass treats the track as un-cached.
      const { normalizeKey: nk } = resolveModule;
      await db
        .delete(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, nk(ARTIST, "Phase3Retry Track")));

      // ── Retry run: resolveByText returns MBID_RETRY_SOFT ──────────────────
      // The retry pass finds jid1 as an eligible source job (status=done,
      // total > resolved, bufferJson present) and retries the un-cached track.
      // resolveByText now returns an MBID, so the pass should:
      //   • seed the recordings spine row
      //   • insert into library_items
      //   • delete the soft row from spotify_library_items
      mockResolveByText.mockClear();
      mockResolveByText.mockResolvedValue(MBID_RETRY_SOFT);

      await runPhase3RetryPass();

      // The track must now appear in library_items.
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libRows.map((r) => r.mbid)).toContain(MBID_RETRY_SOFT);

      // The soft row must have been removed after promotion.
      const softAfterRetry = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.spotifyId, RETRY_EXT_ID),
          ),
        );
      expect(softAfterRetry.map((r) => r.spotifyId)).not.toContain(RETRY_EXT_ID);
    },
    // Allow up to 15 s: 1.1 s real sleep + DB round-trips in both runs.
    15_000,
  );
});

// ── Retry guard: tracks absent from a newer import snapshot are not re-inserted ──
//
// When a user removes a track from Spotify between imports, the source job's
// buffer still contains it, but a newer completed import's buffer does not.
// runPhase3RetryPass must skip re-insertion for any track absent from the
// newest completed snapshot so that deliberate removals are respected.
//
// Setup:
//   1. Seed a source job (status=done, total=1, resolved=0) with the removed
//      track in its bufferJson.
//   2. Insert a newer completed import job (higher id) with a bufferJson that
//      does NOT include the removed track.
//   3. Call runPhase3RetryPass — mockResolveByText is set to return MBID_REMOVED
//      so the track would have been resolved if not filtered.
//   4. Assert MBID_REMOVED is absent from library_items and that
//      mockResolveByText was never called (the track was filtered before MB I/O).

describe("Retry guard — track removed from Spotify after original import is not re-inserted", () => {
  it(
    "does not insert a track into library_items when it is absent from a newer import snapshot",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      mockResolveByText.mockResolvedValue(MBID_REMOVED);

      // ── 1. Seed the source job (unresolved track in buffer) ───────────────
      const [sourceJobRow] = await db
        .insert(libraryImportJobsTable)
        .values({
          userId,
          service: "spotify",
          status: "done",
          phase: "resolve",
          total: 1,
          resolved: 0,
          retryExhausted: false,
          bufferJson: [
            {
              artist: ARTIST,
              title: "Removed Track",
              isrc: null,
              durationMs: null,
              externalId: REMOVED_EXT_ID,
            },
          ],
          startedAt: new Date(),
          finishedAt: new Date(),
        })
        .returning({ id: libraryImportJobsTable.id });
      const sourceJobId = sourceJobRow!.id;

      // ── 2. Seed the newer completed import job (removed track absent) ─────
      // This job has a higher id (inserted after the source job) and its buffer
      // contains a different track — simulating a fresh Spotify fetch where the
      // user had already removed "Removed Track".
      await db.insert(libraryImportJobsTable).values({
        userId,
        service: "spotify",
        status: "done",
        phase: "resolve",
        total: 1,
        resolved: 1,
        retryExhausted: false,
        bufferJson: [
          {
            artist: "Other Artist",
            title: "Other Track",
            isrc: null,
            durationMs: null,
            externalId: `sp-other-newer-${run}`,
          },
        ],
        startedAt: new Date(),
        finishedAt: new Date(),
      });

      // ── 3. Run the retry pass ─────────────────────────────────────────────
      await runPhase3RetryPass();

      // ── 4. Assert the removed track never landed in library_items ─────────
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libRows.map((r) => r.mbid)).not.toContain(MBID_REMOVED);

      // The guard must have filtered the track before reaching MB resolution.
      expect(mockResolveByText).not.toHaveBeenCalled();
      expect(mockResolveByIsrc).not.toHaveBeenCalled();

      // Clean up the two jobs created for this test (afterAll only cleans up
      // by userId which would catch them, but be explicit to stay tidy).
      await db
        .delete(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, sourceJobId));
    },
    15_000,
  );

  it(
    "does not insert a track into library_items when the newer import snapshot is empty (user removed all tracks)",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      mockResolveByText.mockResolvedValue(MBID_REMOVED);

      // ── 1. Seed the source job ────────────────────────────────────────────
      const [sourceJobRow] = await db
        .insert(libraryImportJobsTable)
        .values({
          userId,
          service: "spotify",
          status: "done",
          phase: "resolve",
          total: 1,
          resolved: 0,
          retryExhausted: false,
          bufferJson: [
            {
              artist: ARTIST,
              title: "Removed Track Empty Snap",
              isrc: null,
              durationMs: null,
              externalId: `${REMOVED_EXT_ID}B`.slice(0, 22),
            },
          ],
          startedAt: new Date(),
          finishedAt: new Date(),
        })
        .returning({ id: libraryImportJobsTable.id });
      const sourceJobId = sourceJobRow!.id;

      // ── 2. Seed a newer completed import with an empty buffer ─────────────
      // Simulates the user having removed ALL tracks from Spotify — the fresh
      // Spotify fetch returned nothing, so bufferJson is [].
      const [newerJobRow] = await db
        .insert(libraryImportJobsTable)
        .values({
          userId,
          service: "spotify",
          status: "done",
          phase: "resolve",
          total: 0,
          resolved: 0,
          retryExhausted: false,
          bufferJson: [],   // ← empty but NOT null
          startedAt: new Date(),
          finishedAt: new Date(),
        })
        .returning({ id: libraryImportJobsTable.id });

      // ── 3. Run the retry pass ─────────────────────────────────────────────
      await runPhase3RetryPass();

      // ── 4. Assert the removed track never landed in library_items ─────────
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libRows.map((r) => r.mbid)).not.toContain(MBID_REMOVED);

      // Guard must have filtered the track before any MB I/O.
      expect(mockResolveByText).not.toHaveBeenCalled();
      expect(mockResolveByIsrc).not.toHaveBeenCalled();

      // Clean up.
      await db
        .delete(libraryImportJobsTable)
        .where(inArray(libraryImportJobsTable.id, [sourceJobId, newerJobRow!.id]));
    },
    15_000,
  );
});

// ── Retry pass with no newer import snapshot — unconditional resolution ───────
//
// When no newer completed import job exists for the user+service pair,
// `newerSnapshot` is undefined and `currentLibraryKeys` is null.  The retry
// pass must resolve all un-cached entries unconditionally (no filtering step).
//
// Setup:
//   1. Insert a source job (status=done, total=1, resolved=0, bufferJson present,
//      retryExhausted=false, finishedAt=now) with a single unresolved track.
//   2. Do NOT create any newer completed import job for this user+service.
//   3. Call runPhase3RetryPass — mockResolveByText is set to return MBID_NO_SNAP.
//   4. Assert MBID_NO_SNAP appears in library_items and mockResolveByText was
//      called (track was not filtered out before MB I/O).

describe("Retry pass — no newer import snapshot: all uncached tracks resolved unconditionally", () => {
  it(
    "resolves every un-cached entry into library_items when no newer completed job exists",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      mockResolveByText.mockResolvedValue(MBID_NO_SNAP);

      // ── 1. Seed the source job directly (bypassing runImportWorker) ────────
      // This is the only completed import job for this user+service with a
      // bufferJson — no newer one will exist, so newerSnapshot will be undefined.
      const [sourceJobRow] = await db
        .insert(libraryImportJobsTable)
        .values({
          userId,
          service: "spotify",
          status: "done",
          phase: "resolve",
          total: 1,
          resolved: 0,
          retryExhausted: false,
          bufferJson: [
            {
              artist: ARTIST,
              title: "NoSnap Track",
              isrc: null,
              durationMs: null,
              externalId: NO_SNAP_EXT_ID,
            },
          ],
          startedAt: new Date(),
          finishedAt: new Date(),
        })
        .returning({ id: libraryImportJobsTable.id });
      const sourceJobId = sourceJobRow!.id;

      // ── 2. Run the retry pass (no newer job exists for this user+service) ──
      await runPhase3RetryPass();

      // ── 3. Assert the track landed in library_items ────────────────────────
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libRows.map((r) => r.mbid)).toContain(MBID_NO_SNAP);

      // ── 4. Assert MB resolution was reached (no filtering step skipped it) ─
      expect(mockResolveByText).toHaveBeenCalled();

      // Clean up the source job (afterAll covers library_items + recordings).
      await db
        .delete(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, sourceJobId));
    },
    15_000,
  );
});

// ── Retry-pass FK-failure resilience ─────────────────────────────────────────
//
// Simulates the race condition where a recordings row disappears between the
// retry pass's MB resolve (which seeds the spine row) and its library_items
// insert, producing a 23503 FK violation.  The retry pass must:
//   • catch the error and not crash (job reaches "done")
//   • leave the track absent from library_items (the insert genuinely failed)
//   • leave the track absent from spotify_library_items (no promotion occurred)

describe("Retry pass — library_items FK violation: pass reaches done, track stays absent", () => {
  it(
    "does not appear in library_items or spotify_library_items and retry job reaches done when insert throws 23503",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();

      // resolveByText returns MBID_RETRY_FK so the pass reaches the insert path.
      // The recordings row will be seeded by the retry pass itself (onConflictDoNothing).
      mockResolveByText.mockResolvedValue(MBID_RETRY_FK);

      // ── 1. Seed the source job directly ───────────────────────────────────
      const [sourceJobRow] = await db
        .insert(libraryImportJobsTable)
        .values({
          userId,
          service: "spotify",
          status: "done",
          phase: "resolve",
          total: 1,
          resolved: 0,
          retryExhausted: false,
          bufferJson: [
            {
              artist: ARTIST,
              title: "RetryFK Track",
              isrc: null,
              durationMs: null,
              externalId: RETRY_FK_EXT_ID,
            },
          ],
          startedAt: new Date(),
          finishedAt: new Date(),
        })
        .returning({ id: libraryImportJobsTable.id });
      const sourceJobId = sourceJobRow!.id;

      // ── 2. Inject the FK violation on the library_items insert ────────────
      const fkErr = Object.assign(
        new Error(
          'insert or update on table "library_items" violates foreign key ' +
          'constraint "library_items_mbid_fkey"',
        ),
        { code: "23503", constraint: "library_items_mbid_fkey" },
      );

      const origInsert = (db as any).insert.bind(db);
      let fkInjected = false;

      const insertSpy = vi
        .spyOn(db as any, "insert")
        .mockImplementation((table: unknown) => {
          if (!fkInjected && table === libraryItemsTable) {
            fkInjected = true;
            const fakeBuilder: Record<string, unknown> = {};
            fakeBuilder["values"] = () => fakeBuilder;
            fakeBuilder["onConflictDoNothing"] = () => fakeBuilder;
            fakeBuilder["then"] = (
              onFulfilled: ((v: unknown) => unknown) | null | undefined,
              onRejected: ((e: unknown) => unknown) | null | undefined,
            ) => Promise.reject(fkErr).then(onFulfilled, onRejected);
            return fakeBuilder;
          }
          return origInsert(table);
        });

      // ── 3. Run the retry pass ──────────────────────────────────────────────
      await runPhase3RetryPass();

      insertSpy.mockRestore();

      // ── 4. Assertions ─────────────────────────────────────────────────────

      // library_items must NOT contain the track.
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(libRows.map((r) => r.mbid)).not.toContain(MBID_RETRY_FK);

      // spotify_library_items must NOT contain the soft row — no promotion occurred.
      const softRows = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(eq(spotifyLibraryItemsTable.userId, userId));
      expect(softRows.map((r) => r.spotifyId)).not.toContain(RETRY_FK_EXT_ID);

      // The retry job itself must have reached "done" despite the FK failure.
      // (The source job's retryAttempts counter increments; that's fine.)
      const allJobs = await db
        .select({ status: libraryImportJobsTable.status, id: libraryImportJobsTable.id })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.userId, userId));
      // The retry job (not the source job) must be "done".
      const retryJob = allJobs.find((j) => j.id !== sourceJobId && j.status === "done");
      expect(retryJob).toBeDefined();

      // Clean up the source job.
      await db
        .delete(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, sourceJobId));
    },
    15_000,
  );
});

// ── Re-import preservation: tracks absent from Spotify are not deleted ────────
//
// When a user removes a track from Spotify (or Spotify revokes it due to
// licensing), a subsequent re-import must NOT delete the existing library_items
// row.  Two provenance cases are covered:
//   • provenance.kind = "import" — a track that was imported via Spotify
//   • provenance.kind = "keep"   — a track the user explicitly kept in Lore
// The connector yields neither track, simulating Spotify having removed both
// since the prior import.  Both rows must survive the re-import.

describe("Re-import preservation — tracks absent from Spotify survive re-import", () => {
  it("keeps both 'import' and 'keep' provenance rows after a re-import that omits them", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // Pre-seed two library_items rows using recordings already in the spine
    // (MBID_P1 and MBID_P2 were seeded in beforeAll).
    await db
      .insert(libraryItemsTable)
      .values([
        {
          userId,
          mbid: MBID_P1,
          provenance: { kind: "import", service: "spotify" } as LibraryItemProvenance,
          addedAt: new Date(),
        },
        {
          userId,
          mbid: MBID_P2,
          provenance: { kind: "keep" } as LibraryItemProvenance,
          addedAt: new Date(),
        },
      ])
      .onConflictDoNothing();

    // Connector yields a completely different track — neither MBID_P1 nor MBID_P2.
    // resolveByText returns null so the new track stays unresolved.
    mockResolveByText.mockResolvedValue(null);
    setupConnector([
      { artist: ARTIST, title: "Preservation New Track", externalId: "sp-preservation-new" },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // Both pre-seeded rows must still be in library_items after the re-import.
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    const mbids = items.map((r) => r.mbid);
    expect(mbids).toContain(MBID_P1);
    expect(mbids).toContain(MBID_P2);

    // Job must reach "done" cleanly.
    const [job] = await db
      .select({ status: libraryImportJobsTable.status })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jid));
    expect(job!.status).toBe("done");
  });
});
