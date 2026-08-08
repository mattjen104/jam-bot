// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { setLocation, mockLocation } = vi.hoisted(() => ({
  setLocation: vi.fn(),
  mockLocation: { value: "/" },
}));

vi.mock("wouter", () => ({ useLocation: () => [mockLocation.value, setLocation] }));

import { SlimSectionNav, sectionFor } from "../src/components/SlimSectionNav";

describe("sectionFor — two-section model", () => {
  it("classifies library-family pages as library", () => {
    for (const path of ["/library", "/library/albums", "/journal", "/journal/2026-08", "/following"]) {
      expect(sectionFor(path)).toBe("library");
    }
  });

  it("classifies selector, DJ, and archive pages as part of Lore", () => {
    for (const path of [
      "/",
      "/selectors",
      "/archive/selectors/night-shift",
      "/archive/selector-runs/42",
      "/archive/picker-runs/42",
      "/dj/somebody",
      "/archive",
      "/archive/stations/kexp",
      "/song/abc",
    ]) {
      expect(sectionFor(path)).toBe("lore");
    }
  });
});

describe("SlimSectionNav", () => {
  afterEach(() => {
    cleanup();
    setLocation.mockClear();
    mockLocation.value = "/";
  });

  it("renders exactly two items — Lore and My Library — and no Selectors", () => {
    render(<SlimSectionNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const buttons = Array.from(nav.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Lore", "My Library"]);
    expect(screen.queryByRole("button", { name: "Selectors" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Radio" })).toBeNull();
  });

  it("navigates Lore to the front door and My Library to the library", () => {
    render(<SlimSectionNav />);
    fireEvent.click(screen.getByRole("button", { name: "Lore" }));
    expect(setLocation).toHaveBeenCalledWith("/");
    fireEvent.click(screen.getByRole("button", { name: "My Library" }));
    expect(setLocation).toHaveBeenCalledWith("/library");
  });

  it("highlights Lore while on a selector archive page", () => {
    mockLocation.value = "/archive/selectors/night-shift";
    render(<SlimSectionNav />);
    const lore = screen.getByRole("button", { name: "Lore" });
    expect(lore.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "My Library" }).getAttribute("aria-current")).toBeNull();
  });
});
