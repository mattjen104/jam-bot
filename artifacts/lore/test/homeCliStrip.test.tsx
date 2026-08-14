// @vitest-environment jsdom
/**
 * HomeCliStrip — the SplitHome CLI seam.
 *
 * Covers:
 *  1. Typing `/add …` in the strip's input calls onAddArtists with
 *     correctly split/trimmed artist names.
 *  2. Typing `/scan2` calls onScan(5).
 *  3. The unified filter rail renders scan, age-tier, and category chips in
 *     one row, all as uniform chips that route to their callbacks and expose
 *     active state accessibly (aria-pressed).
 *  4. The "add artists /add" button focuses the input and inserts the
 *     `/add ` prefix.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { HomeCliStrip } from "../src/components/HomeCliStrip";
import type { StationCategory } from "../src/components/dial/DialFilterBar";
import type { AgeTier } from "../src/lib/dialAgeFilter";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderStrip(overrides: Partial<React.ComponentProps<typeof HomeCliStrip>> = {}) {
  const props: React.ComponentProps<typeof HomeCliStrip> = {
    activeTiers: new Set<AgeTier>(),
    activeCategories: new Set<StationCategory>(["lore"]),
    onToggleTier: vi.fn(),
    onToggleCategory: vi.fn(),
    scanOffset: 0,
    onScan: vi.fn(),
    onAddArtists: vi.fn(),
    ...overrides,
  };
  const utils = render(<HomeCliStrip {...props} />);
  const input = screen.getByRole("textbox", { name: "Dial command" }) as HTMLInputElement;
  return { ...utils, props, input };
}

describe("HomeCliStrip", () => {
  it("/add splits and trims artist names into onAddArtists", () => {
    const { props, input } = renderStrip();
    fireEvent.change(input, { target: { value: "/add Radiohead,  Portishead " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onAddArtists).toHaveBeenCalledWith(["Radiohead", "Portishead"]);
    expect(input.value).toBe("");
  });

  it("/scan2 calls onScan(5)", () => {
    const { props, input } = renderStrip();
    fireEvent.change(input, { target: { value: "/scan2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onScan).toHaveBeenCalledWith(5);
  });

  it("routes /matt through the mobile strip and clears after form submission", () => {
    const onMatt = vi.fn();
    const { input, props } = renderStrip({ onMatt });
    fireEvent.change(input, { target: { value: "/matt" } });
    fireEvent.submit(input.form as HTMLFormElement);
    expect(onMatt).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
    expect(props.onAddArtists).not.toHaveBeenCalled();
  });

  it("forwards pending Matt status and blocks duplicate submissions", () => {
    const onMatt = vi.fn();
    renderStrip({
      onMatt,
      mattPending: true,
      mattStatus: { kind: "pending", message: "Adding Matt’s starter library…" },
    });
    const input = screen.getByRole("textbox", { name: "Dial command" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/matt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onMatt).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Adding Matt’s starter library");
  });

  it("renders scan chips in the unified rail that fire onScan and show the active window", () => {
    const { props } = renderStrip();

    const scan1 = screen.getByRole("button", { name: "scan 1 /scan1" });
    const scan2 = screen.getByRole("button", { name: "scan 2 /scan2" });
    const scan3 = screen.getByRole("button", { name: "scan 3 /scan3" });

    // scanOffset=0 → /scan1 is the active window.
    expect(scan1.getAttribute("aria-pressed")).toBe("true");
    expect(scan1.className).toContain("home-cli-strip__filter-chip--active");
    expect(scan2.getAttribute("aria-pressed")).toBe("false");
    expect(scan3.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(scan2);
    expect(props.onScan).toHaveBeenCalledWith(5);
    fireEvent.click(scan3);
    expect(props.onScan).toHaveBeenCalledWith(10);
  });

  it("renders every age-tier chip, routes toggles, and exposes active state", () => {
    const { props } = renderStrip({ activeTiers: new Set<AgeTier>(["first"]) });

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
    const { props } = renderStrip({
      activeCategories: new Set<StationCategory>(["lore", "college"]),
    });

    const categories = [
      ["/lore", "lore"],
      ["/classics", "classics"],
      ["/ambient", "ambient"],
      ["/spinitron", "spinitron"],
      ["/college", "college"],
      ["/longtail", "longtail"],
    ] as const;

    for (const [command, cat] of categories) {
      const chip = screen.getByRole("button", { name: command });
      expect(chip.className).toContain("home-cli-strip__filter-chip");
      expect(chip.getAttribute("aria-pressed")).toBe(
        cat === "lore" || cat === "college" ? "true" : "false",
      );
      fireEvent.click(chip);
      expect(props.onToggleCategory).toHaveBeenCalledWith(cat);
    }
  });

  it("all filter chips share the same rail and uniform chip class", () => {
    renderStrip();
    const row = screen.getByRole("group", { name: "Filter commands" });
    const chips = Array.from(row.querySelectorAll("button"));
    // 3 scans + 4 age tiers + 6 categories
    expect(chips.length).toBe(13);
    for (const chip of chips) {
      expect(chip.className).toContain("home-cli-strip__filter-chip");
    }
  });

  it("add-artists button focuses the input and inserts the /add prefix", () => {
    const { input } = renderStrip();
    const addBtn = screen.getByRole("button", { name: "add artists /add" });
    fireEvent.click(addBtn);
    expect(input.value).toBe("/add ");
    expect(document.activeElement).toBe(input);
  });

  it("renders the /lore homepage control beside the command field", () => {
    renderStrip();
    expect(screen.getByRole("button", { name: "homepage /lore" })).toBeTruthy();
    expect(screen.getByText(">_")).toBeTruthy();
  });
});
