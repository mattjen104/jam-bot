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
 *  4. The `/crossings`, `/radio`, and `/lore` command controls stay in order
 *     and route their actions accessibly.
 *  5. The "add artists /add" button focuses the input and inserts the
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
    activeCategories: new Set<StationCategory>(["anchor"]),
    onToggleTier: vi.fn(),
    onToggleCategory: vi.fn(),
    scanOffset: 0,
    pageCount: 3,
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
    const { props } = renderStrip({
      activeCategories: new Set<StationCategory>(["campus"]),
    });

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
    const { props } = renderStrip({
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
    const { props } = renderStrip({
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

  it("renders the filter remote as three centered button rows", () => {
    renderStrip();
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    const ageRow = screen.getByRole("group", { name: "Age commands" });
    const categoryRow = screen.getByRole("group", { name: "Station category commands" });
    // Scan button count is dynamic — driven by the pageCount prop (default 3).
    expect(scanRow.querySelectorAll("button")).toHaveLength(3);
    expect(ageRow.querySelectorAll("button")).toHaveLength(4);
    expect(categoryRow.querySelectorAll("button")).toHaveLength(7);

    const chips = [
      ...scanRow.querySelectorAll("button"),
      ...ageRow.querySelectorAll("button"),
      ...categoryRow.querySelectorAll("button"),
    ];
    // 3 scans + 4 age tiers + 7 station categories; /lore is the home button.
    expect(chips.length).toBe(14);
    for (const chip of chips) {
      expect(chip.className).toContain("home-cli-strip__filter-chip");
    }
  });

  it("orders the filter stack scan → age → category, with the command row last", () => {
    renderStrip();
    const strip = document.querySelector(".home-cli-strip")!;
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    const ageRow = screen.getByRole("group", { name: "Age commands" });
    const categoryRow = screen.getByRole("group", { name: "Station category commands" });
    const commandRow = document.querySelector(".home-cli-strip__command-row")!;
    const addRow = document.querySelector(".home-cli-strip__row--stack")!;

    // DOM order via compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING
    // means the argument node comes after the receiver.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(scanRow.compareDocumentPosition(ageRow) & FOLLOWING).toBeTruthy();
    expect(ageRow.compareDocumentPosition(categoryRow) & FOLLOWING).toBeTruthy();
    expect(categoryRow.compareDocumentPosition(commandRow) & FOLLOWING).toBeTruthy();
    expect(commandRow.compareDocumentPosition(addRow) & FOLLOWING).toBeTruthy();

    // All three filter groups live inside the same filter-stack element;
    // the command row is outside it.
    const filterStack = strip.querySelector(".home-cli-strip__filter-stack")!;
    expect(filterStack.contains(scanRow)).toBe(true);
    expect(filterStack.contains(ageRow)).toBe(true);
    expect(filterStack.contains(categoryRow)).toBe(true);
    expect(filterStack.contains(commandRow)).toBe(false);
  });

  it("renders exactly pageCount scan buttons with /scan1…/scanN commands", () => {
    renderStrip({ pageCount: 5 });
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    const buttons = [...scanRow.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "/scan1", "/scan2", "/scan3", "/scan4", "/scan5",
    ]);
  });

  it("renders a single scan button for a one-page filtered list", () => {
    renderStrip({ pageCount: 1 });
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    expect(scanRow.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "scan 1 /scan1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "scan 2 /scan2" })).toBeNull();
  });

  it("marks the active scan window via aria-pressed regardless of page count", () => {
    renderStrip({ pageCount: 5, scanOffset: 15 });
    expect(screen.getByRole("button", { name: "scan 4 /scan4" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "scan 1 /scan1" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "scan 5 /scan5" }).getAttribute("aria-pressed")).toBe("false");
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

  it("renders mode controls before /lore in command-line order", () => {
    renderStrip({ onRadioMode: vi.fn() });
    const commandRow = document.querySelector(".home-cli-strip__command-row");
    expect(commandRow).toBeTruthy();
    expect(
      [...commandRow!.querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(["/crossings", "/radio", "/lore"]);
  });

  it.each([
    ["crossings /crossings", false],
    ["radio /radio", true],
  ] as const)("routes the %s shortcut to onRadioMode(%s)", (name, mode) => {
    const onRadioMode = vi.fn();
    renderStrip({ onRadioMode });
    const button = screen.getByRole("button", { name });
    fireEvent.click(button);
    expect(onRadioMode).toHaveBeenCalledWith(mode);
    expect(button.getAttribute("type")).toBe("button");
  });

  it("keeps the mode shortcuts keyboard-activatable as native buttons", () => {
    const onRadioMode = vi.fn();
    renderStrip({ onRadioMode });
    const button = screen.getByRole("button", { name: "radio /radio" });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    expect(onRadioMode).toHaveBeenCalledWith(true);
  });
});
