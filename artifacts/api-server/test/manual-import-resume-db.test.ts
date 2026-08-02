/**
 * Integration tests for markOrphanedImportJobsAsError + runManualImportWorker
 * resume path.
 *
 * Confirms that:
 *   Resume   — a manual import job that was running mid-Phase-3 (bufferJson
 *              stored, status=running) is resumed by markOrphanedImportJobsAsError
 *              rather than being marked as error.
 *
 *   No-dup   — tracks whose normalised key is already in the resolution cache
 *              are not re-inserted into library_items when the worker resumes
 *              (onConflictDoNothing + Phase 2 cache hit together prevent
 *              duplicate rows).
 *
 *   Dead job — non-manual jobs (e.g. service="spotify") with no stored buffer
 *              ARE marked as error by markOrphanedImportJobsAsError.
 *
 * Self-skips when no real DB is available (same pattern as import-resume-db.test.ts).
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, and, inArray, count, isNull } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  libraryImportJobsTable,
  libraryItemsTable,
  recordingsTable,
  resolutionCacheTable,
  type ImportBufferEntry,
} from "@workspace/db";

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const { mockResolveByText, mockResolveByIsrc } = vi.hoisted(() => ({
  mockResolveByText: vi.fn<[string, string, (AbortSignal | undefined)?], Promise<string | null>>(),
  mockResolveByIsrc: vi.fn<[string, (AbortSignal | undefined)?], Promise<string | null>>(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────

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

// ── Deferred imports ─────────────────────────────────────────────────────────

import {
  markOrphanedImportJobsAsError,
  runManualImportWorker,
  NULL_CACHE_MISS_MAX_AGE_MS,
} from "../src/routes/me/index.js";

// normalizeKey is pure and its real implementation is preserved by the mock
// (the mock only replaces resolveToMbid). Import it after vi.mock is hoisted.
import { normalizeKey } from "../src/lore/resolve.js";

// ── Unique IDs per test run ──────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);
const ARTIST = `ManualResume ${run}`;

// Two tracks that will be pre-seeded in the resolution cache.
const MBID_A = `test-mr-a-${run}`;
const MBID_B = `test-mr-b-${run}`;
// A third track with no cache entry — MB returns null (unresolvable).
const TRACK_C_TITLE = `Unresolvable ${run}`;
// A fourth track used for the stale-null-miss test: MB now returns a real MBID.
const MBID_D = `test-mr-d-${run}`;
const TRACK_D_TITLE = `StaleNull ${run}`;

// ── DB state ─────────────────────────────────────────────────────────────────

let dbAvailable = false;
let userId: number;

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
    .values({ spotifyUserId: `test-mr-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // 2. Recording spine rows so library_items FK is satisfied.
  await db.insert(recordingsTable).values([
    { mbid: MBID_A, title: `Track A ${run}`, artist: ARTIST },
    { mbid: MBID_B, title: `Track B ${run}`, artist: ARTIST },
    { mbid: MBID_D, title: TRACK_D_TITLE, artist: ARTIST },
  ]);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  // import_items has a FK to library_import_jobs — delete child rows first.
  await db.execute(sql`DELETE FROM import_items WHERE user_id = ${userId}`);
  await db.delete(libraryImportJobsTable).where(eq(libraryImportJobsTable.userId, userId));
  await db
    .delete(resolutionCacheTable)
    .where(
      inArray(resolutionCacheTable.mbid, [MBID_A, MBID_B, MBID_D]),
    );
  // Also clean up any null-mbid cache entries written for TRACK_C / TRACK_D by key.
  await db
    .delete(resolutionCacheTable)
    .where(
      and(
        inArray(resolutionCacheTable.key, [
          normalizeKey(ARTIST, TRACK_C_TITLE),
          normalizeKey(ARTIST, TRACK_D_TITLE),
        ]),
        isNull(resolutionCacheTable.mbid),
      ),
    );
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID_A, MBID_B, MBID_D]));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
});

// Wipe per-test state between tests.
beforeEach(async () => {
  if (!dbAvailable) return;
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  // import_items has a FK to library_import_jobs — delete child rows first.
  await db.execute(sql`DELETE FROM import_items WHERE user_id = ${userId}`);
  await db.delete(libraryImportJobsTable).where(eq(libraryImportJobsTable.userId, userId));
  await db.delete(resolutionCacheTable).where(inArray(resolutionCacheTable.mbid, [MBID_A, MBID_B, MBID_D]));
  // Also wipe null-mbid cache entries for TRACK_C and TRACK_D (keyed by artist+title).
  await db
    .delete(resolutionCacheTable)
    .where(
      and(
        inArray(resolutionCacheTable.key, [
          normalizeKey(ARTIST, TRACK_C_TITLE),
          normalizeKey(ARTIST, TRACK_D_TITLE),
        ]),
        isNull(resolutionCacheTable.mbid),
      ),
    );
  mockResolveByText.mockReset();
  mockResolveByIsrc.mockReset();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Poll the DB until the job reaches a terminal status, or throw on timeout. */
