// @vitest-environment jsdom
/**
 * DialFilterBar — the Dial's two filter menus.
 *
 * Covers:
 *  1. Renders both groups with all labels and pipe separators.
 *  2. aria-pressed reflects the active sets.
 *  3. Clicking a button fires the matching toggle callback.
 *
 * The selection semantics themselves (additive age tiers, radio-style
 * single-select categories) live in dialFilterState and are exercised in
 * dialFilterState.test.ts.
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
    onToggleTier: vi.fn(),
    onToggleCategory: vi.fn(),
    ...overrides,
  };
  const utils = render(<DialFilterBar {...props} />);
  return { ...utils, props };
}

describe("DialFilterBar", () => {
  it("renders both menus with every label of the editorial taxonomy", () => {
    renderBar();
    for (const label of [
      "First", "Current", "Catalog", "Deep",
      "Ambient & Sleep", "Campus Radio", "Specialist Radio", "Anchor Stations",
      "Public & Community", "Independent DJ", "Discovery",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // Grouped for a11y: song-age group + station-category group.
    expect(screen.getByRole("group", { name: "Song age" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Station category" })).toBeTruthy();
  });

  it("marks the single active category with aria-pressed and the --on class", () => {
    renderBar({
      activeTiers: new Set<AgeTier>(["current", "deep"]),
      activeCategories: new Set<StationCategory>(["campus"]),
    });
    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("Current")).toBe("true");
    expect(pressed("Deep")).toBe("true");
    expect(pressed("First")).toBe("false");
    expect(pressed("Catalog")).toBe("false");
    expect(pressed("Campus Radio")).toBe("true");
    expect(pressed("Ambient & Sleep")).toBe("false");
    expect(pressed("Specialist Radio")).toBe("false");
    expect(pressed("Anchor Stations")).toBe("false");
    expect(pressed("Public & Community")).toBe("false");
    expect(pressed("Independent DJ")).toBe("false");
    expect(pressed("Discovery")).toBe("false");
    expect(screen.getByRole("button", { name: "Current" }).className).toContain("dial-filter-bar__btn--on");
    expect(screen.getByRole("button", { name: "Campus Radio" }).className).toContain("dial-filter-bar__btn--on");
    expect(screen.getByRole("button", { name: "Discovery" }).className).not.toContain("--on");
  });

  it("fires onToggleTier / onToggleCategory with the clicked value", () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Catalog" }));
    expect(props.onToggleTier).toHaveBeenCalledWith("catalog");
    fireEvent.click(screen.getByRole("button", { name: "Ambient & Sleep" }));
    expect(props.onToggleCategory).toHaveBeenCalledWith("ambient");
    fireEvent.click(screen.getByRole("button", { name: "Campus Radio" }));
    expect(props.onToggleCategory).toHaveBeenCalledWith("campus");
    fireEvent.click(screen.getByRole("button", { name: "Specialist Radio" }));
    expect(props.onToggleCategory).toHaveBeenCalledWith("specialist");
    fireEvent.click(screen.getByRole("button", { name: "Anchor Stations" }));
    expect(props.onToggleCategory).toHaveBeenCalledWith("anchor");
    fireEvent.click(screen.getByRole("button", { name: "Public & Community" }));
    expect(props.onToggleCategory).toHaveBeenCalledWith("public");
    fireEvent.click(screen.getByRole("button", { name: "Independent DJ" }));
    expect(props.onToggleCategory).toHaveBeenCalledWith("indie");
    fireEvent.click(screen.getByRole("button", { name: "Discovery" }));
    expect(props.onToggleCategory).toHaveBeenCalledWith("discovery");
  });
});
