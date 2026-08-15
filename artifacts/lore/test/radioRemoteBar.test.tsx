// @vitest-environment jsdom
/**
 * RadioRemoteBar — the radio remote pinned to the top of SplitHome.
 *
 * Covers the controls that moved out of the middle CLI seam:
 *  1. `/crossings`, `/radio`, `/lore` feed-mode controls render in order and
 *     route their actions accessibly (/lore navigates home).
 *  2. The four age-tier chips render with active state and route toggles.
 *  3. The seven station-category chips render with active state and route
 *     toggles.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RadioRemoteBar } from "../src/components/RadioRemoteBar";
import type { StationCategory } from "../src/components/dial/DialFilterBar";
import type { AgeTier } from "../src/lib/dialAgeFilter";

const { mockSetLocation } = vi.hoisted(() => ({
  mockSetLocation: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", mockSetLocation],
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBar(overrides: Partial<React.ComponentProps<typeof RadioRemoteBar>> = {}) {
  const props: React.ComponentProps<typeof RadioRemoteBar> = {
    activeTiers: new Set<AgeTier>(),
    activeCategories: new Set<StationCategory>(["anchor"]),
    onToggleTier: vi.fn(),
    onToggleCategory: vi.fn(),
    onRadioMode: vi.fn(),
    ...overrides,
  };
  render(<RadioRemoteBar {...props} />);
  return { props };
}

describe("RadioRemoteBar", () => {
  it("renders the mode controls in command-line order: /crossings /radio /lore", () => {
    renderBar();
    const modeGroup = screen.getByRole("group", { name: "Feed mode commands" });
    expect(
      [...modeGroup.querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(["/crossings", "/radio", "/lore"]);
  });

  it.each([
    ["crossings /crossings", false],
    ["radio /radio", true],
  ] as const)("routes the %s shortcut to onRadioMode(%s)", (name, mode) => {
    const { props } = renderBar();
    const button = screen.getByRole("button", { name });
    fireEvent.click(button);
    expect(props.onRadioMode).toHaveBeenCalledWith(mode);
    expect(button.getAttribute("type")).toBe("button");
  });

  it("keeps the mode shortcuts keyboard-activatable as native buttons", () => {
    const { props } = renderBar();
    const button = screen.getByRole("button", { name: "radio /radio" });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    expect(props.onRadioMode).toHaveBeenCalledWith(true);
  });

  it("/lore navigates to the homepage", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "homepage /lore" }));
    expect(mockSetLocation).toHaveBeenCalledWith("/");
  });

  it("renders every age-tier chip, routes toggles, and exposes active state", () => {
    const { props } = renderBar({
      activeTiers: new Set<AgeTier>(["first"]),
    });

    const tiers = [
      ["/first", "first"],
      ["/current", "current"],
      ["/catalog", "catalog"],
      ["/deep", "deep"],
    ] as const;

    for (const [command, tier] of tiers) {
      const chip = screen.getByRole("button", { name: command });
      expect(chip.className).toContain("home-cli-strip__filter-chip");
      expect(chip.getAttribute("aria-pressed")).toBe(tier === "first" ? "true" : "false");
      fireEvent.click(chip);
      expect(props.onToggleTier).toHaveBeenCalledWith(tier);
    }
  });

  it("renders every category chip, routes toggles, and exposes active state", () => {
    const { props } = renderBar({
      activeCategories: new Set<StationCategory>(["campus"]),
    });

    const categories = [
      ["/ambient", "ambient"],
      ["/campus", "campus"],
      ["/specialist", "specialist"],
      ["/anchor", "anchor"],
      ["/public", "public"],
      ["/indie", "indie"],
      ["/discovery", "discovery"],
    ] as const;

    for (const [command, cat] of categories) {
      const chip = screen.getByRole("button", { name: command });
      expect(chip.className).toContain("home-cli-strip__filter-chip");
      expect(chip.getAttribute("aria-pressed")).toBe(
        cat === "campus" ? "true" : "false",
      );
      fireEvent.click(chip);
      expect(props.onToggleCategory).toHaveBeenCalledWith(cat);
    }
  });

  it("groups the remote as mode → age → category in one bar", () => {
    renderBar();
    const bar = screen.getByRole("toolbar", { name: "Radio remote" });
    const modeGroup = screen.getByRole("group", { name: "Feed mode commands" });
    const ageRow = screen.getByRole("group", { name: "Age commands" });
    const categoryRow = screen.getByRole("group", { name: "Station category commands" });

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(modeGroup.compareDocumentPosition(ageRow) & FOLLOWING).toBeTruthy();
    expect(ageRow.compareDocumentPosition(categoryRow) & FOLLOWING).toBeTruthy();

    expect(bar.contains(modeGroup)).toBe(true);
    expect(bar.contains(ageRow)).toBe(true);
    expect(bar.contains(categoryRow)).toBe(true);
    expect(ageRow.querySelectorAll("button")).toHaveLength(4);
    expect(categoryRow.querySelectorAll("button")).toHaveLength(7);
  });
});
