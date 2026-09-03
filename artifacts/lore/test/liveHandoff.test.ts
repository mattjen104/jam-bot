import { describe, expect, it, vi } from "vitest";
import type { Station } from "@workspace/api-client-react";
import {
  deriveNextChange,
  commitLiveHandoff,
  isConfirmedHandoffBoundary,
  rankHandoffCandidates,
  stabilizeCandidateOrder,
  tracksDiffer,
  type LiveNow,
} from "../src/player/liveHandoff";
import type { WpOnAirItem } from "../src/webplayer/hooks";

function station(slug: string, overrides: Partial<Station> = {}): Station {
  return {
    id: slug.length,
    slug,
    name: slug.toUpperCase(),
    streamUrl: `https://example.com/${slug}.mp3`,
    streamFormat: "mp3",
    mode: "live",
    attribution: false,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    stationCategories: ["campus"],
    ...overrides,
  } as Station;
}

function now(overrides: Partial<LiveNow> = {}): LiveNow {
  return {
    mbid: "recording-1",
    title: "Track",
    artist: "Artist",
    artworkUrl: null,
    playedAt: "2026-09-03T12:00:00.000Z",
    observedAt: "2026-09-03T12:00:00.000Z",
    freshness: "fresh",
    resolved: true,
    ...overrides,
  };
}

function onAirItem(slug: string, overrides: Partial<WpOnAirItem> = {}): WpOnAirItem {
  return {
    station: station(slug),
    show: null,
    now: now({ mbid: `recording-${slug}` }),
    earlier: [],
    matchCount: 0,
    ...overrides,
  };
}

describe("deriveNextChange", () => {
  it("shows a server-anchored trusted countdown", () => {
    expect(deriveNextChange(now({
      serverTime: "2026-09-03T12:00:00.000Z",
      estimatedRemainingMs: 90_000,
      timingConfidence: "trusted",
    }), Date.parse("2026-09-03T12:00:30.000Z"))).toEqual({
      state: "trusted",
      remainingMs: 60_000,
      label: "Next change in 1:00",
      boundaryAt: Date.parse("2026-09-03T12:01:30.000Z"),
    });
  });

  it("labels a near estimated boundary as changing soon", () => {
    const view = deriveNextChange(now({
      serverTime: "2026-09-03T12:00:00.000Z",
      estimatedRemainingMs: 30_000,
      timingConfidence: "estimated",
    }), Date.parse("2026-09-03T12:00:10.000Z"));
    expect(view.state).toBe("changing-soon");
    expect(view.label).toBe("Changing soon · Lore is watching");
  });

  it("uses minute-granularity language for approximate timing", () => {
    const view = deriveNextChange(now({
      serverTime: "2026-09-03T12:00:00.000Z",
      estimatedRemainingMs: 130_000,
      timingConfidence: "estimated",
    }), Date.parse("2026-09-03T12:00:10.000Z"));
    expect(view.state).toBe("estimated");
    expect(view.label).toBe("about 2 minutes left");
  });

  it("does not fabricate a countdown without server time", () => {
    expect(deriveNextChange(now({
      estimatedRemainingMs: 30_000,
      timingConfidence: "trusted",
    })).state).toBe("unknown");
  });

  it("uses a stale status instead of trusting an old estimate", () => {
    expect(deriveNextChange(now({
      freshness: "stale",
      serverTime: "2026-09-03T12:00:00.000Z",
      estimatedRemainingMs: 30_000,
      timingConfidence: "trusted",
    })).state).toBe("stale");
  });

  it("turns zero into a metadata-check state, not a track claim", () => {
    expect(deriveNextChange(now({
      serverTime: "2026-09-03T12:00:00.000Z",
      estimatedRemainingMs: 1_000,
      timingConfidence: "trusted",
    }), Date.parse("2026-09-03T12:00:02.000Z")).state).toBe("just-changed");
  });
});

