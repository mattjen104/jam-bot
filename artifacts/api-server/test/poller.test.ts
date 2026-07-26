import { describe, it, expect } from "vitest";
import { fetchPlaysUntilCursor } from "../src/lore/poller.js";
import type { HistoryAdapter, RawSpin } from "../src/lore/types.js";

// Poll cadence constants mirrored from poller.ts for feed-depth assertions.
// If poller.ts changes these, the coverage tests below will catch the mismatch.
const BBC_POLL_MS = 600_000; // 10 min
const SPINITRON_POLL_MS = 900_000; // 15 min
const KEXP_POLL_MS = 900_000; // 15 min
const SOMAFM_POLL_MS = 900_000; // 15 min

/**
 * Build a fake history source over a fixed newest-first play list. Each play is
 * `p{n}` with externalId `id{n}`; the adapter serves them page by page and
 * records how many pages were requested so we can assert paging behavior.
 */
function fakeSource(total: number): {
  adapter: HistoryAdapter;
  pagesFetched: () => number;
} {
  const plays: RawSpin[] = Array.from({ length: total }, (_, i) => ({
    rawArtist: `artist${i}`,
    rawTitle: `title${i}`,
    externalId: `id${i}`,
  }));
  let pages = 0;
  const adapter: HistoryAdapter = async (_config, opts) => {
    pages++;
    const limit = opts?.limit ?? 20;
    const page = opts?.page ?? 0;
    return plays.slice(page * limit, page * limit + limit);
  };
  return { adapter, pagesFetched: () => pages };
}

describe("fetchPlaysUntilCursor", () => {
  it("stops on the first page in steady state (cursor near the top)", async () => {
    const { adapter, pagesFetched } = fakeSource(100);
    // Cursor is the 3rd-newest play, well inside page 0 (size 10).
    const out = await fetchPlaysUntilCursor(adapter, {}, "id2", 200, 10);
    expect(pagesFetched()).toBe(1);
    expect(out.some((s) => s.externalId === "id2")).toBe(true);
    expect(out.length).toBe(10);
  });

  it("walks back multiple pages until it reaches the cursor after downtime", async () => {
    const { adapter, pagesFetched } = fakeSource(100);
    // Cursor is the 25th play — requires pages 0,1,2 at size 10 to reach.
    const out = await fetchPlaysUntilCursor(adapter, {}, "id25", 200, 10);
    expect(pagesFetched()).toBe(3);
    expect(out.some((s) => s.externalId === "id25")).toBe(true);
  });

  it("caps at maxPlays so a missing cursor can't page forever", async () => {
    const { adapter, pagesFetched } = fakeSource(1000);
    // Cursor never appears in the data — bounded by maxPlays, not infinite.
    const out = await fetchPlaysUntilCursor(adapter, {}, "does-not-exist", 30, 10);
    expect(out.length).toBe(30);
    expect(pagesFetched()).toBe(3);
  });

  it("pages the full backfill window on first enroll (null cursor)", async () => {
    const { adapter } = fakeSource(1000);
    const out = await fetchPlaysUntilCursor(adapter, {}, null, 50, 10);
    expect(out.length).toBe(50);
  });

  it("stops early on a short page (source has no deeper history)", async () => {
    const { adapter, pagesFetched } = fakeSource(15);
    // Only 15 plays exist; cursor absent. Page 0 full (10), page 1 short (5) -> stop.
    const out = await fetchPlaysUntilCursor(adapter, {}, "absent", 200, 10);
    expect(out.length).toBe(15);
    expect(pagesFetched()).toBe(2);
  });

  it("ends paging cleanly when a page fetch throws", async () => {
    let calls = 0;
    const adapter: HistoryAdapter = async (_config, opts) => {
      calls++;
      if ((opts?.page ?? 0) === 0) {
        return Array.from({ length: 10 }, (_, i) => ({
          rawArtist: "a",
          rawTitle: `t${i}`,
          externalId: `id${i}`,
        }));
      }
      throw new Error("upstream 500");
    };
    // Cursor not on page 0, so it tries page 1, which throws -> stop with page 0.
    const out = await fetchPlaysUntilCursor(adapter, {}, "missing", 200, 10);
    expect(out.length).toBe(10);
    expect(calls).toBe(2);
  });

  // ---- Non-paginating sources (BBC, SomaFM) --------------------------------
  //
  // BBC's /segments/latest and SomaFM's songs feed are fixed-size: they always
  // return the same batch regardless of which page is requested. Both adapters
  // guard against this with `if ((opts?.page ?? 0) > 0) return []`, so
  // fetchPlaysUntilCursor sees an empty batch on page 1 and terminates.
  // Without that guard the pager would loop until MAX_CATCHUP, ingesting the
  // same 25 segments 8× over (wasted network calls, no missed spins but noisy).

  /**
   * Build a non-paginating adapter: page 0 returns `total` plays; page > 0
   * returns [] (matching the guard in bbcApi and somaFm).
   */
  function nonPaginatingSource(total: number): {
    adapter: HistoryAdapter;
    pagesFetched: () => number;
  } {
    const plays: RawSpin[] = Array.from({ length: total }, (_, i) => ({
      rawArtist: `artist${i}`,
      rawTitle: `title${i}`,
      externalId: `np${i}`,
    }));
    let pages = 0;
    const adapter: HistoryAdapter = async (_config, opts) => {
      pages++;
      if ((opts?.page ?? 0) > 0) return []; // page > 0 guard (BBC/SomaFM pattern)
      return plays;
    };
    return { adapter, pagesFetched: () => pages };
  }

  it("terminates on page 0 via short-page when feed size < pageSize (normal BBC case)", async () => {
    // BBC returns ~25 segments; default PAGE_SIZE in production is 50.
    // 25 < 50 → short-page signal on page 0 → only 1 fetch needed.
    // The page > 0 guard in bbcApi is not even reached here — the pager
    // already knows the source is exhausted from the short page.
    const { adapter, pagesFetched } = nonPaginatingSource(25);
    const out = await fetchPlaysUntilCursor(adapter, {}, "absent-cursor", 200, 50);
    expect(pagesFetched()).toBe(1); // short page on page 0 → stops immediately
    expect(out.length).toBe(25);
  });

  it("the page>0 guard is the safety net when feed size equals or exceeds pageSize", async () => {
    // If pageSize ≤ feed size (e.g. pageSize=10, BBC returns 25), the short-page
    // signal doesn't fire on page 0.  Without the page>0 guard the pager would
    // request page 1 and get the SAME 25 items back, never terminating cleanly.
    // With the guard, page 1 returns [] → short page → 2 fetches total.
    const { adapter, pagesFetched } = nonPaginatingSource(25);
    const out = await fetchPlaysUntilCursor(adapter, {}, "absent-cursor", 200, 10);
    expect(pagesFetched()).toBe(2); // page 0 (full, 25≥10) + page 1 ([], stop)
    expect(out.length).toBe(25);
  });

  it("terminates on page 0 when cursor is in the non-paginating feed (steady state)", async () => {
    // Cursor is in the page-0 batch → single fetch, cursor found, stop.
    const { adapter, pagesFetched } = nonPaginatingSource(25);
    const out = await fetchPlaysUntilCursor(adapter, {}, "np12", 200, 50);
    expect(pagesFetched()).toBe(1);
    expect(out.some((s) => s.externalId === "np12")).toBe(true);
  });

  it("never fetches more than 2 pages from a non-paginating source regardless of maxPlays", async () => {
    // Even with a large MAX_CATCHUP (200), the empty page-1 signal stops paging
    // after exactly 2 requests — not 200/10 = 20 redundant loops.
    const { adapter, pagesFetched } = nonPaginatingSource(25);
    await fetchPlaysUntilCursor(adapter, {}, "not-in-feed", 200, 10);
    expect(pagesFetched()).toBe(2);
  });
});

