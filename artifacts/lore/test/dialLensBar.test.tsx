// @vitest-environment jsdom
/**
 * DialLensBar — the Rooms | Press lens toggle.
 *
 * Covers:
 *  1. Renders both lens buttons in a pipe-separated group.
 *  2. aria-pressed reflects the active lens (keyboard-accessible toggles).
 *  3. Clicking fires onSetLens with the target lens.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DialLensBar } from "../src/components/dial/DialLensBar";
import type { DialLens } from "../src/lib/dialLensState";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBar(lens: DialLens = "radio") {
  const onSetLens = vi.fn();
  const utils = render(<DialLensBar lens={lens} onSetLens={onSetLens} />);
  return { ...utils, onSetLens };
}

describe("DialLensBar", () => {
  it("renders Rooms and Press buttons in the Explore view group", () => {
    renderBar();
    expect(screen.getByRole("group", { name: "Explore view" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rooms" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Press" })).toBeTruthy();
  });

  it("marks the active lens with aria-pressed and the --on class", () => {
    renderBar("radio");
    expect(screen.getByRole("button", { name: "Rooms" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Press" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Rooms" }).className).toContain("dial-filter-bar__btn--on");

    cleanup();
    renderBar("press");
    expect(screen.getByRole("button", { name: "Press" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Rooms" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking a lens fires onSetLens with that lens", () => {
    const { onSetLens } = renderBar("radio");
    fireEvent.click(screen.getByRole("button", { name: "Press" }));
    expect(onSetLens).toHaveBeenCalledWith("press");
    fireEvent.click(screen.getByRole("button", { name: "Rooms" }));
    expect(onSetLens).toHaveBeenCalledWith("radio");
  });

  it("uses the filter bar's button anatomy (same pipe-separated style)", () => {
    const { container } = renderBar();
    expect(container.querySelector(".dial-filter-bar")).toBeTruthy();
    expect(container.querySelectorAll(".dial-filter-bar__btn")).toHaveLength(4);
    expect(container.querySelector(".dial-topbar__sep")?.textContent).toBe("|");
  });
});
