/**
 * Integration tests for the ListenBrainz import endpoint and worker.
 *
 * Confirms that:
 *   Bad username  — POST /api/me/library/import/listenbrainz with a username
 *                   that doesn't exist on ListenBrainz returns 400 with the
 *                   username in the error message; no job row is created.
 *
 *   Valid username — the same endpoint with a valid username returns 202 with
 *                   a numeric jobId; a library_import_jobs row is created.
 *
 *   Tier-1 path   — items whose recordingMbid is populated skip Phases 2-3
 *                   and are written directly to library_items (and recordings
 *                   if not already present) with zero MB resolver calls.
 *
 * Self-skips when no real DB is available (same pattern as other *-db.test.ts
 * files).
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, inArray } from "drizzle-orm";
import request from "supertest";
import {
  db,
  loreUsersTable,
  libraryImportJobsTable,
  libraryItemsTable,
  importItemsTable,
  recordingsTable,
  type ImportItem,
} from "@workspace/db";

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const {
  mockValidateUsername,
  mockFetchLoved,
  mockResolveByText,
  mockResolveByIsrc,
} = vi.hoisted(() => ({
  mockValidateUsername: vi.fn<[string], Promise<boolean>>(),
  mockFetchLoved: vi.fn<
    [string, unknown],
    AsyncIterable<ImportItem>
  >(),
  mockResolveByText: vi.fn<
    [string, string, (AbortSignal | undefined)?],
    Promise<string | null>
  >(),
  mockResolveByIsrc: vi.fn<
    [string, (AbortSignal | undefined)?],
    Promise<string | null>
  >(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────

// Replace network-bound LB functions with controllable spies.
vi.mock("../src/lore/listenbrainz.js", () => ({
  validateListenBrainzUsername: mockValidateUsername,
  fetchListenBrainzLoved: mockFetchLoved,
}));

// Pass-through token crypto so the worker never needs a real crypto env.
vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

// Connector mock — not used by the LB worker but evaluated at module load.
vi.mock("../src/lore/serviceConnector.js", () => ({
  getConnector: vi.fn().mockReturnValue({ importLibrary: vi.fn() }),
  getFreshServiceToken: vi.fn(),
  refreshServiceToken: vi.fn(),
}));

// Keep pure helpers but stub the network-bound resolver.
vi.mock("../src/lore/resolve.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lore/resolve.js")>();
  return { ...orig, resolveToMbid: vi.fn() };
});

// Stub the MB resolver factory used by Phase 3.
vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...orig,
    createMbResolver: vi.fn().mockReturnValue({
      resolveByIsrc: mockResolveByIsrc,
      resolveByText: mockResolveByText,
      resolveByTextWithScore: vi.fn(async (artist: string, title: string, signal?: AbortSignal) => {
        const mbid = await mockResolveByText(artist, title, signal);
        return mbid ? { mbid, score: 95 } : null;
      }),
    }),
  };
});

// Stub Spotify live-check seam (evaluated at module load by the me-router).
vi.mock("../src/routes/me/spotify-library-check.js", () => ({
  checkSpotifyLibraryContains: vi.fn(),
}));

// Auth: getUserFromSession is replaced per-test below so the middleware injects
// the correct test user without touching the DB.
vi.mock("../src/lore/userSession.js", () => ({
  getUserFromSession: vi.fn(),
  getOrCreateAnonymousUser: vi.fn(),
  recoverUserByServiceId: vi.fn(),
  sidFromRequest: vi.fn(),
  upsertLoreUserForSid: vi.fn(),
  SID_COOKIE: "lore_sid",
  cookieSidOpts: vi.fn(() => ({})),
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

// ── Deferred imports (after mocks are registered) ────────────────────────────

import app from "../src/app.js";
import { runListenBrainzImportWorker } from "../src/routes/me/library.js";
import * as userSessionModule from "../src/lore/userSession.js";

// ── Unique IDs per test run ──────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);
const ARTIST = `LB Test ${run}`;

// MBIDs for the Tier-1 path test — two tracks with known recording MBIDs.
const MBID_T1A = `test-lb-t1a-${run}`;
const MBID_T1B = `test-lb-t1b-${run}`;
const MBIDS_ALL = [MBID_T1A, MBID_T1B];

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

  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `test-lb-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db
    .delete(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, userId));
  await db
    .delete(importItemsTable)
    .where(eq(importItemsTable.userId, userId));
  await db
    .delete(libraryImportJobsTable)
    .where(eq(libraryImportJobsTable.userId, userId));
  await db
    .delete(recordingsTable)
    .where(inArray(recordingsTable.mbid, MBIDS_ALL));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Poll DB until job reaches a terminal status or throws on timeout. */
