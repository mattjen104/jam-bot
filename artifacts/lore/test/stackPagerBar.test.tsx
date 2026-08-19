// @vitest-environment jsdom
/**
 * StackPagerBar — the pinned stack-paging footer of SplitHome.
 *
 * Covers:
 *  1. Page buttons render proportional to the library size (one numeric
 *     selector per stack page) with the same styling hooks as the Dial's
 *     page buttons.
 *  2. The active page is exposed via aria-pressed; clicks route offsets.
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
    shuffleMode: null,
    onSelectStackPage: vi.fn(),
    onShufflePage: vi.fn(),
    onShuffleAll: vi.fn(),
    ...overrides,
  };
  render(<StackPagerBar {...props} />);
  return { props };
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

  it("labels each page button with the first album title in its window", () => {
    const { props } = renderPager({
      stackPageCount: 4,
      totalGroups: 18,
      pageLabels: ["Rumours", "Blue Lines", null, "Third"],
    });

    // Visible text leads with the album title; a null label falls back to
    // the bare page number.
    const pageGroup = screen.getByRole("group", { name: "Stack page" });
    const buttons = [...pageGroup.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Rumours", "Blue Lines", "3", "Third"]);

    // Accessible labels keep the page number and add the window's album
    // count ("+N more"); the last page's short window counts down.
    screen.getByRole("button", { name: "stack page 1: Rumours, +4 more" });
    screen.getByRole("button", { name: "stack page 2: Blue Lines, +4 more" });
    screen.getByRole("button", { name: "stack page 3" });
    screen.getByRole("button", { name: "stack page 4: Third, +2 more" });

    // Clicks still route offsets by page index, not by label.
    fireEvent.click(screen.getByRole("button", { name: "stack page 4: Third, +2 more" }));
    expect(props.onSelectStackPage).toHaveBeenCalledWith(15);
  });

  it("labels a single-album page without a '+N more' count", () => {
    renderPager({ stackPageCount: 1, totalGroups: 1, pageLabels: ["Rumours"] });
    screen.getByRole("button", { name: "stack page 1: Rumours" });
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
});
