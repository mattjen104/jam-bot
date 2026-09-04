import { describe, expect, it, vi } from "vitest";
import type { Station } from "@workspace/api-client-react";
import {
  deriveBroadcastAdvisory,
  deriveNextChange,
  commitLiveHandoff,
  isConfirmedHandoffBoundary,
  rankHandoffCandidates,
  stabilizeCandidateOrder,
  tracksDiffer,
  type LiveNow,
} from "../src/player/liveHandoff";
import type { WpOnAirItem } from "../src/webplayer/hooks";
import { alignWpOnAirTiming } from "../src/webplayer/hooks";
import { BroadcastClockEstimator } from "../src/lib/broadcastClock";

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

  it("downgrades a trusted signal when bounded uncertainty is too wide", () => {
    const view = deriveNextChange(now({
      serverTime: "2026-09-03T12:00:00.000Z",
      estimatedRemainingMs: 30_000,
      timingConfidence: "trusted",
      timingUncertaintyMs: 20_000,
    }), Date.parse("2026-09-03T12:00:10.000Z"));
    expect(view.state).toBe("estimated");
    expect(view.label).toBe("About 0:20 left");
  });

  it("omits countdowns for receipt-only and unbounded timing", () => {
    expect(deriveNextChange(now({
      timestampKind: "receipt",
      timingReason: "receipt_only",
      serverTime: "2026-09-03T12:00:00.000Z",
      estimatedRemainingMs: 30_000,
    })).label).toBe("No station start time to count from");
    expect(deriveNextChange(now({
      serverTime: "2026-09-03T12:00:00.000Z",
      estimatedRemainingMs: 30_000,
      timingConfidence: "estimated",
      timingUncertaintyMs: 60_000,
    })).label).toBe("Timing is too uncertain to count down");
  });

  it("waits for clock alignment rather than using the device wall clock", () => {
    expect(deriveNextChange(now({
      serverTime: "2026-09-03T12:00:00.000Z",
      estimatedRemainingMs: 30_000,
      timingConfidence: "trusted",
    }), null).label).toBe("Aligning with the broadcast clock");
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

describe("deriveBroadcastAdvisory", () => {
  const evidenceAt = "2026-09-03T12:00:00.000Z";
  const expiresAt = "2026-09-03T12:01:30.000Z";

  it("uses low-confidence language without exposing identity or a next track", () => {
    expect(deriveBroadcastAdvisory(now({
      observedAt: evidenceAt,
      broadcastAdvisory: { kind: "dj_speaking", observedAt: evidenceAt, expiresAt },
    }), Date.parse("2026-09-03T12:00:30.000Z"))).toEqual({
      kind: "dj_speaking",
      label: "DJ may be speaking",
    });
    expect(deriveBroadcastAdvisory(now({
      observedAt: evidenceAt,
      broadcastAdvisory: { kind: "music_resuming", observedAt: evidenceAt, expiresAt },
    }), Date.parse("2026-09-03T12:00:30.000Z"))?.label).toBe("Music may be resuming");
  });

  it("clears stale, expired, and freshly contradicted evidence", () => {
    const advisory = { kind: "dj_speaking" as const, observedAt: evidenceAt, expiresAt };
    expect(deriveBroadcastAdvisory(now({ freshness: "stale", broadcastAdvisory: advisory }))).toBeNull();
    expect(deriveBroadcastAdvisory(now({ broadcastAdvisory: advisory }), Date.parse(expiresAt))).toBeNull();
    expect(deriveBroadcastAdvisory(now({
      observedAt: "2026-09-03T12:00:01.000Z",
      broadcastAdvisory: advisory,
    }), Date.parse("2026-09-03T12:00:30.000Z"))).toBeNull();
  });
});

describe("rankHandoffCandidates", () => {
  it("uses response-level clock timing for an imminent on-air candidate", () => {
    let wall = 9_000_000;
    let mono = 1_000;
    const clock = new BroadcastClockEstimator(() => wall, () => mono);
    const item = onAirItem("imminent", {
      now: now({
        serverTime: undefined,
        estimatedRemainingMs: 25_000,
        timingConfidence: "estimated",
      }),
    });
    const response = alignWpOnAirTiming(
      {
        serverTime: "2026-09-03T12:00:00.000Z",
        items: [item],
        authenticated: false,
      },
      clock,
      { wallMs: wall, monotonicMs: mono },
      { wallMs: wall + 200, monotonicMs: mono + 200 },
    );
    wall += 10_200;
    mono += 10_200;

    const ranked = rankHandoffCandidates(
      response.items,
      station("current"),
      now(),
      clock.now() ?? undefined,
    );
    expect(ranked[0]?.changingSoon).toBe(true);
    expect(response.items[0]?.now.clockUncertaintyMs).toBe(100);
  });

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