async function waitForJobDone(
  jobId: number,
  timeoutMs = 10_000,
): Promise<string> {
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
  throw new Error(
    `job=${jobId} did not reach terminal status within ${timeoutMs}ms`,
  );
}

/** Inject the test loreUser into every request via the auth middleware mock. */
function injectUser() {
  vi.mocked(userSessionModule.getUserFromSession).mockResolvedValue({
    id: userId,
    spotifyUserId: `test-lb-${run}`,
    deviceKey: randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    displayName: null,
    avatarUrl: null,
    spotifyConnectedAt: null,
    listenbrainzUsername: null,
  } as Parameters<typeof userSessionModule.getUserFromSession>[0] extends never
    ? never
    // Cast to the LoreUser type as returned by getUserFromSession.
    : Awaited<ReturnType<typeof userSessionModule.getUserFromSession>>);
}

// ── Tests: HTTP endpoint validation ─────────────────────────────────────────

describe("POST /api/me/library/import/listenbrainz — bad username", () => {
  it("returns 400 with the username in the error when LB says the user does not exist", async () => {
    if (!dbAvailable) return;
    injectUser();

    const badUsername = `no-such-user-${run}`;
    mockValidateUsername.mockResolvedValue(false);

    const res = await request(app)
      .post("/api/me/library/import/listenbrainz")
      .send({ username: badUsername })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(badUsername);

    // Confirm no job row was created for this user.
    const jobs = await db
      .select({ id: libraryImportJobsTable.id })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.userId, userId));
    expect(jobs).toHaveLength(0);
  });
});

describe("POST /api/me/library/import/listenbrainz — valid username", () => {
  it("returns 202 with a numeric jobId when LB confirms the user exists", async () => {
    if (!dbAvailable) return;
    injectUser();

    // Stub an empty loved-recordings iterator so the worker completes fast.
    async function* emptyIter(): AsyncIterable<ImportItem> { /* no items */ }
    mockValidateUsername.mockResolvedValue(true);
    mockFetchLoved.mockReturnValue(emptyIter());

    const username = `valid-user-${run}`;

    const res = await request(app)
      .post("/api/me/library/import/listenbrainz")
      .send({ username })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(202);
    expect(typeof res.body.jobId).toBe("number");

    // Clean up the job so it doesn't interfere with later tests.
    await db
      .delete(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.userId, userId));
  });
});

// ── Tests: Tier-1 fast-path (worker) ─────────────────────────────────────────

describe("runListenBrainzImportWorker — Tier-1 fast-path", () => {
  it("writes items with recordingMbid directly to library_items without calling the MB resolver", async () => {
    if (!dbAvailable) return;

    mockResolveByText.mockReset();
    mockResolveByIsrc.mockReset();

    // Two Tier-1 items: both carry a known recording MBID.
    const tier1Items: ImportItem[] = [
      {
        recordingMbid: MBID_T1A,
        artist: ARTIST,
        title: `Tier1 Track A ${run}`,
        isrc: undefined,
        sourceId: "listenbrainz",
        sourceRef: MBID_T1A,
        addedAt: new Date(Date.UTC(2024, 0, 1)).toISOString(),
      },
      {
        recordingMbid: MBID_T1B,
        artist: ARTIST,
        title: `Tier1 Track B ${run}`,
        isrc: undefined,
        sourceId: "listenbrainz",
        sourceRef: MBID_T1B,
        addedAt: new Date(Date.UTC(2024, 0, 2)).toISOString(),
      },
    ];

    async function* tier1Iter(): AsyncIterable<ImportItem> {
      yield* tier1Items;
    }
    mockFetchLoved.mockReturnValue(tier1Iter());

    // Create the job row the worker expects to find.
    const [job] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "listenbrainz",
        status: "pending",
        total: 0,
        resolved: 0,
        startedAt: new Date(),
      })
      .returning({ id: libraryImportJobsTable.id });
    const jobId = job!.id;

    await runListenBrainzImportWorker(jobId, userId, `valid-user-${run}`);
    await waitForJobDone(jobId);

    // Both MBIDs must now be in library_items.
    const libRows = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    const libMbids = libRows.map((r) => r.mbid);
    expect(libMbids).toContain(MBID_T1A);
    expect(libMbids).toContain(MBID_T1B);

    // The recordings spine rows must also exist.
    const recRows = await db
      .select({ mbid: recordingsTable.mbid })
      .from(recordingsTable)
      .where(inArray(recordingsTable.mbid, MBIDS_ALL));
    expect(recRows.map((r) => r.mbid)).toEqual(
      expect.arrayContaining(MBIDS_ALL),
    );

    // Phase 2/3 resolver must never have been called — Tier-1 items skip it.
    expect(mockResolveByText).not.toHaveBeenCalled();
    expect(mockResolveByIsrc).not.toHaveBeenCalled();
  });
});
