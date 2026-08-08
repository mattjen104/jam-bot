// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  crossingsCacheTable,
  stationQualityTable,
  stationsTable,
  spinsTable,
  recordingsTable,
  type CrossingsRow,
} from "@workspace/db";
import app from "../src/app.js";
import { invalidateNowPlayingBaseCache } from "../src/routes/lore/stations.js";
import { _testOnly_clearCrossingsCache } from "../src/routes/me/crossings.js";

/**
 * Timing tests for the two caching paths that keep the dial fast after a
 * server restart (Task 1626).
 *
 * ── now-playing cache hit ──────────────────────────────────────────────────
 * /api/stations/now-playing runs three DB queries on a cold in-process cache
 * (selectDistinctOn over the full spins table + two batch sub-queries).  On a
 * production-scale dataset this first fill can take several seconds.  Task 1626
 * added a 30-second in-process cache (npBaseCache) so every subsequent request
 * within that window is served from an in-memory Map in essentially zero time.
 *
 * These tests confirm the CACHE HIT path — the path that every user after the
 * first post-restart request actually sees — is consistently under 2 s.  We do
 * not assert a wall-clock limit on the cold fill itself because its duration is
 * proportional to the DB dataset size and would create a flaky environment-
 * dependent gate.
 *
 * ── crossings SWR (stale L2 row) ──────────────────────────────────────────
 * /api/me/crossings uses a two-layer cache: L1 in-process Map and L2 Postgres.
 * After a server restart, L1 is empty but the L2 row (written before the
 * restart) may still exist.  If the row is stale (builtAt > 30 min ago), the
 * handler serves the stale data immediately and schedules a background
 * recompute — the SWR (stale-while-revalidate) path.
 *
 * These tests confirm that response arrives in < 2 s when L1 is empty and L2
 * holds a stale row, both for an empty crossing list and a sentinel list.
 */

const run = randomUUID().slice(0, 8);

// ── Session identifier used as deviceKey / cookie for the crossings user ─────
const SID = `test-timing-${run}`;

// ── Now-playing fixture ───────────────────────────────────────────────────────
const SLUG_NP = `test-timing-np-${run}`;
const MBID_NP = `test-timing-np-${run}`;

// 30-min TTL (mirrors the implementation constant in crossings.ts).
const CROSSINGS_CACHE_TTL_MS = 30 * 60 * 1000;

// Response latency target for both cache-hit paths.
const MAX_RESPONSE_MS = 2_000;

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let userId: number | null = null;
let stationId: number | null = null;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // ── Crossings fixture ─────────────────────────────────────────────────────
  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "t",
    refreshToken: "r",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [u] = await db
    .insert(loreUsersTable)
    .values({
      spotifyUserId: `timing-user-${run}`,
      spotifyConnectionId: SID,
      deviceKey: SID,
    })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // ── Now-playing fixture ───────────────────────────────────────────────────
  // A single extra station + spin so the test station always appears in the
  // dial response.  The station is active and non-hidden by default.
  const [s] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG_NP,
      name: `Test Timing NP ${run}`,
      streamUrl: "http://example.invalid/timing-np",
      stationClass: "community" as const,
    })
    .returning({ id: stationsTable.id });
  stationId = s!.id;

  await db.insert(recordingsTable).values({
    mbid: MBID_NP,
    title: "Timing Track",
    artist: `Timing Artist ${run}`,
  });

  // Spin placed a couple of minutes in the future so it wins ORDER BY even
  // while real pollers are inserting live data.
  await db.insert(spinsTable).values({
    stationId: stationId,
    mbid: MBID_NP,
    confidence: "text" as const,
    rawArtist: `Timing Artist ${run}`,
    rawTitle: "Timing Track",
    playedAt: new Date(Date.now() + 2 * 60_000),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
}, 90_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  // Crossings fixture — FK order: cache row before user.
  if (userId !== null) {
    await db
      .delete(crossingsCacheTable)
      .where(eq(crossingsCacheTable.userId, userId))
      .catch(() => {});
    await db
      .delete(loreUsersTable)
      .where(eq(loreUsersTable.id, userId))
      .catch(() => {});
  }
  await db
    .delete(spotifyConnectionsTable)
    .where(eq(spotifyConnectionsTable.sid, SID))
    .catch(() => {});

  // Now-playing fixture — FK order: spins → quality → station → recording.
  if (stationId !== null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId)).catch(() => {});
    await db
      .delete(stationQualityTable)
      .where(eq(stationQualityTable.stationId, stationId))
      .catch(() => {});
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId)).catch(() => {});
  }
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_NP)).catch(() => {});
}, 90_000);

