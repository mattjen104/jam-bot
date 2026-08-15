/**
 * dialFilterState — toggle semantics for the Dial filter menus.
 *
 * Covers:
 *  1. Age tiers toggle on/off additively; the empty set is allowed.
 *  2. Station categories are a radio-style single-select: selecting a new
 *     category REPLACES the previous one, and re-selecting the active
 *     category is a no-op (same reference back, so React skips the render).
 *     There is never an empty state.
 */
import { describe, expect, it } from "vitest";
import { toggleAgeTier, toggleStationCategory } from "../src/lib/dialFilterState";
import type { AgeTier } from "../src/lib/dialAgeFilter";
import type { StationCategory } from "../src/lib/dialCategories";

describe("toggleAgeTier", () => {
  it("adds an inactive tier", () => {
    const next = toggleAgeTier(new Set<AgeTier>(), "current");
    expect([...next]).toEqual(["current"]);
  });

  it("is additive — multiple tiers can be active together", () => {
    let s = new Set<AgeTier>();
    s = toggleAgeTier(s, "first");
    s = toggleAgeTier(s, "deep");
    expect(s.has("first")).toBe(true);
    expect(s.has("deep")).toBe(true);
    expect(s.size).toBe(2);
  });

  it("removes an active tier and allows the empty set", () => {
    let s = new Set<AgeTier>(["catalog"]);
    s = toggleAgeTier(s, "catalog");
    expect(s.size).toBe(0);
  });

  it("does not mutate the previous set", () => {
    const prev = new Set<AgeTier>(["first"]);
    toggleAgeTier(prev, "first");
    expect(prev.has("first")).toBe(true);
  });
});

describe("toggleStationCategory (single-select)", () => {
  it("selecting a new category replaces the previous one", () => {
    let s = new Set<StationCategory>(["anchor"]);
    s = toggleStationCategory(s, "campus");
    expect([...s]).toEqual(["campus"]);
    s = toggleStationCategory(s, "ambient");
    expect([...s]).toEqual(["ambient"]);
  });

  it("exactly one category is active after any sequence of selections", () => {
    let s = new Set<StationCategory>(["anchor"]);
    for (const cat of ["ambient", "campus", "specialist", "public", "indie", "discovery"] as const) {
      s = toggleStationCategory(s, cat);
      expect(s.size).toBe(1);
      expect(s.has(cat)).toBe(true);
    }
  });

  it("re-selecting the active category is a no-op (returns prev unchanged — no empty state)", () => {
    const prev = new Set<StationCategory>(["specialist"]);
    const next = toggleStationCategory(prev, "specialist");
    expect(next).toBe(prev);
    expect(next.has("specialist")).toBe(true);
  });

  it("does not mutate the previous set on a replacement", () => {
    const prev = new Set<StationCategory>(["anchor"]);
    const next = toggleStationCategory(prev, "indie");
    expect(prev.has("anchor")).toBe(true);
    expect(prev.size).toBe(1);
    expect([...next]).toEqual(["indie"]);
  });

  it("collapses a (legacy) multi-member set down to the newly selected category", () => {
    const prev = new Set<StationCategory>(["anchor", "campus"]);
    const next = toggleStationCategory(prev, "campus");
    expect([...next]).toEqual(["campus"]);
  });
});
