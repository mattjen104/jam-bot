/**
 * Client preview cache — contract tests.
 *
 * The scan loops the same stations repeatedly; the cache must guarantee at
 * most one preview lookup per track, share in-flight promises across
 * concurrent callers, fast-skip known-negatives, expire negatives sooner
 * than positives, stay bounded in size, and support URL-only prefetch of
 * exactly the next scan candidate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPreviewCached,
  prefetchPreview,
  clearPreviewCache,
  previewCacheSize,
  POSITIVE_TTL_MS,
  NEGATIVE_TTL_MS,
  MAX_ENTRIES,
  type PreviewResult,
} from "../src/player/previewCache";

const POSITIVE: PreviewResult = {
  previewUrl: "https://apple.example/clip.m4a",
  artworkUrl: "https://apple.example/art.jpg",
  source: "itunes",
};
const NEGATIVE: PreviewResult = {
  previewUrl: null,
  artworkUrl: null,
  source: null,
};

beforeEach(() => {
  clearPreviewCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  clearPreviewCache();
});

describe("promise sharing", () => {
  it("concurrent lookups for the same MBID share one in-flight fetch", async () => {
    let resolveFetch!: (v: PreviewResult) => void;
    const fetcher = vi.fn(
      () => new Promise<PreviewResult>((res) => { resolveFetch = res; }),
    );

    const a = getPreviewCached("mbid-1", fetcher);
    const b = getPreviewCached("mbid-1", fetcher);
    const c = getPreviewCached("mbid-1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetch(POSITIVE);
    const results = await Promise.all([a, b, c]);
    for (const r of results) expect(r.previewUrl).toBe(POSITIVE.previewUrl);
  });

  it("different MBIDs fetch independently", async () => {
    const fetcher = vi.fn().mockResolvedValue(POSITIVE);
    await Promise.all([
      getPreviewCached("mbid-1", fetcher),
      getPreviewCached("mbid-2", fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("repeat passes hit the cache", () => {
  it("a resolved positive is returned without a second fetch", async () => {
    const fetcher = vi.fn().mockResolvedValue(POSITIVE);
    await getPreviewCached("mbid-1", fetcher);
    const again = await getPreviewCached("mbid-1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.previewUrl).toBe(POSITIVE.previewUrl);
  });

  it("a known-negative returns instantly without re-querying (fast-skip)", async () => {
    const fetcher = vi.fn().mockResolvedValue(NEGATIVE);
    await getPreviewCached("mbid-neg", fetcher);
    const again = await getPreviewCached("mbid-neg", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.previewUrl).toBeNull();
  });
});

describe("TTL behaviour", () => {
  it("negatives expire sooner than positives", async () => {
    const fetcher = vi.fn().mockResolvedValue(NEGATIVE);
    await getPreviewCached("mbid-neg", fetcher);

    vi.advanceTimersByTime(NEGATIVE_TTL_MS + 1);
    await getPreviewCached("mbid-neg", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2); // negative was refetched

    const posFetcher = vi.fn().mockResolvedValue(POSITIVE);
    await getPreviewCached("mbid-pos", posFetcher);
    vi.advanceTimersByTime(NEGATIVE_TTL_MS + 1); // past negative TTL only
    await getPreviewCached("mbid-pos", posFetcher);
    expect(posFetcher).toHaveBeenCalledTimes(1); // positive still fresh
  });

  it("positives expire after POSITIVE_TTL_MS", async () => {
    const fetcher = vi.fn().mockResolvedValue(POSITIVE);
    await getPreviewCached("mbid-pos", fetcher);
    vi.advanceTimersByTime(POSITIVE_TTL_MS + 1);
    await getPreviewCached("mbid-pos", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("failures are transient", () => {
  it("a rejected fetch is not cached — the next call retries", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(POSITIVE);

    await expect(getPreviewCached("mbid-1", fetcher)).rejects.toThrow("network");
    const r = await getPreviewCached("mbid-1", fetcher);
    expect(r.previewUrl).toBe(POSITIVE.previewUrl);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("prefetchPreview swallows rejections", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network"));
    prefetchPreview("mbid-1", fetcher);
    await vi.runAllTimersAsync(); // flush microtasks — must not throw/unhandled-reject
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("size bound", () => {
  it("evicts oldest resolved entries beyond MAX_ENTRIES", async () => {
    const fetcher = vi.fn().mockResolvedValue(POSITIVE);
    for (let i = 0; i < MAX_ENTRIES + 25; i++) {
      await getPreviewCached(`mbid-${i}`, fetcher);
    }
    expect(previewCacheSize()).toBeLessThanOrEqual(MAX_ENTRIES);
    // The most recent entry survives; the very first was evicted.
    fetcher.mockClear();
    await getPreviewCached(`mbid-${MAX_ENTRIES + 24}`, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    await getPreviewCached("mbid-0", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("next-hop prefetch", () => {
  // Mirrors the PlayerProvider scan wiring: when a preview starts playing,
  // exactly the NEXT scan candidate (idx + dir, wrapped) is prefetched —
  // URL only, through the same cache.
  function nextCandidate<T extends { mbid: string }>(
    stations: T[],
    scanIdx: number,
    scanDir: 1 | -1,
  ): T | undefined {
    const n = stations.length;
    return stations[(((scanIdx + scanDir) % n) + n) % n];
  }

  it("prefetch resolves only the next candidate (forward and wrap-around)", async () => {
    const stations = [{ mbid: "a" }, { mbid: "b" }, { mbid: "c" }];
    const fetcher = vi.fn().mockResolvedValue(POSITIVE);

    // Playing idx 0, forward → prefetch b only.
    prefetchPreview(nextCandidate(stations, 0, 1)!.mbid, fetcher);
    await vi.runAllTimersAsync();
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["b"]);

    // Playing idx 2, forward → wraps to a.
    prefetchPreview(nextCandidate(stations, 2, 1)!.mbid, fetcher);
    // Playing idx 0, backward → wraps to c.
    prefetchPreview(nextCandidate(stations, 0, -1)!.mbid, fetcher);
    await vi.runAllTimersAsync();
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["b", "a", "c"]);
  });

  it("prefetched URL is served from cache when the scan hops there", async () => {
    const fetcher = vi.fn().mockResolvedValue(POSITIVE);
    prefetchPreview("next-mbid", fetcher);
    await vi.runAllTimersAsync();
    const r = await getPreviewCached("next-mbid", fetcher);
    expect(r.previewUrl).toBe(POSITIVE.previewUrl);
    expect(fetcher).toHaveBeenCalledTimes(1); // no duplicate lookup on hop
  });
});
