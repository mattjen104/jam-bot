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
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  serviceConnectionsTable,
  libraryImportJobsTable,
  libraryItemsTable,
  recordingsTable,
  resolutionCacheTable,
} from "@workspace/db";

// ── Hoisted mock fns (created before vi.mock factories are evaluated) ────────

const { mockImportLibrary } = vi.hoisted(() => ({
  mockImportLibrary: vi.fn(),
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
// bound resolveToMbid with a spy so we can control what it returns and count
// how many times it was called.
vi.mock("../src/lore/resolve.js", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("../src/lore/resolve.js")>();
  return { ...orig, resolveToMbid: vi.fn() };
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
// Import the worker function under test.
import { runImportWorker } from "../src/routes/me/index.js";

// ── Test-run-scoped unique IDs ───────────────────────────────────────────────

const run = randomUUID().slice(0, 8);

const MBID_P1  = `test-iw-p1-${run}`;   // resolved via Phase 1 ISRC match
const MBID_P2  = `test-iw-p2-${run}`;   // resolved via Phase 2 cache hit
const MBID_P3A = `test-iw-p3a-${run}`;  // Phase 3, resolveToMbid fromCache=true
const MBID_P3B = `test-iw-p3b-${run}`;  // Phase 3, resolveToMbid fromCache=false
const MBIDS_ALL = [MBID_P1, MBID_P2, MBID_P3A, MBID_P3B];

// ISRC for the Phase 1 track (must be ≤ 12 chars and unique).
const ISRC_P1 = `TS${run.toUpperCase()}01`.slice(0, 12);

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
  //    library_items inserts in all phases.
  await db.insert(recordingsTable).values([
    { mbid: MBID_P1,  title: "Phase1 Track",  artist: ARTIST, isrc: ISRC_P1 },
    { mbid: MBID_P2,  title: "Phase2 Track",  artist: ARTIST },
    { mbid: MBID_P3A, title: "Phase3A Track", artist: ARTIST },
    { mbid: MBID_P3B, title: "Phase3B Track", artist: ARTIST },
  ]);

  // 4. resolution_cache entry for Phase 2 (text-key hit for the Phase 2 track).
  const { normalizeKey } = resolveModule;
  await db.insert(resolutionCacheTable).values({
    key: normalizeKey(ARTIST, "Phase2 Track"),
    mbid: MBID_P2,
    confidence: "text",
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  // Clean up in reverse FK order.
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
    .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST, "Phase2 Track")));
  await db
    .delete(recordingsTable)
    .where(inArray(recordingsTable.mbid, MBIDS_ALL));
  await db
    .delete(loreUsersTable)
    .where(eq(loreUsersTable.id, userId));
});

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

    setupConnector([
      { artist: ARTIST, title: "Phase1 Track", isrc: ISRC_P1, externalId: "sp-p1" },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // resolveToMbid must never have been called.
    expect(resolveToMbid).not.toHaveBeenCalled();

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

    // Track has NO isrc, so Phase 1 won't pick it up.
    // Its artist+title normalises to the key we seeded in resolution_cache.
    setupConnector([
      { artist: ARTIST, title: "Phase2 Track", externalId: "sp-p2" },
    ]);

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    expect(resolveToMbid).not.toHaveBeenCalled();

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

// ── Phase 3 test — fromCache=true (no sleep) ─────────────────────────────────

describe("Phase 3 — serial MB resolution, fromCache=true skips sleep", () => {
  it("calls resolveToMbid but does NOT schedule a 1100 ms sleep", async () => {
    if (!dbAvailable) return;

    const resolveToMbid = vi.mocked(resolveModule.resolveToMbid);
    resolveToMbid.mockClear();

    // This track has neither an ISRC in recordings nor a cache entry, so it
    // falls through to Phase 3.
    resolveToMbid.mockResolvedValue({
      mbid: MBID_P3A,
      confidence: "text",
      title: "Phase3A Track",
      artist: ARTIST,
      fromCache: true,  // <── cache hit: no MB network call, no sleep
    });

    setupConnector([
      { artist: ARTIST, title: "Phase3A Track", externalId: "sp-p3a" },
    ]);

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // resolveToMbid must have been called for this track.
    expect(resolveToMbid).toHaveBeenCalledTimes(1);

    // The 1.1 s rate-limit sleep must NOT have been scheduled.
    const sleepCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 1100,
    );
    expect(sleepCalls).toHaveLength(0);

    setTimeoutSpy.mockRestore();

    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    expect(items.map((r) => r.mbid)).toContain(MBID_P3A);
  });
});

// ── Phase 3 test — fromCache=false (sleep fires once) ───────────────────────

describe("Phase 3 — serial MB resolution, fromCache=false triggers sleep", () => {
  it(
    "calls resolveToMbid AND schedules the 1100 ms MB rate-limit sleep",
    async () => {
      if (!dbAvailable) return;

      const resolveToMbid = vi.mocked(resolveModule.resolveToMbid);
      resolveToMbid.mockClear();

      // fromCache=false signals a real MusicBrainz network call was made.
      resolveToMbid.mockResolvedValue({
        mbid: MBID_P3B,
        confidence: "text",
        title: "Phase3B Track",
        artist: ARTIST,
        fromCache: false, // <── real MB call: sleep must fire
      });

      setupConnector([
        { artist: ARTIST, title: "Phase3B Track", externalId: "sp-p3b" },
      ]);

      // Spy on setTimeout WITHOUT faking it — the real 1.1 s sleep will still
      // run, but we can inspect what delay values were requested.
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const jid = await createJob();
      // The worker sleeps 1100 ms for a fromCache=false track; let it complete.
      await runImportWorker(jid, userId, "spotify", connRow);

      // At least one setTimeout must have been called with 1100 ms.
      const sleepCalls = setTimeoutSpy.mock.calls.filter(
        ([, delay]) => delay === 1100,
      );
      expect(sleepCalls.length).toBeGreaterThanOrEqual(1);

      setTimeoutSpy.mockRestore();

      expect(resolveToMbid).toHaveBeenCalledTimes(1);

      const items = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(items.map((r) => r.mbid)).toContain(MBID_P3B);

      const [job] = await db
        .select({ status: libraryImportJobsTable.status })
        .from(libraryImportJobsTable)
        .where(eq(libraryImportJobsTable.id, jid));
      expect(job!.status).toBe("done");
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

// ── Mixed-phase regression test ──────────────────────────────────────────────

describe("Mixed all-3 phases — large re-import short-circuit", () => {
  it("resolves Phase1+Phase2 without resolveToMbid; calls it only for Phase3", async () => {
    if (!dbAvailable) return;

    const resolveToMbid = vi.mocked(resolveModule.resolveToMbid);
    resolveToMbid.mockClear();

    // Phase 3 track only — fromCache=true so no sleep needed.
    resolveToMbid.mockResolvedValue({
      mbid: MBID_P3A,
      confidence: "text",
      title: "Phase3A Track",
      artist: ARTIST,
      fromCache: true,
    });

    // Buffer: one track from each phase.
    setupConnector([
      { artist: ARTIST, title: "Phase1 Track",  isrc: ISRC_P1, externalId: "sp-mix-p1"  },
      { artist: ARTIST, title: "Phase2 Track",                  externalId: "sp-mix-p2"  },
      { artist: ARTIST, title: "Phase3A Track",                 externalId: "sp-mix-p3a" },
    ]);

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const jid = await createJob();
    await runImportWorker(jid, userId, "spotify", connRow);

    // Only the Phase 3 track reached resolveToMbid.
    expect(resolveToMbid).toHaveBeenCalledTimes(1);

    // No 1.1 s sleep — the one Phase 3 call returned fromCache=true.
    const sleepCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 1100,
    );
    expect(sleepCalls).toHaveLength(0);

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
