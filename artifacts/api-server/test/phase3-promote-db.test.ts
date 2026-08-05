/**
 * Integration tests: spotify_library_items → library_items promotion
 *
 * Confirms that runPhase3RetryPass, on successfully resolving a staged
 * spotify_library_items row to a MusicBrainz MBID, correctly:
 *
 *   1. Inserts the track into library_items.
 *   2. Deletes the row from spotify_library_items.
 *   3. Is idempotent: a second pass with the track already in library_items
 *      (and a positive resolution_cache entry) does not error and does not
 *      re-insert or double-write anything.
 *
 * Self-skips (dbAvailable = false) when no real DB is reachable.
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, and, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  libraryImportJobsTable,
  libraryItemsTable,
  importItemsTable,
  recordingsTable,
  resolutionCacheTable,
  spotifyLibraryItemsTable,
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
      resolveByTextWithScore: vi.fn(async (artist: string, title: string, signal?: AbortSignal) => {
        const mbid = await mockResolveByText(artist, title, signal);
        return mbid ? { mbid, score: 95 } : null;
      }),
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

import * as resolveModule from "../src/lore/resolve.js";
import { runPhase3RetryPass } from "../src/routes/me/index.js";

// ── Test-run isolation ───────────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);

// Five users: fresh-promotion, idempotent, synthesised-key, ISRC-keyed, and
// ISRC-bystander (a second user whose soft row shares the ISRC_VALUE to confirm
// the userId guard prevents cross-user deletion).
const ARTIST = `PromoArtist ${run}`;

// The MBID the mocked resolver will return for this test run.
const MBID_PROMO    = `promo-mbid-${run}`;   // fresh promotion
const MBID_IDEM     = `idem-mbid-${run}`;    // idempotent (already in library_items)
const MBID_SYNTH    = `synth-mbid-${run}`;   // synthesised-key promotion
const MBID_ISRC     = `isrc-mbid-${run}`;    // ISRC sub-path promotion

const SPOTIFY_ID_PROMO = `sp-promo-${run}`;  // Spotify track id for the soft row
const SPOTIFY_ID_IDEM  = `sp-idem-${run}`;
// Synthesised key mirrors what the import worker produces when no real Spotify
// ID is available: "artist\u001ftitle".
const SYNTH_EXTERNAL_ID = `${ARTIST}\u001fSynth Track`;
// ISRC sub-path: externalId is also synthesised (not 22 chars) but isrc IS present.
const ISRC_VALUE         = `USAAA${run.padEnd(7, "0").slice(0, 7)}`;
const ISRC_EXTERNAL_ID   = `${ARTIST}\u001fISRC Track`;

const ALL_MBIDS = [MBID_PROMO, MBID_IDEM, MBID_SYNTH, MBID_ISRC];

let dbAvailable = false;
let softTableAvailable = false;

let userIdPromo: number;
let userIdIdem: number;
let userIdSynth: number;
let userIdIsrc: number;
let userIdIsrc2: number;  // bystander: same ISRC, must survive the retry pass

// ── Sleep bypass ─────────────────────────────────────────────────────────────

/**
 * Skip the 1 100 ms rate-limit sleeps so the pass completes fast in tests.
 * Abort-controller timers (4 s / 12 s) are left intact — the mocked resolvers
 * are microtasks, so clearTimeout cancels them before they fire.
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

  // Detect whether spotify_library_items exists in this environment.
  try {
    await db.execute(sql`select 1 from spotify_library_items limit 0`);
    softTableAvailable = true;
  } catch {
    softTableAvailable = false;
    return;
  }

  // Create four isolated users.
  const [u1] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `promo-fresh-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userIdPromo = u1!.id;

  const [u2] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `promo-idem-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userIdIdem = u2!.id;

  const [u3] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `promo-synth-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userIdSynth = u3!.id;

  const [u4] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `promo-isrc-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userIdIsrc = u4!.id;

  const [u5] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `promo-isrc2-${run}`, deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userIdIsrc2 = u5!.id;

  // Seed recordings rows so library_items FK is satisfiable.
  await db.insert(recordingsTable).values([
    { mbid: MBID_PROMO,  title: "Promo Track",  artist: ARTIST },
    { mbid: MBID_IDEM,   title: "Idem Track",   artist: ARTIST },
    { mbid: MBID_SYNTH,  title: "Synth Track",  artist: ARTIST },
    { mbid: MBID_ISRC,   title: "ISRC Track",   artist: ARTIST, isrc: ISRC_VALUE },
  ]);

  // Seed the staging spotify_library_items rows (unresolved, mbid = null).
  await db.insert(spotifyLibraryItemsTable).values([
    {
      userId: userIdPromo,
      spotifyId: SPOTIFY_ID_PROMO,
      title: "Promo Track",
      artist: ARTIST,
      addedAt: new Date(),
      mbid: null,
    },
    {
      userId: userIdIdem,
      spotifyId: SPOTIFY_ID_IDEM,
      title: "Idem Track",
      artist: ARTIST,
      addedAt: new Date(),
      mbid: null,
    },
    // Synthesised-key soft row: spotifyId is the "artist\u001ftitle" fallback
    // that the import worker writes when no real Spotify track ID is available.
    {
      userId: userIdSynth,
      spotifyId: SYNTH_EXTERNAL_ID,
      title: "Synth Track",
      artist: ARTIST,
      addedAt: new Date(),
      mbid: null,
    },
    // ISRC sub-path: externalId is synthesised but the buffer entry has isrc set.
    // The soft row stores the isrc column so the retry pass can match by ISRC.
    {
      userId: userIdIsrc,
      spotifyId: ISRC_EXTERNAL_ID,
      title: "ISRC Track",
      artist: ARTIST,
      isrc: ISRC_VALUE,
      addedAt: new Date(),
      mbid: null,
    },
    // Bystander: a second user who has saved the same ISRC.  No import job
    // will be created for this user, so the retry pass must never touch this row.
    {
      userId: userIdIsrc2,
      spotifyId: `${ARTIST}\u001fISRC Track bystander`,
      title: "ISRC Track",
      artist: ARTIST,
      isrc: ISRC_VALUE,
      addedAt: new Date(),
      mbid: null,
    },
  ]);
});

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (!dbAvailable || !softTableAvailable) return;

  const allUserIds = [userIdPromo, userIdIdem, userIdSynth, userIdIsrc, userIdIsrc2].filter(Boolean);

  // Remove soft rows that might have survived (e.g. if a test failed before cleanup).
  await db
    .delete(spotifyLibraryItemsTable)
    .where(inArray(spotifyLibraryItemsTable.userId, allUserIds))
    .catch(() => {});

  // Remove library_items for our test MBIDs (covers both users and any stray rows
  // the retry scanner might have written for other test-DB users sharing these MBIDs).
  await db
    .delete(libraryItemsTable)
    .where(inArray(libraryItemsTable.mbid, ALL_MBIDS))
    .catch(() => {});

  // Import audit rows then jobs (FK: import_items → library_import_jobs).
  if (allUserIds.length > 0) {
    await db
      .delete(importItemsTable)
      .where(inArray(importItemsTable.userId, allUserIds))
      .catch(() => {});
    await db
      .delete(libraryImportJobsTable)
      .where(inArray(libraryImportJobsTable.userId, allUserIds))
      .catch(() => {});
  }

  // Resolution-cache entries written by the retry pass.
  const { normalizeKey, isrcKey } = resolveModule;
  await db
    .delete(resolutionCacheTable)
    .where(
      inArray(resolutionCacheTable.key, [
        normalizeKey(ARTIST, "Promo Track"),
        normalizeKey(ARTIST, "Idem Track"),
        normalizeKey(ARTIST, "Synth Track"),
        normalizeKey(ARTIST, "ISRC Track"),
        isrcKey(ISRC_VALUE),
      ]),
    )
    .catch(() => {});

  // Remove recordings last (library_items FK already gone).
  await db
    .delete(recordingsTable)
    .where(inArray(recordingsTable.mbid, ALL_MBIDS))
    .catch(() => {});

  if (allUserIds.length > 0) {
    await db
      .delete(loreUsersTable)
      .where(inArray(loreUsersTable.id, allUserIds))
      .catch(() => {});
  }
}, 90_000);

// ── Helper ────────────────────────────────────────────────────────────────────

/** Insert a completed import job whose buffer contains a single unresolved entry. */
async function insertDoneJob(
  userId: number,
  entry: { artist: string; title: string; externalId: string; isrc?: string },
): Promise<number> {
  const [job] = await db
    .insert(libraryImportJobsTable)
    .values({
      userId,
      service: "spotify",
      status: "done",
      phase: "resolve",
      total: 1,
      resolved: 0,
      bufferJson: [{ artist: entry.artist, title: entry.title, externalId: entry.externalId, isrc: entry.isrc ?? null, durationMs: null }],
      startedAt: new Date(),
      finishedAt: new Date(),
    })
    .returning({ id: libraryImportJobsTable.id });
  return job!.id;
}

