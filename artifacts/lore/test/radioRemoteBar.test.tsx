// @vitest-environment jsdom
/**
 * RadioRemoteBar — the radio remote pinned to the top of SplitHome.
 *
 * Covers the controls that moved out of the middle CLI seam:
 *  1. The Crossings dropdown — a single "Crossings on" checkbox reflecting
 *     the feed mode (checked = crossings, unchecked = radio) and routing
 *     flips to onRadioMode. The Track age / Station type filter menus now
 *     live in DialFilterBar on /feed; they are covered by
 *     dialFilterBar.test.tsx and splitHomeAgeFilter.test.tsx.
 *  2. `/lore` is navigation-only (no pressed state) and routes home.
 *  3. Find stations is an optional action rendered only when the host wires
 *     onFindStations.
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
  it("renders the Crossings dropdown trigger plus the /lore nav button", () => {
    renderBar();
    const bar = screen.getByRole("toolbar", { name: "Radio remote" });
    const trigger = screen.getByRole("button", { name: /^Crossings/ });
    expect(trigger.getAttribute("aria-haspopup")).toBe("true");
    expect(trigger.className).toContain("home-cli-strip__filter-chip");
    expect(bar.contains(trigger)).toBe(true);
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

  it("renders no Find stations button when the host does not wire it", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: "Find stations" })).toBeNull();
  });

  it("Find stations is an action (no pressed state) and routes clicks", () => {
    const onFindStations = vi.fn();
    renderBar({ onFindStations });
    const btn = screen.getByRole("button", { name: "Find stations" });
    expect(btn.getAttribute("aria-pressed")).toBeNull();
    fireEvent.click(btn);
    expect(onFindStations).toHaveBeenCalledTimes(1);
  });

  // Track age / Station type menus moved to DialFilterBar on /feed — their
  // checkbox/badge behaviour is covered by dialFilterBar.test.tsx and
  // splitHomeAgeFilter.test.tsx.
});