// ── now-playing base-cache timing ─────────────────────────────────────────────

describe("GET /api/stations/now-playing — base-cache hit timing", () => {
  /**
   * Warm the in-process base cache with one un-timed request, then assert that
   * a second request (which must be served from the in-process Map) completes
   * in well under 2 s.
   *
   * Why not time the cold fill?  The selectDistinctOn + two batch sub-queries
   * run across the full spins table.  Wall-clock duration scales with dataset
   * size and would produce a flaky gate on a shared dev DB with production-
   * scale data.  What Task 1626 actually guarantees is that the SECOND and
   * subsequent requests within the 30-second TTL window are served instantly
   * from the in-process cache — that is the path tested here.
   */
  it(
    "serves a warm-cache response in < 2 s (npBaseCache hit path)",
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      // Force a cold fill first (no timing assertion — duration is DB-scale
      // dependent).  After this call npBaseCache is populated.
      invalidateNowPlayingBaseCache();
      await fetch(`${baseUrl}/api/stations/now-playing`);

      // Immediately request again — must be served from the in-process cache.
      const t0 = Date.now();
      const res = await fetch(`${baseUrl}/api/stations/now-playing`);
      const elapsed = Date.now() - t0;

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { slug: string }[] };
      expect(Array.isArray(body.items)).toBe(true);

      // Our test station must appear in the cached result.
      expect(body.items.some((i) => i.slug === SLUG_NP)).toBe(true);

      expect(
        elapsed,
        `npBaseCache hit took ${elapsed} ms — must be < ${MAX_RESPONSE_MS} ms`,
      ).toBeLessThan(MAX_RESPONSE_MS);
    },
    90_000,
  );

  it(
    "serves a second warm-cache response in < 2 s (confirms cache TTL is active)",
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      // Cache should still be warm from the previous test (TTL = 30 s).
      // Re-warm just in case test ordering changed.
      const warmRes = await fetch(`${baseUrl}/api/stations/now-playing`);
      expect(warmRes.status).toBe(200);

      // Third request in the same 30-second window — still served from cache.
      const t0 = Date.now();
      const res = await fetch(`${baseUrl}/api/stations/now-playing`);
      const elapsed = Date.now() - t0;

      expect(res.status).toBe(200);
      expect(
        elapsed,
        `Repeated npBaseCache hit took ${elapsed} ms — must be < ${MAX_RESPONSE_MS} ms`,
      ).toBeLessThan(MAX_RESPONSE_MS);
    },
    90_000,
  );

  it(
    "invalidateNowPlayingBaseCache clears the cache so the next fill re-runs the DB queries",
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      // Warm then invalidate.
      await fetch(`${baseUrl}/api/stations/now-playing`);
      invalidateNowPlayingBaseCache();

      // After invalidation the next request should still return 200 (the
      // handler runs the fill again).  We don't assert timing here because
      // this is the slow cold-fill path; we only assert correctness.
      const res = await fetch(`${baseUrl}/api/stations/now-playing`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { slug: string }[] };
      expect(body.items.some((i) => i.slug === SLUG_NP)).toBe(true);
    },
    90_000,
  );
});

