// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const { mockLocation, setLocation, useGetIndex } = vi.hoisted(() => ({
  mockLocation: { value: "/index" },
  setLocation: vi.fn(),
  useGetIndex: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => [mockLocation.value, setLocation],
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetIndex,
}));

import Index from "../src/pages/Index";

const fixtures = {
  releases: [{ id: "release-1", name: "A Release", secondary: "An Artist", href: "/album/release-1" }],
  artists: [
    { id: "artist-1", name: "An Artist", secondary: null, href: "/artist/artist-1" },
    { id: "name:unknown", name: "Unknown Artist", secondary: null, href: null },
  ],
  stations: [{ id: "station-one", name: "Station One", secondary: "Canada", href: "/archive/stations/station-one" }],
  selectors: [{ id: "selector-one", name: "Selector One", secondary: null, href: "/archive/selectors/selector-one" }],
} as const;
const noItems: never[] = [];

function installIndexResults() {
  useGetIndex.mockImplementation(({ section, q }: { section: keyof typeof fixtures; q?: string }) => ({
    data: {
      section,
      items: q ? noItems : fixtures[section],
      total: q ? 0 : fixtures[section].length,
      nextCursor: null,
    },
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  }));
}

describe("Index page", () => {
  afterEach(() => {
    cleanup();
    useGetIndex.mockReset();
    setLocation.mockClear();
    mockLocation.value = "/index";
  });

  it("renders all four bounded sections and keeps unresolved artists non-clickable", async () => {
    installIndexResults();
    render(<Index />);

    expect(screen.getByRole("heading", { name: "Index" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Releases" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Artists" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Stations" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Selectors" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /A Release/ }).getAttribute("href")).toBe("/album/release-1");
    expect(screen.getByTestId("link-index-item-artist-1").getAttribute("href")).toBe("/artist/artist-1");
    expect(screen.getByText("Unknown Artist").closest("a")).toBeNull();
    expect(screen.getByTestId("text-index-summary").textContent).toContain("5");
  });

  it("uses a deep-linked section and forwards entity filters to the bounded hook", () => {
    mockLocation.value = "/index?section=stations&artistMbid=artist-1";
    installIndexResults();
    render(<Index />);

    expect(screen.getByRole("heading", { name: "Stations" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Artists" })).toBeNull();
    expect(useGetIndex).toHaveBeenCalledWith(expect.objectContaining({
      section: "stations",
      artistMbid: "artist-1",
      limit: 20,
    }));
  });

  it("restores cached rows after filtering and revisiting an earlier URL state", async () => {
    installIndexResults();
    const view = render(<Index />);
    await waitFor(() => expect(screen.getByText("A Release")).toBeTruthy());

    mockLocation.value = "/index?q=no-match";
    view.rerender(<Index />);
    await waitFor(() => expect(screen.queryByText("A Release")).toBeNull());

    mockLocation.value = "/index";
    view.rerender(<Index />);
    await waitFor(() => expect(screen.getByText("A Release")).toBeTruthy());
  });
});