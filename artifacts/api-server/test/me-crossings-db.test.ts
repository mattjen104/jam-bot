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
import { _testOnly_clearCrossingsCache, _testOnly_getCrossingsCache, SOCIAL_PRESENCE_TTL_MS } from "../src/routes/me/crossings.js";

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
const SID_SORT     = `test-cross-sort-${run}`;     // two-station sort comparison user
const SID_AGED     = `test-cross-aged-${run}`;     // aged crossing (spin 200 days old, outside old 180-day scanCutoff)

// ── Recordings ────────────────────────────────────────────────────────────────
// Scenario 1 — release-group widening
const MBID_SPIN_RG   = `tc-spin-rg-${run}`;   // aired on the station (recording A)
const MBID_LIB_RG    = `tc-lib-rg-${run}`;    // in user's library (recording B, same RG)
const RG_MBID        = `tc-rg-${run}`;        // shared primary release group

// Scenario 2 — artist MBID crossing
const ARTIST_MBID    = `tc-artist-${run}`;    // shared artist MBID
const MBID_SPIN_ART  = `tc-spin-art-${run}`;  // aired track (artist = ARTIST_MBID)
const MBID_LIB_ART   = `tc-lib-art-${run}`;   // library track (artist = ARTIST_MBID)
const MBID_JUNK_ART  = `tc-junk-art-${run}`;  // legacy domain artist, same artist MBID
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

// Scenario 6 — two-station sort by lifetimeArtistCrossings
// Station A plays 3 distinct tracks by ARTIST_MBID_SORT (all >24h ago, not in library).
// Station B plays 1 distinct track by the same artist (>24h ago, not in library).
// The user's library holds a different track by ARTIST_MBID_SORT → artist crossings only.
// Expected: station A lifetimeArtistCrossings=3, station B lifetimeArtistCrossings=1; A > B.
const ARTIST_MBID_SORT        = `tc-artist-sort-${run}`;
const MBID_SORT_A1            = `tc-sort-a1-${run}`;
const MBID_SORT_A2            = `tc-sort-a2-${run}`;
const MBID_SORT_A3            = `tc-sort-a3-${run}`;
const MBID_SORT_B1            = `tc-sort-b1-${run}`;
const MBID_LIB_SORT           = `tc-lib-sort-${run}`;      // library track (same artist, never aired)

// Scenario 7 — aged crossing (spin 200 days old, outside every rolling window)
// The user's library holds the exact MBID that aired 200 days ago.  Lifetime counts
// now run in a separate unbounded query (no scanCutoff), so any historical spin must
// produce lifetimeCrossings ≥ 1 regardless of age.
const MBID_SPIN_AGED          = `tc-spin-aged-${run}`;

// ── Station ───────────────────────────────────────────────────────────────────
const STATION_SLUG      = `test-cross-sta-${run}`;
const STATION_SLUG_SORT_A = `test-cross-sort-a-${run}`;
const STATION_SLUG_SORT_B = `test-cross-sort-b-${run}`;

// ── State ─────────────────────────────────────────────────────────────────────
let dbAvailable = false;
let softTableAvailable = false;
let server: Server | undefined;
let baseUrl = "";

