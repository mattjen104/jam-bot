// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  spotifyLibraryItemsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  stationsTable,
  spinsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { _testOnly_clearCrossingsCache, _testOnly_getCrossingsCache } from "../src/routes/me/crossings.js";

/**
 * Integration tests for GET /api/me/crossings.
 *
 * Three crossing scenarios are covered:
 *
 *   1. Release-group widening — spin has recording A, library has recording B
 *      from the same primary release group. The endpoint must count it as
 *      `crossings ≥ 1` (not just an exact-MBID match).
 *
 *   2. Artist MBID crossing — spin has a recording whose artistMbid appears
 *      via a library item's resolved recording, but the exact MBID / release
 *      group is NOT in the library → `artistCrossings ≥ 1`, `crossings = 0`.
 *
 *   3. Soft-artist fallback — spin's recording has no artistMbid, but the
 *      artist name matches an unresolved `spotify_library_items` row →
 *      `artistCrossings ≥ 1`.
 *
 * All seeds use a run-isolated prefix so concurrent test runs don't interfere.
 * Cleanup runs in afterAll in FK order.
 * Tests skip silently when no DB is reachable.
 */

const run = randomUUID().slice(0, 8);

// ── Session IDs (used as deviceKey / cookie) ──────────────────────────────────
const SID_RG       = `test-cross-rg-${run}`;       // release-group widening user
const SID_ART      = `test-cross-art-${run}`;      // artist MBID crossing user
const SID_SOFT     = `test-cross-soft-${run}`;     // soft artist fallback user
const SID_EMPTY    = `test-cross-empty-${run}`;    // empty library (baseline)
const SID_LIFETIME     = `test-cross-lifetime-${run}`;     // lifetime-only crossing (spin > 24h old)
const SID_LIFETIME_ART = `test-cross-lt-art-${run}`;    // lifetime artist-crossing (spin > 24h old, no exact-MBID match)

// ── Recordings ────────────────────────────────────────────────────────────────
// Scenario 1 — release-group widening
const MBID_SPIN_RG   = `tc-spin-rg-${run}`;   // aired on the station (recording A)
const MBID_LIB_RG    = `tc-lib-rg-${run}`;    // in user's library (recording B, same RG)
const RG_MBID        = `tc-rg-${run}`;        // shared primary release group

// Scenario 2 — artist MBID crossing
const ARTIST_MBID    = `tc-artist-${run}`;    // shared artist MBID
const MBID_SPIN_ART  = `tc-spin-art-${run}`;  // aired track (artist = ARTIST_MBID)
const MBID_LIB_ART   = `tc-lib-art-${run}`;   // library track (artist = ARTIST_MBID)
// MBID_SPIN_ART is intentionally NOT in the library → counts as artistCrossing only.

// Scenario 3 — soft artist name fallback (no artistMbid on the recording)
const SOFT_ARTIST    = `Soft Artist ${run}`;   // artist name to match
const MBID_SPIN_SOFT = `tc-spin-soft-${run}`; // aired track (no artistMbid)
// Library item is a spotify_library_items row (unresolved mbid) with artist = SOFT_ARTIST

// Scenario 4 — lifetime-only crossing (spin > 24h old, crossings=0 but lifetimeCrossings≥1)
// The library holds the EXACT same MBID that aired, so no release-group join is needed.
const MBID_SPIN_LIFETIME = `tc-spin-lt-${run}`; // aired 25h ago AND is in the library

// Scenario 5 — lifetime artist crossing (spin > 24h old, NOT in library, but artist is)
// Two spins of the same track aired 25h ago → lifetimeArtistCrossings must be 1 (distinct mbid).
const ARTIST_MBID_LT          = `tc-artist-lt-${run}`;     // shared artist MBID
const MBID_SPIN_LIFETIME_ART  = `tc-spin-lt-art-${run}`;   // aired 25h ago (not in library)
const MBID_LIB_LIFETIME_ART   = `tc-lib-lt-art-${run}`;    // in library (same artistMbid)

// ── Station ───────────────────────────────────────────────────────────────────
const STATION_SLUG = `test-cross-sta-${run}`;

