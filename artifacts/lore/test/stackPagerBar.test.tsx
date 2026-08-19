// @vitest-environment jsdom
/**
 * StackPagerBar — the pinned stack-paging footer of SplitHome.
 *
 * Covers:
 *  1. Page buttons render proportional to the library size (one numeric
 *     selector per stack page) with the same styling hooks as the Dial's
 *     page buttons.
 *  2. The active page is exposed via aria-pressed; clicks route offsets.
 *  2b. Page buttons stay numeric while each window's first album title is
 *     retained in the aria-label and tooltip.
 *  3. Shuffle / Shuffle all route their callbacks, expose active state, and
 *     become Stop controls while a shuffle runs; both disable on an empty
 *     library.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { StackPagerBar } from "../src/components/StackPagerBar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPager(overrides: Partial<React.ComponentProps<typeof StackPagerBar>> = {}) {
  const props: React.ComponentProps<typeof StackPagerBar> = {
    stackOffset: 0,
    stackPageCount: 4,
    totalGroups: 18,
    stackDensity: "normal",
    onCycleStackDensity: vi.fn(),
    shuffleMode: null,
    onSelectStackPage: vi.fn(),
    onShufflePage: vi.fn(),
    onShuffleAll: vi.fn(),
    ...overrides,
  };
  const utils = render(<StackPagerBar {...props} />);
  return { props, ...utils };
}

describe("StackPagerBar", () => {
  it("renders page buttons proportional to the library size", () => {
    renderPager({ stackPageCount: 4, totalGroups: 18 });
    const pageGroup = screen.getByRole("group", { name: "Stack page" });
    const buttons = [...pageGroup.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["1", "2", "3", "4"]);
    // Same visual style hooks as the Dial page buttons.
    for (const button of buttons) {
      expect(button.className).toContain("home-cli-strip__page-btn");
    }
  });

  it("renders a single page selector for a one-page library", () => {
    renderPager({ stackPageCount: 1, totalGroups: 3 });
    const pageGroup = screen.getByRole("group", { name: "Stack page" });
    expect(pageGroup.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "stack page 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "stack page 2" })).toBeNull();
  });

  it("keeps page buttons numeric while exposing the first album in context", () => {
    const { props } = renderPager({
      stackPageCount: 4,
      totalGroups: 18,
      pageLabels: ["Rumours", "Blue Lines", null, "Third"],
    });

    // Visible text is always the page number; album context is not used as the
    // selector label because it makes the pager look like an artist/album list.
    const pageGroup = screen.getByRole("group", { name: "Stack page" });
    const buttons = [...pageGroup.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["1", "2", "3", "4"]);

    // Accessible labels keep the page number and add the window's album
    // count ("+N more"); the last page's short window counts down.
    screen.getByRole("button", { name: "stack page 1: Rumours, +4 more" });
    screen.getByRole("button", { name: "stack page 2: Blue Lines, +4 more" });
    screen.getByRole("button", { name: "stack page 3" });
    screen.getByRole("button", { name: "stack page 4: Third, +2 more" });

    // Clicks still route offsets by page index.
    fireEvent.click(screen.getByRole("button", { name: "stack page 4: Third, +2 more" }));
    expect(props.onSelectStackPage).toHaveBeenCalledWith(15);
  });

  it("labels a single-album page without a '+N more' count", () => {
    renderPager({ stackPageCount: 1, totalGroups: 1, pageLabels: ["Rumours"] });
    screen.getByRole("button", { name: "stack page 1: Rumours" });
  });

  it("marks the current page via aria-pressed and routes clicks as offsets", () => {
    const { props } = renderPager({ stackOffset: 5, stackPageCount: 4 });
    expect(screen.getByRole("button", { name: "stack page 2" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "stack page 1" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "stack page 3" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "stack page 3" }));
    expect(props.onSelectStackPage).toHaveBeenCalledWith(10);
    fireEvent.click(screen.getByRole("button", { name: "stack page 1" }));
    expect(props.onSelectStackPage).toHaveBeenCalledWith(0);
  });

  it("wraps the controls in a horizontally scrollable rail so later pages stay reachable", () => {
    // A big library yields many page buttons; the rail (overflow-x: auto,
    // same pattern as the CLI seam's filter rows) keeps them scrollable
    // instead of overflowing the viewport on narrow screens.
    renderPager({ stackPageCount: 40, totalGroups: 200 });
    const rail = document.querySelector(".stack-pager-bar .home-cli-strip__filter-rail");
    expect(rail).toBeTruthy();
    expect(rail!.contains(screen.getByRole("group", { name: "Stack page" }))).toBe(true);
    expect(rail!.contains(screen.getByRole("button", { name: "shuffle all albums" }))).toBe(true);
    // All 40 page selectors render inside the scrollable rail.
    expect(screen.getByRole("button", { name: "stack page 40" })).toBeTruthy();
  });

  it("renders Shuffle and Shuffle all controls that route to their callbacks", () => {
    const { props } = renderPager();

    const shuffleBtn = screen.getByRole("button", { name: "shuffle this page" });
    const shuffleAllBtn = screen.getByRole("button", { name: "shuffle all albums" });
    expect(shuffleBtn.textContent).toBe("Shuffle");
    expect(shuffleAllBtn.textContent).toBe("Shuffle all");
    expect(shuffleBtn.getAttribute("aria-pressed")).toBe("false");
    expect(shuffleAllBtn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(shuffleBtn);
    expect(props.onShufflePage).toHaveBeenCalledTimes(1);
    fireEvent.click(shuffleAllBtn);
    expect(props.onShuffleAll).toHaveBeenCalledTimes(1);
  });

  it("turns the Shuffle control into a Stop action while a page shuffle is active", () => {
    const { props } = renderPager({ shuffleMode: "page" });

    const stopBtn = screen.getByRole("button", { name: "stop shuffle" });
    expect(stopBtn.textContent).toBe("Stop");
    expect(stopBtn.getAttribute("aria-pressed")).toBe("true");
    expect(stopBtn.className).toContain("home-cli-strip__scan-btn--active");
    // The Shuffle-all control stays a start action.
    expect(screen.getByRole("button", { name: "shuffle all albums" }).textContent).toBe("Shuffle all");

    fireEvent.click(stopBtn);
    expect(props.onShufflePage).toHaveBeenCalledTimes(1);
  });

  it("turns the Shuffle all control into a Stop action while a library shuffle is active", () => {
    const { props } = renderPager({ shuffleMode: "all" });

    const stopBtn = screen.getByRole("button", { name: "stop shuffle all" });
    expect(stopBtn.textContent).toBe("Stop");
    expect(stopBtn.getAttribute("aria-pressed")).toBe("true");
    // The page-shuffle control stays a start action.
    expect(screen.getByRole("button", { name: "shuffle this page" }).textContent).toBe("Shuffle");

    fireEvent.click(stopBtn);
    expect(props.onShuffleAll).toHaveBeenCalledTimes(1);
  });

  it("disables both shuffle actions when the library is empty", () => {
    const { props } = renderPager({ totalGroups: 0, stackPageCount: 1 });

    const shuffleBtn = screen.getByRole("button", { name: "shuffle this page" }) as HTMLButtonElement;
    const shuffleAllBtn = screen.getByRole("button", { name: "shuffle all albums" }) as HTMLButtonElement;
    expect(shuffleBtn.disabled).toBe(true);
    expect(shuffleAllBtn.disabled).toBe(true);

    fireEvent.click(shuffleBtn);
    fireEvent.click(shuffleAllBtn);
    expect(props.onShufflePage).not.toHaveBeenCalled();
    expect(props.onShuffleAll).not.toHaveBeenCalled();
  });

  it("shows the live album count next to the density key", () => {
    renderPager({ totalGroups: 42, stackPageCount: 9 });
    expect(screen.getByText("42 albums")).toBeTruthy();
    // Singular form for a one-album library.
    cleanup();
    renderPager({ totalGroups: 1, stackPageCount: 1 });
    expect(screen.getByText("1 album")).toBeTruthy();
  });

  it("renders the density cycle key with the current and next row counts", () => {
    renderPager({ stackDensity: "normal" });
    const key = screen.getByRole("button", { name: "density 5 rows — switch to 10" });
    expect(key.textContent).toBe("5");
    expect(key.className).toContain("home-cli-strip__density-btn");
  });

  it("clicking the density key routes to the cycle callback at every step", () => {
    // The component is controlled: the parent owns the density state and
    // re-renders with the next value, so each click must fire the callback.
    const { props, rerender } = renderPager({ stackDensity: "normal" });
    fireEvent.click(screen.getByRole("button", { name: "density 5 rows — switch to 10" }));
    expect(props.onCycleStackDensity).toHaveBeenCalledTimes(1);

    rerender(<StackPagerBar {...props} stackDensity="compact" />);
    const compactKey = screen.getByRole("button", { name: "density 10 rows — switch to 15" });
    expect(compactKey.textContent).toBe("10");
    fireEvent.click(compactKey);
    expect(props.onCycleStackDensity).toHaveBeenCalledTimes(2);

    rerender(<StackPagerBar {...props} stackDensity="micro" />);
    const microKey = screen.getByRole("button", { name: "density 15 rows — switch to 5" });
    expect(microKey.textContent).toBe("15");
    fireEvent.click(microKey);
    expect(props.onCycleStackDensity).toHaveBeenCalledTimes(3);
  });

  it("scales the page selectors with the density: 42 albums → 9 / 5 / 3 pages", () => {
    // 42 albums at density 5 / 10 / 15 rows per page.
    const { props, rerender } = renderPager({
      totalGroups: 42,
      stackPageCount: 9,
      stackDensity: "normal",
    });
    const pageGroup = () => screen.getByRole("group", { name: "Stack page" });
    expect(pageGroup().querySelectorAll("button")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "stack page 9" })).toBeTruthy();

    rerender(<StackPagerBar {...props} stackDensity="compact" stackPageCount={5} />);
    expect(pageGroup().querySelectorAll("button")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "stack page 6" })).toBeNull();

    rerender(<StackPagerBar {...props} stackDensity="micro" stackPageCount={3} />);
    expect(pageGroup().querySelectorAll("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "stack page 4" })).toBeNull();
  });

  it("routes page clicks as density-sized offsets", () => {
    const { props } = renderPager({
      stackDensity: "compact",
      stackPageCount: 5,
      totalGroups: 42,
    });
    // At 10 rows per page, page 3 starts at offset 20 (not 10).
    fireEvent.click(screen.getByRole("button", { name: "stack page 3" }));
    expect(props.onSelectStackPage).toHaveBeenCalledWith(20);
  });

  it("marks the current page by density-sized offset", () => {
    renderPager({ stackDensity: "compact", stackOffset: 10, stackPageCount: 5, totalGroups: 42 });
    expect(screen.getByRole("button", { name: "stack page 2" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "stack page 1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("renders the first page's album art as a decorative backdrop", () => {
    const { container, rerender, props } = renderPager({
      firstPageArtUrl: "https://example.com/first.jpg",
    });
    const backdrop = container.querySelector("img.stack-pager-bar__backdrop-art");
    expect(backdrop?.getAttribute("src")).toBe("https://example.com/first.jpg");
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");

    // Page change → the backdrop crossfades to the next album's cover.
    rerender(<StackPagerBar {...props} firstPageArtUrl="https://example.com/second.jpg" />);
    expect(
      container.querySelector("img.stack-pager-bar__backdrop-art")?.getAttribute("src"),
    ).toBe("https://example.com/second.jpg");

    // No art → no backdrop element at all.
    rerender(<StackPagerBar {...props} firstPageArtUrl={null} />);
    expect(container.querySelector("img.stack-pager-bar__backdrop-art")).toBeNull();
  });
});
