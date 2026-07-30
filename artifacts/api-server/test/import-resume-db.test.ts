/**
 * Integration tests for the import-worker checkpoint/resume logic.
 *
 * Confirms that:
 *   Resume — when the most recent job for a user/service has a partial
 *             buffer (bufferJson IS NOT NULL, phase = "fetching"), a fresh
 *             import calls connector.importLibrary with
 *             startOffset = buffer.length so it never re-fetches tracks
 *             already stored.
 *
 *   Skip   — when the most recent job has a complete buffer
 *             (bufferJson IS NOT NULL, phase ≠ "fetching"), a fresh
 *             import skips importLibrary entirely and drains the stored
 *             buffer directly into the resolution phases.
 *
 * Self-skips when no real DB is available (same pattern as
 * import-worker-db.test.ts).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  serviceConnectionsTable,
  libraryImportJobsTable,
  libraryItemsTable,
  recordingsTable,
  type ImportBufferEntry,
} from "@workspace/db";

// ── Hoisted mock fns ─────────────────────────────────────────────────────────

const { mockImportLibrary, mockResolveByText, mockResolveByIsrc } = vi.hoisted(() => ({
  mockImportLibrary: vi.fn(),
  mockResolveByText: vi.fn<[string, string, (AbortSignal | undefined)?], Promise<string | null>>(),
  mockResolveByIsrc: vi.fn<[string, (AbortSignal | undefined)?], Promise<string | null>>(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────

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

// ── Deferred import ──────────────────────────────────────────────────────────

import { runImportWorker } from "../src/routes/me/index.js";

// ── Unique IDs per test run ──────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);

// Recording that appears in partial / complete buffers — needed as FK target
// for library_items so the worker can insert through Phase 1.
const MBID_BUF = `test-ir-buf-${run}`;
const ISRC_BUF = `IR${run.toUpperCase()}01`.slice(0, 12);

const ARTIST = `ImportResume ${run}`;

// ── DB state ─────────────────────────────────────────────────────────────────

let dbAvailable = false;
let userId: number;
let connRow: typeof serviceConnectionsTable.$inferSelect;

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
    .values({ spotifyUserId: `test-ir-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // 2. service_connections row (crypto mocked → plaintext pass-through)
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

  // 3. Recording used as a FK target for library_items inserts.
  await db.insert(recordingsTable).values([
    { mbid: MBID_BUF, title: "Buffer Track", artist: ARTIST, isrc: ISRC_BUF },
  ]);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  await db.delete(libraryImportJobsTable).where(eq(libraryImportJobsTable.userId, userId));
  await db.delete(serviceConnectionsTable).where(eq(serviceConnectionsTable.id, connRow.id));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID_BUF]));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
});

// Wipe import jobs and library items between tests so seeded prev-job rows
// from one test don't pollute the next test's prevInterrupted lookup.
beforeEach(async () => {
  if (!dbAvailable) return;
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  await db.delete(libraryImportJobsTable).where(eq(libraryImportJobsTable.userId, userId));
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// Wipe import jobs and library items between tests so seeded prev-job rows
// from one test don't pollute the next test's prevWithBuffer lookup.
beforeEach(async () => {
  if (!dbAvailable) return;
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  await db.delete(libraryImportJobsTable).where(eq(libraryImportJobsTable.userId, userId));
});

/** Insert a previous finished/failed job row with a stored buffer. */
async function seedPrevJob(
  opts: {
    bufferEntries: ImportBufferEntry[];
    phase: string;
    status?: string;
  },
): Promise<number> {
  const [j] = await db
    .insert(libraryImportJobsTable)
    .values({
      userId,
      service: "spotify",
      status: opts.status ?? "error",
      phase: opts.phase,
      total: opts.bufferEntries.length,
      resolved: 0,
      bufferJson: opts.bufferEntries,
      startedAt: new Date(Date.now() - 60_000), // 1 minute ago — well within 24 h window
      finishedAt: new Date(),
    })
    .returning({ id: libraryImportJobsTable.id });
  return j!.id;
}

/** Insert a fresh pending job and return its id. */
async function createJob(): Promise<number> {
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
  return j!.id;
}

// ── Test: partial buffer → resume from buffer.length ─────────────────────────

