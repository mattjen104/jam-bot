// @vitest-environment jsdom
/**
 * HomeCliStrip — the SplitHome CLI seam.
 *
 * Covers:
 *  1. Typing `/add …` in the strip's input calls onAddArtists with
 *     correctly split/trimmed artist names.
 *  2. Typing `/scan2` calls onScan(5).
 *  3. Scan buttons call onScan with their offset and reflect the active
 *     window (aria-pressed + active class).
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

  it("scan buttons fire onScan with their offset and show the active window", () => {
    const { props } = renderStrip({ scanOffset: 5 });
    const scan1 = screen.getByRole("button", { name: /scan 1/ });
    const scan2 = screen.getByRole("button", { name: /scan 2/ });
    const scan3 = screen.getByRole("button", { name: /scan 3/ });

    expect(scan2.getAttribute("aria-pressed")).toBe("true");
    expect(scan2.className).toContain("home-cli-strip__btn--active");
    expect(scan1.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(scan3);
    expect(props.onScan).toHaveBeenCalledWith(10);
    fireEvent.click(scan1);
    expect(props.onScan).toHaveBeenCalledWith(0);
  });

  it("the add-artists button inserts the /add prefix and focuses the input", () => {
    const { input } = renderStrip();
    const addBtn = screen.getByRole("button", { name: /add artists/ });
    fireEvent.click(addBtn);
    expect(input.value).toBe("/add ");
    expect(document.activeElement).toBe(input);
  });
});
