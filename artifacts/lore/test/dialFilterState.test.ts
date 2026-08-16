// @vitest-environment jsdom
/**
 * dialFilterState — toggle semantics for the Dial filter menus.
 *
 * Covers:
 *  1. Age tiers toggle on/off additively; the empty set is allowed.
 *  2. Station categories are a radio-style single-select: selecting a new
 *     category REPLACES the previous one, and re-selecting the active
 *     category CLEARS it back to the empty (all-stations) state.
 *  3. useDialSkipped — the per-station scan-skip preference persisted under
 *     "lore:dialSkipped".
 */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  toggleAgeTier,
  toggleStationCategory,
  useDialSkipped,
} from "../src/lib/dialFilterState";
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

describe("toggleStationCategory (single-select, clearable)", () => {
  it("selecting a new category replaces the previous one", () => {
    let s = new Set<StationCategory>(["anchor"]);
    s = toggleStationCategory(s, "campus");
    expect([...s]).toEqual(["campus"]);
    s = toggleStationCategory(s, "ambient");
    expect([...s]).toEqual(["ambient"]);
  });

  it("at most one category is active after any sequence of selections", () => {
    let s = new Set<StationCategory>(["anchor"]);
    for (const cat of ["ambient", "campus", "specialist", "public", "indie", "discovery"] as const) {
      s = toggleStationCategory(s, cat);
      expect(s.size).toBe(1);
      expect(s.has(cat)).toBe(true);
    }
  });

  it("re-selecting the active category clears it back to the empty (all-stations) state", () => {
    const prev = new Set<StationCategory>(["specialist"]);
    const next = toggleStationCategory(prev, "specialist");
    expect(next.size).toBe(0);
  });

  it("a category can be re-selected after clearing", () => {
    let s = new Set<StationCategory>();
    s = toggleStationCategory(s, "campus");
    expect([...s]).toEqual(["campus"]);
    s = toggleStationCategory(s, "campus");
    expect(s.size).toBe(0);
    s = toggleStationCategory(s, "campus");
    expect([...s]).toEqual(["campus"]);
  });

  it("does not mutate the previous set on a replacement", () => {
    const prev = new Set<StationCategory>(["anchor"]);
    const next = toggleStationCategory(prev, "indie");
    expect(prev.has("anchor")).toBe(true);
    expect(prev.size).toBe(1);
    expect([...next]).toEqual(["indie"]);
  });

  it("does not mutate the previous set on a clear", () => {
    const prev = new Set<StationCategory>(["anchor"]);
    const next = toggleStationCategory(prev, "anchor");
    expect(prev.has("anchor")).toBe(true);
    expect(next.size).toBe(0);
  });

  it("collapses a (legacy) multi-member set down to the newly selected category", () => {
    const prev = new Set<StationCategory>(["anchor", "campus"]);
    const next = toggleStationCategory(prev, "campus");
    expect([...next]).toEqual(["campus"]);
  });
});

describe("useDialSkipped (per-station scan-skip preference)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty when nothing is stored", () => {
    const { result } = renderHook(() => useDialSkipped());
    expect(result.current.skipped.size).toBe(0);
  });

  it("toggleSkip adds then removes a slug", () => {
    const { result } = renderHook(() => useDialSkipped());
    act(() => result.current.toggleSkip("kexp"));
    expect(result.current.skipped.has("kexp")).toBe(true);
    expect(result.current.isSkipped("kexp")).toBe(true);
    act(() => result.current.toggleSkip("kexp"));
    expect(result.current.skipped.has("kexp")).toBe(false);
    expect(result.current.isSkipped("kexp")).toBe(false);
  });

  it("persists to localStorage under lore:dialSkipped", () => {
    const { result } = renderHook(() => useDialSkipped());
    act(() => result.current.toggleSkip("wfmu"));
    act(() => result.current.toggleSkip("kcrw"));
    const stored = JSON.parse(localStorage.getItem("lore:dialSkipped")!);
    expect(new Set(stored)).toEqual(new Set(["wfmu", "kcrw"]));
  });

  it("rehydrates from localStorage on mount", () => {
    localStorage.setItem("lore:dialSkipped", JSON.stringify(["cism", "chmr"]));
    const { result } = renderHook(() => useDialSkipped());
    expect(result.current.skipped.has("cism")).toBe(true);
    expect(result.current.skipped.has("chmr")).toBe(true);
    expect(result.current.skipped.size).toBe(2);
  });

  it("tolerates malformed stored values (falls back to empty)", () => {
    localStorage.setItem("lore:dialSkipped", "{not json[");
    const { result } = renderHook(() => useDialSkipped());
    expect(result.current.skipped.size).toBe(0);
    localStorage.setItem("lore:dialSkipped", JSON.stringify({ nope: true }));
    const { result: r2 } = renderHook(() => useDialSkipped());
    expect(r2.current.skipped.size).toBe(0);
    localStorage.setItem("lore:dialSkipped", JSON.stringify(["ok", 42, null]));
    const { result: r3 } = renderHook(() => useDialSkipped());
    expect([...r3.current.skipped]).toEqual(["ok"]);
  });
});
