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
 *  4. The "add artists /add" button focuses the input and inserts the
 *     `/add ` prefix.
 *
 * The feed-mode buttons (/crossings /radio /lore) and the age/category
 * filter chips moved to the RadioRemoteBar — see radioRemoteBar.test.tsx.
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
    totalActiveCount: 13,
    density: "normal",
    onCycleDensity: vi.fn(),
    ...overrides,
  };
  const utils = render(<HomeCliStrip {...props} />);
  const input = screen.getByRole("textbox", { name: "Dial command" }) as HTMLInputElement;
  const openAdvancedControls = () => {
    fireEvent.click(screen.getByRole("button", { name: /Show more scan controls/ }));
  };
  return { ...utils, props, input, openAdvancedControls };
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

  it("/scan2 calls onScan(10) in compact density — page math follows the density page size", () => {
    const { props, input } = renderStrip({ density: "compact" });
    fireEvent.change(input, { target: { value: "/scan2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onScan).toHaveBeenCalledWith(10);
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
    const { props, openAdvancedControls } = renderStrip();
    openAdvancedControls();

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
    const { props, openAdvancedControls } = renderStrip();
    openAdvancedControls();

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
    const { props, openAdvancedControls } = renderStrip({ scanMode: "page" });
    openAdvancedControls();

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
    const { props, openAdvancedControls } = renderStrip({ scanMode: "all" });
    openAdvancedControls();

    const stopBtn = screen.getByRole("button", { name: "stop scan all" });
    expect(stopBtn.textContent).toBe("Stop");
    expect(stopBtn.getAttribute("aria-pressed")).toBe("true");
    // The page-scan control stays a start action.
    expect(screen.getByRole("button", { name: "scan this page" }).textContent).toBe("Scan");

    fireEvent.click(stopBtn);
    expect(props.onScanAll).toHaveBeenCalledTimes(1);
  });

  it("disables both scan actions when the filtered list is empty", () => {
    const { props, openAdvancedControls } = renderStrip({ totalRows: 0, pageCount: 1 });
    openAdvancedControls();

    const scanBtn = screen.getByRole("button", { name: "scan this page" }) as HTMLButtonElement;
    const scanAllBtn = screen.getByRole("button", { name: "scan all stations" }) as HTMLButtonElement;
    expect(scanBtn.disabled).toBe(true);
    expect(scanAllBtn.disabled).toBe(true);

    fireEvent.click(scanBtn);
    fireEvent.click(scanAllBtn);
    expect(props.onScanPage).not.toHaveBeenCalled();
    expect(props.onScanAll).not.toHaveBeenCalled();
  });

  it("keeps the seam to scan remote → command row → add row, with the filters moved out", () => {
    renderStrip();
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    const commandRow = document.querySelector(".home-cli-strip__command-row")!;
    const addRow = document.querySelector(".home-cli-strip__row--stack")!;

    // DOM order via compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING
    // means the argument node comes after the receiver.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(scanRow.compareDocumentPosition(commandRow) & FOLLOWING).toBeTruthy();
    expect(commandRow.compareDocumentPosition(addRow) & FOLLOWING).toBeTruthy();

    // The primary rail is the station count + Scan + one disclosure control.
    expect(scanRow.querySelectorAll("button")).toHaveLength(2);
    expect(screen.queryByRole("group", { name: "More scan controls" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show more scan controls/ }));
    expect(screen.getByRole("group", { name: "More scan controls" })).toBeVisible();
    // The advanced group retains the density key, page selectors, and Scan all.
    expect(screen.getByRole("group", { name: "More scan controls" }).querySelectorAll("button")).toHaveLength(5);
    // The age/category chip groups and the feed-mode buttons live in the
    // RadioRemoteBar now — not in the seam.
    expect(screen.queryByRole("group", { name: "Age commands" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Station category commands" })).toBeNull();
    expect(screen.queryByRole("button", { name: "radio /radio" })).toBeNull();
    expect(screen.queryByRole("button", { name: "crossings /crossings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "homepage /lore" })).toBeNull();
  });

  it("renders exactly pageCount numeric page selectors — no /scanN button per page", () => {
    const { openAdvancedControls } = renderStrip({ pageCount: 5, totalRows: 23 });
    openAdvancedControls();
    const pageGroup = screen.getByRole("group", { name: "Page" });
    const buttons = [...pageGroup.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    // The old giant per-page command buttons are gone.
    expect(buttons.every((b) => !b.textContent?.startsWith("/scan"))).toBe(true);
  });

  it("renders a single page selector for a one-page filtered list", () => {
    const { openAdvancedControls } = renderStrip({ pageCount: 1, totalRows: 4 });
    openAdvancedControls();
    const pageGroup = screen.getByRole("group", { name: "Page" });
    expect(pageGroup.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "page 1 /scan1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "page 2 /scan2" })).toBeNull();
    // Scan actions stay enabled — there are rows to scan.
    expect((screen.getByRole("button", { name: "scan this page" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("marks the selected page via aria-pressed regardless of page count", () => {
    const { openAdvancedControls } = renderStrip({ pageCount: 5, totalRows: 23, scanOffset: 15 });
    openAdvancedControls();
    expect(screen.getByRole("button", { name: "page 4 /scan4" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "page 1 /scan1" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "page 5 /scan5" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("always shows the total active station count on the scan remote", () => {
    renderStrip({ totalActiveCount: 13 });
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    expect(scanRow.textContent).toContain("13 stations");
  });

  it("uses the singular form for a single active station", () => {
    renderStrip({ totalActiveCount: 1, pageCount: 1, totalRows: 1 });
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    expect(scanRow.textContent).toContain("1 station");
    expect(scanRow.textContent).not.toContain("1 stations");
  });

  it("renders a density cycle key that shows the current page size and fires onCycleDensity", () => {
    const { props, openAdvancedControls } = renderStrip({ density: "normal" });
    openAdvancedControls();
    const densityBtn = screen.getByRole("button", { name: "density 5 rows — switch to 10" });
    expect(densityBtn.textContent).toBe("5");

    fireEvent.click(densityBtn);
    expect(props.onCycleDensity).toHaveBeenCalledTimes(1);
  });

  it("labels the density key for each mode in the cycle", () => {
    const { unmount, openAdvancedControls } = renderStrip({ density: "compact" });
    openAdvancedControls();
    expect(screen.getByRole("button", { name: "density 10 rows — switch to 15" }).textContent).toBe("10");
    unmount();

    const second = renderStrip({ density: "micro" });
    second.openAdvancedControls();
    expect(screen.getByRole("button", { name: "density 15 rows — switch to 5" }).textContent).toBe("15");
  });

  it("pages by 10-row offsets in compact density", () => {
    const { props, openAdvancedControls } = renderStrip({ density: "compact", pageCount: 2, totalRows: 13, totalActiveCount: 13 });
    openAdvancedControls();
    fireEvent.click(screen.getByRole("button", { name: "page 2 /scan2" }));
    expect(props.onSelectPage).toHaveBeenCalledWith(10);
  });

  it("marks the current page from the scan offset at the density's page size", () => {
    const { openAdvancedControls } = renderStrip({ density: "compact", pageCount: 2, totalRows: 13, totalActiveCount: 13, scanOffset: 10 });
    openAdvancedControls();
    expect(screen.getByRole("button", { name: "page 2 /scan2" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "page 1 /scan1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("pages by 15-key offsets in micro density", () => {
    const { props, openAdvancedControls } = renderStrip({ density: "micro", pageCount: 2, totalRows: 20, totalActiveCount: 20 });
    openAdvancedControls();
    fireEvent.click(screen.getByRole("button", { name: "page 2 /scan2" }));
    expect(props.onSelectPage).toHaveBeenCalledWith(15);
    // Scan controls and the count survive alongside the page selectors.
    screen.getByRole("button", { name: "scan this page" });
    screen.getByRole("button", { name: "scan all stations" });
    expect(screen.getByRole("group", { name: "Scan commands" }).textContent).toContain("20 stations");
  });

  it("add-artists button focuses the input and inserts the /add prefix", () => {
    const { input } = renderStrip();
    const addBtn = screen.getByRole("button", { name: "add artists /add" });
    fireEvent.click(addBtn);
    expect(input.value).toBe("/add ");
    expect(document.activeElement).toBe(input);
  });

  it("renders the command prompt wordmark beside the command field", () => {
    renderStrip();
    expect(screen.getByText(">_")).toBeTruthy();
  });
});
