// @vitest-environment node
/**
 * Integration tests for server-side library hit annotation (Task 2).
 *
 * Verifies that isLibraryHit / isArtistHit are computed server-side and
 * returned correctly on:
 *   - GET /api/stations/now-playing  (exact MBID hit)
 *   - GET /api/stations/recent-spins (RG widening, artist hit)
 *   - SSE now-playing stream         (flags in spin-changed events)
 *   - Cross-user isolation           (user B never sees user A's hits)
 *
 * All seeds use a run-isolated prefix; cleanup runs in afterAll in FK order.
 * Tests skip silently when no DB is reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  stationsTable,
  spinsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { spinEvents } from "../src/lore/resolve.js";

const run = randomUUID().slice(0, 8);

// ── Session IDs (deviceKey / cookie value) ────────────────────────────────────
const SID_A = `test-lh-a-${run}`;  // user A: has library items
const SID_B = `test-lh-b-${run}`;  // user B: empty library (isolation baseline)

// ── Recordings ────────────────────────────────────────────────────────────────

// Exact MBID hit: spin A-EXACT is directly in user A's library.
const MBID_EXACT         = `lh-exact-${run}`;

// Release-group widening: station plays MBID_RG_SPIN; library has MBID_RG_LIB.
// Both share RG_MBID as their primary release group → should fire isLibraryHit.
const MBID_RG_SPIN       = `lh-rg-spin-${run}`;
const MBID_RG_LIB        = `lh-rg-lib-${run}`;
const RG_MBID            = `lh-rg-${run}`;

// Artist MBID hit: station plays MBID_ARTIST_SPIN; library has MBID_ARTIST_LIB.
// Same ARTIST_MBID but different recording/RG → should fire isArtistHit only.
const MBID_ARTIST_SPIN   = `lh-artist-spin-${run}`;
const MBID_ARTIST_LIB    = `lh-artist-lib-${run}`;
const ARTIST_MBID        = `lh-artist-${run}`;

// ── Station ───────────────────────────────────────────────────────────────────
const STATION_SLUG = `lh-station-${run}`;

// ── Test state ────────────────────────────────────────────────────────────────
let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let stationId: number | null = null;
let userAId: number | null = null;
let userBId: number | null = null;

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function get(path: string, sid?: string) {
  const headers: Record<string, string> = {};
  if (sid) headers["cookie"] = `lore_sid=${sid}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

/**
 * Open an SSE connection as `sid`, wait for the `:connected` handshake, call
 * `emitFn` to fire a spin-changed event, then read and return the first `data:`
 * frame. Aborts after `timeoutMs` ms (default 8 s) to keep tests fast.
 */
