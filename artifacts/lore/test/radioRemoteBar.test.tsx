// @vitest-environment jsdom
/**
 * RadioRemoteBar — the radio remote pinned to the top of SplitHome.
 *
 * Covers the controls that moved out of the middle CLI seam:
 *  1. Three filter dropdowns — Crossings, Track age, Station type — each a
 *     trigger button opening a panel of labeled checkboxes.
 *  2. The Crossings checkbox reflects the feed mode (checked = crossings,
 *     unchecked = radio) and routes flips to onRadioMode.
 *  3. Age-tier and station-category checkboxes reflect the active sets and
 *     route toggles.
 *  4. `/lore` is navigation-only (no pressed state) and routes home.
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

function openMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
}

describe("RadioRemoteBar", () => {
  it("renders the three dropdown triggers plus the /lore nav button", () => {
    renderBar();
    const bar = screen.getByRole("toolbar", { name: "Radio remote" });
    for (const name of ["Crossings", "Track age", "Station type"]) {
      const trigger = screen.getByRole("button", { name: new RegExp(`^${name}`) });
      expect(trigger.getAttribute("aria-haspopup")).toBe("true");
      expect(trigger.className).toContain("home-cli-strip__filter-chip");
      expect(bar.contains(trigger)).toBe(true);
    }
    expect(bar.contains(screen.getByRole("button", { name: "homepage /lore" }))).toBe(true);
  });

  it("the Crossings checkbox defaults to checked (crossings is the default mode)", () => {
    renderBar();
    openMenu("Crossings");
    const box = screen.getByRole("checkbox", { name: /Crossings on/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it("the Crossings checkbox is unchecked when radioMode is on", () => {
    renderBar({ radioMode: true });
    openMenu("Crossings");
    expect((screen.getByRole("checkbox", { name: /Crossings on/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("unchecking Crossings switches to radio mode (onRadioMode(true))", () => {
    const { props } = renderBar({ radioMode: false });
    openMenu("Crossings");
    fireEvent.click(screen.getByRole("checkbox", { name: /Crossings on/ }));
    expect(props.onRadioMode).toHaveBeenCalledWith(true);
  });

  it("checking Crossings in radio mode switches back (onRadioMode(false))", () => {
    const { props } = renderBar({ radioMode: true });
    openMenu("Crossings");
    fireEvent.click(screen.getByRole("checkbox", { name: /Crossings on/ }));
    expect(props.onRadioMode).toHaveBeenCalledWith(false);
  });

  it("/lore carries no pressed state — it is navigation, not a toggle", () => {
    renderBar();
    const loreBtn = screen.getByRole("button", { name: "homepage /lore" });
    expect(loreBtn.getAttribute("aria-pressed")).toBeNull();
    expect(loreBtn.className).toContain("home-cli-strip__home-btn--nav");
  });

  it("/lore navigates to the homepage", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "homepage /lore" }));
    expect(mockSetLocation).toHaveBeenCalledWith("/");
  });

  it("renders every age-tier checkbox and routes toggles", () => {
    const { props } = renderBar({
      activeTiers: new Set<AgeTier>(["first"]),
    });
    openMenu("Track age");

    const tiers = [
      [/First/, "first"],
      [/Current/, "current"],
      [/Catalog/, "catalog"],
      [/Deep/, "deep"],
    ] as const;

    for (const [name, tier] of tiers) {
      const box = screen.getByRole("checkbox", { name }) as HTMLInputElement;
      expect(box.checked).toBe(tier === "first");
      fireEvent.click(box);
      expect(props.onToggleTier).toHaveBeenCalledWith(tier);
    }
  });

  it("renders every category checkbox, additively checked, and routes toggles", () => {
    const { props } = renderBar({
      activeCategories: new Set<StationCategory>(["campus", "indie"]),
    });
    openMenu("Station type");

    const categories = [
      [/Ambient & Sleep/, "ambient", false],
      [/Campus Radio/, "campus", true],
      [/Specialist Radio/, "specialist", false],
      [/Anchor Stations/, "anchor", false],
      [/Public & Community/, "public", false],
      [/Independent DJ/, "indie", true],
      [/Discovery/, "discovery", false],
    ] as const;

    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
    for (const [name, cat, isChecked] of categories) {
      const box = screen.getByRole("checkbox", { name }) as HTMLInputElement;
      expect(box.checked).toBe(isChecked);
      fireEvent.click(box);
      expect(props.onToggleCategory).toHaveBeenCalledWith(cat);
    }
  });

  it("shows active-count badges on families with checked options", () => {
    renderBar({
      activeTiers: new Set<AgeTier>(["first", "deep"]),
      activeCategories: new Set<StationCategory>(["campus"]),
    });
    expect(screen.getByRole("button", { name: /^Track age/ }).textContent).toContain("· 2");
    expect(screen.getByRole("button", { name: /^Station type/ }).textContent).toContain("· 1");
  });
});
