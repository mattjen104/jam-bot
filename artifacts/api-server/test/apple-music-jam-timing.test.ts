import { describe, expect, it } from "vitest";
import {
  JAM_CORRECTION_THRESHOLD_MS,
  correctionConverged,
  observeMatch,
  positionAt,
} from "../src/lore/apple-music-jam-timing.js";

describe("Apple Music jam timing", () => {
  it("advances a playing anchor and freezes paused anchors", () => {
    expect(positionAt({ state: "playing", positionMs: 5_000, effectiveAtMs: 10_000 }, 12_500)).toBe(7_500);
    expect(positionAt({ state: "paused", positionMs: 5_000, effectiveAtMs: 10_000 }, 12_500)).toBe(5_000);
  });

  it("uses conservative drift thresholds and convergence checks", () => {
    expect(JAM_CORRECTION_THRESHOLD_MS).toBeGreaterThan(1_000);
    expect(correctionConverged(2_000, 300)).toBe(true);
    expect(correctionConverged(2_000, 2_200)).toBe(false);
  });

  it("requires two consecutive confident matches and never changes on a miss", () => {
    const state = { confirmedKey: null, candidateKey: null, candidateCount: 0 };
    const track = { key: "isrc:A", title: "A", artist: "Artist", playOffsetMs: 10_000, score: 90 };
    expect(observeMatch(state, null).kind).toBe("miss");
    expect(observeMatch(state, track).kind).toBe("pending");
    expect(observeMatch(state, { ...track, key: "isrc:B" }).kind).toBe("pending");
    expect(observeMatch(state, track).kind).toBe("pending");
    expect(observeMatch(state, track).kind).toBe("changed");
    expect(observeMatch(state, { ...track, score: 20 }).kind).toBe("low-confidence");
  });
});