const TEST_TIMEOUT = 90_000;

// ── Test 1: fresh promotion ───────────────────────────────────────────────────
//
// A spotify_library_items row (mbid = null) whose track the retry pass can
// now resolve should end up in library_items AND be removed from
// spotify_library_items.

describe("runPhase3RetryPass — promotes staged soft row to library_items", () => {
  it(
    "deletes the spotify_library_items row and inserts into library_items after resolving the MBID",
    async () => {
      if (!dbAvailable || !softTableAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      // Resolver finds the track this time.
      mockResolveByText.mockResolvedValue(MBID_PROMO);

      await insertDoneJob(userIdPromo, {
        artist: ARTIST,
        title: "Promo Track",
        externalId: SPOTIFY_ID_PROMO,
      });

      const spy = installSleepBypass();
      try {
        await runPhase3RetryPass(undefined, [userIdPromo, userIdIdem, userIdSynth, userIdIsrc, userIdIsrc2]);
      } finally {
        spy.mockRestore();
      }

      // 1. The track must appear in library_items for this user.
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, userIdPromo),
            eq(libraryItemsTable.mbid, MBID_PROMO),
          ),
        );
      expect(libRows.length).toBe(1);
      expect(libRows[0]!.mbid).toBe(MBID_PROMO);

      // 2. The soft row must be gone from spotify_library_items.
      const softRows = await db
        .select({ id: spotifyLibraryItemsTable.id })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userIdPromo),
            eq(spotifyLibraryItemsTable.spotifyId, SPOTIFY_ID_PROMO),
          ),
        );
      expect(softRows.length).toBe(0);

      // 3. The resolution_cache must have a positive entry.
      const { normalizeKey } = resolveModule;
      const cacheRows = await db
        .select({ mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST, "Promo Track")));
      expect(cacheRows.length).toBeGreaterThanOrEqual(1);
      expect(cacheRows[0]!.mbid).toBe(MBID_PROMO);
    },
    TEST_TIMEOUT,
  );
});

