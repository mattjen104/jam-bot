import { describe, it, expect } from "vitest";
import {
  pickLeaseTargets,
  mergeShowScoped,
  applyFollowBonus,
  normaliseDjName,
  FOLLOW_BONUS,
  type ScoredStation,
} from "../src/lore/socket-leases.js";
import { pickWatcherStreamUrl } from "../src/lore/poller.js";

function scored(
  stationId: number,
  score: number,
  crossings = 1,
  extras: Partial<ScoredStation> = {},
): ScoredStation {
  return {
    stationId,
    slug: `s${stationId}`,
    name: `S${stationId}`,
    score,
    crossings,
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// pickLeaseTargets
// ---------------------------------------------------------------------------

describe("pickLeaseTargets", () => {
  it("returns the top-N scorers in score order", () => {
    const out = pickLeaseTargets(
      [scored(1, 0.5), scored(2, 3.2), scored(3, 1.1)],
      2,
    );
    expect(out.map((s) => s.stationId)).toEqual([2, 3]);
  });

  it("never leases zero- or negative-score stations even with free slots", () => {
    const out = pickLeaseTargets([scored(1, 0), scored(2, 2)], 10);
    expect(out.map((s) => s.stationId)).toEqual([2]);
  });

  it("returns empty when there are no spare slots", () => {
    expect(pickLeaseTargets([scored(1, 5)], 0)).toEqual([]);
    expect(pickLeaseTargets([scored(1, 5)], -3)).toEqual([]);
  });

  it("breaks score ties deterministically by station id", () => {
    const out = pickLeaseTargets([scored(9, 1), scored(4, 1), scored(7, 1)], 2);
    expect(out.map((s) => s.stationId)).toEqual([4, 7]);
  });

  it("does not mutate the input array", () => {
    const input = [scored(1, 1), scored(2, 9)];
    pickLeaseTargets(input, 1);
    expect(input.map((s) => s.stationId)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// pickWatcherStreamUrl
// ---------------------------------------------------------------------------

describe("pickWatcherStreamUrl", () => {
  it("prefers the lowest-bitrate mount when mounts are advertised", () => {
    expect(
      pickWatcherStreamUrl({
        streamUrl: "http://x/hi",
        mounts: [
          { url: "http://x/320", bitrate: 320 },
          { url: "http://x/64", bitrate: 64 },
          { url: "http://x/128", bitrate: 128 },
        ],
      }),
    ).toBe("http://x/64");
  });

  it("falls back to the first mount when no bitrates are known", () => {
    expect(
      pickWatcherStreamUrl({
        mounts: [{ url: "http://x/a" }, { url: "http://x/b" }],
      }),
    ).toBe("http://x/a");
  });

  it("ignores malformed mount entries", () => {
    expect(
      pickWatcherStreamUrl({
        streamUrl: "http://x/plain",
        mounts: [null, {}, { url: "" }],
      }),
    ).toBe("http://x/plain");
  });

  it("uses streamUrl when no mounts exist and null when nothing is usable", () => {
    expect(pickWatcherStreamUrl({ streamUrl: "http://x/s" })).toBe("http://x/s");
    expect(pickWatcherStreamUrl({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeShowScoped
// ---------------------------------------------------------------------------

describe("mergeShowScoped", () => {
  it("leaves stations untouched when showScopedMap is empty", () => {
    const base = [scored(1, 5.0, 10), scored(2, 2.0, 4)];
    const result = mergeShowScoped(base, new Map());
    expect(result).toEqual(base);
  });

  it("replaces score and crossings for a matched station", () => {
    const base = [scored(1, 5.0, 10)];
    const scopedMap = new Map([
      [1, { score: 2.5, crossings: 3, activeDj: "DJ Soma" }],
    ]);
    const [r] = mergeShowScoped(base, scopedMap);
    expect(r!.score).toBe(2.5);
    expect(r!.crossings).toBe(3);
    expect(r!.scopedToShow).toBe(true);
    expect(r!.activeDj).toBe("DJ Soma");
  });

  it("marks the replaced entry as show-scoped", () => {
    const base = [scored(1, 5.0, 10)];
    const scopedMap = new Map([
      [1, { score: 2.5, crossings: 3, activeDj: null }],
    ]);
    const [r] = mergeShowScoped(base, scopedMap);
    expect(r!.scopedToShow).toBe(true);
  });

  it("does NOT replace when show-scoped crossings are zero", () => {
    const base = [scored(1, 5.0, 10)];
    const scopedMap = new Map([
      [1, { score: 0.1, crossings: 0, activeDj: "DJ Zero" }],
    ]);
    const [r] = mergeShowScoped(base, scopedMap);
    // Station-wide values must be preserved.
    expect(r!.score).toBe(5.0);
    expect(r!.crossings).toBe(10);
    expect(r!.scopedToShow).toBeUndefined();
  });

  it("a station whose current show has crossings outranks the same station scored station-wide with more crossings", () => {
    // Station 1: station-wide score 8, but show-scoped score is only 3.
    // Station 2: station-wide score 5, no show context.
    // After merge, station 1 drops to 3 and station 2 stays at 5.
    // pickLeaseTargets should then prefer station 2.
    const base = [scored(1, 8.0, 20), scored(2, 5.0, 8)];
    const scopedMap = new Map([
      [1, { score: 3.0, crossings: 4, activeDj: "Night DJ" }],
    ]);
    const merged = mergeShowScoped(base, scopedMap);
    const targets = pickLeaseTargets(merged, 1);
    expect(targets[0]!.stationId).toBe(2);
  });

  it("a station whose current show has MORE crossings than the station-wide average wins the lease", () => {
    // Station 1: station-wide score 5 — but its current show is unusually
    // good and has a show-scoped score of 12.
    // Station 2: station-wide score 9 — no active show.
    // After merge, station 1 should win with score 12.
    const base = [scored(1, 5.0, 8), scored(2, 9.0, 15)];
    const scopedMap = new Map([
      [1, { score: 12.0, crossings: 10, activeDj: "Peak Show" }],
    ]);
    const merged = mergeShowScoped(base, scopedMap);
    const targets = pickLeaseTargets(merged, 1);
    expect(targets[0]!.stationId).toBe(1);
  });

  it("preserves other fields (slug, name) when replacing", () => {
    const base = [scored(42, 1.0, 2)];
    const scopedMap = new Map([
      [42, { score: 5.0, crossings: 7, activeDj: "Mix" }],
    ]);
    const [r] = mergeShowScoped(base, scopedMap);
    expect(r!.slug).toBe("s42");
    expect(r!.name).toBe("S42");
  });
});

// ---------------------------------------------------------------------------
// normaliseDjName
// ---------------------------------------------------------------------------

describe("normaliseDjName", () => {
  it("lowercases and collapses non-alphanumeric runs to spaces", () => {
    expect(normaliseDjName("DJ Snake")).toBe("dj snake");
    expect(normaliseDjName("dj-snake")).toBe("dj snake");
    expect(normaliseDjName("DJ  SNAKE")).toBe("dj snake");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normaliseDjName("  DJ Snake  ")).toBe("dj snake");
  });

  it("handles an empty string", () => {
    expect(normaliseDjName("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// applyFollowBonus
// ---------------------------------------------------------------------------

describe("applyFollowBonus", () => {
  it("applies FOLLOW_BONUS to a station whose active DJ is followed", () => {
    const stations = [
      scored(1, 4.0, 5, { activeDj: "DJ Mora", scopedToShow: true }),
    ];
    const follows = new Set([normaliseDjName("DJ Mora")]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(4.0 * FOLLOW_BONUS);
  });

  it("matching is case-insensitive and punctuation-tolerant", () => {
    const stations = [
      scored(1, 2.0, 3, { activeDj: "DJ Mora", scopedToShow: true }),
    ];
    // Follow stored as 'dj mora' (already normalised)
    const follows = new Set(["dj mora"]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(2.0 * FOLLOW_BONUS);
  });

  it("does NOT boost a station with score === 0", () => {
    const stations = [
      scored(1, 0, 0, { activeDj: "DJ Mora", scopedToShow: true }),
    ];
    const follows = new Set([normaliseDjName("DJ Mora")]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(0);
  });

  it("does NOT boost a station with no activeDj", () => {
    const stations = [scored(1, 5.0, 8, { scopedToShow: true })];
    const follows = new Set(["dj mora"]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(5.0);
  });

  it("leaves unmatched stations unchanged", () => {
    const stations = [
      scored(1, 3.0, 5, { activeDj: "DJ Other", scopedToShow: true }),
    ];
    const follows = new Set([normaliseDjName("DJ Mora")]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(3.0);
  });

  it("is a no-op when followedDjNames is empty", () => {
    const stations = [
      scored(1, 4.0, 5, { activeDj: "DJ Mora", scopedToShow: true }),
    ];
    const result = applyFollowBonus(stations, new Set());
    expect(result).toBe(stations); // same reference — no allocation
  });

  it("followed station wins lease over an otherwise higher-scoring unfollowed station", () => {
    const stations = [
      scored(1, 6.0, 10, { activeDj: "DJ Followed", scopedToShow: true }),
      scored(2, 8.0, 15),
    ];
    const follows = new Set([normaliseDjName("DJ Followed")]);
    const boosted = applyFollowBonus(stations, follows);
    const targets = pickLeaseTargets(boosted, 1);
    expect(targets[0]!.stationId).toBe(1);
  });

  it("does not mutate the original array or objects", () => {
    const original: ScoredStation = scored(1, 4.0, 5, {
      activeDj: "DJ Mora",
      scopedToShow: true,
    });
    const stations = [original];
    const follows = new Set([normaliseDjName("DJ Mora")]);
    applyFollowBonus(stations, follows);
    expect(original.score).toBe(4.0);
  });
});
