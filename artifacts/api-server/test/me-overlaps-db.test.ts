// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  recordingsTable,
  stationsTable,
  spinsTable,
  pickersTable,
  picksTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests confirming the /api/me/overlaps/* endpoints are correctly
 * scoped to the authenticated session:
 *
 *   1. No session cookie → new anonymous user is provisioned; all endpoints
 *      return empty items (no foreign data leaks).
 *   2. Two distinct sessions with different libraries see different results —
 *      User A's overlaps don't appear for User B.
 *   3. A session with an empty library gets empty items from all three
 *      endpoints (pickers, stations, runs).
 *
 * All seeds are run-isolated (unique slug/mbid/handle per `run`). Cleaned up.
 * Skips silently when no DB is reachable.
 */

const run = randomUUID().slice(0, 8);

// ---- session cookies ----------------------------------------------------------
const SID_A = `test-overlap-a-${run}`;
const SID_B = `test-overlap-b-${run}`;
const SID_EMPTY = `test-overlap-empty-${run}`;

// ---- recordings ---------------------------------------------------------------
const MBID_SHARED = `test-ovlp-shared-${run}`;   // in both station spins AND picker picks
const MBID_STATION_ONLY = `test-ovlp-sta-${run}`; // in station spins only
const MBID_PICKER_ONLY = `test-ovlp-pck-${run}`;  // in picker picks only
const MBID_B_ONLY = `test-ovlp-b-${run}`;         // only in User B's library (no spins)

// ---- station ------------------------------------------------------------------
const STATION_SLUG = `test-ovlp-station-${run}`;

// ---- picker -------------------------------------------------------------------
const PICKER_HANDLE = `test-ovlp-picker-${run}`;

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";

// DB row ids for cleanup
let userAId: number | null = null;
let userBId: number | null = null;
let userEmptyId: number | null = null;
let stationId: number | null = null;
let pickerId: number | null = null;

// ---- helpers ------------------------------------------------------------------