// ── Test 2: idempotent re-promotion ──────────────────────────────────────────
//
// When library_items already has the track and the resolution_cache has a
// positive entry, the retry pass must not error and must not insert duplicates.
// (The soft row was cleaned up in the first pass; subsequent passes skip the
// track via the cache-hit fast-path and create no retry job at all.)

describe("runPhase3RetryPass — idempotent when track is already in library_items", () => {
  it(
    "does not error and does not duplicate the library_items row on a second pass",
    async () => {
      if (!dbAvailable || !softTableAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      // Resolver returns the MBID — but the cache hit should short-circuit before it's called.
      mockResolveByText.mockResolvedValue(MBID_IDEM);

      // Manually seed the already-promoted state:
      //   • library_items has the track
      //   • resolution_cache has a positive entry
      //   • spotify_library_items row is already gone (as if the first pass ran)
      await db
        .insert(libraryItemsTable)
        .values({ userId: userIdIdem, mbid: MBID_IDEM, provenance: { kind: "import", service: "spotify" }, addedAt: new Date() })
        .onConflictDoNothing();

      const { normalizeKey } = resolveModule;
      await db
        .insert(resolutionCacheTable)
        .values({ key: normalizeKey(ARTIST, "Idem Track"), mbid: MBID_IDEM })
        .onConflictDoNothing();

      // Remove the soft row (simulating the first pass having already promoted it).
      await db
        .delete(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userIdIdem),
            eq(spotifyLibraryItemsTable.spotifyId, SPOTIFY_ID_IDEM),
          ),
        );

      // Insert a source job with total > resolved to make the user eligible.
      const sourceJobId = await insertDoneJob(userIdIdem, {
        artist: ARTIST,
        title: "Idem Track",
        externalId: SPOTIFY_ID_IDEM,
      });

      const spy = installSleepBypass();
      try {
        await runPhase3RetryPass(undefined, [userIdPromo, userIdIdem, userIdSynth, userIdIsrc, userIdIsrc2]);
      } finally {
        spy.mockRestore();
      }

      // No retry job should have been created — the cache hit skips the track.
      const jobs = await db
        .select({ id: libraryImportJobsTable.id })
        .from(libraryImportJobsTable)
        .where(
          and(
            eq(libraryImportJobsTable.userId, userIdIdem),
            eq(libraryImportJobsTable.service, "spotify"),
          ),
        );
      expect(jobs.length).toBe(1);
      expect(jobs[0]!.id).toBe(sourceJobId);

      // Exactly one library_items row for this user+mbid — no duplicate.
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, userIdIdem),
            eq(libraryItemsTable.mbid, MBID_IDEM),
          ),
        );
      expect(libRows.length).toBe(1);

      // spotify_library_items stays empty.
      const softRows = await db
        .select({ id: spotifyLibraryItemsTable.id })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userIdIdem),
            eq(spotifyLibraryItemsTable.spotifyId, SPOTIFY_ID_IDEM),
          ),
        );
      expect(softRows.length).toBe(0);
    },
    TEST_TIMEOUT,
  );
});

