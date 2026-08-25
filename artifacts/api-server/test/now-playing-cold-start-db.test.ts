import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  stationsTable,
  loreUsersTable,
  recordingsTable,
  spinsTable,
  stationQualityTable,
} from "@workspace/db";
import app from "../src/app.js";
import {
  _testOnly_setNpColdFillWaitMs,
  _testOnly_resetNpCaches,
  _testOnly_expireNpBaseCache,
  _testOnly_getNpBuildCount,
  prewarmNowPlayingBaseCache,
  invalidateNowPlayingBaseCache,
} from "../src/routes/lore/stations.js";
import { _testOnly_clearLibraryHitCache } from "../src/lore/library-hits.js";

/**
 * Cold-start behavior of GET /api/stations/now-playing (task: dial must not
 * sit on "Loading stations…" for ~10s after a server restart).
 *
 * Covered:
 *   1. Cold cache + slow fill (deadline forced to 0 so the timeout always
 *      wins): a timely stations-only partial (every nowPlaying null).
 *   2. Concurrent cold requests: single-flight — the heavy base fill runs
 *      exactly once for the whole burst.
 *   3. Eventual consistency: a later poll serves the full payload with the
 *      seeded spin, i.e. the background fill landed in the cache.
 *   4. Prewarm joining: prewarmNowPlayingBaseCache() shares the same
 *      single-flight fill (no extra build) and warms the cache for requests.
 *   5. Stale-while-revalidate: an expired (but present) base cache is served
 *      immediately instead of the partial path.
 */
const run = randomUUID().slice(0, 8);
const SLUG = `test-cold-${run}`;
const MBID = `test-cold-mbid-${run}`;
const DEVICE_KEY = `00000000-0000-4000-8000-${run.padStart(12, "0")}`;
const MIN = 60 * 1000;

let dbAvailable = false;
let stationId: number | undefined;
let userId: number | undefined;
let server: Server | undefined;
let baseUrl = "";

type NowPlayingItem = { slug: string; nowPlaying: unknown | null };
type ListNowPlayingResponse = { items: NowPlayingItem[] };

const BLOCKED_SESSION_COOKIE = "lore_sid=00000000-0000-0000-0000-000000000000";

async function getNowPlaying(
  query = "",
  init?: RequestInit,
): Promise<ListNowPlayingResponse> {
  const res = await fetch(`${baseUrl}/api/stations/now-playing${query}`, init);
  expect(res.status).toBe(200);
  return (await res.json()) as ListNowPlayingResponse;
}

/** Poll until the seeded station has a non-null nowPlaying (full payload). */
async function pollUntilFull(timeoutMs = 120_000): Promise<ListNowPlayingResponse> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await getNowPlaying();
    const mine = body.items.find((i) => i.slug === SLUG);
    if (mine?.nowPlaying) return body;
    if (Date.now() > deadline) throw new Error("full now-playing payload never arrived");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [s] = await db
    .insert(stationsTable)
    .values({ slug: SLUG, name: `Test Cold ${run}`, streamUrl: "http://example.invalid/cold", stationClass: "community" })
    .returning({ id: stationsTable.id });
  stationId = s!.id;
  const [user] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: DEVICE_KEY })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBID, title: "Cold Track", artist: `Test Cold Artist ${run}` },
  ]);
  // A couple of minutes in the future so it outranks concurrent live ingest.
  await db.insert(spinsTable).values({
    stationId,
    mbid: MBID,
    confidence: "text" as const,
    rawArtist: "Cold Artist",
    rawTitle: "Cold Track",
    playedAt: new Date(Date.now() + 2 * MIN),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
}, 90_000);

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  if (stationId) {
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, [stationId]));
    await db.delete(stationQualityTable).where(inArray(stationQualityTable.stationId, [stationId]));
    await db.delete(stationsTable).where(inArray(stationsTable.id, [stationId]));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
  if (userId) await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
}, 90_000);

