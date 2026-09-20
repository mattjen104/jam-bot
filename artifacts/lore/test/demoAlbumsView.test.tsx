/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useGetArtist, useGetMyAlbums } = vi.hoisted(() => ({
  useGetArtist: vi.fn(),
  useGetMyAlbums: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetArtist,
  useGetMyAlbums,
}));

import { DemoAlbumsView } from "../src/components/DemoAlbumsView";

describe("DemoAlbumsView artist focus", () => {
  afterEach(cleanup);

  it("includes canonical imported albums even when they are not personal library rows", () => {
    useGetMyAlbums.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false, isError: false });
    useGetArtist.mockReturnValue({
      data: {
        mbid: "fleetwood-mac",
        name: "Fleetwood Mac",
        topTracks: [],
        creditedAlbums: [],
        creditBacklinks: [],
        catalogue: null,
        albums: [{
          releaseGroupMbid: "rumours",
          title: "Rumours",
          releaseYear: 1977,
          primaryType: "Album",
          artworkUrl: null,
          firstRecordingMbid: "dreams",
          trackCount: 11,
        }],
      },
      isLoading: false,
      isError: false,
    });

    render(
      <DemoAlbumsView
        focusedArtist="Fleetwood Mac"
        focusedArtistMbid="fleetwood-mac"
        returnContext="/library?view=albums"
      />,
    );

    expect(screen.getByText("Rumours")).toBeTruthy();
    expect(screen.queryByText("No albums found for Fleetwood Mac.")).toBeNull();
  });
});