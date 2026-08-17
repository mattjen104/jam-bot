import { describe, it, expect } from "vitest";
import { isResolvedSseSpinFrame } from "../src/hooks/useDialData";

/**
 * Regression guard for the provisional now-playing fast path: the shared
 * /api/stations/now-playing/stream channel now carries `spin-raw`
 * (provisional, pre-resolution) and `spin-raw-failed` (terminal, never
 * persisted) frames alongside resolved `spin-changed` frames. The Dial feed
 * must stay a persisted-spin surface — applying a provisional or failed frame
 * would display an unpersisted track with empty MBID / release-year /
 * library-hit state, and SSE overrides are never cleared, so it would stick.
 */
describe("isResolvedSseSpinFrame — Dial SSE override guard", () => {
  it("accepts resolved spin-changed frames (type absent or explicit)", () => {
    expect(isResolvedSseSpinFrame({})).toBe(true);
    expect(isResolvedSseSpinFrame({ type: "spin-changed" })).toBe(true);
  });

  it("rejects provisional spin-raw frames", () => {
    expect(isResolvedSseSpinFrame({ type: "spin-raw" })).toBe(false);
  });

  it("rejects terminal spin-raw-failed frames", () => {
    expect(isResolvedSseSpinFrame({ type: "spin-raw-failed" })).toBe(false);
  });
});
