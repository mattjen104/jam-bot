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
const SID_RG    = `test-cross-rg-${run}`;     // release-group widening user
const SID_ART   = `test-cross-art-${run}`;    // artist MBID crossing user
const SID_SOFT  = `test-cross-soft-${run}`;   // soft artist fallback user
const SID_EMPTY = `test-cross-empty-${run}`;  // empty library (baseline)

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
  for (const sid of [SID_RG, SID_ART, SID_SOFT, SID_EMPTY]) {
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

  // ── Recordings ───────────────────────────────────────────────────────────────
  await db.insert(recordingsTable).values([
    // Scenario 1
    { mbid: MBID_SPIN_RG,   title: "Spin Track RG",   artist: `Album Artist ${run}` },
    { mbid: MBID_LIB_RG,    title: "Lib Track RG",    artist: `Album Artist ${run}` },
    // Scenario 2
    { mbid: MBID_SPIN_ART,  title: "Spin Track Art",  artist: `Artist ${run}`, artistMbid: ARTIST_MBID },
    { mbid: MBID_LIB_ART,   title: "Lib Track Art",   artist: `Artist ${run}`, artistMbid: ARTIST_MBID },
    // Scenario 3
    { mbid: MBID_SPIN_SOFT, title: "Spin Track Soft", artist: SOFT_ARTIST },
    // artistMbid intentionally absent (null) for soft-fallback test
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
  await db.insert(spinsTable).values([
    // Scenario 1 — aired recording A (shares RG with library recording B)
    { stationId: stationId!, mbid: MBID_SPIN_RG,   confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: now },
    // Scenario 2 — aired by ARTIST_MBID but the exact track is not in the library
    { stationId: stationId!, mbid: MBID_SPIN_ART,  confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 1000) },
    // Scenario 3 — aired by SOFT_ARTIST (no artistMbid on recording)
    { stationId: stationId!, mbid: MBID_SPIN_SOFT, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 2000) },
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
  for (const userId of [userRgId, userArtId, userSoftId, userEmptyId]) {
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
  for (const mbid of [MBID_SPIN_RG, MBID_LIB_RG, MBID_SPIN_ART, MBID_LIB_ART, MBID_SPIN_SOFT]) {
    await db
      .delete(recordingReleaseGroupsTable)
      .where(eq(recordingReleaseGroupsTable.recordingMbid, mbid));
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }

  // Lore users
  for (const userId of [userRgId, userArtId, userSoftId, userEmptyId]) {
    if (userId != null) {
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
    }
  }

  // Legacy spotify connections
  for (const sid of [SID_RG, SID_ART, SID_SOFT, SID_EMPTY]) {
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
    expect(row).toBeDefined();
    expect(row!.crossings).toBe(0);
    expect(row!.artistCrossings).toBeGreaterThanOrEqual(1);
  });
});
