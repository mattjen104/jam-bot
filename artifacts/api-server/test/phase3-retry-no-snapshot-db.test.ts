/**
 * Integration test: Phase 3 retry pass — no newer snapshot exists.
 *
 * When a retry candidate has no newer completed import job (snapshot), the pass
 * must live-check the Spotify /me/tracks/contains API before re-inserting.
 * A track that the API reports as not saved must not appear in library_items.
 *
 * Covers the residual gap left after the original removed-track guard: the user
 * removes a track from Spotify and then runs no further import, leaving no
 * snapshot for the guard to diff against.
 *
 * Self-skips when no real DB is available.
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
  importItemsTable,
  recordingsTable,
  resolutionCacheTable,
} from "@workspace/db";

// ── Hoisted mock fns ──────────────────────────────────────────────────────────

const { mockResolveByText, mockResolveByIsrc, mockCheckSpotifyLibraryContains } = vi.hoisted(() => ({
  mockResolveByText: vi.fn<[string, string, (AbortSignal | undefined)?], Promise<string | null>>(),
  mockResolveByIsrc: vi.fn<[string, (AbortSignal | undefined)?], Promise<string | null>>(),
  mockCheckSpotifyLibraryContains: vi.fn<[unknown, string[]], Promise<{ ok: true; savedIds: Set<string> } | { ok: false; reason: "token" | "api_error" | "network" }>>(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

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
      resolveByTextWithScore: vi.fn(async (artist: string, title: string, signal?: AbortSignal) => {
        const mbid = await mockResolveByText(artist, title, signal);
        return mbid ? { mbid, score: 95 } : null;
      }),
    }),
  };
});

// Mock the injectable Spotify live-check seam so the test never hits the
// network and can control whether the track is present in Spotify.
vi.mock("../src/routes/me/spotify-library-check.js", () => ({
  checkSpotifyLibraryContains: mockCheckSpotifyLibraryContains,
}));

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
import { runPhase3RetryPass } from "../src/routes/me/index.js";

// ── Test-run isolation ────────────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);

// A real 22-char Spotify track ID so the no-snapshot path routes the entry
// through the /me/tracks/contains live check (synthetic IDs pass through).
const SPOTIFY_TRACK_ID = `NoSnap${run}0000000000`.slice(0, 22);
const ARTIST = `NoSnapArtist ${run}`;
const TITLE  = `NoSnapTrack ${run}`;
const MBID   = `no-snap-mbid-${run}`;

let dbAvailable = false;
let userId: number;

// ── Sleep bypass ──────────────────────────────────────────────────────────────

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

  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `no-snap-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // Service connection with a future expiresAt so getFreshToken returns the
  // plaintext token directly (tokenCrypto is mocked as pass-through).
  await db.insert(serviceConnectionsTable).values({
    userId,
    service: "spotify",
    accessToken: "fake-token-no-snap",
    refreshToken: "fake-refresh-no-snap",
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: "user-library-read",
    canWrite: false,
  });

  // Recordings spine row so library_items FK is satisfied if the track were
  // (incorrectly) inserted — lets us assert its absence.
  await db
    .insert(recordingsTable)
    .values({ mbid: MBID, title: TITLE, artist: ARTIST })
    .onConflictDoNothing();
});

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (!dbAvailable) return;

  await db
    .delete(libraryItemsTable)
    .where(inArray(libraryItemsTable.mbid, [MBID]))
    .catch(() => {});

  await db
    .delete(importItemsTable)
    .where(eq(importItemsTable.userId, userId))
    .catch(() => {});
  await db
    .delete(libraryImportJobsTable)
    .where(eq(libraryImportJobsTable.userId, userId))
    .catch(() => {});

  await db
    .delete(serviceConnectionsTable)
    .where(eq(serviceConnectionsTable.userId, userId))
    .catch(() => {});

  const { normalizeKey } = resolveModule;
  await db
    .delete(resolutionCacheTable)
    .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST, TITLE)))
    .catch(() => {});

  await db
    .delete(recordingsTable)
    .where(eq(recordingsTable.mbid, MBID))
    .catch(() => {});

  await db
    .delete(loreUsersTable)
    .where(eq(loreUsersTable.id, userId))
    .catch(() => {});
});

// ── Test ──────────────────────────────────────────────────────────────────────

describe("runPhase3RetryPass — no newer snapshot: live Spotify check prevents ghost-restore", () => {
  it(
    "does not insert into library_items when the track is absent from the live Spotify library",
    async () => {
      if (!dbAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      mockCheckSpotifyLibraryContains.mockClear();
      // MB would succeed if it were reached — confirms the seam fires before MB.
      mockResolveByText.mockResolvedValue(MBID);
      // Seam returns an empty Set — track is not saved in the user's Spotify
      // library, so the retry pass must filter it out and skip re-insertion.
      mockCheckSpotifyLibraryContains.mockResolvedValue({ ok: true, savedIds: new Set<string>() });

      // Completed import job with one unresolved track.  No newer job exists for
      // this user, so the no-snapshot live-check path activates.
      const [jobRow] = await db
        .insert(libraryImportJobsTable)
        .values({
          userId,
          service: "spotify",
          status: "done",
          phase: "resolve",
          total: 1,
          resolved: 0,
          bufferJson: [{ artist: ARTIST, title: TITLE, externalId: SPOTIFY_TRACK_ID }],
          startedAt: new Date(),
          finishedAt: new Date(),
        })
        .returning({ id: libraryImportJobsTable.id });
      const sourceJobId = jobRow!.id;

      const sleepSpy = installSleepBypass();
      try {
        await runPhase3RetryPass(undefined, [userId]);
      } finally {
        sleepSpy.mockRestore();
      }

      // The injectable seam must have been called (live check was reached).
      expect(mockCheckSpotifyLibraryContains, "seam must be called once").toHaveBeenCalledTimes(1);

      // The seam must have been called with the candidate's Spotify track ID.
      const seamCallIds = mockCheckSpotifyLibraryContains.mock.calls[0]![1];
      expect(seamCallIds).toContain(SPOTIFY_TRACK_ID);

      // No retry job should have been created — the candidate was skipped because
      // entriesToRetry became empty after the live filter.
      const jobs = await db
        .select({ id: libraryImportJobsTable.id, status: libraryImportJobsTable.status })
        .from(libraryImportJobsTable)
        .where(
          and(
            eq(libraryImportJobsTable.userId, userId),
            eq(libraryImportJobsTable.service, "spotify"),
          ),
        );
      expect(jobs.length, "only the source job must exist").toBe(1);
      expect(jobs[0]!.id).toBe(sourceJobId);

      // The track must NOT appear in library_items.
      const items = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      expect(items.map((r) => r.mbid)).not.toContain(MBID);

      // MB resolver must not have been called — the live check filtered the
      // track before the resolve loop.
      expect(mockResolveByText).not.toHaveBeenCalled();
      expect(mockResolveByIsrc).not.toHaveBeenCalled();
    },
    30_000,
  );
});
