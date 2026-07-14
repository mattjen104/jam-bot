// @vitest-environment node
/**
 * Unit tests for the getInsightMaps in-memory cache (stations.ts).
 *
 * Three behaviours are exercised:
 *   1. A second call within the TTL window reuses the cached promise and does
 *      NOT invoke the underlying builder again.
 *   2. After the TTL expires the cache is rebuilt, picking up genre profiles
 *      written to the DB between the two calls.
 *   3. A builder that throws is NOT cached — the next call retries rather than
 *      replaying the rejection.
 *
 * Tests 1 and 3 use a fake builder so they need no real DB.
 * Test 2 uses the real DB (self-skips when unavailable) and fake timers to
 * advance past the 5-minute TTL without waiting.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql, isNotNull } from "drizzle-orm";
import {
  db,
  stationsTable,
  showsTable,
} from "@workspace/db";
import {
  getInsightMaps,
  INSIGHT_MAPS_TTL_MS,
  _configureInsightMapsBuilder,
  _resetInsightMapsBuilder,
  _resetInsightMapsCache,
} from "../src/routes/lore/stations.js";

// ---------------------------------------------------------------------------
// DB lifecycle for test 2 (TTL expiry with real DB)
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);
let dbAvailable = false;
let stationId: number | undefined;
let showId: number | undefined;

const STREAM_URL = `http://radio-insight-test-${run}.example/stream`;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [stRow] = await db
    .insert(stationsTable)
    .values({
      slug: `test-insight-${run}`,
      name: `Insight Maps Test Station ${run}`,
      streamUrl: STREAM_URL,
      stationClass: "curated",
    })
    .returning({ id: stationsTable.id });

  stationId = stRow!.id;

  const [shRow] = await db
    .insert(showsTable)
    .values({
      stationId: stationId!,
      name: `Test Show ${run}`,
      djName: `DJ Test ${run}`,
      genreProfile: { top: [{ genre: "jazz", count: 5 }] },
      discoveryScore: 0.4,
    })
    .returning({ id: showsTable.id });

  showId = shRow!.id;
});

afterAll(async () => {
  if (!dbAvailable || stationId === undefined) return;
  if (showId !== undefined) {
    await db.delete(showsTable).where(eq(showsTable.id, showId));
  }
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
});

afterEach(() => {
  // Always restore the real builder and clear the cache between tests so
  // each test starts from a cold cache with the real (or freshly-configured)
  // builder.
  _resetInsightMapsBuilder();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Test 1 — cache reuse: second call within TTL does not invoke builder again
// ---------------------------------------------------------------------------

describe("getInsightMaps — cache reuse within TTL", () => {
  it("returns a cached promise and calls the builder only once for rapid successive calls", async () => {
    let buildCount = 0;

    const fakeBuilder = vi.fn(async () => {
      buildCount++;
      return {
        showByName: new Map(),
        showByDj: new Map(),
        pickerByDj: new Map(),
      };
    });

    _configureInsightMapsBuilder(fakeBuilder);

    // First call — cold cache, builder fires.
    const result1 = await getInsightMaps();
    expect(buildCount).toBe(1);

    // Second call — still within TTL, same promise is returned.
    const result2 = await getInsightMaps();
    expect(buildCount).toBe(1);

    // Both calls resolve to the exact same object (identity check confirms
    // it is the same cached promise, not two independently-resolved promises).
    expect(result1).toBe(result2);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — TTL expiry: rebuild picks up updated genre profiles from DB
// ---------------------------------------------------------------------------

describe("getInsightMaps — TTL expiry triggers rebuild with fresh data", () => {
  it("picks up a genre profile written to the DB after the TTL expires", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Use fake timers so we can advance past the 5-minute TTL instantly.
    vi.useFakeTimers();

    const showKey = `${stationId}|test show ${run}`;

    // First call — cold cache, reads DB.  The show has genreProfile = jazz.
    const maps1 = await getInsightMaps();
    const insight1 = maps1.showByName.get(showKey);
    expect(insight1).toBeTruthy();
    expect(insight1?.genres).toContain("jazz");

    // Update the show's genre profile in the DB to "blues".
    await db
      .update(showsTable)
      .set({ genreProfile: { top: [{ genre: "blues", count: 8 }] } })
      .where(eq(showsTable.id, showId!));

    // Advance time past the TTL — cache should now be considered stale.
    vi.advanceTimersByTime(INSIGHT_MAPS_TTL_MS + 1);

    // Second call — cache expired, builder runs again against the DB.
    const maps2 = await getInsightMaps();
    const insight2 = maps2.showByName.get(showKey);
    expect(insight2).toBeTruthy();
    expect(insight2?.genres).toContain("blues");
    expect(insight2?.genres).not.toContain("jazz");

    // Restore for afterAll cleanup (real timers needed for DB teardown).
    vi.useRealTimers();

    // Restore the original genre for test isolation.
    await db
      .update(showsTable)
      .set({ genreProfile: { top: [{ genre: "jazz", count: 5 }] } })
      .where(eq(showsTable.id, showId!));
  });
});

// ---------------------------------------------------------------------------
// Test 4 — thundering herd: concurrent cold-cache callers share one build
// ---------------------------------------------------------------------------

describe("getInsightMaps — concurrent cold-cache calls fire the builder only once", () => {
  it("resolves all callers from a single in-flight promise when the cache is empty", async () => {
    let buildCount = 0;

    // The builder takes a tick to resolve so that multiple synchronous callers
    // can all observe an empty cache before the first one sets the entry.
    const fakeBuilder = vi.fn(
      () =>
        new Promise<{ showByName: Map<never, never>; showByDj: Map<never, never>; pickerByDj: Map<never, never> }>(
          (resolve) => {
            buildCount++;
            // Yield to the microtask queue so all callers below reach
            // getInsightMaps() before the promise settles.
            Promise.resolve().then(() =>
              resolve({ showByName: new Map(), showByDj: new Map(), pickerByDj: new Map() })
            );
          }
        )
    );

    _configureInsightMapsBuilder(fakeBuilder as Parameters<typeof _configureInsightMapsBuilder>[0]);

    // Fire five concurrent requests against a cold cache.
    const results = await Promise.all([
      getInsightMaps(),
      getInsightMaps(),
      getInsightMaps(),
      getInsightMaps(),
      getInsightMaps(),
    ]);

    // The builder must have been invoked exactly once despite five concurrent callers.
    expect(buildCount).toBe(1);
    expect(fakeBuilder).toHaveBeenCalledTimes(1);

    // Every caller receives the exact same resolved object (shared promise).
    const first = results[0];
    for (const r of results.slice(1)) {
      expect(r).toBe(first);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3 — error not cached: a failed build is evicted so the next call
//           retries rather than replaying the cached rejection
// ---------------------------------------------------------------------------

describe("getInsightMaps — failed build is not cached", () => {
  it("retries on the next call when the builder throws", async () => {
    const error = new Error("DB unavailable (simulated)");

    let attempt = 0;
    const flakyBuilder = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw error;
      return {
        showByName: new Map([["key", null]] as [string, null][]),
        showByDj: new Map(),
        pickerByDj: new Map(),
      };
    });

    _configureInsightMapsBuilder(flakyBuilder);

    // First call — builder throws; the promise rejects.
    await expect(getInsightMaps()).rejects.toThrow("DB unavailable (simulated)");

    // Builder was called exactly once.
    expect(flakyBuilder).toHaveBeenCalledTimes(1);

    // Second call — because the error was NOT cached, the builder is called
    // again and this time it succeeds.
    const maps = await getInsightMaps();
    expect(flakyBuilder).toHaveBeenCalledTimes(2);

    // The resolved maps contain the value from the second (successful) attempt.
    expect(maps.showByName.has("key")).toBe(true);
  });
});
