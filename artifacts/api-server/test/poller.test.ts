import { describe, it, expect } from "vitest";
import { fetchPlaysUntilCursor } from "../src/lore/poller.js";
import type { HistoryAdapter, RawSpin } from "../src/lore/types.js";

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
});