// ── Test 3: synthesised-key promotion ─────────────────────────────────────────
//
// When the connector yields no real Spotify ID the import worker falls back to
// "artist\u001ftitle" as the buffer entry's externalId.  seedSpotifySoftRows
// stores that same synthesised key as the spotifyId column value.  The retry
// pass must detect a non-22-char externalId and delete the soft row by
// artist+title (or ISRC), not by the synthesised spotifyId string.
//
// This test confirms the promotion works end-to-end for that path.

describe("runPhase3RetryPass — promotes soft row seeded with a synthesised externalId", () => {
  it(
    "removes the spotify_library_items row and inserts into library_items when externalId is artist+title fallback",
    async () => {
      if (!dbAvailable || !softTableAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      // Resolver finds the track on this retry.
      mockResolveByText.mockResolvedValue(MBID_SYNTH);

      // Source job: buffer entry uses the synthesised key (not a real Spotify ID).
      await insertDoneJob(userIdSynth, {
        artist: ARTIST,
        title: "Synth Track",
        externalId: SYNTH_EXTERNAL_ID,   // "Artist\u001fSynth Track" — not 22 chars
      });

      const spy = installSleepBypass();
      try {
        await runPhase3RetryPass(undefined, [userIdPromo, userIdIdem, userIdSynth, userIdIsrc, userIdIsrc2]);
      } finally {
        spy.mockRestore();
      }

      // 1. The track must appear in library_items for this user.
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, userIdSynth),
            eq(libraryItemsTable.mbid, MBID_SYNTH),
          ),
        );
      expect(libRows.length).toBe(1);
      expect(libRows[0]!.mbid).toBe(MBID_SYNTH);

      // 2. The soft row must be gone from spotify_library_items.
      //    Query by userId + title (not by spotifyId) to confirm the fallback
      //    delete path correctly removed the row regardless of which key it
      //    was stored under.
      const softRows = await db
        .select({ id: spotifyLibraryItemsTable.id, title: spotifyLibraryItemsTable.title })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userIdSynth),
            eq(spotifyLibraryItemsTable.title, "Synth Track"),
          ),
        );
      expect(softRows.length).toBe(0);

      // 3. Resolution cache must have a positive entry for the text key.
      const { normalizeKey } = resolveModule;
      const cacheRows = await db
        .select({ mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, normalizeKey(ARTIST, "Synth Track")));
      expect(cacheRows.length).toBeGreaterThanOrEqual(1);
      expect(cacheRows[0]!.mbid).toBe(MBID_SYNTH);
    },
    TEST_TIMEOUT,
  );
});