async function waitForJobDone(jobId: number, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ status: libraryImportJobsTable.status })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jobId))
      .limit(1);
    if (row && row.status !== "running" && row.status !== "pending") {
      return row.status;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`job=${jobId} did not reach terminal status within ${timeoutMs}ms`);
}

/** Seed two resolution cache entries for tracks A and B. */
async function seedResolutionCache() {
  await db
    .insert(resolutionCacheTable)
    .values([
      { key: normalizeKey(ARTIST, `Track A ${run}`), mbid: MBID_A },
      { key: normalizeKey(ARTIST, `Track B ${run}`), mbid: MBID_B },
    ])
    .onConflictDoNothing();
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ── Test 1: mid-Phase-3 interrupt → job resumed (not errored) ────────────────
//
// A manual import job that was mid-Phase-3 resolution when the server restarted
// (status=running, phase=resolve, bufferJson stored) must be resumed by
// markOrphanedImportJobsAsError, not marked as error.  The function calls
// runManualImportWorker via setImmediate so we poll the DB for the terminal state.

describe("mid-Phase-3 interrupt — job resumed, not errored", () => {
  it("resumes a manual import job whose buffer was stored during Phase 3", async () => {
    if (!dbAvailable) return;

    await seedResolutionCache();

    // All cache-hit tracks — MB resolver is never needed.
    mockResolveByText.mockResolvedValue(null);

    const buffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: `Track A ${run}`, isrc: null, durationMs: null, externalId: `mr-a-${run}` },
      { artist: ARTIST, title: `Track B ${run}`, isrc: null, durationMs: null, externalId: `mr-b-${run}` },
    ];

    // Seed the orphaned job: status=running, phase=resolve, bufferJson populated.
    // This simulates a mid-Phase-3 interrupt — the server restarted while the
    // worker was iterating through MB resolution.
    const [orphan] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "manual",
        status: "running",
        phase: "resolve",
        total: buffer.length,
        resolved: 0,
        bufferJson: buffer,
        startedAt: new Date(Date.now() - 5 * 60_000), // 5 min ago — not a zombie
      })
      .returning({ id: libraryImportJobsTable.id });
    const jobId = orphan!.id;

    // markOrphanedImportJobsAsError must recognise this as resumable and call
    // setImmediate(() => runManualImportWorker(...)) instead of marking it error.
    await markOrphanedImportJobsAsError([userId]);

    // Flush the setImmediate tick so the worker is at least queued, then poll
    // until the worker completes.
    await new Promise((r) => setImmediate(r));
    const finalStatus = await waitForJobDone(jobId);

    expect(finalStatus).toBe("done");

    // Both cache-hit tracks must be in the library.
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    const mbids = items.map((r) => r.mbid).sort();
    expect(mbids).toContain(MBID_A);
    expect(mbids).toContain(MBID_B);
  });
});

// ── Test 2: non-manual job with no buffer is marked error ────────────────────
//
// A Spotify import job (service≠"manual") that was running with no stored
// buffer must be marked error — it cannot be resumed without re-fetching.

