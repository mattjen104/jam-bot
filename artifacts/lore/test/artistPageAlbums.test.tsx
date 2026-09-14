/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchNextPage, getRecordingAlbumTracks, startReplay, useGetArtist, useMyLibraryInfinite, useSearchArtistStations } = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  getRecordingAlbumTracks: vi.fn(),
  startReplay: vi.fn(),
  useGetArtist: vi.fn(),
  useMyLibraryInfinite: vi.fn(),
  useSearchArtistStations: vi.fn(() => ({ data: { stations: [] } })),
}));

vi.mock("wouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("wouter")>();
  return { ...original, useParams: () => ({ mbid: "artist-mbid" }) };
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...original,
    getRecordingAlbumTracks,
    useGetArtist,
    useSearchArtistStations,
    getSearchArtistStationsQueryKey: vi.fn(() => ["artist-stations"]),
  };
});

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({ ride: { startReplay } }),
}));

vi.mock("../src/lib/meHooks", () => ({
  useAppConfig: () => ({ data: { demoSurface: false } }),
  useMyLibraryInfinite,
}));

import Artist from "../src/pages/Artist";

const artistResult = {
  mbid: "artist-mbid",
  name: "The Artist",
  topTracks: [],
  albums: [{
    releaseGroupMbid: "release-group",
    title: "The Album",
    releaseYear: 2024,
    primaryType: "Album",
    artworkUrl: "https://example.com/cover.jpg",
    firstRecordingMbid: "anchor-mbid",
    trackCount: 2,
  }],
  catalogue: null,
};

describe("artist album playback", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    useGetArtist.mockReturnValue({ data: artistResult, isLoading: false, isError: false });
    useMyLibraryInfinite.mockReturnValue({
      data: { pages: [{ items: [] }] },
      hasNextPage: false,
      fetchNextPage,
      isFetchingNextPage: false,
    });
  });

  it("starts the grounded album tracks in their returned order", async () => {
    getRecordingAlbumTracks.mockResolvedValue({
      rgTitle: "The Album",
      tracks: [
        { mbid: "track-1", title: "First", artist: "The Artist" },
        { mbid: "track-2", title: "Second", artist: "The Artist" },
      ],
    });
    render(<Artist />);

    fireEvent.click(screen.getByRole("button", { name: "Play The Album" }));

    await waitFor(() => expect(startReplay).toHaveBeenCalledTimes(1));
    expect(getRecordingAlbumTracks).toHaveBeenCalledWith("anchor-mbid", {
      canonicalOrder: true,
    });
    expect(startReplay.mock.calls[0]?.[0].map((seed: { mbid: string }) => seed.mbid))
      .toEqual(["track-1", "track-2"]);
    expect(startReplay).toHaveBeenCalledWith(
      expect.any(Array),
      "The Album",
      { timeOrientation: "curated", context: "library" },
    );
  });

  it("explains and disables an album when no playable tracks resolve", async () => {
    getRecordingAlbumTracks.mockResolvedValue({ rgTitle: "The Album", tracks: [] });
    render(<Artist />);

    fireEvent.click(screen.getByRole("button", { name: "Play The Album" }));

    const unavailable = await screen.findByRole("button", { name: "The Album is unavailable to play" });
    expect((unavailable as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("No playable tracks");
    expect(startReplay).not.toHaveBeenCalled();
  });

  it("progressively loads every matching Library page", async () => {
    useMyLibraryInfinite.mockReturnValue({
      data: { pages: [{ items: [] }] },
      hasNextPage: true,
      fetchNextPage,
      isFetchingNextPage: false,
    });
    render(<Artist />);
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(1));
    expect(useMyLibraryInfinite).toHaveBeenCalledWith({ q: "The Artist" }, 100);
  });
});