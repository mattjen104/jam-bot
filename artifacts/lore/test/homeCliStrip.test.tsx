// @vitest-environment jsdom
/**
 * HomeCliStrip — the SplitHome CLI seam.
 *
 * Covers:
 *  1. Typing `/add …` in the strip's input calls onAddArtists with
 *     correctly split/trimmed artist names.
 *  2. Typing `/scan2` calls onScan(5) (CLI page-command compatibility).
 *  3. The compact scan remote renders numeric page selectors plus single
 *     `Scan` / `Scan all` controls that route to their callbacks, expose
 *     active/selected state accessibly, and become Stop controls while a
 *     scan is running.
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
    totalRows: 13,
    scanMode: null,
    onSelectPage: vi.fn(),
    onScanPage: vi.fn(),
    onScanAll: vi.fn(),
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

  it("renders numeric page selectors that fire onSelectPage and show the selected page", () => {
    const { props } = renderStrip({
      activeCategories: new Set<StationCategory>(["campus"]),
    });

    const page1 = screen.getByRole("button", { name: "page 1 /scan1" });
    const page2 = screen.getByRole("button", { name: "page 2 /scan2" });
    const page3 = screen.getByRole("button", { name: "page 3 /scan3" });

    // Compact numeric labels — no giant /scanN buttons.
    expect(page1.textContent).toBe("1");
    expect(page2.textContent).toBe("2");
    expect(page3.textContent).toBe("3");

    // scanOffset=0 → page 1 is selected.
    expect(page1.getAttribute("aria-pressed")).toBe("true");
    expect(page1.className).toContain("home-cli-strip__page-btn--active");
    expect(page2.getAttribute("aria-pressed")).toBe("false");
    expect(page3.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(page2);
    expect(props.onSelectPage).toHaveBeenCalledWith(5);
    fireEvent.click(page3);
    expect(props.onSelectPage).toHaveBeenCalledWith(10);
  });

  it("renders one Scan and one Scan all control that route to their callbacks", () => {
    const { props } = renderStrip();

    const scanBtn = screen.getByRole("button", { name: "scan this page" });
    const scanAllBtn = screen.getByRole("button", { name: "scan all stations" });
    expect(scanBtn.textContent).toBe("Scan");
    expect(scanAllBtn.textContent).toBe("Scan all");
    expect(scanBtn.getAttribute("aria-pressed")).toBe("false");
    expect(scanAllBtn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(scanBtn);
    expect(props.onScanPage).toHaveBeenCalledTimes(1);
    fireEvent.click(scanAllBtn);
    expect(props.onScanAll).toHaveBeenCalledTimes(1);
  });

  it("turns the Scan control into a Stop action while a page scan is active", () => {
    const { props } = renderStrip({ scanMode: "page" });

    const stopBtn = screen.getByRole("button", { name: "stop page scan" });
    expect(stopBtn.textContent).toBe("Stop");
    expect(stopBtn.getAttribute("aria-pressed")).toBe("true");
    expect(stopBtn.className).toContain("home-cli-strip__scan-btn--active");
    // The Scan-all control stays a start action.
    expect(screen.getByRole("button", { name: "scan all stations" }).textContent).toBe("Scan all");

    fireEvent.click(stopBtn);
    expect(props.onScanPage).toHaveBeenCalledTimes(1);
  });

  it("turns the Scan all control into a Stop action while an all-scan is active", () => {
    const { props } = renderStrip({ scanMode: "all" });

    const stopBtn = screen.getByRole("button", { name: "stop scan all" });
    expect(stopBtn.textContent).toBe("Stop");
    expect(stopBtn.getAttribute("aria-pressed")).toBe("true");
    // The page-scan control stays a start action.
    expect(screen.getByRole("button", { name: "scan this page" }).textContent).toBe("Scan");

    fireEvent.click(stopBtn);
    expect(props.onScanAll).toHaveBeenCalledTimes(1);
  });

  it("disables both scan actions when the filtered list is empty", () => {
    const { props } = renderStrip({ totalRows: 0, pageCount: 1 });

    const scanBtn = screen.getByRole("button", { name: "scan this page" }) as HTMLButtonElement;
    const scanAllBtn = screen.getByRole("button", { name: "scan all stations" }) as HTMLButtonElement;
    expect(scanBtn.disabled).toBe(true);
    expect(scanAllBtn.disabled).toBe(true);

    fireEvent.click(scanBtn);
    fireEvent.click(scanAllBtn);
    expect(props.onScanPage).not.toHaveBeenCalled();
    expect(props.onScanAll).not.toHaveBeenCalled();
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
    // Scan remote: pageCount numeric selectors (default 3) + Scan + Scan all.
    expect(scanRow.querySelectorAll("button")).toHaveLength(5);
    expect(ageRow.querySelectorAll("button")).toHaveLength(4);
    expect(categoryRow.querySelectorAll("button")).toHaveLength(7);

    const chips = [
      ...ageRow.querySelectorAll("button"),
      ...categoryRow.querySelectorAll("button"),
    ];
    // 4 age tiers + 7 station categories stay uniform chips; the scan remote
    // uses its own compact page-selector + scan-button styling.
    expect(chips.length).toBe(11);
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

  it("renders exactly pageCount numeric page selectors — no /scanN button per page", () => {
    renderStrip({ pageCount: 5, totalRows: 23 });
    const pageGroup = screen.getByRole("group", { name: "Page" });
    const buttons = [...pageGroup.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    // The old giant per-page command buttons are gone.
    expect(buttons.every((b) => !b.textContent?.startsWith("/scan"))).toBe(true);
  });

  it("renders a single page selector for a one-page filtered list", () => {
    renderStrip({ pageCount: 1, totalRows: 4 });
    const pageGroup = screen.getByRole("group", { name: "Page" });
    expect(pageGroup.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "page 1 /scan1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "page 2 /scan2" })).toBeNull();
    // Scan actions stay enabled — there are rows to scan.
    expect((screen.getByRole("button", { name: "scan this page" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("marks the selected page via aria-pressed regardless of page count", () => {
    renderStrip({ pageCount: 5, totalRows: 23, scanOffset: 15 });
    expect(screen.getByRole("button", { name: "page 4 /scan4" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "page 1 /scan1" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "page 5 /scan5" }).getAttribute("aria-pressed")).toBe("false");
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
