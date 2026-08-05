// @vitest-environment jsdom
/**
 * Confirms that album art in the grouped library views always falls back to
 * the Rumours placeholder when an image fails to load, rather than showing a
 * broken-image icon.
 *
 * Two surfaces are covered here (LibraryRow is tested separately in
 * libraryRowArtworkFallback.test.tsx):
 *   1. AlbumGroupRow header image (~line 622 of Library.tsx)
 *   2. ArtistGroupRow sub-album header image (~line 832 of Library.tsx)
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Stub LibraryRow so AlbumGroupRow/ArtistGroupRow render without deep deps.
// ---------------------------------------------------------------------------

vi.mock("../src/components/LibraryRow", () => ({
  LibraryRow: ({
    item,
  }: {
    item: { mbid: string | null; recording?: { title?: string | null } | null };
  }) => (
    <li data-testid="library-row" data-mbid={item.mbid ?? "soft"}>
      {item.recording?.title ?? item.mbid ?? "unknown"}
    </li>
  ),
}));

// ---------------------------------------------------------------------------
// Imports (must follow vi.mock calls)
// ---------------------------------------------------------------------------

import {
  AlbumGroupRow,
  ArtistGroupRow,
  type AlbumGroup,
  type ArtistGroup,
} from "../src/pages/Library";
import { RUMOURS } from "../src/lib/rumours";
import type { LibraryItem } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(): LibraryItem {
  return {
    mbid: "mbid-art-test",
    addedAt: "2024-01-01T00:00:00Z",
    provenance: { kind: "keep" },
    recording: {
      title: "Test Track",
      artist: "Test Artist",
      artworkUrl: "https://example.com/art.jpg",
      albumTitle: "Test Album",
      spotifyUrl: null,
    },
  };
}

const ART_URL = "https://example.com/cover.jpg";

function makeAlbumGroup(artworkUrl: string | null = ART_URL): AlbumGroup {
  return {
    key: "Test Artist\x1fTest Album",
    albumTitle: "Test Album",
    artist: "Test Artist",
    artworkUrl,
    items: [makeItem()],
  };
}

function makeArtistGroup(albumArtworkUrl: string | null = ART_URL): ArtistGroup {
  return {
    key: "Test Artist",
    artist: "Test Artist",
    items: [makeItem()],
    albums: [
      {
        key: "Test Artist\x1fTest Album",
        albumTitle: "Test Album",
        artist: "Test Artist",
        artworkUrl: albumArtworkUrl,
        items: [makeItem()],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ===========================================================================
// Surface 1 — AlbumGroupRow header image
// ===========================================================================

describe("AlbumGroupRow — artwork fallback on load error", () => {
  it("renders an img with the proxied artwork URL when artworkUrl is set", () => {
    render(
      <AlbumGroupRow
        group={makeAlbumGroup(ART_URL)}
        openDoorMbid={null}
        setOpenDoorMbid={vi.fn()}
        openShelfMbid={null}
        setOpenShelfMbid={vi.fn()}
      />,
    );

    const imgs = document.querySelectorAll("img");
    // At least one img present (the header swatch)
    expect(imgs.length).toBeGreaterThan(0);
    const headerImg = imgs[0] as HTMLImageElement;
    // jsdom resolves relative paths to absolute — check the proxy path is embedded
    expect(headerImg.src).toContain("example.com");
  });

  it("swaps to RUMOURS when the header image fires an error event", () => {
    render(
      <AlbumGroupRow
        group={makeAlbumGroup(ART_URL)}
        openDoorMbid={null}
        setOpenDoorMbid={vi.fn()}
        openShelfMbid={null}
        setOpenShelfMbid={vi.fn()}
      />,
    );

    const headerImg = document.querySelector("img") as HTMLImageElement;
    expect(headerImg).toBeTruthy();

    // Simulate the browser failing to fetch the image
    fireEvent.error(headerImg);

    expect(headerImg.src).toBe(new URL(RUMOURS, document.baseURI).href);
  });

  it("does not show a broken img when artworkUrl is null (gradient fallback renders instead)", () => {
    render(
      <AlbumGroupRow
        group={makeAlbumGroup(null)}
        openDoorMbid={null}
        setOpenDoorMbid={vi.fn()}
        openShelfMbid={null}
        setOpenShelfMbid={vi.fn()}
      />,
    );

    // No <img> in the header when artworkUrl is null — gradient span is used
    expect(document.querySelector("img")).toBeNull();
  });
});

// ===========================================================================
// Surface 2 — ArtistGroupRow sub-album header image
// ===========================================================================

describe("ArtistGroupRow — sub-album artwork fallback on load error", () => {
  it("shows the sub-album img after expanding and swaps to RUMOURS on error", () => {
    render(
      <ArtistGroupRow
        group={makeArtistGroup(ART_URL)}
        openDoorMbid={null}
        setOpenDoorMbid={vi.fn()}
        openShelfMbid={null}
        setOpenShelfMbid={vi.fn()}
      />,
    );

    // Before expansion: no img (sub-albums are hidden)
    expect(document.querySelector("img")).toBeNull();

    // Expand the artist group
    fireEvent.click(screen.getByRole("button"));

    // After expansion: the sub-album header img should appear
    const albumImg = document.querySelector("img") as HTMLImageElement;
    expect(albumImg).toBeTruthy();
    expect(albumImg.src).toContain("example.com");

    // Simulate load failure
    fireEvent.error(albumImg);

    expect(albumImg.src).toBe(new URL(RUMOURS, document.baseURI).href);
  });

  it("does not render a sub-album img when artworkUrl is null (gradient span instead)", () => {
    render(
      <ArtistGroupRow
        group={makeArtistGroup(null)}
        openDoorMbid={null}
        setOpenDoorMbid={vi.fn()}
        openShelfMbid={null}
        setOpenShelfMbid={vi.fn()}
      />,
    );

    // Expand
    fireEvent.click(screen.getByRole("button"));

    // No img; the gradient span is rendered instead
    expect(document.querySelector("img")).toBeNull();
  });
});
