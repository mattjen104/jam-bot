/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getArtistMetadata, useGetArtist, useMyLibraryInfinite, useSearchArtistStations } = vi.hoisted(() => ({
  getArtistMetadata: vi.fn(),
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
    getArtistMetadata,
    useGetArtist,
    useSearchArtistStations,
    getSearchArtistStationsQueryKey: vi.fn(() => ["artist-stations"]),
  };
});

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({ ride: { startReplay: vi.fn() } }),
}));

vi.mock("../src/lib/meHooks", () => ({
  useAppConfig: () => ({ data: { demoSurface: false } }),
  useMyLibraryInfinite,
}));

import Artist from "../src/pages/Artist";

describe("artist metadata section", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    useGetArtist.mockReturnValue({
      data: {
        mbid: "artist-mbid",
        name: "The Artist",
        topTracks: [],
        albums: [],
        catalogue: null,
      },
      isLoading: false,
      isError: false,
    });
    useMyLibraryInfinite.mockReturnValue({
      data: { pages: [{ items: [] }] },
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    });
  });

  it("renders grounded metadata without changing the page when the bridge is unavailable", async () => {
    getArtistMetadata.mockResolvedValue({
      mbid: "artist-mbid",
      status: "success",
      qid: "Q42",
      metadata: {
        aliases: ["The Example"],
        inceptionDate: "1980-00-00",
        formationPlace: { qid: "Q99", url: "https://www.wikidata.org/wiki/Q99" },
        officialWebsite: "https://example.com",
        recordLabels: [],
        groups: [],
        members: [],
      },
      fetchedAt: "2024-01-01T00:00:00.000Z",
      expiresAt: "2024-02-01T00:00:00.000Z",
    });
    render(<Artist />);
    expect((await screen.findByTestId("artist-about")).textContent).toContain("The Example");
    expect(screen.getByText("Official website →")).toBeTruthy();
  });

  it("silently omits provider errors", async () => {
    getArtistMetadata.mockResolvedValue({
      mbid: "artist-mbid",
      status: "error",
      qid: null,
      metadata: null,
      fetchedAt: "2024-01-01T00:00:00.000Z",
      expiresAt: "2024-01-01T01:00:00.000Z",
    });
    render(<Artist />);
    await waitFor(() => expect(getArtistMetadata).toHaveBeenCalledWith("artist-mbid"));
    expect(screen.queryByTestId("artist-about")).toBeNull();
  });
});