describe("Resume from partial buffer — rate-limited previous job", () => {
  it("calls importLibrary with startOffset = prevBuffer.length", async () => {
    if (!dbAvailable) return;

    mockImportLibrary.mockClear();
    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // 3 tracks were already fetched before the rate-limit hit.
    const partialBuffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: "Track A", isrc: null, durationMs: null, externalId: "sp-a" },
      { artist: ARTIST, title: "Track B", isrc: null, durationMs: null, externalId: "sp-b" },
      { artist: ARTIST, title: "Track C", isrc: null, durationMs: null, externalId: "sp-c" },
    ];

    // Seed a previous job that died mid-fetch (phase="fetching").
    await seedPrevJob({ bufferEntries: partialBuffer, phase: "fetching" });

    // New fetch yields nothing beyond the resume point (simplest valid stub).
    mockImportLibrary.mockImplementation(async function* () {
      // yields nothing — the worker just needs to see the startOffset
    });

    const newJobId = await createJob();
    await runImportWorker(newJobId, userId, "spotify", connRow);

    // importLibrary must have been called exactly once, with startOffset = 3.
    expect(mockImportLibrary).toHaveBeenCalledTimes(1);
    const [, startOffset] = mockImportLibrary.mock.calls[0] as [string, number];
    expect(startOffset).toBe(partialBuffer.length); // 3

    // Job should finish as "done" (empty new batch, nothing unresolved from prior buffer
    // because those tracks have no ISRC match and no cache entry, so they fall through
    // Phase 3 which returns null — worker still marks done).
    const [job] = await db
      .select({ status: libraryImportJobsTable.status })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, newJobId));
    expect(job!.status).toBe("done");
  });
});

// ── Test: complete buffer (phase="spine") is NOT reused — fresh fetch ─────────
//
// A previous job that reached phase="spine" (or beyond) completed the fetch.
// The resume logic only triggers for phase="fetching" jobs, so a "spine" job's
// buffer is ignored and Spotify is re-fetched from offset 0.

describe("No resume from complete-phase buffer — always re-fetches Spotify", () => {
  it("calls importLibrary with startOffset=0 when the prev job's phase is spine", async () => {
    if (!dbAvailable) return;

    mockImportLibrary.mockClear();
    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // Previous job completed the fetch (phase="spine") but failed during
    // resolution — its buffer should NOT trigger a resume.
    const completeBuffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: "Spine Track", isrc: null, durationMs: null, externalId: "sp-spine" },
    ];
    await seedPrevJob({ bufferEntries: completeBuffer, phase: "spine", status: "error" });

    // Fresh Spotify fetch yields nothing.
    mockImportLibrary.mockImplementation(async function* () {});

    const newJobId = await createJob();
    await runImportWorker(newJobId, userId, "spotify", connRow);

    // importLibrary MUST have been called — the spine-phase buffer is not reused.
    expect(mockImportLibrary).toHaveBeenCalledTimes(1);
    // startOffset must be 0 — no partial buffer to resume from.
    const [, startOffset] = mockImportLibrary.mock.calls[0] as [string, number | undefined];
    expect(startOffset ?? 0).toBe(0);

    const [job] = await db
      .select({ status: libraryImportJobsTable.status })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, newJobId));
    expect(job!.status).toBe("done");
  });
});

// ── Test: prior successful job → fresh Spotify fetch ─────────────────────────
//
// A re-import after a fully-completed (status="done") job must NOT reuse the
// stale buffer — it should call importLibrary from offset 0 so the user's
// current Spotify library is reflected.

describe("Fresh fetch after successful import — status=done buffer is ignored", () => {
  it("calls importLibrary with startOffset=0 when the previous job completed successfully", async () => {
    if (!dbAvailable) return;

    mockImportLibrary.mockClear();
    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // Previous job completed successfully — its buffer must not be reused.
    const doneBuffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: "Old Track", isrc: null, durationMs: null, externalId: "sp-old" },
    ];
    await seedPrevJob({ bufferEntries: doneBuffer, phase: "spine", status: "done" });

    // Fresh Spotify response is empty (no new tracks beyond the resume window).
    mockImportLibrary.mockImplementation(async function* () {
      // yields nothing
    });

    const newJobId = await createJob();
    await runImportWorker(newJobId, userId, "spotify", connRow);

    // importLibrary MUST have been called — no buffer reuse from a done job.
    expect(mockImportLibrary).toHaveBeenCalledTimes(1);
    // startOffset must be 0 — fresh fetch from the beginning.
    const [, startOffset] = mockImportLibrary.mock.calls[0] as [string, number | undefined];
    expect(startOffset ?? 0).toBe(0);

    // Job finishes as "done" (empty fetch → nothing to resolve).
    const [job] = await db
      .select({ status: libraryImportJobsTable.status })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, newJobId));
    expect(job!.status).toBe("done");
  });
});

