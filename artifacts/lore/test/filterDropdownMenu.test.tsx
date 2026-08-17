// @vitest-environment jsdom
/**
 * FilterDropdownMenu — the shared dropdown trigger + checkbox panel used by
 * DialFilterBar and RadioRemoteBar.
 *
 * Covers:
 *  1. Trigger renders the family label and an active-count badge when any
 *     option is checked, with aria-haspopup + aria-expanded.
 *  2. Clicking the trigger opens the panel; every option is a <label>
 *     wrapping a checkbox whose state reflects the active set.
 *  3. Toggling a checkbox reports the value and keeps the panel open.
 *  4. Escape closes the panel and returns focus to the trigger.
 *  5. Clicking outside closes the panel; the panel stays mounted (hidden)
 *     when closed.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FilterDropdownMenu } from "../src/components/dial/FilterDropdownMenu";

const OPTIONS = [
  { value: "first", label: "First", title: "First-ever play" },
  { value: "current", label: "Current", title: "Released within the last 18 months" },
  { value: "deep", label: "Deep", title: "Released 60+ months ago" },
] as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderMenu(overrides: Partial<React.ComponentProps<typeof FilterDropdownMenu<string>>> = {}) {
  const props: React.ComponentProps<typeof FilterDropdownMenu<string>> = {
    label: "Track age",
    ariaLabel: "Track age",
    options: OPTIONS as unknown as { value: string; label: string; title: string }[],
    active: new Set<string>(),
    onToggle: vi.fn(),
    variant: "bar",
    ...overrides,
  };
  render(<FilterDropdownMenu<string> {...props} />);
  return { props };
}

// The panel stays mounted (display:none) while closed, so it leaves the
// accessibility tree and can't be queried by role in the closed state —
// select by class for open/closed state assertions.
function panel(): HTMLElement {
  const el = document.querySelector(".filter-dropdown__panel");
  if (!el) throw new Error("panel not mounted");
  return el as HTMLElement;
}

describe("FilterDropdownMenu", () => {
  it("renders the trigger with aria-haspopup and a collapsed panel", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Track age" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // The panel stays in the DOM but hidden while closed.
    expect(panel().hasAttribute("hidden")).toBe(true);
  });

  it("opens on trigger click, rendering one labeled checkbox per option", () => {
    renderMenu({ active: new Set(["current"]) });
    fireEvent.click(screen.getByRole("button", { name: "Track age" }));

    const trigger = screen.getByRole("button", { name: "Track age" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel().hasAttribute("hidden")).toBe(false);

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect((screen.getByRole("checkbox", { name: /First/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /Current/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Deep/ }) as HTMLInputElement).checked).toBe(false);
    // Every checkbox is wrapped by its visible label.
    for (const box of boxes) {
      expect(box.closest("label")).not.toBeNull();
    }
  });

  it("shows an active-count badge on the trigger only when options are checked", () => {
    const { rerender } = render(
      <FilterDropdownMenu<string>
        label="Track age"
        ariaLabel="Track age"
        options={OPTIONS as unknown as { value: string; label: string; title: string }[]}
        active={new Set()}
        onToggle={vi.fn()}
        variant="bar"
      />,
    );
    expect(screen.queryByText(/· \d/)).toBeNull();

    rerender(
      <FilterDropdownMenu<string>
        label="Track age"
        ariaLabel="Track age"
        options={OPTIONS as unknown as { value: string; label: string; title: string }[]}
        active={new Set(["first", "deep"])}
        onToggle={vi.fn()}
        variant="bar"
      />,
    );
    expect(screen.getByRole("button", { name: /Track age/ }).textContent).toContain("· 2");
  });

  it("reports checkbox toggles and keeps the panel open", () => {
    const { props } = renderMenu({ active: new Set(["first"]) });
    fireEvent.click(screen.getByRole("button", { name: "Track age" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Deep/ }));
    expect(props.onToggle).toHaveBeenCalledWith("deep");
    expect(panel().hasAttribute("hidden")).toBe(false);
  });

  it("closes on Escape and returns focus to the trigger", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Track age" });
    fireEvent.click(trigger);
    expect(panel().hasAttribute("hidden")).toBe(false);

    fireEvent.keyDown(panel(), { key: "Escape" });
    expect(panel().hasAttribute("hidden")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on click-outside but not on clicks inside the panel", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Track age" }));
    fireEvent.mouseDown(panel());
    expect(panel().hasAttribute("hidden")).toBe(false);
    fireEvent.mouseDown(document.body);
    expect(panel().hasAttribute("hidden")).toBe(true);
  });

  it("uses the chips trigger styling in the chips variant", () => {
    renderMenu({ variant: "chips" });
    expect(screen.getByRole("button", { name: "Track age" }).className).toContain(
      "home-cli-strip__filter-chip",
    );
  });
});