describe("non-manual running job — marked error, not resumed", () => {
  it("marks a running Spotify job as error when there is no stored buffer", async () => {
    if (!dbAvailable) return;

    const [deadJob] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "spotify",
        status: "running",
        phase: "fetching",
        total: 10,
        resolved: 2,
        // bufferJson intentionally absent — not resumable
        startedAt: new Date(Date.now() - 3 * 60_000),
      })
      .returning({ id: libraryImportJobsTable.id });
    const jobId = deadJob!.id;

    await markOrphanedImportJobsAsError([userId]);

    // One setImmediate tick — dead jobs are updated synchronously (no worker
    // is dispatched), but let the event loop drain cleanly anyway.
    await new Promise((r) => setImmediate(r));

    const [row] = await db
      .select({ status: libraryImportJobsTable.status, error: libraryImportJobsTable.error })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jobId))
      .limit(1);

    expect(row!.status).toBe("error");
    expect(row!.error).toMatch(/server restarted/i);
  });
});

// ── Test 3: already-resolved tracks are not re-inserted as duplicates ─────────
//
// When a resumed worker runs Phase 2 and finds resolution cache hits for all
// buffer entries, it must not create duplicate library_items rows — even if
// the item was already saved before the interrupt.
//
// Scenario:
//   • Track A was already resolved and saved to library_items before the crash.
//   • Track B was resolved to the cache but not yet saved (or also already saved).
//   • The resumed worker hits Phase 2 for both → onConflictDoNothing on both.
//   • Final library_items count for this user must be exactly 2, not 3 or 4.

describe("already-resolved tracks — no duplicate library_items on resume", () => {
  it("does not re-insert tracks that are already in library_items", async () => {
    if (!dbAvailable) return;

    await seedResolutionCache();
    mockResolveByText.mockResolvedValue(null);

    // Pre-insert track A as if it was saved before the server restart.
    await db
      .insert(libraryItemsTable)
      .values({
        userId,
        mbid: MBID_A,
        provenance: { kind: "import", service: "manual" },
        addedAt: new Date(),
      })
      .onConflictDoNothing();

    const buffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: `Track A ${run}`, isrc: null, durationMs: null, externalId: `mr-dup-a-${run}` },
      { artist: ARTIST, title: `Track B ${run}`, isrc: null, durationMs: null, externalId: `mr-dup-b-${run}` },
    ];

    // Seed the interrupted job.
    const [orphan] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "manual",
        status: "running",
        phase: "resolve",
        total: buffer.length,
        resolved: 1, // A was already counted before the crash
        bufferJson: buffer,
        startedAt: new Date(Date.now() - 2 * 60_000),
      })
      .returning({ id: libraryImportJobsTable.id });
    const jobId = orphan!.id;

    await markOrphanedImportJobsAsError([userId]);
    await new Promise((r) => setImmediate(r));
    await waitForJobDone(jobId);

    // library_items must contain exactly 2 distinct rows — no duplicates.
    const [{ value: itemCount }] = await db
      .select({ value: count() })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));

    expect(Number(itemCount)).toBe(2);

    // Each mbid appears exactly once.
    const mbidRows = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(
        and(
          eq(libraryItemsTable.userId, userId),
          inArray(libraryItemsTable.mbid, [MBID_A, MBID_B]),
        ),
      );
    expect(mbidRows).toHaveLength(2);
    const mbidSet = new Set(mbidRows.map((r) => r.mbid));
    expect(mbidSet.has(MBID_A)).toBe(true);
    expect(mbidSet.has(MBID_B)).toBe(true);
  });
});

// ── Test 4: mixed queue — only manual jobs with buffer are resumed ─────────────
//
// When there are multiple orphaned jobs for the same user, only manual+bufferJson
// jobs are resumed; the rest are marked error.

