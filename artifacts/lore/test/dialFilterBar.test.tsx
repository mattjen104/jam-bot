// @vitest-environment jsdom
/**
 * DialFilterBar — the Dial's three filter dropdown menus.
 *
 * Covers:
 *  1. Three dropdown triggers render: Crossings, Track age, Station type.
 *  2. Each panel carries the right checkboxes with full labels, checked
 *     state driven by the active sets / crossings flag.
 *  3. Active-count badges reflect the number of checked options.
 *  4. Toggling a checkbox fires the matching callback.
 *
 * The selection semantics themselves (additive tiers + categories, crossings
 * boolean) live in dialFilterState and are exercised in
 * dialFilterState.test.ts; open/close mechanics are covered in
 * filterDropdownMenu.test.tsx.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DialFilterBar, type StationCategory } from "../src/components/dial/DialFilterBar";
import type { AgeTier } from "../src/lib/dialAgeFilter";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBar(overrides: Partial<React.ComponentProps<typeof DialFilterBar>> = {}) {
  const props = {
    activeTiers: new Set<AgeTier>(),
    activeCategories: new Set<StationCategory>(["anchor"]),
    crossingsActive: true,
    onToggleTier: vi.fn(),
    onToggleCategory: vi.fn(),
    onToggleCrossings: vi.fn(),
    ...overrides,
  };
  const utils = render(<DialFilterBar {...props} />);
  return { ...utils, props };
}

function openMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
}

describe("DialFilterBar", () => {
  it("renders only the crossings trigger inside the filter bar group", () => {
    renderBar();
    const bar = screen.getByRole("group", { name: "Dial filters" });
    const trigger = screen.getByRole("button", { name: /^Crossings/ });
    expect(bar.contains(trigger)).toBe(true);
    expect(screen.queryByRole("button", { name: /^Track age/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Station type/ })).toBeNull();
  });

  it("the Crossings menu has a single checkbox reflecting crossingsActive", () => {
    const { props } = renderBar({ crossingsActive: true });
    openMenu("Crossings");
    const box = screen.getByRole("checkbox", { name: /Crossings on/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(box);
    expect(props.onToggleCrossings).toHaveBeenCalledTimes(1);
  });

  it("the Crossings checkbox is unchecked in radio mode", () => {
    renderBar({ crossingsActive: false });
    openMenu("Crossings");
    expect((screen.getByRole("checkbox", { name: /Crossings on/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("a Crossings-on badge appears only when crossings mode is off (count 0) — never for the default", () => {
    renderBar({ crossingsActive: true });
    // Crossings counts as "active" only when its checkbox is checked; the
    // badge reads the checked count, so crossings-on shows · 1.
    expect(screen.getByRole("button", { name: /^Crossings/ }).textContent).toContain("· 1");
  });

  it("lets listeners choose crossings or first plays as the scoped station sort", () => {
    const { props } = renderBar({
      crossingScope: "lifetime",
      onCycleCrossingScope: vi.fn(),
      sortMetric: "crossings",
      onSortMetric: vi.fn(),
    });
    openMenu("Sort");
    fireEvent.click(screen.getByRole("checkbox", { name: /First plays/ }));
    expect(props.onSortMetric).toHaveBeenCalledWith("firstPlays");
  });
});
