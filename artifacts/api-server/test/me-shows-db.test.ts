// @vitest-environment node
/**
 * Integration tests for GET /api/me/shows — the Dial's Shows lens — and the
 * Bandsintown fetcher's cache / negative-cache behavior.
 *
 * Covered:
 *   1. Empty taste — hasTaste:false, settled (computing:false), no events.
 *   2. Taste-source coverage — events surface for taste-seed artists AND
 *      unresolved soft Spotify artists (same taste set as crossings).
 *   3. Ordering — soonest-first; past events never returned.
 *   4. Near/elsewhere split — ?city= flags matching events nearCity:true and
 *      sorts them first; no city → flat soonest-first with nearCity:false.
 *   5. Bandsintown attribution header on responses containing events.
 *   6. Fetcher: positive cache (6 h TTL) — a fresh artist is not re-fetched.
 *   7. Fetcher: negative cache — an artist with zero events (or a 404) is
 *      cached and not re-fetched within the negative TTL.
 *   8. Fetcher: transient HTTP errors are NOT cached (retry-safe).
 *
 * All seeds use a run-isolated prefix; cleanup in FK order; tests skip
 * silently when no DB is reachable.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  tasteSeedsTable,
  spotifyLibraryItemsTable,
  artistEventsTable,
  artistEventsCacheTable,
} from "@workspace/db";
import app from "../src/app.js";
import {
  normalizeArtistKey,
  fetchAndStoreEvents,
  getStoredEvents,
} from "../src/lore/bandsintown-fetcher.js";

const run = randomUUID().slice(0, 8);

// ── Session ids ───────────────────────────────────────────────────────────────
const SID_FULL  = `test-shows-full-${run}`;  // seed + soft Spotify artist
const SID_EMPTY = `test-shows-empty-${run}`; // no taste at all

// ── Fixtures ──────────────────────────────────────────────────────────────────
const SEED_ARTIST = `Shows Seed Artist ${run}`;
const SOFT_ARTIST = `Shows Soft Artist ${run}`;
const SEED_KEY = normalizeArtistKey(SEED_ARTIST);
const SOFT_KEY = normalizeArtistKey(SOFT_ARTIST);

// Fetcher-test artists — never part of any user's taste
const FETCH_POS_ARTIST = `Fetch Pos Artist ${run}`;
const FETCH_NEG_ARTIST = `Fetch Neg Artist ${run}`;
const FETCH_404_ARTIST = `Fetch NotFound Artist ${run}`;
const FETCH_ERR_ARTIST = `Fetch Err Artist ${run}`;
const FETCH_KEYS = [
  normalizeArtistKey(FETCH_POS_ARTIST),
  normalizeArtistKey(FETCH_NEG_ARTIST),
  normalizeArtistKey(FETCH_404_ARTIST),
  normalizeArtistKey(FETCH_ERR_ARTIST),
];

const DAY = 24 * 60 * 60 * 1000;
/** Future timestamps relative to the real clock — the route filters on now(). */
const IN_3_DAYS  = new Date(Date.now() + 3 * DAY);
const IN_10_DAYS = new Date(Date.now() + 10 * DAY);
const IN_20_DAYS = new Date(Date.now() + 20 * DAY);
const YESTERDAY  = new Date(Date.now() - 1 * DAY);

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

let server: Server;
let baseUrl: string;
let dbAvailable = false;
let userFullId: number | null = null;

const realFetch = globalThis.fetch;

