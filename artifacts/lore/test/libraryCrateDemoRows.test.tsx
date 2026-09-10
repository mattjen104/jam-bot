// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "../src/lib/meHooks";

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../src/lib/setContexts", () => ({
  anchorKey: ({ kind, mbid, artist }: { kind: string; mbid?: string; artist?: string }) =>
    kind === "mbid" ? `mbid:${mbid}` : `artist:${artist}`,
  useSetContexts: () => new Map(),
}));

vi.mock("../src/components/LibraryRowMenu", () => ({
  LibraryRowMenu: () => <button aria-label="More options">•••</button>,
}));

const item = {
  mbid: "demo-track",
  spotifyId: null,
  addedAt: "2026-09-10T00:00:00.000Z",
  removed: false,
  fuzzyMatch: false,
  provenance: {
    kind: "keep",
    stationName: "KEXP",
    sourceKeepDate: true,
  },
  recording: {
    title: "French Disko",
    artist: "Stereolab",
    artistMbid: "demo-artist",
    artworkUrl: "https://images.example/french-disko.jpg",
    albumTitle: "Oscillons from the Anti-Sun",
    releaseGroupMbid: "demo-release",
    releaseYear: 2005,
    spotifyUrl: null,
  },
} as LibraryItem;

afterEach(cleanup);

describe("LibraryCrate demo song rows", () => {
  it("uses compact song metadata and a single overflow menu only in demo mode", async () => {
    const { LibraryCrate } = await import("../src/components/LibraryCrate");
    const { container, rerender } = render(
      <LibraryCrate
        items={[item]}
        seedArtists={[]}
        sort="added"
        hideAddedRail
        demoSurface
      />,
    );

    const demoRow = screen.getByTestId("library-crate-track");
    expect(demoRow.classList.contains("demo-library__song-row")).toBe(true);
    expect(within(demoRow).getByText("French Disko")).toBeTruthy();
    expect(within(demoRow).getByText("Song")).toBeTruthy();
    expect(within(demoRow).getByText("Stereolab")).toBeTruthy();
    expect(within(demoRow).queryByText("Oscillons from the Anti-Sun")).toBeNull();
    expect(within(demoRow).getAllByRole("button", { name: "More options" })).toHaveLength(1);
    expect(container.querySelector(".library-crate__track-art img")).toBeTruthy();

    rerender(
      <LibraryCrate
        items={[item]}
        seedArtists={[]}
        sort="added"
        hideAddedRail
        demoSurface={false}
      />,
    );

    const regularRow = screen.getByTestId("library-crate-track");
    expect(regularRow.classList.contains("demo-library__song-row")).toBe(false);
    expect(within(regularRow).getByText("Oscillons from the Anti-Sun")).toBeTruthy();
    expect(within(regularRow).queryByRole("button", { name: "More options" })).toBeNull();
  });
});