// ── crossings SWR (stale L2 row) timing ──────────────────────────────────────

/**
 * Seed a stale Postgres L2 row for the test user while leaving L1 empty.
 *
 * Sequence:
 *   1. _testOnly_clearCrossingsCache — awaitable; drains any in-flight L2 write
 *      then deletes the L2 row and clears L1.
 *   2. Direct INSERT into crossings_cache with built_at = 31 min ago — bypasses
 *      cachePersonalCrossings (which would repopulate L1) so that L1 remains
 *      empty and the handler must read from L2.
 *
 * After this helper returns:
 *   - L1 has no entry for userId   → handler falls through to L2.
 *   - L2 has a row with isStale=true → readL2CacheAny returns { data, isStale: true }.
 *   - Handler takes the SWR branch: returns the stale data immediately and
 *     fires schedulePersonalCrossingsRecompute in the background.
 */
async function seedStaleL2Row(uid: number, data: CrossingsRow[]): Promise<void> {
  // Await both L1 eviction and in-flight L2 write drain before inserting our
  // own stale row, so the insert is not racing with a concurrent writeL2Cache.
  await _testOnly_clearCrossingsCache(uid);

  const staleAt = new Date(Date.now() - CROSSINGS_CACHE_TTL_MS - 60_000); // 31 min ago
  await db
    .insert(crossingsCacheTable)
    .values({ userId: uid, data, builtAt: staleAt })
    .onConflictDoUpdate({
      target: crossingsCacheTable.userId,
      set: { data, builtAt: staleAt },
    });
}

describe("GET /api/me/crossings — SWR stale-L2 timing", () => {
  it(
    "responds in < 2 s when L1 is empty and L2 has a stale-but-present row",
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      // Prepare: empty crossing list (content doesn't matter for the timing
      // assertion — we just need L2 to have a row so the SWR path triggers).
      await seedStaleL2Row(userId!, []);

      const t0 = Date.now();
      const res = await fetch(`${baseUrl}/api/me/crossings`, {
        headers: { cookie: `lore_sid=${SID}` },
      });
      const elapsed = Date.now() - t0;

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(Array.isArray(body.items)).toBe(true);

      expect(
        elapsed,
        `SWR crossings (stale L2, empty list) took ${elapsed} ms — must be < ${MAX_RESPONSE_MS} ms`,
      ).toBeLessThan(MAX_RESPONSE_MS);
    },
    90_000,
  );

  it(
    "returns stale L2 data unchanged and still under 2 s (SWR does not transform the payload)",
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      // Seed a recognisable sentinel row so we can verify the stale value is
      // returned as-is — not zeroed, not re-computed inline, not transformed.
      const sentinel: CrossingsRow[] = [
        {
          stationSlug: `sentinel-${run}`,
          crossings: 7,
          artistCrossings: 3,
          weekCrossings: 5,
          weekArtistCrossings: 2,
          monthCrossings: 6,
          monthArtistCrossings: 3,
          lifetimeCrossings: 42,
          lifetimeArtistCrossings: 11,
        },
      ];

      await seedStaleL2Row(userId!, sentinel);

      const t0 = Date.now();
      const res = await fetch(`${baseUrl}/api/me/crossings`, {
        headers: { cookie: `lore_sid=${SID}` },
      });
      const elapsed = Date.now() - t0;

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { stationSlug: string; lifetimeCrossings: number }[];
      };

      // Stale sentinel values must come back unmodified.
      const hit = body.items.find((i) => i.stationSlug === `sentinel-${run}`);
      expect(hit, "sentinel crossing row must be present in the SWR response").toBeDefined();
      expect(hit!.lifetimeCrossings).toBe(42);

      expect(
        elapsed,
        `SWR crossings (sentinel payload) took ${elapsed} ms — must be < ${MAX_RESPONSE_MS} ms`,
      ).toBeLessThan(MAX_RESPONSE_MS);
    },
    90_000,
  );
});
