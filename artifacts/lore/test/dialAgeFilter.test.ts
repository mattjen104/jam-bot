/**
 * dialAgeFilter — pure age-tier classification for the Dial's filter menus.
 *
 * Covers:
 *  1. spinAgeTier: the premiere (First) rule — isFirstSpin AND brand-new
 *     (playedAt on/before the release date, partial dates read permissively;
 *     year-only fallback while dates backfill); first plays of older catalog
 *     fall through to Current/Catalog/Deep; no age data → null.
 *  2. expandPartialReleaseDateEnd: permissive partial-ISO expansion.
 *  3. rowPassesAgeTierFilter: empty set passes all, null tier always passes,
 *     additive membership check.
 */
import { describe, expect, it } from "vitest";
import {
  spinAgeTier,
  isPremierePlay,
  expandPartialReleaseDateEnd,
  rowPassesAgeTierFilter,
  type AgeTier,
} from "../src/lib/dialAgeFilter";

const NOW_YEAR = 2026;

describe("expandPartialReleaseDateEnd", () => {
  it("expands a year-only date to the end of that year", () => {
    expect(expandPartialReleaseDateEnd("2025")).toBe("2025-12-31");
  });

  it("expands a year-month date to the last day of that month", () => {
    expect(expandPartialReleaseDateEnd("2025-11")).toBe("2025-11-30");
    expect(expandPartialReleaseDateEnd("2024-02")).toBe("2024-02-29"); // leap year
    expect(expandPartialReleaseDateEnd("2025-02")).toBe("2025-02-28");
  });

  it("keeps a full date as-is", () => {
    expect(expandPartialReleaseDateEnd("2025-11-07")).toBe("2025-11-07");
  });

  it("returns null for absent or malformed dates", () => {
    expect(expandPartialReleaseDateEnd(null)).toBeNull();
    expect(expandPartialReleaseDateEnd(undefined)).toBeNull();
    expect(expandPartialReleaseDateEnd("")).toBeNull();
    expect(expandPartialReleaseDateEnd("Nov 7, 2025")).toBeNull();
    expect(expandPartialReleaseDateEnd("2025-13")).toBeNull();
    expect(expandPartialReleaseDateEnd("2025-11-40")).toBeNull();
  });
});

describe("isPremierePlay", () => {
  it("qualifies a spin aired on the release day", () => {
    expect(isPremierePlay("2025-11-07T18:30:00Z", "2025-11-07", null)).toBe(true);
  });

  it("qualifies a spin aired before the release day (advance/premiere spin)", () => {
    expect(isPremierePlay("2025-10-30T12:00:00Z", "2025-11-07", null)).toBe(true);
  });

  it("rejects a spin aired after the release day", () => {
    expect(isPremierePlay("2025-11-08T00:30:00Z", "2025-11-07", null)).toBe(false);
  });

  it("reads a year-only date permissively (any spin within the release year)", () => {
    expect(isPremierePlay("2025-03-01T12:00:00Z", "2025", null)).toBe(true);
    expect(isPremierePlay("2025-12-31T12:00:00Z", "2025", null)).toBe(true);
    expect(isPremierePlay("2026-01-01T00:00:00Z", "2025", null)).toBe(false);
  });

  it("reads a year-month date permissively (any spin within the release month)", () => {
    expect(isPremierePlay("2025-11-01T12:00:00Z", "2025-11", null)).toBe(true);
    expect(isPremierePlay("2025-11-30T12:00:00Z", "2025-11", null)).toBe(true);
    expect(isPremierePlay("2025-12-01T00:00:00Z", "2025-11", null)).toBe(false);
  });

  it("falls back to year granularity when the release date is absent", () => {
    // Release year ≥ spin's calendar year qualifies.
    expect(isPremierePlay("2026-06-15T12:00:00Z", null, 2026)).toBe(true);
    expect(isPremierePlay("2026-06-15T12:00:00Z", null, 2027)).toBe(true);
    expect(isPremierePlay("2026-06-15T12:00:00Z", null, 2025)).toBe(false);
  });

  it("returns false when neither date nor year is known", () => {
    expect(isPremierePlay("2026-06-15T12:00:00Z", null, null)).toBe(false);
  });

  it("returns false for an unparseable playedAt", () => {
    expect(isPremierePlay("not-a-date", "2025-11-07", null)).toBe(false);
  });
});

describe("spinAgeTier", () => {
  it("returns 'first' for a first-ever play of a brand-new release (full date)", () => {
    // Day of release.
    expect(spinAgeTier(true, 2025, "2025-11-07", "2025-11-07T20:00:00Z")).toBe("first");
    // Advance spin, before release day.
    expect(spinAgeTier(true, 2025, "2025-11-07", "2025-11-01T20:00:00Z")).toBe("first");
  });

  it("returns 'first' via the year-only fallback while dates backfill", () => {
    expect(spinAgeTier(true, 2026, null, "2026-03-10T12:00:00Z")).toBe("first");
    expect(spinAgeTier(true, 2027, null, "2026-12-31T12:00:00Z")).toBe("first");
  });

  it("no longer flags a first-ever play of old catalog as 'first'", () => {
    // 50-year-old deep cut heard for the first time → deep, not first.
    expect(spinAgeTier(true, 1975, null, "2026-06-01T12:00:00Z")).toBe("deep");
    // Last year's release first heard this year → current/catalog by year.
    expect(spinAgeTier(true, 2025, null, "2026-06-01T12:00:00Z")).toBe("current");
  });

  it("returns null for a first spin with no age data at all (passes all filters)", () => {
    expect(spinAgeTier(true, null, null, "2026-06-01T12:00:00Z")).toBeNull();
  });

  it("returns null when the release year is unknown and not a first spin", () => {
    expect(spinAgeTier(false, null)).toBeNull();
    expect(spinAgeTier(false, undefined)).toBeNull();
  });

  it("classifies 'current' as released within ~18 months", () => {
    expect(spinAgeTier(false, NOW_YEAR, null, null, NOW_YEAR)).toBe("current");
    expect(spinAgeTier(false, NOW_YEAR - 1, null, null, NOW_YEAR)).toBe("current");
  });

  it("classifies 'catalog' as released ~19–60 months ago", () => {
    expect(spinAgeTier(false, NOW_YEAR - 2, null, null, NOW_YEAR)).toBe("catalog");
    expect(spinAgeTier(false, NOW_YEAR - 5, null, null, NOW_YEAR)).toBe("catalog");
  });

  it("classifies 'deep' as released more than 60 months ago", () => {
    expect(spinAgeTier(false, NOW_YEAR - 6, null, null, NOW_YEAR)).toBe("deep");
    expect(spinAgeTier(false, 1975, null, null, NOW_YEAR)).toBe("deep");
  });

  it("defaults playedAt to now for live rows", () => {
    // A current-year first play "now" qualifies via the year fallback.
    const year = new Date().getFullYear();
    expect(spinAgeTier(true, year)).toBe("first");
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
