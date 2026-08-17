import { describe, expect, it } from "vitest";
import {
  classifyFreshness,
  expectedCadenceMs,
} from "../src/lore/freshness.js";

/**
 * Boundary tests for the now-playing freshness classifier.
 *
 * Contract: fresh ≤ 2× the source's expected polling cadence, aging ≤ 6×,
 * stale beyond. Unknown/null sources use the poller default (90s).
 */

const T0 = new Date("2026-08-15T12:00:00Z");
const at = (msAgo: number) => new Date(T0.getTime() - msAgo);

describe("expectedCadenceMs", () => {
  it("uses per-source cadence when known", () => {
    expect(expectedCadenceMs("radio_browser_icy")).toBe(30_000);
    expect(expectedCadenceMs("spinitron")).toBe(900_000);
  });

  it("falls back to the poller default for unknown or null sources", () => {
    expect(expectedCadenceMs("some_new_source")).toBe(90_000);
    expect(expectedCadenceMs(null)).toBe(90_000);
    expect(expectedCadenceMs(undefined)).toBe(90_000);
  });
});

describe("classifyFreshness — fast source (radio_browser_icy, 30s cadence)", () => {
  it("fresh at zero age and exactly at the 2× boundary", () => {
    expect(classifyFreshness("radio_browser_icy", at(0), T0)).toBe("fresh");
    expect(classifyFreshness("radio_browser_icy", at(60_000), T0)).toBe("fresh");
  });

  it("aging just past 2× and up to exactly 6×", () => {
    expect(classifyFreshness("radio_browser_icy", at(60_001), T0)).toBe("aging");
    expect(classifyFreshness("radio_browser_icy", at(180_000), T0)).toBe("aging");
  });

  it("stale past 6×", () => {
    expect(classifyFreshness("radio_browser_icy", at(180_001), T0)).toBe("stale");
    expect(classifyFreshness("radio_browser_icy", at(3_600_000), T0)).toBe("stale");
  });
});

describe("classifyFreshness — slow history source (spinitron, 15min cadence)", () => {
  it("fresh within 30 minutes", () => {
    expect(classifyFreshness("spinitron", at(29 * 60_000), T0)).toBe("fresh");
    expect(classifyFreshness("spinitron", at(30 * 60_000), T0)).toBe("fresh");
  });

  it("aging between 30 and 90 minutes", () => {
    expect(classifyFreshness("spinitron", at(31 * 60_000), T0)).toBe("aging");
    expect(classifyFreshness("spinitron", at(90 * 60_000), T0)).toBe("aging");
  });

  it("stale past 90 minutes", () => {
    expect(classifyFreshness("spinitron", at(91 * 60_000), T0)).toBe("stale");
  });
});

describe("classifyFreshness — unknown source uses the 90s default", () => {
  it("fresh ≤ 3min, aging ≤ 9min, stale beyond", () => {
    expect(classifyFreshness("unknown", at(3 * 60_000), T0)).toBe("fresh");
    expect(classifyFreshness("unknown", at(9 * 60_000), T0)).toBe("aging");
    expect(classifyFreshness("unknown", at(9 * 60_000 + 1), T0)).toBe("stale");
    expect(classifyFreshness(null, at(0), T0)).toBe("fresh");
  });
});

describe("classifyFreshness — clock skew", () => {
  it("never stale by negative age (observedAt in the future clamps to 0)", () => {
    expect(classifyFreshness("radio_browser_icy", at(-60_000), T0)).toBe("fresh");
  });
});

describe("classifyFreshness — provisional observations (spin-raw fast path)", () => {
  // Contract: a provisional observation carries the same observedAt semantics
  // as a persisted spin, so it classifies identically — a station must never
  // read aging/stale while a resolution is in flight.
  it("a just-observed provisional track is fresh for every source cadence", () => {
    for (const source of ["radio_browser_icy", "spinitron", "kcrw", null]) {
      expect(classifyFreshness(source, at(0), T0)).toBe("fresh");
    }
  });

  it("classification is purely observedAt-driven — no special provisional branch", () => {
    // A provisional frame observed 70s ago on a 30s-cadence source ages
    // exactly like a persisted spin of the same age.
    expect(classifyFreshness("radio_browser_icy", at(70_000), T0)).toBe("aging");
  });
});
