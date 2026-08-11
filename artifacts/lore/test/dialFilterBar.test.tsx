// @vitest-environment jsdom
/**
 * DialFilterBar — the Dial's two additive toggle menus.
 *
 * Covers:
 *  1. Renders both groups with all labels and pipe separators.
 *  2. aria-pressed reflects the active sets.
 *  3. Clicking a button fires the matching toggle callback.
 *
 * The additive-set semantics themselves (toggle on/off, last-category
 * protection) live in DialView state and are exercised in
 * dialFilterBehavior.test.tsx.
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
    activeCategories: new Set<StationCategory>(["lore"]),
    onToggleTier: vi.fn(),
    onToggleCategory: vi.fn(),
    ...overrides,
  };
  const utils = render(<DialFilterBar {...props} />);
  return { ...utils, props };
}

describe("DialFilterBar", () => {
  it("renders both menus with every label", () => {
    renderBar();
    for (const label of ["First", "Current", "Catalog", "Deep", "Lore", "Classics", "Ambient"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // Grouped for a11y: song-age group + station-category group.
    expect(screen.getByRole("group", { name: "Song age" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Station category" })).toBeTruthy();
  });

  it("marks active buttons with aria-pressed and the --on class", () => {
    renderBar({
      activeTiers: new Set<AgeTier>(["current", "deep"]),
      activeCategories: new Set<StationCategory>(["lore", "ambient"]),
    });
    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("Current")).toBe("true");
    expect(pressed("Deep")).toBe("true");
    expect(pressed("First")).toBe("false");
    expect(pressed("Catalog")).toBe("false");
    expect(pressed("Lore")).toBe("true");
    expect(pressed("Ambient")).toBe("true");
    expect(pressed("Classics")).toBe("false");
    expect(screen.getByRole("button", { name: "Current" }).className).toContain("dial-filter-bar__btn--on");
    expect(screen.getByRole("button", { name: "Classics" }).className).not.toContain("--on");
  });

  it("fires onToggleTier / onToggleCategory with the clicked value", () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Catalog" }));
    expect(props.onToggleTier).toHaveBeenCalledWith("catalog");
    fireEvent.click(screen.getByRole("button", { name: "Ambient" }));
    expect(props.onToggleCategory).toHaveBeenCalledWith("ambient");
  });
});