describe("GET /api/stations/now-playing — cold start", () => {
  it("continues serving the Feed while the general background pool is exhausted", async () => {
    if (!dbAvailable) return;
    _testOnly_resetNpCaches();
    // Prime the inexpensive station directory snapshot before simulating a
    // saturated general pool. The assertion below isolates the listener
    // now-playing read model rather than coupling this regression to a fresh
    // directory cache eviction.
    await getNowPlaying();
    invalidateNowPlayingBaseCache();
    const clients = await Promise.all(
      Array.from({ length: pool.options.max ?? 10 }, () => pool.connect()),
    );
    try {
      const started = Date.now();
      const initial = await getNowPlaying("", {
        headers: { cookie: BLOCKED_SESSION_COOKIE },
      });
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(initial.items.find((i) => i.slug === SLUG)).toBeTruthy();

      const full = await pollUntilFull(8_000);
      expect(full.items.find((i) => i.slug === SLUG)?.nowPlaying).toBeTruthy();
    } finally {
      for (const client of clients) client.release();
    }
  }, 30_000);

  it("uses the indexed listener path for a dated dial snapshot under background saturation", async () => {
    if (!dbAvailable) return;
    _testOnly_resetNpCaches();
    // Reuse a warm directory snapshot while making the per-date live cache
    // cold; this exercises the date range in the lateral station/time lookup.
    await getNowPlaying();
    const clients = await Promise.all(
      Array.from({ length: pool.options.max ?? 10 }, () => pool.connect()),
    );
    try {
      const date = new Date(Date.now() + 2 * MIN).toISOString().slice(0, 10);
      const started = Date.now();
      const body = await getNowPlaying(`?date=${date}`, {
        headers: { cookie: BLOCKED_SESSION_COOKIE },
      });
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(body.items.find((item) => item.slug === SLUG)).toBeTruthy();
    } finally {
      for (const client of clients) client.release();
    }
  }, 30_000);

  it("falls back to public hit flags when a signed listener's cold context is queued", async () => {
    if (!dbAvailable || !userId) return;
    _testOnly_clearLibraryHitCache(userId);
    // Leave one general connection for the identity lookup, then make the
    // five-query cold hit-context batch queue behind it. The live Feed must
    // not wait for that optional personalization.
    const clients = await Promise.all(
      Array.from({ length: Math.max((pool.options.max ?? 10) - 1, 1) }, () => pool.connect()),
    );
    try {
      const started = Date.now();
      const body = await getNowPlaying("", {
        headers: { cookie: `lore_sid=${DEVICE_KEY}` },
      });
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(body.items.find((item) => item.slug === SLUG)).toBeTruthy();
    } finally {
      for (const client of clients) client.release();
    }
  }, 30_000);

  it("serves a timely stations-only partial when the cold fill outlives the deadline, then the full payload on a later poll", async () => {
    if (!dbAvailable) return;
    // Deadline 0: even a fast fill loses the race (queries cannot resolve
    // within the same tick), so the partial path is deterministic.
    const restore = _testOnly_setNpColdFillWaitMs(0);
    try {
      _testOnly_resetNpCaches();

      const started = Date.now();
      const body = await getNowPlaying();
      const elapsed = Date.now() - started;

      // Station list is present, nothing has nowPlaying yet.
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.find((i) => i.slug === SLUG)).toBeTruthy();
      expect(body.items.every((i) => i.nowPlaying === null)).toBe(true);
      // Must be far faster than the multi-second cold fill.  Production wait is
      // 1.5 s; 30 s is generous enough to absorb heavy Postgres load from the
      // running dev-server pollers without producing false failures.
      expect(elapsed).toBeLessThan(30_000);

      // The fill kicked off in the background lands in the cache: a later
      // poll returns the seeded spin.
      const full = await pollUntilFull();
      expect(full.items.find((i) => i.slug === SLUG)?.nowPlaying).toBeTruthy();
    } finally {
      restore();
    }
  }, 180_000);

  it("runs the heavy base fill exactly once for a burst of concurrent cold requests", async () => {
    if (!dbAvailable) return;
    const restore = _testOnly_setNpColdFillWaitMs(0);
    try {
      _testOnly_resetNpCaches();
      const before = _testOnly_getNpBuildCount();
      const bodies = await Promise.all(Array.from({ length: 5 }, () => getNowPlaying()));
      for (const body of bodies) {
        expect(body.items.length).toBeGreaterThan(0);
      }
      // Wait for the shared fill to settle so its build is counted.
      await pollUntilFull();
      expect(_testOnly_getNpBuildCount() - before).toBe(1);
    } finally {
      restore();
    }
  }, 180_000);

  it("prewarm joins the same single-flight fill and warms the cache for requests", async () => {
    if (!dbAvailable) return;
    _testOnly_resetNpCaches();
    const before = _testOnly_getNpBuildCount();
    prewarmNowPlayingBaseCache();
    prewarmNowPlayingBaseCache(); // duplicate prewarm must not double the work
    // A request issued while the prewarm fill is in flight joins it too
    // (generous wait so it rides the fill to completion instead of a partial).
    const restore = _testOnly_setNpColdFillWaitMs(120_000);
    try {
      const body = await getNowPlaying();
      expect(body.items.find((i) => i.slug === SLUG)?.nowPlaying).toBeTruthy();
      expect(_testOnly_getNpBuildCount() - before).toBe(1);
    } finally {
      restore();
    }
  }, 180_000);

  it("serves an expired base cache stale-while-revalidate instead of the partial path", async () => {
    if (!dbAvailable) return;
    // Ensure a populated cache, then expire it.
    const restore = _testOnly_setNpColdFillWaitMs(120_000);
    try {
      await pollUntilFull();
      _testOnly_expireNpBaseCache();
      const started = Date.now();
      const body = await getNowPlaying();
      const elapsed = Date.now() - started;
      // Stale data is served immediately — the seeded spin is still there,
      // not the nulled-out partial.
      expect(body.items.find((i) => i.slug === SLUG)?.nowPlaying).toBeTruthy();
      expect(elapsed).toBeLessThan(10_000);
    } finally {
      restore();
    }
  }, 180_000);
});