describe("mixed orphaned queue — manual+buffer resumed, others errored", () => {
  it("resumes only the manual job with stored buffer; marks the rest as error", async () => {
    if (!dbAvailable) return;

    await seedResolutionCache();
    mockResolveByText.mockResolvedValue(null);

    const buffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: `Track A ${run}`, isrc: null, durationMs: null, externalId: `mr-mix-a-${run}` },
    ];

    // Job 1: manual with buffer — resumable.
    const [resumableRow] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "manual",
        status: "running",
        phase: "resolve",
        total: 1,
        resolved: 0,
        bufferJson: buffer,
        startedAt: new Date(Date.now() - 4 * 60_000),
      })
      .returning({ id: libraryImportJobsTable.id });
    const resumableId = resumableRow!.id;

    // Job 2: manual without buffer — not resumable.
    const [deadManualRow] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "manual",
        status: "pending",
        phase: null,
        total: 5,
        resolved: 0,
        // no bufferJson
        startedAt: new Date(Date.now() - 1 * 60_000),
      })
      .returning({ id: libraryImportJobsTable.id });
    const deadManualId = deadManualRow!.id;

    await markOrphanedImportJobsAsError([userId]);
    await new Promise((r) => setImmediate(r));

    // Dead manual job should be errored immediately (no worker).
    const [deadRow] = await db
      .select({ status: libraryImportJobsTable.status })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, deadManualId))
      .limit(1);
    expect(deadRow!.status).toBe("error");

    // Resumable job should eventually reach "done".
    const finalStatus = await waitForJobDone(resumableId);
    expect(finalStatus).toBe("done");
  });
});

// ── Test 5: runManualImportWorker directly — cache hit skips Phase 3 ──────────
//
// When all buffer tracks are already in the resolution cache, Phase 3 is
// entirely skipped and the MB resolver is never called.  This confirms the
// Phase 2 fast-path works and that resolved counts are accurate.

describe("runManualImportWorker directly — Phase 2 cache hits skip Phase 3", () => {
  it("resolves all tracks via cache without calling the MB resolver", async () => {
    if (!dbAvailable) return;

    await seedResolutionCache();
    // resolveByText must never be called when Phase 2 covers everything.
    mockResolveByText.mockRejectedValue(new Error("resolveByText must not be called"));

    const buffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: `Track A ${run}`, isrc: null, durationMs: null, externalId: `mr-direct-a-${run}` },
      { artist: ARTIST, title: `Track B ${run}`, isrc: null, durationMs: null, externalId: `mr-direct-b-${run}` },
    ];

    const [job] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "manual",
        status: "running",
        phase: "resolve",
        total: buffer.length,
        resolved: 0,
        bufferJson: buffer,
        startedAt: new Date(),
      })
      .returning({ id: libraryImportJobsTable.id });
    const jobId = job!.id;

    await runManualImportWorker(jobId, userId, buffer);

    // Worker completed without throwing.
    const [row] = await db
      .select({
        status: libraryImportJobsTable.status,
        resolved: libraryImportJobsTable.resolved,
        total: libraryImportJobsTable.total,
      })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jobId))
      .limit(1);

    expect(row!.status).toBe("done");
    expect(row!.resolved).toBe(2);
    expect(row!.total).toBe(2);

    // MB resolver was never invoked.
    expect(mockResolveByText).not.toHaveBeenCalled();
  });
});

// ── Test 6: unresolvable third track — job still completes ───────────────────
//
// If one track has no cache entry and MB returns null (unresolvable), the
// worker must still finish as "done" with resolved < total, rather than
// getting stuck or marking error.

