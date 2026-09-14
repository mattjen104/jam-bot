/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { stop, toggle, useGetAlbum } = vi.hoisted(() => ({
  stop: vi.fn(),
  toggle: vi.fn(),
  useGetAlbum: vi.fn(),
}));

vi.mock("wouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("wouter")>();
  return {
    ...original,
    useParams: () => ({ releaseGroupMbid: "release-group" }),
    useSearch: () => "?track=track-1&return=%2Flibrary%3Fview%3Dsongs&returnScroll=240",
  };
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/api-client-react")>();
  return { ...original, useGetAlbum };
});

vi.mock("../src/lib/meHooks", () => ({
  useAppConfig: () => ({ data: { demoSurface: true } }),
  useMyLibraryMbids: () => ({ data: { mbids: ["track-2"] } }),
}));

vi.mock("../src/player/inlinePreview", () => ({
  useInlinePreview: () => ({
    playingMbid: null,
    loadingMbid: null,
    toggle,
    stop,
  }),
}));

vi.mock("../src/components/ListProvenance", () => ({
  AlbumListProvenance: () => null,
}));

import Album from "../src/pages/Album";

const album = {
  releaseGroupMbid: "release-group",
  title: "Exact Album",
  primaryType: "Album",
  releaseYear: 2026,
  tracks: [
    {
      mbid: "track-1",
      title: "Unavailable First",
      artist: "Exact Artist",
      artistMbid: "artist-id",
      artworkUrl: null,
      spinCount: 2,
      lastSpunAt: "2026-09-10T12:00:00Z",
    },
    {
      mbid: "track-2",
      title: "Playable Second",
      artist: "Exact Artist",
      artistMbid: "artist-id",
      artworkUrl: null,
      spinCount: 0,
      lastSpunAt: null,
    },
  ],
};

describe("Album preview sequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useGetAlbum.mockReturnValue({ data: album, isLoading: false, isError: false });
    toggle
      .mockResolvedValueOnce("unavailable")
      .mockResolvedValueOnce("playing");
  });

  afterEach(cleanup);

  it("skips unavailable clips in release order and preserves entity return context", async () => {
    render(<Album />);

    expect(screen.getByText("30-second clips")).toBeTruthy();
    expect(screen.getByTestId("back-to-dial").getAttribute("href"))
      .toBe("/library?view=songs&scroll=240");
    expect(screen.getByTestId("album-artist-link").getAttribute("href"))
      .toContain("/artist/artist-id?return=%2Flibrary%3Fview%3Dsongs");
    expect(screen.getAllByTestId("album-track")[0]?.getAttribute("href"))
      .toContain("/song/track-1?return=%2Flibrary%3Fview%3Dsongs");
    expect(screen.getAllByTestId("album-track")[0]?.textContent).not.toContain("Kept");
    expect(screen.getAllByTestId("album-track")[1]?.textContent).toContain("Kept");

    fireEvent.click(screen.getByRole("button", { name: "Preview Album" }));

    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(2));
    expect(toggle.mock.calls.map(([mbid]) => mbid)).toEqual(["track-1", "track-2"]);
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });

  it("releases the single preview owner when the album page unmounts", () => {
    const view = render(<Album />);
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});