import { describe, it, expect } from "vitest";
import {
  pickLeaseTargets,
  type ScoredStation,
} from "../src/lore/socket-leases.js";
import { pickWatcherStreamUrl } from "../src/lore/poller.js";

function scored(
  stationId: number,
  score: number,
  crossings = 1,
): ScoredStation {
  return { stationId, slug: `s${stationId}`, name: `S${stationId}`, score, crossings };
}

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
