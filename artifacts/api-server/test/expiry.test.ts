import { describe, it, expect } from "vitest";
import {
  estimateExpiry,
  LIKELY_EXPIRING_THRESHOLD_MS,
} from "../src/lore/expiry.js";

/**
 * Track-expiry estimator (pure):
 *  - playedAt-based remaining time and the likely-expiring threshold;
 *  - fingerprint offset + capture time preferred over playedAt;
 *  - missing duration / missing position ⇒ null (no estimate, no penalty);
 *  - wildly-overshot elapsed ⇒ null (stale data, not "expiring").
 */

const T0 = new Date("2026-08-15T12:00:00.000Z");
const secsAgo = (s: number) => new Date(T0.getTime() - s * 1000);

describe("estimateExpiry", () => {
  it("computes remaining time from duration and playedAt", () => {
    const est = estimateExpiry({
      durationMs: 180_000,
      playedAt: secsAgo(60),
      now: T0,
    });
    expect(est).toEqual({
      remainingMs: 120_000,
      likelyExpiring: false,
      positionSource: "played_at",
    });
  });

  it("flags likely-expiring inside the threshold window", () => {
    const est = estimateExpiry({
      durationMs: 180_000,
      playedAt: secsAgo(172), // 8s left < 15s threshold
      now: T0,
    });
    expect(est?.likelyExpiring).toBe(true);
    expect(est?.remainingMs).toBe(8_000);
  });

  it("clamps remaining to 0 when slightly past the end (still expiring)", () => {
    const est = estimateExpiry({
      durationMs: 180_000,
      playedAt: secsAgo(200), // 20s past end, inside overshoot grace
      now: T0,
    });
    expect(est).toMatchObject({ remainingMs: 0, likelyExpiring: true });
  });

  it("returns null without duration — degrade gracefully", () => {
    expect(estimateExpiry({ durationMs: null, playedAt: secsAgo(60), now: T0 })).toBeNull();
    expect(estimateExpiry({ durationMs: undefined, playedAt: secsAgo(60), now: T0 })).toBeNull();
    expect(estimateExpiry({ durationMs: 0, playedAt: secsAgo(60), now: T0 })).toBeNull();
  });

  it("returns null without any position signal", () => {
    expect(estimateExpiry({ durationMs: 180_000, playedAt: null, now: T0 })).toBeNull();
    expect(
      estimateExpiry({ durationMs: 180_000, playedAt: new Date(NaN), now: T0 }),
    ).toBeNull();
  });

  it("prefers the fingerprint offset over playedAt when both exist", () => {
    // playedAt says 10s elapsed, but the fingerprint pinned the clip at
    // 170s into the song 5s ago → 175s elapsed, 5s remaining.
    const est = estimateExpiry({
      durationMs: 180_000,
      playedAt: secsAgo(10),
      playOffsetMs: 170_000,
      offsetCapturedAt: secsAgo(5),
      now: T0,
    });
    expect(est).toEqual({
      remainingMs: 5_000,
      likelyExpiring: true,
      positionSource: "fingerprint",
    });
  });

  it("falls back to playedAt when the offset pair is incomplete", () => {
    const est = estimateExpiry({
      durationMs: 180_000,
      playedAt: secsAgo(30),
      playOffsetMs: 170_000, // no capture time — unusable
      now: T0,
    });
    expect(est?.positionSource).toBe("played_at");
    expect(est?.remainingMs).toBe(150_000);
  });

  it("returns null when elapsed wildly exceeds duration (stale, not expiring)", () => {
    const est = estimateExpiry({
      durationMs: 180_000,
      playedAt: secsAgo(600), // 10 minutes into a 3-minute song
      now: T0,
    });
    expect(est).toBeNull();
  });

  it("threshold boundary: exactly at threshold is NOT likely-expiring", () => {
    const est = estimateExpiry({
      durationMs: 180_000,
      playedAt: new Date(T0.getTime() - (180_000 - LIKELY_EXPIRING_THRESHOLD_MS)),
      now: T0,
    });
    expect(est?.remainingMs).toBe(LIKELY_EXPIRING_THRESHOLD_MS);
    expect(est?.likelyExpiring).toBe(false);
  });
});