// ── Test: zombie cleared → worker resumes from ex-zombie's partial buffer ─────
//
// When POST /api/me/library/import finds a running job older than ZOMBIE_AGE_MS
// (30 min), it marks it as status="error" WITHOUT touching phase or bufferJson.
// The new job's worker then finds that ex-zombie (phase="fetching", bufferJson
// intact) and uses its buffer.length as startOffset — so tracks already fetched
// before the server restart are not re-fetched.
//
// This test exercises the full interaction:
//   1. Zombie seeded (running, >30 min, phase="fetching", partial bufferJson).
//   2. POST handler clears zombie → status="error", phase/bufferJson preserved.
//   3. New job created and worker started.
//   4. Worker finds ex-zombie as prevInterrupted and resumes from buffer.length.

describe("Zombie cleared → new worker resumes from ex-zombie's partial buffer", () => {
  it("calls importLibrary with startOffset = zombie buffer length after zombie is cleared", async () => {
    if (!dbAvailable) return;

    mockImportLibrary.mockClear();
    mockResolveByText.mockClear();
    mockResolveByIsrc.mockClear();

    // Tracks already fetched before the server restarted mid-import.
    const partialBuffer: ImportBufferEntry[] = [
      { artist: ARTIST, title: "Zombie Track A", isrc: null, durationMs: null, externalId: "sp-z-a" },
      { artist: ARTIST, title: "Zombie Track B", isrc: null, durationMs: null, externalId: "sp-z-b" },
      { artist: ARTIST, title: "Zombie Track C", isrc: null, durationMs: null, externalId: "sp-z-c" },
    ];

    // 1. Seed the zombie: still "running", phase="fetching", startedAt 35 min
    //    ago so it is past the 30-minute ZOMBIE_AGE_MS threshold.
    const [zombieRow] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId,
        service: "spotify",
        status: "running",
        phase: "fetching",
        total: partialBuffer.length,
        resolved: 0,
        bufferJson: partialBuffer,
        startedAt: new Date(Date.now() - 35 * 60_000), // 35 min > ZOMBIE_AGE_MS
      })
      .returning({ id: libraryImportJobsTable.id });
    const zombieId = zombieRow!.id;

    // 2. Simulate what POST /api/me/library/import does when it detects the
    //    zombie: sets status="error" but leaves phase and bufferJson intact.
    await db
      .update(libraryImportJobsTable)
      .set({
        status: "error",
        error: "Import interrupted (server restarted) — please try again",
        finishedAt: new Date(),
      })
      .where(eq(libraryImportJobsTable.id, zombieId));

    // Confirm zombie is cleared and phase/bufferJson are preserved.
    const [zombie] = await db
      .select({
        status: libraryImportJobsTable.status,
        phase: libraryImportJobsTable.phase,
        bufferJson: libraryImportJobsTable.bufferJson,
      })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, zombieId));
    expect(zombie!.status).toBe("error");           // cleared
    expect(zombie!.phase).toBe("fetching");          // preserved — worker key
    expect(zombie!.bufferJson).toHaveLength(partialBuffer.length); // preserved

    // 3. Spotify yields nothing beyond the resume offset (simplest valid stub).
    mockImportLibrary.mockImplementation(async function* () {});

    // 4. Create the fresh job and run the worker (mirrors what POST does after
    //    clearing the zombie).
    const newJobId = await createJob();
    await runImportWorker(newJobId, userId, "spotify", connRow);

    // Worker must call importLibrary exactly once with startOffset = 3.
    expect(mockImportLibrary).toHaveBeenCalledTimes(1);
    const [, startOffset] = mockImportLibrary.mock.calls[0] as [string, number];
    expect(startOffset).toBe(partialBuffer.length); // 3

    // New job must finish successfully.
    const [newJob] = await db
      .select({ status: libraryImportJobsTable.status })
      .from(libraryImportJobsTable)
      .where(eq(libraryImportJobsTable.id, newJobId));
    expect(newJob!.status).toBe("done");
  });
});