// ── State ─────────────────────────────────────────────────────────────────────
let dbAvailable = false;
let softTableAvailable = false;
let server: Server | undefined;
let baseUrl = "";

let stationId: number | null = null;
let userRgId: number | null = null;
let userArtId: number | null = null;
let userSoftId: number | null = null;
let userEmptyId: number | null = null;
let userLifetimeId: number | null = null;
let userLifetimeArtId: number | null = null;

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function get(path: string, sid?: string) {
  const headers: Record<string, string> = {};
  if (sid) headers["cookie"] = `lore_sid=${sid}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Legacy spotify_connections (FK required by lore_users)
  for (const sid of [SID_RG, SID_ART, SID_SOFT, SID_EMPTY, SID_LIFETIME, SID_LIFETIME_ART]) {
    await db.insert(spotifyConnectionsTable).values({
      sid,
      accessToken: "t",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  // Lore users — deviceKey doubles as the session cookie value
  const [uRg] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `cross-rg-${run}`, spotifyConnectionId: SID_RG, deviceKey: SID_RG })
    .returning({ id: loreUsersTable.id });
  userRgId = uRg!.id;

  const [uArt] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `cross-art-${run}`, spotifyConnectionId: SID_ART, deviceKey: SID_ART })
    .returning({ id: loreUsersTable.id });
  userArtId = uArt!.id;

  const [uSoft] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `cross-soft-${run}`, spotifyConnectionId: SID_SOFT, deviceKey: SID_SOFT })
    .returning({ id: loreUsersTable.id });
  userSoftId = uSoft!.id;

  const [uEmpty] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `cross-empty-${run}`, spotifyConnectionId: SID_EMPTY, deviceKey: SID_EMPTY })
    .returning({ id: loreUsersTable.id });
  userEmptyId = uEmpty!.id;

  const [uLifetime] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `cross-lt-${run}`, spotifyConnectionId: SID_LIFETIME, deviceKey: SID_LIFETIME })
    .returning({ id: loreUsersTable.id });
  userLifetimeId = uLifetime!.id;

  const [uLifetimeArt] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `cross-lt-art-${run}`, spotifyConnectionId: SID_LIFETIME_ART, deviceKey: SID_LIFETIME_ART })
    .returning({ id: loreUsersTable.id });
  userLifetimeArtId = uLifetimeArt!.id;

  // ── Recordings ───────────────────────────────────────────────────────────────
  await db.insert(recordingsTable).values([
    // Scenario 1
    { mbid: MBID_SPIN_RG,              title: "Spin Track RG",              artist: `Album Artist ${run}` },
    { mbid: MBID_LIB_RG,               title: "Lib Track RG",               artist: `Album Artist ${run}` },
    // Scenario 2
    { mbid: MBID_SPIN_ART,             title: "Spin Track Art",             artist: `Artist ${run}`, artistMbid: ARTIST_MBID },
    { mbid: MBID_LIB_ART,              title: "Lib Track Art",              artist: `Artist ${run}`, artistMbid: ARTIST_MBID },
    // Scenario 3
    { mbid: MBID_SPIN_SOFT,            title: "Spin Track Soft",            artist: SOFT_ARTIST },
    // Scenario 4 — lifetime-only (spin is the same MBID that's in the library)
    { mbid: MBID_SPIN_LIFETIME,        title: "Spin Track Lifetime",        artist: `Lifetime Artist ${run}` },
    // Scenario 5 — lifetime artist crossing (spin NOT in library, but artist is)
    { mbid: MBID_SPIN_LIFETIME_ART,    title: "Spin Track Lifetime Art",    artist: `LT Art Artist ${run}`, artistMbid: ARTIST_MBID_LT },
    { mbid: MBID_LIB_LIFETIME_ART,     title: "Lib Track Lifetime Art",     artist: `LT Art Artist ${run}`, artistMbid: ARTIST_MBID_LT },
  ]);

  // Release-group bridge rows (both recordings share the same primary RG)
  await db.insert(recordingReleaseGroupsTable).values([
    { recordingMbid: MBID_SPIN_RG, releaseGroupMbid: RG_MBID, isPrimary: true,  title: `Test Album ${run}` },
    { recordingMbid: MBID_LIB_RG,  releaseGroupMbid: RG_MBID, isPrimary: true,  title: `Test Album ${run}` },
  ]);

  // ── Station + spins ──────────────────────────────────────────────────────────
  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG,
      name: `Test Crossings Station ${run}`,
      streamUrl: "http://example.invalid/cross",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  const now = new Date();
  const ago25h = new Date(now.getTime() - 25 * 60 * 60 * 1000); // outside the 24h window
  await db.insert(spinsTable).values([
    // Scenario 1 — aired recording A (shares RG with library recording B)
    { stationId: stationId!, mbid: MBID_SPIN_RG,       confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: now },
    // Scenario 2 — aired by ARTIST_MBID but the exact track is not in the library.
    // Seeded TWICE (>2 min apart) to confirm count(distinct mbid) collapses replays
    // into a single artistCrossings unit rather than counting spin events.
    { stationId: stationId!, mbid: MBID_SPIN_ART,      confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 1000) },
    { stationId: stationId!, mbid: MBID_SPIN_ART,      confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 1000 - 3 * 60 * 1000) },
    // Scenario 3 — aired by SOFT_ARTIST (no artistMbid on recording)
    { stationId: stationId!, mbid: MBID_SPIN_SOFT,     confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 2000) },
    // Scenario 4 — aired 25h ago (outside rolling window) — lifetime-only crossing
    { stationId: stationId!, mbid: MBID_SPIN_LIFETIME, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: ago25h },
    // Scenario 5 — aired 25h ago TWICE (distinct mbid, same artist) — lifetime artist crossing.
    // Both spins are outside the 24h window.  count(distinct mbid) must collapse them to 1.
    { stationId: stationId!, mbid: MBID_SPIN_LIFETIME_ART, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: ago25h },
    { stationId: stationId!, mbid: MBID_SPIN_LIFETIME_ART, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(ago25h.getTime() - 3 * 60 * 1000) },
  ]);

  // ── Library items ────────────────────────────────────────────────────────────

  // User RG: library has recording B (not the aired recording A)
  await db.insert(libraryItemsTable).values([
    { userId: userRgId!, mbid: MBID_LIB_RG, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // User ART: library has MBID_LIB_ART (same artistMbid as the aired MBID_SPIN_ART)
  await db.insert(libraryItemsTable).values([
    { userId: userArtId!, mbid: MBID_LIB_ART, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // User SOFT: library has an unresolved spotify_library_items row (no mbid, name matches)
  // Guard: table may not exist in all environments (schema migration not yet applied).
  // We detect this by attempting the insert and catching "relation does not exist"
  // (code 42P01), which Postgres returns immediately — no hanging probe needed.
  try {
    await db.insert(spotifyLibraryItemsTable).values([
      {
        userId: userSoftId!,
        spotifyId: `soft-${run}`,
        title: "Some Track",
        artist: SOFT_ARTIST,
        addedAt: new Date(),
        // mbid intentionally null — the soft-fallback path
      },
    ]);
    softTableAvailable = true;
  } catch {
    softTableAvailable = false;
  }

  // User EMPTY: no library items at all

  // User LIFETIME: library has the exact MBID that aired 25h ago
  await db.insert(libraryItemsTable).values([
    { userId: userLifetimeId!, mbid: MBID_SPIN_LIFETIME, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // User LIFETIME_ART: library has a different track by the same artist (not the aired MBID)
  await db.insert(libraryItemsTable).values([
    { userId: userLifetimeArtId!, mbid: MBID_LIB_LIFETIME_ART, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // ── Server ───────────────────────────────────────────────────────────────────
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

// ── Teardown ──────────────────────────────────────────────────────────────────
afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  // Soft-artist spotify items (only if the table exists in this environment)
  if (softTableAvailable && userSoftId != null) {
    await db
      .delete(spotifyLibraryItemsTable)
      .where(eq(spotifyLibraryItemsTable.userId, userSoftId));
  }

  // Library items
  for (const userId of [userRgId, userArtId, userSoftId, userEmptyId, userLifetimeId, userLifetimeArtId]) {
    if (userId != null) {
      await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    }
  }

  // Spins + station
  if (stationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }

  // Release-group bridge rows + recordings (cascade deletes rrg rows automatically,
  // but explicit delete is safe and avoids relying on cascade order)
  for (const mbid of [
    MBID_SPIN_RG, MBID_LIB_RG,
    MBID_SPIN_ART, MBID_LIB_ART,
    MBID_SPIN_SOFT,
    MBID_SPIN_LIFETIME,
    MBID_SPIN_LIFETIME_ART, MBID_LIB_LIFETIME_ART,
  ]) {
    await db
      .delete(recordingReleaseGroupsTable)
      .where(eq(recordingReleaseGroupsTable.recordingMbid, mbid));
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }

  // Lore users
  for (const userId of [userRgId, userArtId, userSoftId, userEmptyId, userLifetimeId, userLifetimeArtId]) {
    if (userId != null) {
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
    }
  }

  // Legacy spotify connections
  for (const sid of [SID_RG, SID_ART, SID_SOFT, SID_EMPTY, SID_LIFETIME, SID_LIFETIME_ART]) {
    await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, sid));
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

const TEST_TIMEOUT = 30_000;

describe("GET /api/me/crossings — release-group widening", () => {
  it("counts a crossing when the station plays a different pressing of a library album", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/crossings", SID_RG);
    expect(status).toBe(200);
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body.items)).toBe(true);

    const row = (body.items as Array<{ stationSlug: string; crossings: number; artistCrossings: number }>)
      .find((r) => r.stationSlug === STATION_SLUG);

    // The station aired MBID_SPIN_RG; the library has MBID_LIB_RG (same RG).
    // The endpoint must widen via recording_release_groups and count it.
    expect(row).toBeDefined();
    expect(row!.crossings).toBeGreaterThanOrEqual(1);
  }, TEST_TIMEOUT);

  it("returns empty items for a user with no library", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/crossings", SID_EMPTY);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
  }, TEST_TIMEOUT);
});

describe("GET /api/me/crossings — artist MBID crossing", () => {
  it("counts artistCrossings when the station plays a track by a library artist (no exact-MBID match)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/crossings", SID_ART);
    expect(status).toBe(200);

    const row = (body.items as Array<{ stationSlug: string; crossings: number; artistCrossings: number }>)
      .find((r) => r.stationSlug === STATION_SLUG);

    // MBID_SPIN_ART is not in the library and shares no RG with MBID_LIB_ART,
    // but both share ARTIST_MBID → artistCrossings must be ≥ 1 and crossings = 0.
    expect(row).toBeDefined();
    expect(row!.crossings).toBe(0);
    expect(row!.artistCrossings).toBeGreaterThanOrEqual(1);
  }, TEST_TIMEOUT);

  it("collapses duplicate spins of the same track into a single artistCrossings unit", async () => {
    if (!dbAvailable) return;
    // MBID_SPIN_ART was seeded twice (>2 min apart) in beforeAll.
    // count(distinct mbid) must collapse both spin events into 1 distinct recording.
    _testOnly_clearCrossingsCache(userArtId!);
    const { status, body } = await get("/api/me/crossings", SID_ART);
    expect(status).toBe(200);

    const row = (body.items as Array<{ stationSlug: string; crossings: number; artistCrossings: number }>)
      .find((r) => r.stationSlug === STATION_SLUG);

    expect(row).toBeDefined();
    expect(row!.artistCrossings).toBe(1);
  }, TEST_TIMEOUT);
});

describe("GET /api/me/crossings — soft artist name fallback", () => {
  it("counts artistCrossings when artist name matches an unresolved spotify_library_items row", async () => {
    if (!dbAvailable || !softTableAvailable) return;
    const { status, body } = await get("/api/me/crossings", SID_SOFT);
    expect(status).toBe(200);

    const row = (body.items as Array<{ stationSlug: string; crossings: number; artistCrossings: number }>)
      .find((r) => r.stationSlug === STATION_SLUG);

    // MBID_SPIN_SOFT has no artistMbid; artist name = SOFT_ARTIST.
    // The soft-artist path must match the spotify_library_items row by name.
    // Exactly one distinct recording aired by this artist → artistCrossings must be 1.
    expect(row).toBeDefined();
    expect(row!.crossings).toBe(0);
    expect(row!.artistCrossings).toBe(1);
  });
});

describe("GET /api/me/crossings — lifetime-only crossing (spin outside 24h window)", () => {
  it("includes the station when the only crossing is older than 24h, with crossings=0 and lifetimeCrossings≥1", async () => {
    if (!dbAvailable) return;

    // Evict any cached result so we hit the DB fresh for this user.
    _testOnly_clearCrossingsCache(userLifetimeId!);

    const { status, body } = await get("/api/me/crossings", SID_LIFETIME);
    expect(status).toBe(200);

    type CrossingItem = {
      stationSlug: string;
      crossings: number;
      artistCrossings: number;
      lifetimeCrossings: number;
      lifetimeArtistCrossings: number;
    };
    const row = (body.items as CrossingItem[]).find((r) => r.stationSlug === STATION_SLUG);

    // The spin was played 25h ago — outside the 24h window — but MBID_SPIN_LIFETIME
    // is in the user's library exactly (same MBID).
    // The HAVING clause must pass on the lifetime aggregate, not the 24h count.
    expect(row).toBeDefined();
    expect(row!.crossings).toBe(0);                           // nothing within 24h
    expect(row!.artistCrossings).toBe(0);                     // nothing within 24h
    expect(row!.lifetimeCrossings).toBeGreaterThanOrEqual(1); // the 25h-old spin
  }, TEST_TIMEOUT);
});

describe("GET /api/me/crossings — lifetime artist crossing (spin outside 24h window)", () => {
  it("collapses two old spins of the same track into lifetimeArtistCrossings===1 and includes the station", async () => {
    if (!dbAvailable) return;

    // Evict any cached result so we hit the DB fresh for this user.
    _testOnly_clearCrossingsCache(userLifetimeArtId!);

    const { status, body } = await get("/api/me/crossings", SID_LIFETIME_ART);
    expect(status).toBe(200);

    type CrossingItem = {
      stationSlug: string;
      crossings: number;
      artistCrossings: number;
      lifetimeCrossings: number;
      lifetimeArtistCrossings: number;
    };
    const row = (body.items as CrossingItem[]).find((r) => r.stationSlug === STATION_SLUG);

    // MBID_SPIN_LIFETIME_ART was spun twice, both >24h ago, and is NOT in the library.
    // MBID_LIB_LIFETIME_ART is in the library and shares ARTIST_MBID_LT.
    // → crossings=0, artistCrossings=0 (outside window), lifetimeCrossings=0 (not in library),
    //   lifetimeArtistCrossings=1 (count distinct mbid collapses both spins).
    // The HAVING clause must admit this row on the lifetime artist aggregate alone.
    expect(row).toBeDefined();
    expect(row!.crossings).toBe(0);                        // nothing within 24h
    expect(row!.artistCrossings).toBe(0);                  // nothing within 24h
    expect(row!.lifetimeCrossings).toBe(0);                // aired track not in library
    expect(row!.lifetimeArtistCrossings).toBe(1);          // two spins of one distinct recording
  }, TEST_TIMEOUT);
});

describe("GET /api/me/crossings — TTL cache", () => {
  it("serves the second request from the in-memory cache without updating builtAt", async () => {
    if (!dbAvailable) return;

    // Evict so the first request populates the cache fresh.
    _testOnly_clearCrossingsCache(userRgId!);

    // First request — populates cache.
    const first = await get("/api/me/crossings", SID_RG);
    expect(first.status).toBe(200);

    // Record the builtAt timestamp the first request wrote.
    const afterFirst = _testOnly_getCrossingsCache(userRgId!);
    expect(afterFirst).toBeDefined();
    const builtAt1 = afterFirst!.builtAt;

    // Second request — must be a cache hit (builtAt must not change).
    const second = await get("/api/me/crossings", SID_RG);
    expect(second.status).toBe(200);

    const afterSecond = _testOnly_getCrossingsCache(userRgId!);
    expect(afterSecond!.builtAt).toBe(builtAt1); // same timestamp → no DB re-query

    // Response content must match.
    expect(second.body).toEqual(first.body);
  }, TEST_TIMEOUT);
});
