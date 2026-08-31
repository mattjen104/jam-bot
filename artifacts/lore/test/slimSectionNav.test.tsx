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
  it("classifies library-family pages as library", () => {
    for (const path of ["/library", "/library/albums", "/journal", "/journal/2026-08", "/following"]) {
      expect(sectionFor(path)).toBe("library");
    }
  });

  it("classifies the Heard page separately", () => {
    expect(sectionFor("/heard")).toBe("heard");
    expect(sectionFor("/heard/today")).toBe("heard");
  });

  it("classifies Index pages separately", () => {
    expect(sectionFor("/index")).toBe("index");
    expect(sectionFor("/index?section=stations&artistMbid=abc")).toBe("index");
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

  it("renders exactly four hyperlinks — Feed, Heard, Stack, and Index", () => {
    render(<SlimSectionNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Feed", "Heard", "Stack", "Index"]);
    // No button-styled nav items remain.
    expect(nav.querySelectorAll("button").length).toBe(0);
  });

  it("hides Heard and Index when the listener archive reveal is disabled", () => {
    render(<SlimSectionNav showArchiveNav={false} />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Feed", "Stack"]);
    expect(screen.queryByRole("link", { name: "Heard" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Index" })).toBeNull();
  });

  it("links Feed to the full Dial (/feed) from the split homepage", () => {
    mockLocation.value = "/";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Feed" }).getAttribute("href")).toBe("/feed");
    expect(screen.getByRole("link", { name: "Heard" }).getAttribute("href")).toBe("/heard");
    expect(screen.getByRole("link", { name: "Stack" }).getAttribute("href")).toBe("/library");
    expect(screen.getByRole("link", { name: "Index" }).getAttribute("href")).toBe("/index");
  });

  it("links Feed back to the front door from any other page", () => {
    mockLocation.value = "/library";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Feed" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Heard" }).getAttribute("href")).toBe("/heard");
    expect(screen.getByRole("link", { name: "Stack" }).getAttribute("href")).toBe("/library");
    expect(screen.getByRole("link", { name: "Index" }).getAttribute("href")).toBe("/index");
  });

  it("pins Feed to the left corner and the other sections to the right side", () => {
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Feed" }).className).toContain("corner-nav__link--left");
    expect(screen.getByRole("link", { name: "Stack" }).className).toContain("corner-nav__link--right");
    expect(screen.getByRole("link", { name: "Heard" }).className).toContain("corner-nav__link--right");
    expect(screen.getByRole("link", { name: "Index" }).className).toContain("corner-nav__link--right");
  });

  it("marks Feed active on the front door", () => {
    mockLocation.value = "/";
    render(<SlimSectionNav />);
    const lore = screen.getByRole("link", { name: "Feed" });
    expect(lore.getAttribute("aria-current")).toBe("page");
    expect(lore.className).toContain("corner-nav__link--active");
    expect(screen.getByRole("link", { name: "Stack" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Heard" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Index" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Heard active only on the Heard route", () => {
    mockLocation.value = "/heard";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Heard" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Feed" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Stack" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Index" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Index active across filtered Index routes", () => {
    mockLocation.value = "/index?section=artists&artistMbid=abc";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Index" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Feed" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Stack active across the library family of routes", () => {
    for (const path of ["/library", "/journal", "/following"]) {
      mockLocation.value = path;
      render(<SlimSectionNav />);
      expect(screen.getByRole("link", { name: "Stack" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByRole("link", { name: "Feed" }).getAttribute("aria-current")).toBeNull();
      cleanup();
    }
  });

  it("keeps Feed active while on a selector archive page", () => {
    mockLocation.value = "/archive/selectors/night-shift";
    render(<SlimSectionNav />);
    expect(screen.getByRole("link", { name: "Feed" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("SlimSectionNav — bottom nav row variant (mobile shell)", () => {
  afterEach(() => {
    cleanup();
    setLocation.mockClear();
    mockLocation.value = "/";
  });

  it("renders the same four links inside a .bottom-nav row", () => {
    // On the split homepage the Feed label targets the full Dial at /feed.
    mockLocation.value = "/";
    render(<SlimSectionNav variant="bottom" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.className).toContain("bottom-nav");
    expect(nav.className).not.toContain("corner-nav");
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Feed", "Heard", "Stack", "Index"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/feed", "/heard", "/library", "/index"]);
  });

  it("uses bottom-nav link classes with the same data-section hooks", () => {
    render(<SlimSectionNav variant="bottom" />);
    const lore = screen.getByRole("link", { name: "Feed" });
    const library = screen.getByRole("link", { name: "Stack" });
    expect(lore.className).toContain("bottom-nav__link");
    expect(library.className).toContain("bottom-nav__link");
    expect(lore.getAttribute("data-section")).toBe("lore");
    expect(library.getAttribute("data-section")).toBe("library");
  });

  it("marks the active section with aria-current and the active class", () => {
    mockLocation.value = "/library";
    render(<SlimSectionNav variant="bottom" />);
    const library = screen.getByRole("link", { name: "Stack" });
    expect(library.getAttribute("aria-current")).toBe("page");
    expect(library.className).toContain("bottom-nav__link--active");
    expect(screen.getByRole("link", { name: "Feed" }).getAttribute("aria-current")).toBeNull();
  });
});
