// @vitest-environment jsdom
/**
 * Regression guard for the LibraryRow artwork swatch onError handler.
 *
 * Confirms that when an album cover URL fails to load (expired CDN link,
 * proxy 4xx, etc.) the img element swaps to the Rumours placeholder rather
 * than displaying a broken-image icon.
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyAlbumAvatar: vi.fn(() => ({ data: undefined })),
    useSetAlbumAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  });
});

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import(
    "./helpers/playerProviderMock"
  );
  return makePlayerProviderMock(importOriginal);
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    getRecordingAlbumTracks: vi.fn(async () => ({ tracks: [], rgTitle: null })),
    spotifyPlay: vi.fn(),
  });
});

vi.mock("../src/components/AlbumShelf", () => ({
  AlbumShelf: () => <div data-testid="album-shelf" />,
}));

// ---------------------------------------------------------------------------
// Imports (must follow vi.mock calls)
// ---------------------------------------------------------------------------

import { LibraryRow } from "../src/components/LibraryRow";
import { RUMOURS } from "../src/lib/rumours";
import type { LibraryItem } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(artworkUrl: string | null = "https://example.com/art.jpg"): LibraryItem {
  return {
    mbid: "mbid-row-art-test",
    addedAt: "2024-01-01T00:00:00Z",
    provenance: { kind: "keep" },
    recording: {
      title: "Test Track",
      artist: "Test Artist",
      artworkUrl,
      albumTitle: "Test Album",
      spotifyUrl: null,
    },
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
// LibraryRow — artwork swatch onError handler
// ===========================================================================

describe("LibraryRow — artwork swatch fallback on load error", () => {
  it("renders an img with a URL derived from the artworkUrl", () => {
    render(
      <ul>
        <LibraryRow item={makeItem("https://example.com/art.jpg")} />
      </ul>,
    );

    const img = document.querySelector(".lrow__art-img") as HTMLImageElement | null;
    expect(img).toBeTruthy();
    // proxyArtUrl converts external URLs to /api/art?src=…; the origin is
    // encoded in the query string, so check for the encoded domain.
    expect(img!.src).toContain("example.com");
  });

  it("swaps to the RUMOURS placeholder when the swatch fires an error event", () => {
    render(
      <ul>
        <LibraryRow item={makeItem("https://example.com/art.jpg")} />
      </ul>,
    );

    const img = document.querySelector(".lrow__art-img") as HTMLImageElement | null;
    expect(img).toBeTruthy();

    // Simulate the browser reporting a failed image load (e.g. proxy 404,
    // expired CDN URL, or network error).
    fireEvent.error(img!);

    expect(img!.src).toBe(RUMOURS);
  });

  it("does not enter a broken state on a second error after already showing RUMOURS", () => {
    // onArtError guards against setting src to RUMOURS when it's already RUMOURS,
    // which would cause an infinite error loop in browsers that fire onError
    // for the fallback itself.
    render(
      <ul>
        <LibraryRow item={makeItem("https://example.com/art.jpg")} />
      </ul>,
    );

    const img = document.querySelector(".lrow__art-img") as HTMLImageElement | null;
    expect(img).toBeTruthy();

    fireEvent.error(img!);
    expect(img!.src).toBe(RUMOURS);

    // Second error — guard must hold, src must remain RUMOURS
    fireEvent.error(img!);
    expect(img!.src).toBe(RUMOURS);
  });

  it("renders RUMOURS directly when artworkUrl is null — no broken state possible", () => {
    render(
      <ul>
        <LibraryRow item={makeItem(null)} />
      </ul>,
    );

    const img = document.querySelector(".lrow__art-img") as HTMLImageElement | null;
    expect(img).toBeTruthy();
    // When there is no artwork URL the img src is pre-set to RUMOURS, so it
    // never enters a broken state regardless of network conditions.
    expect(img!.src).toBe(RUMOURS);
  });
});