let stationId: number | null = null;
let stationSortAId: number | null = null;
let stationSortBId: number | null = null;
let userRgId: number | null = null;
let userArtId: number | null = null;
let userSoftId: number | null = null;
let userEmptyId: number | null = null;
let userLifetimeId: number | null = null;
let userLifetimeArtId: number | null = null;
let userSortId: number | null = null;
let userAgedId: number | null = null;

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
  for (const sid of [SID_RG, SID_ART, SID_SOFT, SID_EMPTY, SID_LIFETIME, SID_LIFETIME_ART, SID_SORT, SID_AGED]) {
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

  const [uSort] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `cross-sort-${run}`, spotifyConnectionId: SID_SORT, deviceKey: SID_SORT })
    .returning({ id: loreUsersTable.id });
  userSortId = uSort!.id;

  const [uAged] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `cross-aged-${run}`, spotifyConnectionId: SID_AGED, deviceKey: SID_AGED })
    .returning({ id: loreUsersTable.id });
  userAgedId = uAged!.id;

  // ── Recordings ───────────────────────────────────────────────────────────────
  await db.insert(recordingsTable).values([
    // Scenario 1
    { mbid: MBID_SPIN_RG,              title: "Spin Track RG",              artist: `Album Artist ${run}` },
    { mbid: MBID_LIB_RG,               title: "Lib Track RG",               artist: `Album Artist ${run}` },
    // Scenario 2
    { mbid: MBID_SPIN_ART,             title: "Spin Track Art",             artist: `Artist ${run}`, artistMbid: ARTIST_MBID },
    { mbid: MBID_LIB_ART,              title: "Lib Track Art",              artist: `Artist ${run}`, artistMbid: ARTIST_MBID },
    { mbid: MBID_JUNK_ART,              title: "Legacy Ad Track",            artist: "wellsfargo.com", artistMbid: ARTIST_MBID },
    // Scenario 3
    { mbid: MBID_SPIN_SOFT,            title: "Spin Track Soft",            artist: SOFT_ARTIST },
    // Scenario 4 — lifetime-only (spin is the same MBID that's in the library)
    { mbid: MBID_SPIN_LIFETIME,        title: "Spin Track Lifetime",        artist: `Lifetime Artist ${run}` },
    // Scenario 5 — lifetime artist crossing (spin NOT in library, but artist is)
    { mbid: MBID_SPIN_LIFETIME_ART,    title: "Spin Track Lifetime Art",    artist: `LT Art Artist ${run}`, artistMbid: ARTIST_MBID_LT },
    { mbid: MBID_LIB_LIFETIME_ART,     title: "Lib Track Lifetime Art",     artist: `LT Art Artist ${run}`, artistMbid: ARTIST_MBID_LT },
    // Scenario 6 — sort: 3 distinct tracks on station A, 1 on station B (all >24h, not in library)
    { mbid: MBID_SORT_A1,              title: "Sort Track A1",              artist: `Sort Artist ${run}`, artistMbid: ARTIST_MBID_SORT },
    { mbid: MBID_SORT_A2,              title: "Sort Track A2",              artist: `Sort Artist ${run}`, artistMbid: ARTIST_MBID_SORT },
    { mbid: MBID_SORT_A3,              title: "Sort Track A3",              artist: `Sort Artist ${run}`, artistMbid: ARTIST_MBID_SORT },
    { mbid: MBID_SORT_B1,              title: "Sort Track B1",              artist: `Sort Artist ${run}`, artistMbid: ARTIST_MBID_SORT },
    { mbid: MBID_LIB_SORT,             title: "Sort Lib Track",             artist: `Sort Artist ${run}`, artistMbid: ARTIST_MBID_SORT },
    // Scenario 7 — aged crossing (spin 200 days old)
    { mbid: MBID_SPIN_AGED,            title: "Spin Track Aged",            artist: `Aged Artist ${run}` },
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
    { stationId: stationId!, mbid: MBID_JUNK_ART,      confidence: "text", rawTitle: "ad", rawArtist: "wellsfargo.com", playedAt: new Date(now.getTime() - 1500) },
    // Scenario 3 — aired by SOFT_ARTIST (no artistMbid on recording)
    { stationId: stationId!, mbid: MBID_SPIN_SOFT,     confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 2000) },
    // Scenario 4 — aired 25h ago (outside rolling window) — lifetime-only crossing
    { stationId: stationId!, mbid: MBID_SPIN_LIFETIME, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: ago25h },
    // Scenario 5 — aired 25h ago TWICE (distinct mbid, same artist) — lifetime artist crossing.
    // Both spins are outside the 24h window.  count(distinct mbid) must collapse them to 1.
    { stationId: stationId!, mbid: MBID_SPIN_LIFETIME_ART, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: ago25h },
    { stationId: stationId!, mbid: MBID_SPIN_LIFETIME_ART, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(ago25h.getTime() - 3 * 60 * 1000) },
    // Scenario 7 — aired 200 days ago (outside the old 180-day scanCutoff, inside 365-day window).
    // With scanCutoff extended to 365 days this spin must produce lifetimeCrossings ≥ 1.
    { stationId: stationId!, mbid: MBID_SPIN_AGED, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000) },
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

  // ── Scenario 6 — two-station sort ────────────────────────────────────────────
  const [stationSortA] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG_SORT_A,
      name: `Test Sort Station A ${run}`,
      streamUrl: "http://example.invalid/sort-a",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationSortAId = stationSortA!.id;

  const [stationSortB] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG_SORT_B,
      name: `Test Sort Station B ${run}`,
      streamUrl: "http://example.invalid/sort-b",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationSortBId = stationSortB!.id;

  // All sort spins are 25h old (outside the 24h window) so they count only
  // toward lifetimeArtistCrossings, not the rolling artistCrossings.
  const ago25hSort = new Date(now.getTime() - 25 * 60 * 60 * 1000);
  await db.insert(spinsTable).values([
    // Station A — 3 distinct tracks by ARTIST_MBID_SORT
    { stationId: stationSortAId!, mbid: MBID_SORT_A1, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: ago25hSort },
    { stationId: stationSortAId!, mbid: MBID_SORT_A2, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(ago25hSort.getTime() - 60_000) },
    { stationId: stationSortAId!, mbid: MBID_SORT_A3, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(ago25hSort.getTime() - 120_000) },
    // Station B — 1 distinct track by ARTIST_MBID_SORT
    { stationId: stationSortBId!, mbid: MBID_SORT_B1, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: ago25hSort },
  ]);

  // User SORT: library has MBID_LIB_SORT (same artist MBID_SORT, but never aired)
  // → all station A / B spins are artist crossings only (not library hits).
  await db.insert(libraryItemsTable).values([
    { userId: userSortId!, mbid: MBID_LIB_SORT, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // ── Scenario 7 — aged crossing ───────────────────────────────────────────────
  // User AGED: library has the exact MBID that aired 200 days ago.
  // This spin falls outside the old 180-day scanCutoff but inside the new 365-day
  // window, so lifetimeCrossings must be ≥ 1.
  await db.insert(libraryItemsTable).values([
    { userId: userAgedId!, mbid: MBID_SPIN_AGED, provenance: { kind: "keep" }, addedAt: new Date() },
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
  for (const userId of [userRgId, userArtId, userSoftId, userEmptyId, userLifetimeId, userLifetimeArtId, userSortId, userAgedId]) {
    if (userId != null) {
      await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    }
  }

  // Spins + stations
  if (stationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.execute(sql`DELETE FROM station_quality WHERE station_id = ${stationId}`);
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
  if (stationSortAId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationSortAId));
    await db.execute(sql`DELETE FROM station_quality WHERE station_id = ${stationSortAId}`);
    await db.delete(stationsTable).where(eq(stationsTable.id, stationSortAId));
  }
  if (stationSortBId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationSortBId));
    await db.execute(sql`DELETE FROM station_quality WHERE station_id = ${stationSortBId}`);
    await db.delete(stationsTable).where(eq(stationsTable.id, stationSortBId));
  }

  // Release-group bridge rows + recordings (cascade deletes rrg rows automatically,
  // but explicit delete is safe and avoids relying on cascade order)
  for (const mbid of [
    MBID_SPIN_RG, MBID_LIB_RG,
    MBID_SPIN_ART, MBID_LIB_ART, MBID_JUNK_ART,
    MBID_SPIN_SOFT,
    MBID_SPIN_LIFETIME,
    MBID_SPIN_LIFETIME_ART, MBID_LIB_LIFETIME_ART,
    MBID_SORT_A1, MBID_SORT_A2, MBID_SORT_A3, MBID_SORT_B1, MBID_LIB_SORT,
    MBID_SPIN_AGED,
  ]) {
    await db
      .delete(recordingReleaseGroupsTable)
      .where(eq(recordingReleaseGroupsTable.recordingMbid, mbid));
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }

  // Lore users
  for (const userId of [userRgId, userArtId, userSoftId, userEmptyId, userLifetimeId, userLifetimeArtId, userSortId, userAgedId]) {
    if (userId != null) {
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
    }
  }

  // Legacy spotify connections
  for (const sid of [SID_RG, SID_ART, SID_SOFT, SID_EMPTY, SID_LIFETIME, SID_LIFETIME_ART, SID_SORT, SID_AGED]) {
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

describe("GET /api/me/crossings — two-station sort by lifetimeArtistCrossings", () => {
  it("station with 3 distinct artist tracks scores higher than station with 1", async () => {
    if (!dbAvailable) return;

    _testOnly_clearCrossingsCache(userSortId!);

    const { status, body } = await get("/api/me/crossings", SID_SORT);
    expect(status).toBe(200);

    type CrossingItem = {
      stationSlug: string;
      crossings: number;
      artistCrossings: number;
      lifetimeCrossings: number;
      lifetimeArtistCrossings: number;
    };
    const items = body.items as CrossingItem[];

    const rowA = items.find((r) => r.stationSlug === STATION_SLUG_SORT_A);
    const rowB = items.find((r) => r.stationSlug === STATION_SLUG_SORT_B);

    // Both stations must appear — each has at least one lifetime artist crossing.
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();

    // Station A aired 3 distinct tracks by ARTIST_MBID_SORT (all >24h ago, not in library).
    expect(rowA!.lifetimeArtistCrossings).toBe(3);

    // Station B aired 1 distinct track by the same artist (>24h ago, not in library).
    expect(rowB!.lifetimeArtistCrossings).toBe(1);

    // Station A must rank above station B when sorted descending by lifetimeArtistCrossings.
    expect(rowA!.lifetimeArtistCrossings).toBeGreaterThan(rowB!.lifetimeArtistCrossings);

    // Rolling-window counts must both be 0 (spins are outside the 24h window).
    expect(rowA!.crossings).toBe(0);
    expect(rowA!.artistCrossings).toBe(0);
    expect(rowB!.crossings).toBe(0);
    expect(rowB!.artistCrossings).toBe(0);

    // Confirm client-side descending sort places A before B.
    const sortedByLifetimeArtist = [...items].sort(
      (x, y) => y.lifetimeArtistCrossings - x.lifetimeArtistCrossings,
    );
    const idxA = sortedByLifetimeArtist.findIndex((r) => r.stationSlug === STATION_SLUG_SORT_A);
    const idxB = sortedByLifetimeArtist.findIndex((r) => r.stationSlug === STATION_SLUG_SORT_B);
    expect(idxA).toBeLessThan(idxB);
  }, TEST_TIMEOUT);
});

describe("GET /api/me/crossings — aged crossing (spin outside old 180-day window)", () => {
  it("returns lifetimeCrossings ≥ 1 for a library track whose only spin is 200 days old", async () => {
    if (!dbAvailable) return;

    _testOnly_clearCrossingsCache(userAgedId!);

    const { status, body } = await get("/api/me/crossings", SID_AGED);
    expect(status).toBe(200);

    type CrossingItem = {
      stationSlug: string;
      crossings: number;
      artistCrossings: number;
      lifetimeCrossings: number;
      lifetimeArtistCrossings: number;
    };
    const row = (body.items as CrossingItem[]).find((r) => r.stationSlug === STATION_SLUG);

    // MBID_SPIN_AGED aired 200 days ago and is in the user's library (exact MBID match).
    // Lifetime counts now run via a separate unbounded query (no WHERE on playedAt),
    // so the station must appear with lifetimeCrossings ≥ 1 regardless of how old the
    // spin is.  Rolling-window fields must all be 0 (outside 24h / 7d / 30d).
    expect(row).toBeDefined();
    expect(row!.crossings).toBe(0);
    expect(row!.artistCrossings).toBe(0);
    expect(row!.weekCrossings).toBe(0);
    expect(row!.monthCrossings).toBe(0);
    expect(row!.lifetimeCrossings).toBeGreaterThanOrEqual(1);
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

// ── Blended crossings — presence TTL and spin window ─────────────────────────
//
//   A. Presence TTL: only users with lastSeenAt within SOCIAL_PRESENCE_TTL_MS
//      contribute. A user last seen > 3 min ago must be excluded.
//
//   B. Spin window: crossings/artistCrossings use the same 24-h rolling window
//      as personal crossings. A spin aired 23 h ago counts; 25 h ago must NOT.
describe("GET /api/me/crossings/blended — presence TTL and spin window", () => {
  const brun = randomUUID().slice(0, 8);

  const BSID_ACTIVE = `tc-blend-active-${brun}`;
  const BSID_STALE  = `tc-blend-stale-${brun}`;

  const BMBID_LIB   = `tc-blend-lib-${brun}`;   // in active user's library; aired 23h ago
  const BMBID_OLD   = `tc-blend-old-${brun}`;   // in active user's library; aired 25h ago

  const BSLUG = `tc-blend-station-${brun}`;

  let bStationId: number | undefined;
  let bUserActiveId: number | undefined;
  let bUserStaleId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable) return;

    await db.insert(spotifyConnectionsTable).values([
      { sid: BSID_ACTIVE, accessToken: "t", refreshToken: "r", expiresAt: new Date(Date.now() + 3_600_000) },
      { sid: BSID_STALE,  accessToken: "t", refreshToken: "r", expiresAt: new Date(Date.now() + 3_600_000) },
    ]);

    // Active user: heartbeat just now, socialParticipation = true (default)
    const [uA] = await db.insert(loreUsersTable).values({
      spotifyUserId: `blend-active-${brun}`,
      spotifyConnectionId: BSID_ACTIVE,
      deviceKey: BSID_ACTIVE,
      lastSeenAt: new Date(),
    }).returning({ id: loreUsersTable.id });
    bUserActiveId = uA!.id;

    // Stale user: heartbeat 10 minutes ago
    const [uS] = await db.insert(loreUsersTable).values({
      spotifyUserId: `blend-stale-${brun}`,
      spotifyConnectionId: BSID_STALE,
      deviceKey: BSID_STALE,
      lastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
    }).returning({ id: loreUsersTable.id });
    bUserStaleId = uS!.id;

    await db.insert(recordingsTable).values([
      { mbid: BMBID_LIB, title: "Recent Blend Track", artist: `Blend Artist ${brun}` },
      { mbid: BMBID_OLD, title: "Old Blend Track",    artist: `Blend Artist ${brun}` },
    ]);

    const [bSt] = await db.insert(stationsTable).values({
      slug: BSLUG, name: `Blend Test Station ${brun}`,
      streamUrl: "http://example.invalid/blend", stationClass: "community",
    }).returning({ id: stationsTable.id });
    bStationId = bSt!.id;

    const ago23h = new Date(Date.now() - 23 * 60 * 60 * 1000);
    const ago25h = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.insert(spinsTable).values([
      { stationId: bStationId!, mbid: BMBID_LIB, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: ago23h },
      { stationId: bStationId!, mbid: BMBID_OLD, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: ago25h },
    ]);

    // Active user owns both library items; stale user owns only BMBID_LIB
    await db.insert(libraryItemsTable).values([
      { userId: bUserActiveId!, mbid: BMBID_LIB, provenance: { kind: "keep" }, addedAt: new Date() },
      { userId: bUserActiveId!, mbid: BMBID_OLD, provenance: { kind: "keep" }, addedAt: new Date() },
      { userId: bUserStaleId!,  mbid: BMBID_LIB, provenance: { kind: "keep" }, addedAt: new Date() },
    ]);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (!dbAvailable) return;
    if (bStationId != null) {
      await db.delete(spinsTable).where(eq(spinsTable.stationId, bStationId));
      await db.delete(stationsTable).where(eq(stationsTable.id, bStationId));
    }
    for (const uid of [bUserActiveId, bUserStaleId]) {
      if (uid != null) {
        await db.delete(libraryItemsTable).where(sql`${libraryItemsTable.userId} = ${uid}`);
        await db.delete(loreUsersTable).where(eq(loreUsersTable.id, uid));
      }
    }
    for (const mbid of [BMBID_LIB, BMBID_OLD]) {
      await db.delete(recordingReleaseGroupsTable).where(eq(recordingReleaseGroupsTable.recordingMbid, mbid));
      await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
    }
    for (const sid of [BSID_ACTIVE, BSID_STALE]) {
      await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, sid));
    }
  }, TEST_TIMEOUT);

  it("counts a 23h-old spin in crossings but excludes a 25h-old spin (24h spin window)", async () => {
    if (!dbAvailable) return;
    const res = await fetch(`${baseUrl}/api/me/crossings/blended`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      items: Array<{ stationSlug: string; crossings: number; lifetimeCrossings: number }>;
    };
    const row = body.items.find((r) => r.stationSlug === BSLUG);
    expect(row).toBeDefined();
    // BMBID_LIB aired 23h ago — inside the 24h spin window → crossings = 1
    expect(row!.crossings).toBe(1);
    // BMBID_OLD aired 25h ago — outside window → only lifetimeCrossings
    expect(row!.lifetimeCrossings).toBeGreaterThanOrEqual(2);
  }, TEST_TIMEOUT);

  it("excludes a user whose lastSeenAt exceeds SOCIAL_PRESENCE_TTL_MS", async () => {
    if (!dbAvailable) return;
    // Make the active user stale temporarily
    await db.update(loreUsersTable)
      .set({ lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(loreUsersTable.id, bUserActiveId!));

    const res = await fetch(`${baseUrl}/api/me/crossings/blended`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      items: Array<{ stationSlug: string; crossings: number }>;
    };
    const row = body.items.find((r) => r.stationSlug === BSLUG);
    // Both users are now stale → zero crossings or row absent
    if (row) expect(row.crossings).toBe(0);

    // Restore active user
    await db.update(loreUsersTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(loreUsersTable.id, bUserActiveId!));
  }, TEST_TIMEOUT);

  it("SOCIAL_PRESENCE_TTL_MS is ≤ 5 minutes so presence stays short-lived", () => {
    expect(SOCIAL_PRESENCE_TTL_MS).toBeGreaterThan(0);
    expect(SOCIAL_PRESENCE_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});