describe("unresolvable track — worker still completes as done", () => {
  it("finishes as done with resolved < total when one track cannot be resolved", async () => {
    if (!dbAvailable) return;

    await seedResolutionCache();
    // Track C has no cache entry; MB returns null.
    mockResolveByText.mockResolvedValue(null);

    const buffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: `Track A ${run}`, isrc: null, durationMs: null, externalId: `mr-u-a-${run}` },
      { artist: ARTIST, title: `Track B ${run}`, isrc: null, durationMs: null, externalId: `mr-u-b-${run}` },
      { artist: ARTIST, title: TRACK_C_TITLE, isrc: null, durationMs: null, externalId: `mr-u-c-${run}` },
    ];

    const [job] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "manual",
        status: "running",
        phase: "resolve",
        total: buffer.length,
        resolved: 0,
        bufferJson: buffer,
        startedAt: new Date(),
      })
      .returning({ id: libraryImportJobsTable.id });
    const jobId = job!.id;

    await runManualImportWorker(jobId, userId, buffer);

    const [row] = await db
      .select({
        status: libraryImportJobsTable.status,
        resolved: libraryImportJobsTable.resolved,
        total: libraryImportJobsTable.total,
      })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jobId))
      .limit(1);

    expect(row!.status).toBe("done");
    // Tracks A and B resolved via cache; Track C unresolvable.
    expect(row!.resolved).toBe(2);
    expect(row!.total).toBe(3);

    // Library should contain only A and B.
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    expect(items.map((r) => r.mbid).sort()).toEqual([MBID_A, MBID_B].sort());
  });
});

// ── Test 7: stale null-miss cache entry — Phase 3 re-resolves the track ───────
//
// If a null-mbid resolution cache entry is older than NULL_CACHE_MISS_MAX_AGE_MS
// (MusicBrainz may have indexed the track since the miss was written), Phase 2
// must treat it as expired and NOT add it to matchedIdx.  Phase 3 then gets a
// fresh attempt and — if MB now returns a real MBID — saves the track.

describe("stale null-miss cache — Phase 3 re-resolves an aged-out null entry", () => {
  it("re-resolves a track whose null cache entry is older than the max-age threshold", async () => {
    if (!dbAvailable) return;

    const staleCacheKey = normalizeKey(ARTIST, TRACK_D_TITLE);

    // Insert a null-mbid cache entry with updated_at in the past (8 days ago —
    // beyond the 7-day NULL_CACHE_MISS_MAX_AGE_MS threshold).
    const staleAge = NULL_CACHE_MISS_MAX_AGE_MS + 24 * 60 * 60_000; // 8 days in ms
    await db.execute(sql`
      INSERT INTO resolution_cache (key, mbid, confidence, created_at, updated_at)
      VALUES (
        ${staleCacheKey},
        NULL,
        'unresolved',
        NOW() - (${staleAge.toString()} || ' milliseconds')::interval,
        NOW() - (${staleAge.toString()} || ' milliseconds')::interval
      )
      ON CONFLICT (key) DO UPDATE
        SET mbid = NULL,
            confidence = 'unresolved',
            updated_at = NOW() - (${staleAge.toString()} || ' milliseconds')::interval
    `);

    // MB now returns a real MBID for this track (it was indexed since the miss).
    mockResolveByText.mockResolvedValue(MBID_D);

    const buffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: TRACK_D_TITLE, isrc: null, durationMs: null, externalId: `mr-stale-d-${run}` },
    ];

    const [job] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "manual",
        status: "running",
        phase: "resolve",
        total: buffer.length,
        resolved: 0,
        bufferJson: buffer,
        startedAt: new Date(),
      })
      .returning({ id: libraryImportJobsTable.id });
    const jobId = job!.id;

    await runManualImportWorker(jobId, userId, buffer);

    const [row] = await db
      .select({
        status: libraryImportJobsTable.status,
        resolved: libraryImportJobsTable.resolved,
        total: libraryImportJobsTable.total,
      })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, jobId))
      .limit(1);

    expect(row!.status).toBe("done");
    expect(row!.resolved).toBe(1);
    expect(row!.total).toBe(1);

    // The track must appear in library_items — Phase 3 resolved it.
    const items = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, userId), eq(libraryItemsTable.mbid, MBID_D)));
    expect(items).toHaveLength(1);

    // MB resolver was called exactly once (Phase 3 ran for this track).
    expect(mockResolveByText).toHaveBeenCalledTimes(1);
    expect(mockResolveByText).toHaveBeenCalledWith(ARTIST, TRACK_D_TITLE, expect.anything());
  });
});