async function readOneSseEvent(
  sid: string,
  emitFn: () => void,
  timeoutMs = 8_000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/stations/now-playing/stream`, {
      headers: { Cookie: `lore_sid=${sid}` },
      signal: controller.signal,
    });

    if (!response.body) throw new Error("No response body on SSE stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let emitted = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("SSE stream closed before event arrived");

      buf += decoder.decode(value, { stream: true });

      // Fire the spin event once we know the connection (and its hit context)
      // is established — the server writes ":connected" synchronously after
      // buildLibraryHitContext resolves, so the context is ready by this point.
      if (!emitted && buf.includes(":connected")) {
        emitted = true;
        emitFn();
      }

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          await reader.cancel();
          return JSON.parse(line.slice(6)) as Record<string, unknown>;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  try {
    await db.execute(eq as unknown as Parameters<typeof db.execute>[0]);
  } catch {
    // intentional no-op — just checking db is reachable below
  }

  try {
    const result = await db.execute<{ one: number }>(
      { sql: "select 1 as one", params: [], typings: [] } as never,
    );
    if (result.rows[0]?.one === 1) dbAvailable = true;
  } catch {
    // DB not available — tests will skip
    return;
  }

  // ── Spotify connections (FK for lore_users) ────────────────────────────────
  for (const sid of [SID_A, SID_B]) {
    await db.insert(spotifyConnectionsTable).values({
      sid,
      accessToken: "t",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  // ── Lore users ─────────────────────────────────────────────────────────────
  const [uA] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `lh-a-${run}`, spotifyConnectionId: SID_A, deviceKey: SID_A })
    .returning({ id: loreUsersTable.id });
  userAId = uA!.id;

  const [uB] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `lh-b-${run}`, spotifyConnectionId: SID_B, deviceKey: SID_B })
    .returning({ id: loreUsersTable.id });
  userBId = uB!.id;

  // ── Recordings ─────────────────────────────────────────────────────────────
  await db.insert(recordingsTable).values([
    { mbid: MBID_EXACT,       title: "Exact Track",       artist: `Exact Artist ${run}` },
    { mbid: MBID_RG_SPIN,     title: "RG Spin Track",     artist: `RG Artist ${run}` },
    { mbid: MBID_RG_LIB,      title: "RG Lib Track",      artist: `RG Artist ${run}` },
    { mbid: MBID_ARTIST_SPIN, title: "Artist Spin Track", artist: `Artist ${run}`, artistMbid: ARTIST_MBID },
    { mbid: MBID_ARTIST_LIB,  title: "Artist Lib Track",  artist: `Artist ${run}`, artistMbid: ARTIST_MBID },
  ]);

  // Release-group bridge: RG_SPIN and RG_LIB share RG_MBID.
  await db.insert(recordingReleaseGroupsTable).values([
    { recordingMbid: MBID_RG_SPIN, releaseGroupMbid: RG_MBID, isPrimary: true, title: `Test Album ${run}` },
    { recordingMbid: MBID_RG_LIB,  releaseGroupMbid: RG_MBID, isPrimary: true, title: `Test Album ${run}` },
    // MBID_EXACT gets its own RG so a batch RG lookup for it doesn't cross-contaminate.
    { recordingMbid: MBID_EXACT, releaseGroupMbid: `lh-rg-exact-${run}`, isPrimary: true, title: `Exact Album ${run}` },
  ]);

  // ── Station ────────────────────────────────────────────────────────────────
  const [stn] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG,
      name: `Test LH Station ${run}`,
      streamUrl: "http://example.invalid/lh",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = stn!.id;

  // Insert three spins at decreasing times so the most recent is MBID_EXACT
  // (used by the now-playing endpoint) and the other two appear in recent-spins.
  const now = new Date();
  await db.insert(spinsTable).values([
    {
      stationId: stationId!,
      mbid: MBID_EXACT,
      confidence: "text",
      rawTitle: "Exact Track",
      rawArtist: "Exact Artist",
      playedAt: now,
    },
    {
      stationId: stationId!,
      mbid: MBID_RG_SPIN,
      confidence: "text",
      rawTitle: "RG Spin Track",
      rawArtist: "RG Artist",
      playedAt: new Date(now.getTime() - 1_000),
    },
    {
      stationId: stationId!,
      mbid: MBID_ARTIST_SPIN,
      confidence: "text",
      rawTitle: "Artist Spin Track",
      rawArtist: "Artist",
      playedAt: new Date(now.getTime() - 2_000),
    },
  ]);

  // ── User A library ─────────────────────────────────────────────────────────
  await db.insert(libraryItemsTable).values([
    // Exact MBID hit
    { userId: userAId!, mbid: MBID_EXACT, provenance: { kind: "keep" }, addedAt: new Date() },
    // RG widening: library has MBID_RG_LIB (not MBID_RG_SPIN, but same RG)
    { userId: userAId!, mbid: MBID_RG_LIB, provenance: { kind: "keep" }, addedAt: new Date() },
    // Artist hit: library has MBID_ARTIST_LIB (same artistMbid as MBID_ARTIST_SPIN)
    { userId: userAId!, mbid: MBID_ARTIST_LIB, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);
  // User B: no library items

  // ── Server ─────────────────────────────────────────────────────────────────
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  for (const userId of [userAId, userBId]) {
    if (userId != null) {
      await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    }
  }

  if (stationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }

  for (const mbid of [MBID_EXACT, MBID_RG_SPIN, MBID_RG_LIB, MBID_ARTIST_SPIN, MBID_ARTIST_LIB]) {
    await db.delete(recordingReleaseGroupsTable).where(
      eq(recordingReleaseGroupsTable.recordingMbid, mbid),
    );
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }

  for (const userId of [userAId, userBId]) {
    if (userId != null) {
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
    }
  }

  for (const sid of [SID_A, SID_B]) {
    await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, sid));
  }
});

const TEST_TIMEOUT = 30_000;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/stations/now-playing — exact MBID library hit", () => {
  it("marks isLibraryHit=true when the now-playing MBID is in the listener's library", async () => {
    if (!dbAvailable) return;

    const { status, body } = await get("/api/stations/now-playing", SID_A);
    expect(status).toBe(200);

    type Item = { slug: string; nowPlaying: { isLibraryHit: boolean; isArtistHit: boolean } | null };
    const item = (body.items as Item[]).find((i) => i.slug === STATION_SLUG);

    expect(item).toBeDefined();
    expect(item!.nowPlaying).not.toBeNull();
    // MBID_EXACT is the most recent spin and is directly in user A's library.
    expect(item!.nowPlaying!.isLibraryHit).toBe(true);
    expect(item!.nowPlaying!.isArtistHit).toBe(false);
  }, TEST_TIMEOUT);
});

describe("GET /api/stations/recent-spins — release-group widening", () => {
  it("marks isLibraryHit=true when the spin's RG is in the listener's library", async () => {
    if (!dbAvailable) return;

    const today = new Date().toISOString().slice(0, 10);
    const { status, body } = await get(`/api/stations/recent-spins?date=${today}`, SID_A);
    expect(status).toBe(200);

    type SpinItem = { mbid: string | null; isLibraryHit: boolean; isArtistHit: boolean };
    type StationItem = { stationSlug: string; spins: SpinItem[] };
    const stationItem = (body.items as StationItem[]).find((i) => i.stationSlug === STATION_SLUG);

    expect(stationItem).toBeDefined();
    const rgSpin = stationItem!.spins.find((sp) => sp.mbid === MBID_RG_SPIN);

    // MBID_RG_SPIN is not in the library but shares RG_MBID with MBID_RG_LIB
    // which IS in the library → album-level widening must fire isLibraryHit.
    expect(rgSpin).toBeDefined();
    expect(rgSpin!.isLibraryHit).toBe(true);
    expect(rgSpin!.isArtistHit).toBe(false);
  }, TEST_TIMEOUT);
});

describe("GET /api/stations/recent-spins — artist MBID hit", () => {
  it("marks isArtistHit=true when the spin artist is in the library but the track/album is not", async () => {
    if (!dbAvailable) return;

    const today = new Date().toISOString().slice(0, 10);
    const { status, body } = await get(`/api/stations/recent-spins?date=${today}`, SID_A);
    expect(status).toBe(200);

    type SpinItem = { mbid: string | null; isLibraryHit: boolean; isArtistHit: boolean };
    type StationItem = { stationSlug: string; spins: SpinItem[] };
    const stationItem = (body.items as StationItem[]).find((i) => i.stationSlug === STATION_SLUG);

    expect(stationItem).toBeDefined();
    const artistSpin = stationItem!.spins.find((sp) => sp.mbid === MBID_ARTIST_SPIN);

    // MBID_ARTIST_SPIN shares ARTIST_MBID with MBID_ARTIST_LIB (in library)
    // but does not share the same recording MBID or release group.
    // → isLibraryHit must be false, isArtistHit must be true.
    expect(artistSpin).toBeDefined();
    expect(artistSpin!.isLibraryHit).toBe(false);
    expect(artistSpin!.isArtistHit).toBe(true);
  }, TEST_TIMEOUT);
});

describe("SSE /api/stations/now-playing/stream — spin-changed event carries hit flags", () => {
  it("includes isLibraryHit=true in the SSE payload when the spin MBID is in the listener's library", async () => {
    if (!dbAvailable) return;

    const ev = await readOneSseEvent(SID_A, () => {
      // Emit a spin whose MBID is directly in user A's library.
      spinEvents.emit("spin-changed", {
        stationId: stationId!,
        stationSlug: STATION_SLUG,
        rawArtist: "Exact Artist",
        rawTitle: "Exact Track",
        mbid: MBID_EXACT,
        artistMbid: null,
        releaseGroupMbid: null,
        isFirstSpin: false,
      });
    });

    // The SSE handler annotates the event server-side per listener.
    expect(ev.isLibraryHit).toBe(true);
    expect(ev.isArtistHit).toBe(false);
    // Existing fields must still be present.
    expect(ev.mbid).toBe(MBID_EXACT);
    expect(ev.stationSlug).toBe(STATION_SLUG);
  }, TEST_TIMEOUT);
});

describe("Cross-user isolation — hit flags are not shared between listeners", () => {
  it("returns isLibraryHit=false for user B on the same station where user A sees a hit", async () => {
    if (!dbAvailable) return;

    // User A should see a hit (MBID_EXACT in library).
    const resA = await get("/api/stations/now-playing", SID_A);
    expect(resA.status).toBe(200);

    // User B (empty library) must see no hit for the identical station/spin.
    const resB = await get("/api/stations/now-playing", SID_B);
    expect(resB.status).toBe(200);

    type Item = { slug: string; nowPlaying: { isLibraryHit: boolean; isArtistHit: boolean } | null };

    const itemA = (resA.body.items as Item[]).find((i) => i.slug === STATION_SLUG);
    const itemB = (resB.body.items as Item[]).find((i) => i.slug === STATION_SLUG);

    expect(itemA?.nowPlaying?.isLibraryHit).toBe(true);
    expect(itemB?.nowPlaying?.isLibraryHit).toBe(false);
    expect(itemB?.nowPlaying?.isArtistHit).toBe(false);
  }, TEST_TIMEOUT);
});
