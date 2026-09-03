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

describe("sectionFor — primary section model", () => {
  it("classifies library-family pages as Stack", () => {
    for (const path of ["/library", "/library/albums", "/journal", "/journal/2026-08", "/following"]) {
      expect(sectionFor(path)).toBe("stack");
    }
  });

  it("groups Feed, Heard, Index, and station exploration under Explore", () => {
    for (const path of ["/feed", "/heard", "/heard/today", "/index", "/index?section=stations", "/stations/kexp"]) {
      expect(sectionFor(path)).toBe("feed");
    }
  });

  it("returns archival dives to the Now job", () => {
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
      expect(sectionFor(path)).toBe("now");
    }
  });
});

describe("SlimSectionNav — bottom-corner hyperlinks", () => {
  afterEach(() => {
    cleanup();
    setLocation.mockClear();
    mockLocation.value = "/";
  });

  it("renders exactly three listening jobs — Now, Explore, and Stack", () => {
    render(<SlimSectionNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Now", "Explore", "Stack"]);
    // No button-styled nav items remain.
    expect(nav.querySelectorAll("button").length).toBe(0);
  });

  it("keeps the three jobs stable when archive reveal is disabled", () => {
    render(<SlimSectionNav showArchiveNav={false} />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Now", "Explore", "Stack"]);
    expect(screen.queryByRole("link", { name: "Heard" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Index" })).toBeNull();
  });

  it("links each job to its stable route from Now", () => {
    mockLocation.value = "/";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Now" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("href")).toBe("/feed");
    expect(screen.getByRole("link", { name: "Stack" }).getAttribute("href")).toBe("/library");
  });

  it("keeps the same stable routes from Stack", () => {
    mockLocation.value = "/library";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Now" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("href")).toBe("/feed");
    expect(screen.getByRole("link", { name: "Stack" }).getAttribute("href")).toBe("/library");
  });

  it("pins Now to the left corner and Explore and Stack to the right side", () => {
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Now" }).className).toContain("corner-nav__link--left");
    expect(screen.getByRole("link", { name: "Stack" }).className).toContain("corner-nav__link--right");
    expect(screen.getByRole("link", { name: "Explore" }).className).toContain("corner-nav__link--right");
  });

  it("marks Now active on the front door", () => {
    mockLocation.value = "/";
    render(<SlimSectionNav />);
    const lore = screen.getByRole("link", { name: "Now" });
    expect(lore.getAttribute("aria-current")).toBe("page");
    expect(lore.className).toContain("corner-nav__link--active");
    expect(screen.getByRole("link", { name: "Stack" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Explore active on a deeper Feed lens", () => {
    mockLocation.value = "/heard";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Now" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Stack" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Explore active across filtered Index routes", () => {
    mockLocation.value = "/index?section=artists&artistMbid=abc";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Now" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Stack active across the library family of routes", () => {
    for (const path of ["/library", "/journal", "/following"]) {
      mockLocation.value = path;
      render(<SlimSectionNav />);
      expect(screen.getByRole("link", { name: "Stack" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByRole("link", { name: "Now" }).getAttribute("aria-current")).toBeNull();
      cleanup();
    }
  });

  it("keeps Now active while on a selector archive page", () => {
    mockLocation.value = "/archive/selectors/night-shift";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Now" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("SlimSectionNav — bottom nav row variant (mobile shell)", () => {
  afterEach(() => {
    cleanup();
    setLocation.mockClear();
    mockLocation.value = "/";
  });

  it("renders the same three jobs inside a .bottom-nav row", () => {
    mockLocation.value = "/";
    render(<SlimSectionNav variant="bottom" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.className).toContain("bottom-nav");
    expect(nav.className).not.toContain("corner-nav");
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Now", "Explore", "Stack"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/", "/feed", "/library"]);
  });

  it("uses bottom-nav link classes with the same data-section hooks", () => {
    render(<SlimSectionNav variant="bottom" />);
    const lore = screen.getByRole("link", { name: "Now" });
    const library = screen.getByRole("link", { name: "Stack" });
    expect(lore.className).toContain("bottom-nav__link");
    expect(library.className).toContain("bottom-nav__link");
    expect(lore.getAttribute("data-section")).toBe("now");
    expect(library.getAttribute("data-section")).toBe("stack");
  });

  it("marks the active section with aria-current and the active class", () => {
    mockLocation.value = "/library";
    render(<SlimSectionNav variant="bottom" />);
    const library = screen.getByRole("link", { name: "Stack" });
    expect(library.getAttribute("aria-current")).toBe("page");
    expect(library.className).toContain("bottom-nav__link--active");
    expect(screen.getByRole("link", { name: "Now" }).getAttribute("aria-current")).toBeNull();
  });
});
