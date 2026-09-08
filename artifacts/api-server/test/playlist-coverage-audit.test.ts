import { describe, expect, it } from "vitest";
import {
  auditExclusion,
  auditOutcome,
  classifyPlaylistEvidence,
  reuseAuditEvidence,
  stratifiedPilot,
  wasAuditedToday,
  wilsonInterval,
  type PlaylistAuditStation,
} from "../src/lore/playlist-coverage-audit.js";

const station: PlaylistAuditStation = {
  id: 1, slug: "real", name: "Real", org: null, country: "US", city: null,
  streamUrl: "https://radio.example/live", homepageUrl: null,
  nowPlayingSource: null, nowPlayingConfig: {}, active: true, hidden: false,
  tier: "flagship", automaticCullReason: null,
  automaticCullCanonicalStationId: null, scheduleScrapedAt: null,
  lastAliveAt: null, lastUsableAt: null, lastUsableArtist: null,
  lastUsableTitle: null, probeOutcome: null, probeAt: null,
};

describe("playlist coverage cohort", () => {
  it("uses a stable mutually-exclusive exclusion order", () => {
    expect(auditExclusion({ ...station, slug: "test-row", active: false })).toBe("test");
    expect(auditExclusion({ ...station, automaticCullReason: "duplicate_stream", hidden: true })).toBe("duplicate");
    expect(auditExclusion({ ...station, active: false, hidden: true })).toBe("inactive");
    expect(auditExclusion({ ...station, hidden: true })).toBe("hidden");
  });

  it("does not mistake reachable audio for playlist evidence", () => {
    expect(classifyPlaylistEvidence({ ...station, lastAliveAt: new Date() }, null))
      .toBe("potential_unprobed");
  });

  it("separates resumable history from live-only pairs", () => {
    const pair = { stationId: 1, observedAt: new Date().toISOString(), outcome: "usable_pair" as const };
    expect(classifyPlaylistEvidence(station, pair)).toBe("confirmed_live");
    expect(classifyPlaylistEvidence({
      ...station, nowPlayingSource: "kexp_api",
    }, pair)).toBe("confirmed_history");
  });
});

describe("playlist coverage sampling and uncertainty", () => {
  it("allocates proportionally across strata and remains stable by station id", () => {
    const rows = [
      { ...station, id: 4, country: "CA" },
      { ...station, id: 1, country: "US" },
      { ...station, id: 3, country: "CA" },
      { ...station, id: 2, country: "US" },
    ];
    const first = stratifiedPilot(rows, 3).map((row) => row.id);
    expect(first).toHaveLength(3);
    expect(stratifiedPilot([...rows].reverse(), 3).map((row) => row.id)).toEqual(first);
    expect(new Set(first.map((id) => rows.find((row) => row.id === id)?.country)))
      .toEqual(new Set(["US", "CA"]));
  });

  it("enforces the once-daily evidence guard", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    expect(wasAuditedToday({ stationId: 1, observedAt: "2026-09-08T01:00:00Z", outcome: "unreachable" }, now)).toBe(true);
    expect(wasAuditedToday({ stationId: 1, observedAt: "2026-09-07T01:00:00Z", outcome: "unreachable" }, now)).toBe(false);
  });

  it("retains incurred request bounds when pilot evidence is reused at zero load", () => {
    const reused = reuseAuditEvidence(
      {
        stationId: 7,
        observedAt: "2026-09-08T01:00:00.000Z",
        outcome: "usable_pair",
        requestCountUpperBound: 7,
      },
      "2026-09-08T20:00:00.000Z",
      "pilot",
      "icy|US|no_schedule|usable_pair",
    );
    expect(reused.requestCountUpperBound).toBe(7);
    expect(reused.incrementalRequestCountUpperBound).toBe(0);
    expect(reused.reusedDailyEvidence).toBe(true);
  });

  it("keeps network-policy rejections separate from technical failures", () => {
    expect(auditOutcome("unreachable", "redirect resolved to a private address"))
      .toBe("policy_rejected");
    expect(auditOutcome("unreachable", "unsafe stream URL")).toBe("policy_rejected");
    expect(auditOutcome("unreachable", "unsafe redirect target")).toBe("policy_rejected");
    expect(auditOutcome("unreachable", "connect timeout")).toBe("unreachable");
  });

  it("returns a bounded Wilson interval", () => {
    const interval = wilsonInterval(5, 10);
    expect(interval.low).toBeCloseTo(0.237, 2);
    expect(interval.high).toBeCloseTo(0.763, 2);
  });
});