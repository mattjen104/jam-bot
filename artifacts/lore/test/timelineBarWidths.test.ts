/**
 * Tests for timelineBarWidth utilities.
 *
 * Critical invariant: bar width derives from the playedAt delta ONLY.
 * A spin with a known duration that disagrees with its delta must render at
 * the delta width — proving complete independence from duration_ms.
 */

import { describe, it, expect } from "vitest";
import {
  computeSpinBarMs,
  annotateSpinWidths,
  MAX_BAR_MS,
} from "../src/lib/timelineBarWidth";

const CLAMP = MAX_BAR_MS; // 8 minutes

describe("computeSpinBarMs", () => {
  it("returns deltaMs when within clamp, gapMs = 0", () => {
    const a = new Date("2026-08-05T12:00:00Z");
    const b = new Date("2026-08-05T12:03:00Z"); // 3 min = 180,000 ms
    const result = computeSpinBarMs(a, b);
    expect(result.barMs).toBe(180_000);
    expect(result.gapMs).toBe(0);
  });

  it("clamps bar and exposes gap when delta > MAX_BAR_MS", () => {
    const a = new Date("2026-08-05T12:00:00Z");
    const b = new Date("2026-08-05T12:20:00Z"); // 20 min = 1,200,000 ms
    const result = computeSpinBarMs(a, b);
    expect(result.barMs).toBe(CLAMP);
    expect(result.gapMs).toBe(1_200_000 - CLAMP);
  });

  it("null nextPlayedAt returns { barMs: CLAMP, gapMs: 0 }", () => {
    const a = new Date("2026-08-05T12:00:00Z");
    const result = computeSpinBarMs(a, null);
    expect(result.barMs).toBe(CLAMP);
    expect(result.gapMs).toBe(0);
  });

  it("zero or negative delta returns { barMs: 0, gapMs: 0 }", () => {
    const a = new Date("2026-08-05T12:00:00Z");
    const sameTime = computeSpinBarMs(a, a);
    expect(sameTime.barMs).toBe(0);
    expect(sameTime.gapMs).toBe(0);

    const earlier = new Date("2026-08-05T11:59:00Z");
    const negative = computeSpinBarMs(a, earlier);
    expect(negative.barMs).toBe(0);
    expect(negative.gapMs).toBe(0);
  });

  it("bar width derives from delta NOT duration — a spin with known duration disagreeing with its delta renders at the delta width", () => {
    // Spin delta = 4 minutes; if we were using duration_ms (e.g. 3:30 = 210s), we'd get 210,000 ms.
    // Correct answer is the 4-minute delta.
    const a = new Date("2026-08-05T12:00:00Z");
    const b = new Date("2026-08-05T12:04:00Z"); // 4 min delta
    // duration_ms would be 210_000 (3m30s) — deliberately different
    const _ignored_duration_ms = 210_000;
    const result = computeSpinBarMs(a, b);
    expect(result.barMs).toBe(240_000); // 4 min, not 3m30s
    expect(result.barMs).not.toBe(_ignored_duration_ms);
  });

  it("a spin with null duration still renders a correct bar (duration independence)", () => {
    // Even when there is no known duration, the bar must render correctly.
    const a = new Date("2026-08-05T12:00:00Z");
    const b = new Date("2026-08-05T12:05:00Z");
    // duration_ms = null (not passed — proves the function doesn't need it)
    const result = computeSpinBarMs(a, b);
    expect(result.barMs).toBe(300_000); // 5 min
  });

  it("respects a custom clamp value", () => {
    const a = new Date("2026-08-05T12:00:00Z");
    const b = new Date("2026-08-05T12:10:00Z"); // 10 min
    const customClamp = 5 * 60_000; // 5 min
    const result = computeSpinBarMs(a, b, customClamp);
    expect(result.barMs).toBe(customClamp);
    expect(result.gapMs).toBe(5 * 60_000);
  });
});

describe("annotateSpinWidths", () => {
  it("annotates an array of spins with bar+gap widths", () => {
    const spins = [
      { playedAt: "2026-08-05T12:00:00Z" },
      { playedAt: "2026-08-05T12:03:00Z" }, // 3 min gap
      { playedAt: "2026-08-05T12:25:00Z" }, // 22 min gap → clamp + gap
    ];
    const results = annotateSpinWidths(spins);
    expect(results.length).toBe(3);

    // First spin: 3 min delta
    expect(results[0].barMs).toBe(180_000);
    expect(results[0].gapMs).toBe(0);

    // Second spin: 22 min delta → clamped
    expect(results[1].barMs).toBe(CLAMP);
    expect(results[1].gapMs).toBe(22 * 60_000 - CLAMP);

    // Last spin: no next → { barMs: CLAMP, gapMs: 0 }
    expect(results[2].barMs).toBe(CLAMP);
    expect(results[2].gapMs).toBe(0);
  });
});