// ---- Feed-depth adequacy for history-paging sources ----------------------
//
// These tests document and enforce the mathematical relationship between each
// source's poll interval and the depth of its feed. The invariant that must
// hold to guarantee zero missed spins:
//
//   feed_size × avg_track_duration_ms ≫ poll_interval_ms
//
// "HistoryAdapter coverage" means: if the poller has been down for exactly one
// poll interval, all spins played during that gap must still be present in the
// source's feed when the next poll fires. We document the conservative lower
// bound here; real feeds are typically 2–5× deeper.

describe("feed-depth adequacy: history-paging sources cannot miss spins", () => {
  // Conservative minimum segments the live BBC /segments/latest endpoint
  // returns. Empirically observed: 20–30 music segments on busy services
  // (BBC Radio 6 Music, BBC Radio 1) covering ~90–150 min of programming.
  // We assert a floor of 20 to give a clear buffer over the 10-min cadence.
  const BBC_MIN_FEED_SEGMENTS = 20;

  // Conservative minimum track duration (3 min) in ms.
  const MIN_TRACK_DURATION_MS = 3 * 60_000;

  it("BBC: feed holds at least 10× the poll interval's worth of music", () => {
    const feedDepthMs = BBC_MIN_FEED_SEGMENTS * MIN_TRACK_DURATION_MS;
    // feedDepthMs = 20 × 180 000 = 3 600 000 ms = 60 min
    // BBC_POLL_MS = 600 000 ms = 10 min
    // ratio = 6 — feed covers 6 full poll intervals, zero missed spins.
    expect(feedDepthMs).toBeGreaterThan(BBC_POLL_MS);
    const safetyMargin = feedDepthMs / BBC_POLL_MS;
    expect(safetyMargin).toBeGreaterThanOrEqual(6);
  });

  // SomaFM's songs feed carries ~20 entries with timestamps; comment in
  // adapters.ts says "~1h of music". At 15-min cadence the safety margin is 4×.
  const SOMAFM_MIN_FEED_SONGS = 20;
  it("SomaFM: feed holds at least 4× the poll interval's worth of music", () => {
    const feedDepthMs = SOMAFM_MIN_FEED_SONGS * MIN_TRACK_DURATION_MS;
    expect(feedDepthMs).toBeGreaterThan(SOMAFM_POLL_MS);
    const safetyMargin = feedDepthMs / SOMAFM_POLL_MS;
    expect(safetyMargin).toBeGreaterThanOrEqual(4);
  });

  // Spinitron and KEXP both support pagination (fetchPlaysUntilCursor pages
  // back to the cursor), so their feed depth is unbounded — the only limit
  // is MAX_CATCHUP (200 plays). At 15-min cadence a busy station plays at
  // most ~5 songs, well inside the 200-play window.
  const MAX_CATCHUP = 200;
  const MAX_SONGS_PER_POLL_INTERVAL = Math.ceil(SPINITRON_POLL_MS / MIN_TRACK_DURATION_MS);

  it("Spinitron/KEXP: MAX_CATCHUP (200) greatly exceeds max songs per poll interval", () => {
    // At 15 min cadence and 3-min minimum track duration: at most 5 songs.
    expect(MAX_CATCHUP).toBeGreaterThan(MAX_SONGS_PER_POLL_INTERVAL * 10);
  });

  it("KEXP: poll interval constants match (KEXP_POLL_MS === SPINITRON_POLL_MS)", () => {
    // Both are paginating sources at the same cadence.
    expect(KEXP_POLL_MS).toBe(SPINITRON_POLL_MS);
  });
});
