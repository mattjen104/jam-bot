// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { setLocation, mockLocation } = vi.hoisted(() => ({
  setLocation: vi.fn(),
  mockLocation: { value: "/" },
}));

vi.mock("wouter", () => ({
  useLocation: () => [mockLocation.value, setLocation],
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

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

describe("SlimSectionNav — bottom-corner hyperlinks", () => {
  afterEach(() => {
    cleanup();
    setLocation.mockClear();
    mockLocation.value = "/";
  });

  it("renders exactly two bracketed hyperlinks — [lore] and [my library]", () => {
    render(<SlimSectionNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["[lore]", "[my library]"]);
    // No button-styled nav items remain.
    expect(nav.querySelectorAll("button").length).toBe(0);
  });

  it("links [lore] to the front door and [my library] to the library", () => {
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "[lore]" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "[my library]" }).getAttribute("href")).toBe("/library");
  });

  it("pins [lore] to the left corner and [my library] to the right corner", () => {
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "[lore]" }).className).toContain("corner-nav__link--left");
    expect(screen.getByRole("link", { name: "[my library]" }).className).toContain("corner-nav__link--right");
  });

  it("marks [lore] active on the front door", () => {
    mockLocation.value = "/";
    render(<SlimSectionNav />);
    const lore = screen.getByRole("link", { name: "[lore]" });
    expect(lore.getAttribute("aria-current")).toBe("page");
    expect(lore.className).toContain("corner-nav__link--active");
    expect(screen.getByRole("link", { name: "[my library]" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks [my library] active across the library family of routes", () => {
    for (const path of ["/library", "/journal", "/following"]) {
      mockLocation.value = path;
      render(<SlimSectionNav />);
      expect(screen.getByRole("link", { name: "[my library]" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByRole("link", { name: "[lore]" }).getAttribute("aria-current")).toBeNull();
      cleanup();
    }
  });

  it("keeps [lore] active while on a selector archive page", () => {
    mockLocation.value = "/archive/selectors/night-shift";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "[lore]" }).getAttribute("aria-current")).toBe("page");
  });
});