// ── Test 4: ISRC sub-path promotion ──────────────────────────────────────────
//
// When the buffer entry has isrc set but externalId is still a synthesised
// "artist\u001ftitle" key (no real Spotify track ID), the retry pass should:
//   • Resolve the MBID via resolveByIsrc (not resolveByText).
//   • Delete the soft row by matching spotify_library_items.isrc (not spotifyId
//     or artist+title), scoped to the correct userId.
//   • Insert the track into library_items.
//
// A bug in the ISRC branch (e.g. missing AND userId, wrong column) would
// silently delete the wrong user's row or leave the row un-deleted.

describe("runPhase3RetryPass — promotes soft row with synthesised externalId via ISRC match", () => {
  it(
    "removes the spotify_library_items row by isrc and inserts into library_items when isrc is present",
    async () => {
      if (!dbAvailable || !softTableAvailable) return;

      mockResolveByText.mockClear();
      mockResolveByIsrc.mockClear();
      // ISRC resolver finds the track; text resolver must not be needed.
      mockResolveByIsrc.mockResolvedValue(MBID_ISRC);
      mockResolveByText.mockResolvedValue(null);

      // Buffer entry: synthesised externalId but real ISRC.
      await insertDoneJob(userIdIsrc, {
        artist: ARTIST,
        title: "ISRC Track",
        externalId: ISRC_EXTERNAL_ID,   // not 22 chars → synthesised-key branch
        isrc: ISRC_VALUE,
      });

      const spy = installSleepBypass();
      try {
        await runPhase3RetryPass(undefined, [userIdPromo, userIdIdem, userIdSynth, userIdIsrc, userIdIsrc2]);
      } finally {
        spy.mockRestore();
      }

      // 1. The track must appear in library_items for this user.
      const libRows = await db
        .select({ mbid: libraryItemsTable.mbid })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, userIdIsrc),
            eq(libraryItemsTable.mbid, MBID_ISRC),
          ),
        );
      expect(libRows.length).toBe(1);
      expect(libRows[0]!.mbid).toBe(MBID_ISRC);

      // 2. The soft row must be gone — matched by isrc, scoped to this user.
      //    Query by isrc to confirm the ISRC delete path ran (not artist+title).
      const softRows = await db
        .select({ id: spotifyLibraryItemsTable.id })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userIdIsrc),
            eq(spotifyLibraryItemsTable.isrc, ISRC_VALUE),
          ),
        );
      expect(softRows.length).toBe(0);

      // 3. Resolution cache must have a positive entry for the ISRC key.
      const { isrcKey } = resolveModule;
      const cacheRows = await db
        .select({ mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(eq(resolutionCacheTable.key, isrcKey(ISRC_VALUE)));
      expect(cacheRows.length).toBeGreaterThanOrEqual(1);
      expect(cacheRows[0]!.mbid).toBe(MBID_ISRC);

      // 4. The bystander user's soft row (same ISRC, different userId) must be
      //    untouched — confirming the "AND userId" guard in the ISRC delete
      //    condition is present and effective.
      const bystanderRows = await db
        .select({ id: spotifyLibraryItemsTable.id, isrc: spotifyLibraryItemsTable.isrc })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userIdIsrc2),
            eq(spotifyLibraryItemsTable.isrc, ISRC_VALUE),
          ),
        );
      expect(bystanderRows.length).toBe(1);
      expect(bystanderRows[0]!.isrc).toBe(ISRC_VALUE);
    },
    TEST_TIMEOUT,
  );
});