describe("rankHandoffCandidates", () => {
  it("ranks fresh resolved affinity above a generic fresh station", () => {
    const current = station("current");
    const ranked = rankHandoffCandidates([
      onAirItem("generic"),
      onAirItem("affinity", {
        now: now({ mbid: "affinity", artist: "Artist" }),
        matchCount: 4,
      }),
    ], current, now());
    expect(ranked.map((candidate) => candidate.station.slug)).toEqual(["affinity", "generic"]);
    expect(ranked[0]?.reasons).toContain("playing Artist");
  });

  it("rejects unresolved, stale, and unplayable destinations", () => {
    const ranked = rankHandoffCandidates([
      onAirItem("unresolved", { now: now({ mbid: null, resolved: false }) }),
      onAirItem("stale", { now: now({ freshness: "stale" }) }),
      onAirItem("site-only", { station: station("site-only", { streamUrl: "", relayUrl: null }) }),
      onAirItem("fresh"),
    ], station("current"), now());
    expect(ranked.map((candidate) => candidate.station.slug)).toEqual(["fresh"]);
  });

  it("demotes an approximate track when it crosses the changing-soon threshold", () => {
    const serverTime = "2026-09-03T12:00:00.000Z";
    const ranked = rankHandoffCandidates([
      onAirItem("affinity", {
        matchCount: 10,
        now: now({
          mbid: "affinity",
          serverTime,
          estimatedRemainingMs: 50_000,
          timingConfidence: "estimated",
        }),
      }),
      onAirItem("steady", {
        now: now({
          mbid: "steady",
          serverTime,
          estimatedRemainingMs: 180_000,
          timingConfidence: "estimated",
        }),
      }),
    ], station("current"), now(), Date.parse("2026-09-03T12:00:25.000Z"));
    expect(ranked.map((candidate) => candidate.station.slug)).toEqual([
      "steady",
      "affinity",
    ]);
    expect(ranked[1]?.changingSoon).toBe(true);
  });
});

describe("stabilizeCandidateOrder", () => {
  it("updates metadata without moving still-eligible stations", () => {
    const ranked = rankHandoffCandidates([
      onAirItem("a", { matchCount: 1 }),
      onAirItem("b", { matchCount: 8 }),
      onAirItem("c", { matchCount: 3 }),
    ], station("current"), now());
    const stable = stabilizeCandidateOrder(["a", "b"], ranked);
    expect(stable.map((candidate) => candidate.station.slug)).toEqual(["a", "b", "c"]);
  });

  it("drops an ineligible station and fills its vacancy", () => {
    const ranked = rankHandoffCandidates([
      onAirItem("b"),
      onAirItem("c"),
    ], station("current"), now());
    expect(
      stabilizeCandidateOrder(["a", "b"], ranked)
        .map((candidate) => candidate.station.slug),
    ).toEqual(["b", "c"]);
  });

  it("keeps the visible three stable when clock-only scoring moves another station ahead", () => {
    const initial = rankHandoffCandidates([
      onAirItem("a", { matchCount: 4 }),
      onAirItem("b", { matchCount: 3 }),
      onAirItem("c", { matchCount: 2 }),
      onAirItem("d", { matchCount: 1 }),
    ], station("current"), now());
    const rescored = rankHandoffCandidates([
      onAirItem("a", { matchCount: 4 }),
      onAirItem("b", { matchCount: 3 }),
      onAirItem("c", { matchCount: 0 }),
      onAirItem("d", { matchCount: 2 }),
    ], station("current"), now());
    expect(
      stabilizeCandidateOrder(
        initial.map((candidate) => candidate.station.slug),
        rescored,
      ).slice(0, 3).map((candidate) => candidate.station.slug),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("tracksDiffer", () => {
  it("uses strong MBIDs before normalized text", () => {
    expect(tracksDiffer(now({ mbid: "a" }), now({ mbid: "b", title: "Track", artist: "Artist" }))).toBe(true);
    expect(tracksDiffer(now({ mbid: null, title: " Track ", artist: "ARTIST" }), now({ mbid: null }))).toBe(false);
  });
});

describe("isConfirmedHandoffBoundary", () => {
  it("accepts only a different, fresh, playable destination track", () => {
    const baseline = now({ mbid: "old" });
    expect(isConfirmedHandoffBoundary(baseline, now({ mbid: "new", freshness: "fresh" }), true)).toBe(true);
    expect(isConfirmedHandoffBoundary(baseline, now({ mbid: "new", freshness: "stale" }), true)).toBe(false);
    expect(isConfirmedHandoffBoundary(baseline, now({ mbid: null, resolved: false, freshness: "fresh" }), true)).toBe(false);
    expect(isConfirmedHandoffBoundary(baseline, now({ mbid: "new", freshness: "fresh" }), false)).toBe(false);
    expect(isConfirmedHandoffBoundary(baseline, now({ mbid: "old", freshness: "fresh" }), true)).toBe(false);
  });
});

describe("commitLiveHandoff", () => {
  it("stops an active scan exactly once before tuning the destination", () => {
    const stopScan = vi.fn();
    const tune = vi.fn();
    const destination = station("destination");
    commitLiveHandoff(destination, "source", true, stopScan, tune);
    expect(stopScan).toHaveBeenCalledOnce();
    expect(tune).toHaveBeenCalledOnce();
    expect(tune).toHaveBeenCalledWith(destination);
  });

  it("does not retune when catching the current station", () => {
    const stopScan = vi.fn();
    const tune = vi.fn();
    commitLiveHandoff(station("source"), "source", false, stopScan, tune);
    expect(stopScan).not.toHaveBeenCalled();
    expect(tune).not.toHaveBeenCalled();
  });
});