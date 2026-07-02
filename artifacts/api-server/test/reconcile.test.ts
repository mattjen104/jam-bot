import { describe, expect, it } from "vitest";
import { windowStart, collectWindowPlays } from "../src/lore/reconcile.js";
import type { HistoryAdapter, RawSpin } from "../src/lore/types.js";

const NOW = new Date("2026-07-02T12:00:00.000Z");
const noSleep = () => Promise.resolve();

function spin(playedAt: Date | null, id: string): RawSpin {
  return {
    rawArtist: "Artist",
    rawTitle: "Title",
    playedAt,
    externalId: id,
  } as RawSpin;
}

/**
 * Fake time-anchored source over a newest-first play list: honors `before`
 * (strictly older) + `limit`, like KEXP's airdate_before paging.
 */
function fakeSource(plays: RawSpin[]): {
  adapter: HistoryAdapter;
  pagesFetched: () => number;
} {
  let pages = 0;
  const adapter: HistoryAdapter = async (_config, opts) => {
    pages++;
    const before = opts?.before ? new Date(opts.before) : new Date(8640000000000000);
    const limit = opts?.limit ?? 20;
    return plays
      .filter((p) => p.playedAt && p.playedAt < before)
      .slice(0, limit);
  };
  return { adapter, pagesFetched: () => pages };
}

/** n plays spaced `stepMinutes` apart, newest-first, ending `n*step` before NOW. */
function playsBack(n: number, stepMinutes: number): RawSpin[] {
  return Array.from({ length: n }, (_, i) =>
    spin(new Date(NOW.getTime() - (i + 1) * stepMinutes * 60_000), `id${i}`),
  );
}

describe("windowStart", () => {
  it("subtracts the window from now", () => {
    expect(windowStart(NOW, 48)).toEqual(new Date("2026-06-30T12:00:00.000Z"));
    expect(windowStart(NOW, 1)).toEqual(new Date("2026-07-02T11:00:00.000Z"));
  });
});

describe("collectWindowPlays", () => {
  it("collects only plays inside the window and stops at the edge", async () => {
    // 100 plays, one per hour: 48 inside a 48h window, the rest older.
    const { adapter, pagesFetched } = fakeSource(playsBack(100, 60));
    const start = windowStart(NOW, 48);
    const out = await collectWindowPlays(adapter, {}, start, NOW, {
      pageSize: 20,
      sleep: noSleep,
    });
    expect(out.length).toBe(48);
    expect(out.every((s) => s.playedAt! >= start)).toBe(true);
    // Pages 1-3 stay inside the window; page 4 crosses the edge and stops it.
    expect(pagesFetched()).toBe(3);
  });

  it("stops on an empty page (source exhausted before the edge)", async () => {
    const { adapter, pagesFetched } = fakeSource(playsBack(5, 60));
    const out = await collectWindowPlays(adapter, {}, windowStart(NOW, 48), NOW, {
      pageSize: 20,
      sleep: noSleep,
    });
    expect(out.length).toBe(5);
    // Page 0 is short but in-window; page 1 comes back empty and ends the walk.
    expect(pagesFetched()).toBe(2);
  });

  it("never wedges on a page that does not move the walk", async () => {
    // Source ignores `before` and always returns the same timestamped play —
    // the 1s nudge plus the page cap must terminate the walk.
    const same = spin(new Date(NOW.getTime() - 60_000), "stuck");
    let pages = 0;
    const adapter: HistoryAdapter = async () => {
      pages++;
      return [same];
    };
    const out = await collectWindowPlays(adapter, {}, windowStart(NOW, 48), NOW, {
      pageSize: 20,
      maxPages: 5,
      sleep: noSleep,
    });
    expect(pages).toBe(5); // capped, not infinite
    expect(out.length).toBe(5); // dedup is the ingest path's job
  });

  it("stops when a batch carries no timestamps (cannot anchor the walk)", async () => {
    const adapter: HistoryAdapter = async () => [spin(null, "a"), spin(null, "b")];
    const out = await collectWindowPlays(adapter, {}, windowStart(NOW, 48), NOW, {
      sleep: noSleep,
    });
    expect(out.length).toBe(0); // timestampless plays can't be windowed
  });

  it("ends the sweep cleanly when a page fetch throws", async () => {
    let calls = 0;
    const good = playsBack(20, 60);
    const adapter: HistoryAdapter = async (_config, opts) => {
      calls++;
      if (calls > 1) throw new Error("upstream 500");
      const limit = opts?.limit ?? 20;
      return good.slice(0, limit);
    };
    const out = await collectWindowPlays(adapter, {}, windowStart(NOW, 48), NOW, {
      pageSize: 10,
      sleep: noSleep,
    });
    expect(out.length).toBe(10); // page 0 kept, failure ends the walk
    expect(calls).toBe(2);
  });

  it("paces between pages via the injected sleep", async () => {
    const { adapter } = fakeSource(playsBack(100, 60));
    let naps = 0;
    await collectWindowPlays(adapter, {}, windowStart(NOW, 48), NOW, {
      pageSize: 20,
      pauseMs: 1,
      sleep: async () => {
        naps++;
      },
    });
    expect(naps).toBe(2); // pages 2 and 3 each waited; page 1 never does
  });
});
