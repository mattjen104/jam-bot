/**
 * dialFilterState — additive toggle semantics for the Dial filter menus.
 *
 * Covers:
 *  1. Age tiers toggle on/off additively; the empty set is allowed.
 *  2. Station categories toggle additively; deselecting the LAST active
 *     category is a no-op (same reference back, so React skips the render).
 */
import { describe, expect, it } from "vitest";
import { toggleAgeTier, toggleStationCategory } from "../src/lib/dialFilterState";
import type { AgeTier } from "../src/lib/dialAgeFilter";
import type { StationCategory } from "../src/components/dial/DialFilterBar";

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

describe("toggleStationCategory", () => {
  it("adds an inactive category (all three can be active together)", () => {
    let s = new Set<StationCategory>(["lore"]);
    s = toggleStationCategory(s, "classics");
    s = toggleStationCategory(s, "ambient");
    expect(s.size).toBe(3);
  });

  it("removes an active category while at least one other remains", () => {
    let s = new Set<StationCategory>(["lore", "ambient"]);
    s = toggleStationCategory(s, "lore");
    expect([...s]).toEqual(["ambient"]);
  });

  it("refuses to deselect the last active category (returns prev unchanged)", () => {
    const prev = new Set<StationCategory>(["classics"]);
    const next = toggleStationCategory(prev, "classics");
    expect(next).toBe(prev);
    expect(next.has("classics")).toBe(true);
  });

  it("does not mutate the previous set on a normal toggle", () => {
    const prev = new Set<StationCategory>(["lore", "classics"]);
    toggleStationCategory(prev, "classics");
    expect(prev.size).toBe(2);
  });
});