async function get(path: string, sid?: string) {
  const headers: Record<string, string> = {};
  if (sid) headers["cookie"] = `lore_sid=${sid}`;
  const res = await realFetch(`${baseUrl}${path}`, { headers });
  return {
    status: res.status,
    body: await res.json(),
    headers: res.headers,
  };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  for (const sid of [SID_FULL, SID_EMPTY]) {
    await db.insert(spotifyConnectionsTable).values({
      sid, accessToken: "t", refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }
  const [uFull] = await db.insert(loreUsersTable)
    .values({ spotifyUserId: `shows-full-${run}`, spotifyConnectionId: SID_FULL, deviceKey: SID_FULL })
    .returning({ id: loreUsersTable.id });
  userFullId = uFull!.id;
  await db.insert(loreUsersTable)
    .values({ spotifyUserId: `shows-empty-${run}`, spotifyConnectionId: SID_EMPTY, deviceKey: SID_EMPTY });

  // Full user's taste: a taste seed + an unresolved soft Spotify artist
  await db.insert(tasteSeedsTable).values({ userId: userFullId!, artistName: SEED_ARTIST });
  await db.insert(spotifyLibraryItemsTable).values({
    userId: userFullId!, spotifyId: `sp-shows-${run}`, title: "Soft Track", artist: SOFT_ARTIST,
  });

  // Stored events (as if a background fetch already ran):
  //  - seed artist: near-city event in 10 days (Portland, OR) + elsewhere
  //    event in 3 days (New York) + a past event that must never surface
  //  - soft artist: elsewhere event in 20 days (London)
  await db.insert(artistEventsTable).values([
    {
      artistKey: SEED_KEY, eventId: `ev-near-${run}`,
      eventDatetime: IN_10_DAYS, eventDate: dateStr(IN_10_DAYS),
      venueName: "Crystal Ballroom", venueCity: "Portland", venueRegion: "OR",
      venueCountry: "US", ticketUrl: `https://tickets.example/${run}/near`,
    },
    {
      artistKey: SEED_KEY, eventId: `ev-soon-${run}`,
      eventDatetime: IN_3_DAYS, eventDate: dateStr(IN_3_DAYS),
      venueName: "Bowery Ballroom", venueCity: "New York", venueRegion: "NY",
      venueCountry: "US", ticketUrl: `https://tickets.example/${run}/soon`,
    },
    {
      artistKey: SEED_KEY, eventId: `ev-past-${run}`,
      eventDatetime: YESTERDAY, eventDate: dateStr(YESTERDAY),
      venueName: "Gone Venue", venueCity: "Portland", venueRegion: "OR",
      venueCountry: "US", ticketUrl: null,
    },
    {
      artistKey: SOFT_KEY, eventId: `ev-soft-${run}`,
      eventDatetime: IN_20_DAYS, eventDate: dateStr(IN_20_DAYS),
      venueName: "Roundhouse", venueCity: "London", venueRegion: null,
      venueCountry: "UK", ticketUrl: `https://tickets.example/${run}/soft`,
    },
  ]);
  // Fresh cache rows so the route treats both artists as settled
  await db.insert(artistEventsCacheTable).values([
    { artistKey: SEED_KEY, fetchedAt: new Date(), eventCount: 3 },
    { artistKey: SOFT_KEY, fetchedAt: new Date(), eventCount: 1 },
  ]);

  server = app.listen(0);
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 120_000);

afterAll(async () => {
  if (!dbAvailable) return;
  server?.close();
  const allKeys = [SEED_KEY, SOFT_KEY, ...FETCH_KEYS];
  await db.delete(artistEventsTable).where(inArray(artistEventsTable.artistKey, allKeys));
  await db.delete(artistEventsCacheTable).where(inArray(artistEventsCacheTable.artistKey, allKeys));
  if (userFullId != null) {
    await db.delete(tasteSeedsTable).where(eq(tasteSeedsTable.userId, userFullId));
    await db.delete(spotifyLibraryItemsTable).where(eq(spotifyLibraryItemsTable.userId, userFullId));
  }
  await db.delete(loreUsersTable).where(inArray(loreUsersTable.deviceKey, [SID_FULL, SID_EMPTY]));
  await db.delete(spotifyConnectionsTable).where(inArray(spotifyConnectionsTable.sid, [SID_FULL, SID_EMPTY]));
}, 120_000);

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env["BANDSINTOWN_APP_ID"];
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Read model — GET /api/me/shows
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/me/shows", () => {
  it("returns hasTaste:false settled for a listener with no taste", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/shows", SID_EMPTY);
    expect(status).toBe(200);
    expect(body.hasTaste).toBe(false);
    expect(body.computing).toBe(false);
    expect(body.events).toEqual([]);
  }, 120_000);

  it("covers seed AND soft-Spotify taste artists, soonest-first, no past events", async () => {
    if (!dbAvailable) return;
    const { status, body, headers } = await get("/api/me/shows", SID_FULL);
    expect(status).toBe(200);
    expect(body.hasTaste).toBe(true);
    // No BANDSINTOWN_APP_ID in the test env → settled immediately
    expect(body.computing).toBe(false);

    const ids = body.events.map((e: { id: string }) => e.id);
    expect(ids).toEqual([
      `${SEED_KEY}:ev-soon-${run}`,   // in 3 days
      `${SEED_KEY}:ev-near-${run}`,   // in 10 days
      `${SOFT_KEY}:ev-soft-${run}`,   // in 20 days (soft Spotify artist)
    ]);
    // The past event never surfaces
    expect(ids).not.toContain(`${SEED_KEY}:ev-past-${run}`);

    // Display names round-trip from taste, not the normalized key
    const artists = body.events.map((e: { artistName: string }) => e.artistName);
    expect(artists).toContain(SEED_ARTIST);
    expect(artists).toContain(SOFT_ARTIST);

    // No city → nothing flagged near
    expect(body.events.every((e: { nearCity: boolean }) => e.nearCity === false)).toBe(true);

    // Bandsintown attribution header present when events are returned
    expect(headers.get("x-bandsintown-powered")).toBe("true");
  }, 120_000);

  it("splits near/elsewhere on ?city= and sorts near-city first", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get(
      `/api/me/shows?city=${encodeURIComponent("Portland, OR")}`,
      SID_FULL,
    );
    expect(status).toBe(200);

    const ids = body.events.map((e: { id: string }) => e.id);
    // Portland event first (near), then the rest soonest-first
    expect(ids).toEqual([
      `${SEED_KEY}:ev-near-${run}`,
      `${SEED_KEY}:ev-soon-${run}`,
      `${SOFT_KEY}:ev-soft-${run}`,
    ]);
    const near = body.events.find((e: { id: string }) => e.id === `${SEED_KEY}:ev-near-${run}`);
    const far  = body.events.find((e: { id: string }) => e.id === `${SEED_KEY}:ev-soon-${run}`);
    expect(near.nearCity).toBe(true);
    expect(far.nearCity).toBe(false);
    expect(near.ticketUrl).toBe(`https://tickets.example/${run}/near`);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch lifecycle — computing stays true until the whole background batch lands
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/me/shows — background batch lifecycle", () => {
  const SID_SLOW = `test-shows-slow-${run}`;
  const SLOW_ARTISTS = [1, 2, 3].map((i) => `Slow Batch Artist ${i} ${run}`);
  const SLOW_KEYS = SLOW_ARTISTS.map(normalizeArtistKey);
  let slowUserId: number | null = null;

  afterAll(async () => {
    if (!dbAvailable) return;
    await db.delete(artistEventsTable).where(inArray(artistEventsTable.artistKey, SLOW_KEYS));
    await db.delete(artistEventsCacheTable).where(inArray(artistEventsCacheTable.artistKey, SLOW_KEYS));
    if (slowUserId != null) {
      await db.delete(tasteSeedsTable).where(eq(tasteSeedsTable.userId, slowUserId));
    }
    await db.delete(loreUsersTable).where(eq(loreUsersTable.deviceKey, SID_SLOW));
    await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID_SLOW));
  }, 120_000);

  it("keeps computing:true across polls while slow fetches are in flight, then settles", async () => {
    if (!dbAvailable) return;

    // A dedicated user whose taste artists have NO cache rows → all stale
    await db.insert(spotifyConnectionsTable).values({
      sid: SID_SLOW, accessToken: "t", refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const [u] = await db.insert(loreUsersTable)
      .values({ spotifyUserId: `shows-slow-${run}`, spotifyConnectionId: SID_SLOW, deviceKey: SID_SLOW })
      .returning({ id: loreUsersTable.id });
    slowUserId = u!.id;
    await db.insert(tasteSeedsTable).values(
      SLOW_ARTISTS.map((artistName) => ({ userId: slowUserId!, artistName })),
    );

    process.env["BANDSINTOWN_APP_ID"] = "test-app-id";
    // Deterministic gate: upstream lookups hang until the test releases them,
    // so the batch CANNOT complete early no matter how slow the test host is.
    let releaseUpstream!: () => void;
    const upstreamGate = new Promise<void>((r) => { releaseUpstream = r; });
    mockBandsintown(async () => {
      await upstreamGate;
      return new Response("[]", { status: 200 });
    });

    // 1. Triggering request — batch just enqueued → computing:true
    const first = await get("/api/me/shows", SID_SLOW);
    expect(first.status).toBe(200);
    expect(first.body.hasTaste).toBe(true);
    expect(first.body.computing).toBe(true);

    // 2. A poll during the batch (within the 15-min cooldown) must STILL
    //    report computing:true — this is what keeps the client polling.
    //    The gate guarantees the batch is genuinely still in flight here.
    const during = await get("/api/me/shows", SID_SLOW);
    expect(during.body.computing).toBe(true);

    // 3. Release the upstream and poll until the batch settles → computing:false.
    releaseUpstream();
    let settled = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const poll = await get("/api/me/shows", SID_SLOW);
      if (poll.body.computing === false) { settled = true; break; }
    }
    expect(settled).toBe(true);

    // Every artist in the batch was actually checked (negative-cached)
    const cacheRows = await db
      .select()
      .from(artistEventsCacheTable)
      .where(inArray(artistEventsCacheTable.artistKey, SLOW_KEYS));
    expect(cacheRows).toHaveLength(SLOW_ARTISTS.length);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fetcher — cache / negative-cache / error behavior (mocked upstream)
// ─────────────────────────────────────────────────────────────────────────────

function mockBandsintown(handler: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("rest.bandsintown.com")) return handler(url);
    return realFetch(input, init);
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe("bandsintown fetcher caching", () => {
  it("is a no-op without BANDSINTOWN_APP_ID (graceful degradation)", async () => {
    if (!dbAvailable) return;
    const spy = mockBandsintown(() => new Response("[]", { status: 200 }));
    await fetchAndStoreEvents(FETCH_POS_ARTIST);
    expect(spy).not.toHaveBeenCalled();
  }, 120_000);

  it("stores events and does not re-fetch a fresh artist (positive cache)", async () => {
    if (!dbAvailable) return;
    process.env["BANDSINTOWN_APP_ID"] = "test-app-id";
    const future = new Date(Date.now() + 5 * DAY).toISOString();
    const payload = JSON.stringify([
      {
        id: `bit-${run}-1`,
        datetime: future,
        venue: { name: "Test Hall", city: "Seattle", region: "WA", country: "US" },
        url: `https://bandsintown.example/${run}/e1`,
      },
    ]);
    const spy = mockBandsintown(() => new Response(payload, { status: 200 }));

    await fetchAndStoreEvents(FETCH_POS_ARTIST);
    const upstreamCalls = () =>
      spy.mock.calls.filter((c) => String(c[0]).includes("rest.bandsintown.com")).length;
    expect(upstreamCalls()).toBe(1);

    const stored = await getStoredEvents([normalizeArtistKey(FETCH_POS_ARTIST)]);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.venueCity).toBe("Seattle");
    expect(stored[0]!.ticketUrl).toBe(`https://bandsintown.example/${run}/e1`);

    // Second call within the positive TTL → served from cache, no upstream hit
    await fetchAndStoreEvents(FETCH_POS_ARTIST);
    expect(upstreamCalls()).toBe(1);
  }, 120_000);

  it("negative-caches an artist with zero upcoming events", async () => {
    if (!dbAvailable) return;
    process.env["BANDSINTOWN_APP_ID"] = "test-app-id";
    const spy = mockBandsintown(() => new Response("[]", { status: 200 }));

    await fetchAndStoreEvents(FETCH_NEG_ARTIST);
    const upstreamCalls = () =>
      spy.mock.calls.filter((c) => String(c[0]).includes("rest.bandsintown.com")).length;
    expect(upstreamCalls()).toBe(1);

    const key = normalizeArtistKey(FETCH_NEG_ARTIST);
    const cache = await db
      .select()
      .from(artistEventsCacheTable)
      .where(eq(artistEventsCacheTable.artistKey, key));
    expect(cache).toHaveLength(1);
    expect(cache[0]!.eventCount).toBe(0);

    // Within the negative TTL the artist costs a cached negative, not a lookup
    await fetchAndStoreEvents(FETCH_NEG_ARTIST);
    expect(upstreamCalls()).toBe(1);
  }, 120_000);

  it("treats a 404 (artist unknown) as a cached negative", async () => {
    if (!dbAvailable) return;
    process.env["BANDSINTOWN_APP_ID"] = "test-app-id";
    const spy = mockBandsintown(() => new Response("not found", { status: 404 }));

    await fetchAndStoreEvents(FETCH_404_ARTIST);
    const upstreamCalls = () =>
      spy.mock.calls.filter((c) => String(c[0]).includes("rest.bandsintown.com")).length;
    expect(upstreamCalls()).toBe(1);

    const key = normalizeArtistKey(FETCH_404_ARTIST);
    const cache = await db
      .select()
      .from(artistEventsCacheTable)
      .where(eq(artistEventsCacheTable.artistKey, key));
    expect(cache).toHaveLength(1);
    expect(cache[0]!.eventCount).toBe(0);

    await fetchAndStoreEvents(FETCH_404_ARTIST);
    expect(upstreamCalls()).toBe(1);
  }, 120_000);

  it("does NOT cache transient HTTP errors (retry-safe)", async () => {
    if (!dbAvailable) return;
    process.env["BANDSINTOWN_APP_ID"] = "test-app-id";
    const spy = mockBandsintown(() => new Response("boom", { status: 503 }));

    await fetchAndStoreEvents(FETCH_ERR_ARTIST);
    const key = normalizeArtistKey(FETCH_ERR_ARTIST);
    const cache = await db
      .select()
      .from(artistEventsCacheTable)
      .where(eq(artistEventsCacheTable.artistKey, key));
    expect(cache).toHaveLength(0); // nothing cached — next call retries

    const upstreamCalls = () =>
      spy.mock.calls.filter((c) => String(c[0]).includes("rest.bandsintown.com")).length;
    expect(upstreamCalls()).toBe(1);
    await fetchAndStoreEvents(FETCH_ERR_ARTIST);
    expect(upstreamCalls()).toBe(2); // retried — the error was not cached
  }, 120_000);
});
