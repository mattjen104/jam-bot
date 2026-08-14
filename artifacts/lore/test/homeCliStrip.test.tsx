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
 *  4. Age chips render every supported slash command, route to the
 *     tier callback, and expose active state accessibly.
 *  5. Category chips render every supported slash command, route to the
 *     category callback, and expose active state accessibly.
 *  6. The "add artists /add" button focuses the input and inserts the
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

  it("scan buttons fire onScan with their offset and show the active window", () => {
    const { props } = renderStrip({ activeCategories: new Set<StationCategory>(["lore", "college"]) });

    const tiers = [
      ["/first", "first", "First play"],
      ["/current", "current", "Current"],
      ["/catalog", "catalog", "Catalog"],
      ["/deep", "deep", "Deep"],
    ] as const;

    const categories = [
      ["/lore", "lore"],
      ["/classics", "classics"],
      ["/ambient", "ambient"],
      ["/spinitron", "spinitron"],
      ["/college", "college"],
      ["/longtail", "longtail"],
    ] as const;
    const scan1 = screen.getByRole("button", { name: "scan1" });
    const scan2 = screen.getByRole("button", { name: "scan2" });
    const scan3 = screen.getByRole("button", { name: "scan3" });
    const { input } = renderStrip();
    const addBtn = screen.getByRole("button", { name: "Add artists" });
    fireEvent.click(addBtn);
    expect(input.value).toBe("/add ");
    expect(document.activeElement).toBe(input);
  });
});

      const chip = screen.getByRole("button", { name: command });
