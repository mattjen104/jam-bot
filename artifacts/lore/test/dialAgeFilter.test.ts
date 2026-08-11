/**
 * dialAgeFilter — pure age-tier classification for the Dial's filter menus.
 *
 * Covers:
 *  1. spinAgeTier: first-spin precedence, current/catalog/deep year math,
 *     unknown release year → null.
 *  2. rowPassesAgeTierFilter: empty set passes all, null tier always passes,
 *     additive membership check.
 */
import { describe, expect, it } from "vitest";
import { spinAgeTier, rowPassesAgeTierFilter, type AgeTier } from "../src/lib/dialAgeFilter";

const NOW_YEAR = 2026;

describe("spinAgeTier", () => {
  it("returns 'first' for a first-ever spin regardless of release year", () => {
    expect(spinAgeTier(true, 1975, NOW_YEAR)).toBe("first");
    expect(spinAgeTier(true, NOW_YEAR, NOW_YEAR)).toBe("first");
    expect(spinAgeTier(true, null, NOW_YEAR)).toBe("first");
  });

  it("returns null when the release year is unknown and not a first spin", () => {
    expect(spinAgeTier(false, null, NOW_YEAR)).toBeNull();
    expect(spinAgeTier(false, undefined, NOW_YEAR)).toBeNull();
  });

  it("classifies 'current' as released within ~18 months", () => {
    // Same year → 0 months → current.
    expect(spinAgeTier(false, NOW_YEAR, NOW_YEAR)).toBe("current");
    // One year back → 12 months → current.
    expect(spinAgeTier(false, NOW_YEAR - 1, NOW_YEAR)).toBe("current");
  });

  it("classifies 'catalog' as released ~19–60 months ago", () => {
    // Two years back → 24 months → catalog.
    expect(spinAgeTier(false, NOW_YEAR - 2, NOW_YEAR)).toBe("catalog");
    // Five years back → 60 months → still catalog (inclusive boundary).
    expect(spinAgeTier(false, NOW_YEAR - 5, NOW_YEAR)).toBe("catalog");
  });

  it("classifies 'deep' as released more than 60 months ago", () => {
    expect(spinAgeTier(false, NOW_YEAR - 6, NOW_YEAR)).toBe("deep");
    expect(spinAgeTier(false, 1975, NOW_YEAR)).toBe("deep");
  });

  it("defaults nowYear to the current year", () => {
    // A 1970s release is deep no matter what year "now" is.
    expect(spinAgeTier(false, 1971)).toBe("deep");
  });
});

describe("rowPassesAgeTierFilter", () => {
  const set = (...tiers: AgeTier[]) => new Set<AgeTier>(tiers);

  it("passes every row when no tiers are active", () => {
    expect(rowPassesAgeTierFilter("deep", set())).toBe(true);
    expect(rowPassesAgeTierFilter(null, set())).toBe(true);
  });

  it("always passes rows with unknown age (null tier)", () => {
    expect(rowPassesAgeTierFilter(null, set("current"))).toBe(true);
    expect(rowPassesAgeTierFilter(null, set("first", "deep"))).toBe(true);
  });

  it("matches additively against the active set", () => {
    expect(rowPassesAgeTierFilter("current", set("current"))).toBe(true);
    expect(rowPassesAgeTierFilter("deep", set("current"))).toBe(false);
    expect(rowPassesAgeTierFilter("deep", set("current", "deep"))).toBe(true);
    expect(rowPassesAgeTierFilter("first", set("first"))).toBe(true);
    expect(rowPassesAgeTierFilter("catalog", set("first"))).toBe(false);
  });
});