async function get(path: string, sid?: string) {
  const headers: Record<string, string> = {};
  if (sid) headers["cookie"] = `lore_sid=${sid}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

// -------------------------------------------------------------------------------

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // ---- legacy spotify connections (needed by lore_users FK) ------------------
  for (const sid of [SID_A, SID_B, SID_EMPTY]) {
    await db.insert(spotifyConnectionsTable).values({
      sid,
      accessToken: "t",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  // ---- lore users (deviceKey = SID for cookie resolution) --------------------
  const [uA] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `ovlp-a-${run}`, spotifyConnectionId: SID_A, deviceKey: SID_A })
    .returning({ id: loreUsersTable.id });
  userAId = uA!.id;

  const [uB] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `ovlp-b-${run}`, spotifyConnectionId: SID_B, deviceKey: SID_B })
    .returning({ id: loreUsersTable.id });
  userBId = uB!.id;

  const [uE] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `ovlp-empty-${run}`, spotifyConnectionId: SID_EMPTY, deviceKey: SID_EMPTY })
    .returning({ id: loreUsersTable.id });
  userEmptyId = uE!.id;

  // ---- recordings -------------------------------------------------------------
  await db.insert(recordingsTable).values([
    { mbid: MBID_SHARED,       title: "Shared Track",        artist: `Artist ${run}` },
    { mbid: MBID_STATION_ONLY, title: "Station Only Track",  artist: `Artist ${run}` },
    { mbid: MBID_PICKER_ONLY,  title: "Picker Only Track",   artist: `Artist ${run}` },
    { mbid: MBID_B_ONLY,       title: "B Only Track",        artist: `Artist ${run}` },
  ]);

  // ---- station + spins --------------------------------------------------------
  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG,
      name: `Test Ovlp Station ${run}`,
      streamUrl: "http://example.invalid/ovlp",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  const now = new Date();
  await db.insert(spinsTable).values([
    { stationId: stationId!, mbid: MBID_SHARED,       confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: now },
    { stationId: stationId!, mbid: MBID_STATION_ONLY, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 1000) },
  ]);

  // ---- picker + picks ---------------------------------------------------------
  const [picker] = await db
    .insert(pickersTable)
    .values({
      handle: PICKER_HANDLE,
      name: `Test Ovlp Picker ${run}`,
      pickerType: "blog",
      trustTier: 1,
      active: true,
    })
    .returning({ id: pickersTable.id });
  pickerId = picker!.id;

  await db.insert(picksTable).values([
    { pickerId: pickerId!, mbid: MBID_SHARED,      source: "test", rawTitle: "Shared Track",       rawArtist: `Artist ${run}` },
    { pickerId: pickerId!, mbid: MBID_PICKER_ONLY, source: "test", rawTitle: "Picker Only Track",  rawArtist: `Artist ${run}` },
  ]);

  // ---- library items ----------------------------------------------------------
  // User A has MBID_SHARED + MBID_STATION_ONLY + MBID_PICKER_ONLY in their library.
  // User B has only MBID_B_ONLY (which has no spins or picks → no overlaps).
  // User EMPTY has nothing.
  await db.insert(libraryItemsTable).values([
    { userId: userAId!, mbid: MBID_SHARED,       provenance: { kind: "keep" }, addedAt: new Date() },
    { userId: userAId!, mbid: MBID_STATION_ONLY, provenance: { kind: "keep" }, addedAt: new Date() },
    { userId: userAId!, mbid: MBID_PICKER_ONLY,  provenance: { kind: "keep" }, addedAt: new Date() },
    { userId: userBId!, mbid: MBID_B_ONLY,       provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // ---- server -----------------------------------------------------------------
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) {
    // closeAllConnections() destroys keep-alive sockets. We race server.close()
    // against a 5-second fallback so afterAll never blocks on internal app
    // timers or SSE connections that outlive the test suite.
    (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    await Promise.race([
      new Promise<void>((r) => server!.close(() => r())),
      new Promise<void>((r) => setTimeout(r, 5000)),
    ]);
  }
  if (!dbAvailable) return;

  // Clean up in FK order.
  for (const userId of [userAId, userBId, userEmptyId]) {
    if (userId != null) {
      await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    }
  }
  if (pickerId != null) {
    await db.delete(picksTable).where(eq(picksTable.pickerId, pickerId));
    await db.delete(pickersTable).where(eq(pickersTable.id, pickerId));
  }
  if (stationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
  for (const mbid of [MBID_SHARED, MBID_STATION_ONLY, MBID_PICKER_ONLY, MBID_B_ONLY]) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }
  for (const userId of [userAId, userBId, userEmptyId]) {
    if (userId != null) await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  for (const sid of [SID_A, SID_B, SID_EMPTY]) {
    await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, sid));
  }
});

// -------------------------------------------------------------------------------
// Absent session — auto-provisioned anonymous user has an empty library
// -------------------------------------------------------------------------------

describe("absent session (no lore_sid cookie)", () => {
  it("GET /api/me/overlaps/pickers returns empty items, not foreign data", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/pickers");
    expect(status).toBe(200);
    expect(body).toHaveProperty("items");
    // The newly provisioned anonymous user has an empty library — no overlaps.
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
  });

  it("GET /api/me/overlaps/stations returns empty items, not foreign data", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/stations");
    expect(status).toBe(200);
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
  });

  it("GET /api/me/overlaps/runs returns empty items, not foreign data", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/runs");
    expect(status).toBe(200);
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------
// Empty library — authenticated user with no library items
// -------------------------------------------------------------------------------

describe("authenticated session with empty library", () => {
  it("GET /api/me/overlaps/pickers returns empty items", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/pickers", SID_EMPTY);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
  });

  it("GET /api/me/overlaps/stations returns empty items", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/stations", SID_EMPTY);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
  });

  it("GET /api/me/overlaps/runs returns empty items", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/runs", SID_EMPTY);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------
// Session isolation — User A's library produces overlaps; User B's does not
// -------------------------------------------------------------------------------

describe("session isolation between two listeners", () => {
  it("User A sees their own picker overlaps", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/pickers", SID_A);
    expect(status).toBe(200);
    const handles = body.items.map((i: { picker: { handle: string } }) => i.picker.handle);
    // MBID_SHARED and MBID_PICKER_ONLY are in User A's library and in the test picker.
    expect(handles).toContain(PICKER_HANDLE);
    const row = body.items.find(
      (i: { picker: { handle: string }; sharedCount: number }) => i.picker.handle === PICKER_HANDLE,
    );
    expect(row.sharedCount).toBeGreaterThanOrEqual(2);
  });

  it("User B sees no picker overlaps (their library has no picks)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/pickers", SID_B);
    expect(status).toBe(200);
    const handles = body.items.map((i: { picker: { handle: string } }) => i.picker.handle);
    // MBID_B_ONLY is not in any picker's picks list.
    expect(handles).not.toContain(PICKER_HANDLE);
  });

  it("User A sees their own station overlaps", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/stations", SID_A);
    expect(status).toBe(200);
    const slugs = body.items.map((i: { station: { slug: string } }) => i.station.slug);
    expect(slugs).toContain(STATION_SLUG);
    const row = body.items.find(
      (i: { station: { slug: string }; sharedCount: number }) => i.station.slug === STATION_SLUG,
    );
    expect(row.sharedCount).toBeGreaterThanOrEqual(2);
  });

  it("User B sees no station overlaps (their library has no spins)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/stations", SID_B);
    expect(status).toBe(200);
    const slugs = body.items.map((i: { station: { slug: string } }) => i.station.slug);
    // MBID_B_ONLY has no spins, so User B has no station overlap.
    expect(slugs).not.toContain(STATION_SLUG);
  });

  it("User A sees their own run overlaps", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/runs", SID_A);
    expect(status).toBe(200);
    const slugs = body.items.map((i: { station: { slug: string } }) => i.station.slug);
    expect(slugs).toContain(STATION_SLUG);
    const row = body.items.find(
      (i: { station: { slug: string }; owned: number }) => i.station.slug === STATION_SLUG,
    );
    expect(row.owned).toBeGreaterThanOrEqual(2);
  });

  it("User B sees no run overlaps", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/runs", SID_B);
    expect(status).toBe(200);
    const slugs = body.items.map((i: { station: { slug: string } }) => i.station.slug);
    expect(slugs).not.toContain(STATION_SLUG);
  });
});

// -------------------------------------------------------------------------------
// ?day= parameter — day-scoped filtering
// -------------------------------------------------------------------------------

describe("?day= query parameter on /me/overlaps/runs", () => {
  it("omitting ?day= returns all-time runs (existing behaviour unchanged)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/runs", SID_A);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    // User A has spins seeded today — at least one run should be returned.
    const slugs = body.items.map((i: { station: { slug: string } }) => i.station.slug);
    expect(slugs).toContain(STATION_SLUG);
  });

  it("?day= matching today returns runs whose day field equals today's UTC date", async () => {
    if (!dbAvailable) return;
    // Build today's date in YYYY-MM-DD UTC format — must match spinDayExpr.
    const now = new Date();
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

    const { status, body } = await get(`/api/me/overlaps/runs?day=${today}`, SID_A);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);

    // Every returned item must have day === today.
    for (const item of body.items as Array<{ day: string }>) {
      expect(item.day).toBe(today);
    }

    // The test station's spins were inserted with `new Date()` (today), so it
    // should appear.
    const slugs = body.items.map((i: { station: { slug: string } }) => i.station.slug);
    expect(slugs).toContain(STATION_SLUG);
  });

  it("?day= for a past date with no matching spins returns empty items", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/runs?day=2000-01-01", SID_A);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
  });

  it("?day= with an invalid format is ignored and returns all-time results", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/overlaps/runs?day=not-a-date", SID_A);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    // Invalid day is silently dropped — falls back to all-time, which includes
    // at least the runs seeded for User A.
    const slugs = body.items.map((i: { station: { slug: string } }) => i.station.slug);
    expect(slugs).toContain(STATION_SLUG);
  });
});
