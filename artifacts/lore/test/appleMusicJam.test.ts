import { describe, expect, it } from "vitest";
import {
  JAM_MAX_CORRECTIONS,
  correctionAction,
  estimateServerOffset,
  targetJamPosition,
  applyJamSnapshot,
} from "../src/lib/appleMusicJam";

describe("Apple Music room clock", () => {
  it("uses low-latency four-timestamp samples for clock offset", () => {
    expect(estimateServerOffset([
      { clientSentAt: 0, serverReceivedAt: 110, serverSentAt: 110, clientReceivedAt: 20 },
      { clientSentAt: 100, serverReceivedAt: 211, serverSentAt: 211, clientReceivedAt: 122 },
      { clientSentAt: 200, serverReceivedAt: 900, serverSentAt: 900, clientReceivedAt: 1_000 },
    ])).toBe(100);
  });

  it("extrapolates only while playing", () => {
    const playing = { transport: { state: "playing" as const, positionMs: 2_000, effectiveAt: new Date(10_000).toISOString() } };
    expect(targetJamPosition(playing as never, 12_500)).toBe(4_500);
    const paused = { transport: { ...playing.transport, state: "paused" as const } };
    expect(targetJamPosition(paused as never, 12_500)).toBe(2_000);
  });

  it("tolerates jitter, seeks meaningful drift, and stops futile correction", () => {
    expect(correctionAction(1_000, 1_200, 0)).toBe("ignore");
    expect(correctionAction(1_000, 4_000, 0)).toBe("seek");
    expect(correctionAction(1_000, 4_000, JAM_MAX_CORRECTIONS)).toBe("give-up");
  });

  it("applies an authoritative seek even when the Apple track did not change", async () => {
    const calls: number[] = [];
    const music = {
      currentPlaybackTime: 1,
      seekToTime: async (seconds: number) => { calls.push(seconds); },
      setQueue: async () => undefined,
      play: async () => undefined,
      pause: async () => undefined,
    };
    await applyJamSnapshot({
      view: {
        status: "active",
        transport: {
          state: "paused",
          positionMs: 20_000,
          effectiveAt: new Date().toISOString(),
          track: { title: "Track", artist: "Artist", appleMusicId: "123" },
        },
      } as never,
      music: music as never,
      serverOffsetMs: 0,
      currentAppleId: "123",
    });
    expect(calls).toEqual([20]);
  });
});