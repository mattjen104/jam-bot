import { beforeEach, describe, expect, it } from "vitest";
import {
  PLAYBACK_SAMPLE_LIMIT,
  _testOnly_resetPlaybackHealth,
  getPlaybackHealth,
  recordPlaybackEvent,
} from "../../src/lore/playback-health.js";

describe("playback health aggregation", () => {
  beforeEach(_testOnly_resetPlaybackHealth);

  it("groups non-identifying events and exposes percentile health", () => {
    recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "playing", startupMs: 200 });
    recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "playing", startupMs: 9_000 });
    recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "stall", stallMs: 500 });
    const [summary] = getPlaybackHealth().summaries;
    expect(summary).toMatchObject({
      stationSlug: "kexp", sampleCount: 2, startupP50Ms: 200,
      startupP95Ms: 9000, stallP95Ms: 500, health: "degraded",
    });
  });

  it("keeps duration samples bounded", () => {
    for (let i = 0; i < PLAYBACK_SAMPLE_LIMIT + 5; i++) {
      recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "playing", startupMs: i });
    }
    expect(getPlaybackHealth().summaries[0]!.sampleCount).toBe(PLAYBACK_SAMPLE_LIMIT);
  });

  it("does not double-count a terminal marker in the failure rate", () => {
    recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "startup_failure" });
    recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "terminal_failure" });
    expect(getPlaybackHealth().summaries[0]).toMatchObject({
      failureRate: 1,
      startupFailureCount: 1,
      terminalFailureCount: 1,
    });
  });

  it("keeps warmed and ordinary startup samples comparable without listener data", () => {
    recordPlaybackEvent({
      stationSlug: "kexp",
      transport: "https",
      format: "aac",
      event: "playing",
      startupMs: 120,
      warmed: true,
    });
    recordPlaybackEvent({
      stationSlug: "kexp",
      transport: "https",
      format: "aac",
      event: "playing",
      startupMs: 320,
      warmed: false,
    });
    expect(getPlaybackHealth().summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warmed: true, startupP50Ms: 120 }),
        expect.objectContaining({ warmed: false, startupP50Ms: 320 }),
      ]),
    );
  });
});