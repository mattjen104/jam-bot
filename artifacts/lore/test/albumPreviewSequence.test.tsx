/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useGetAlbum } = vi.hoisted(() => ({ useGetAlbum: vi.fn() }));

vi.mock("wouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("wouter")>();
  return {
    ...original,
    useParams: () => ({ releaseGroupMbid: "release-group" }),
    useSearch: () => "?track=track-1&return=%2Flibrary%3Fview%3Dsongs&returnScroll=240",
  };
});
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetAlbum,
  useGetCollection: () => ({ data: undefined, isLoading: false, isError: false }),
  useGetCollectionJspf: () => ({ data: undefined }),
  useGetCollectionPlayerCapability: () => ({ data: undefined }),
}));
vi.mock("../src/lib/meHooks", () => ({
  useAppConfig: () => ({ data: { demoSurface: true } }),
  useMyLibraryMbids: () => ({ data: { mbids: ["track-2"], releaseGroupMbids: [] } }),
}));
vi.mock("../src/hooks/useAlbumCredits", () => ({ useAlbumCredits: () => ({ data: undefined, isLoading: false }) }));
vi.mock("../src/hooks/usePublicCollectionCredits", () => ({ usePublicCollectionCredits: () => ({ data: undefined, isLoading: false }) }));
vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({ ride: { active: false, current: null, startReplay: vi.fn(), stop: vi.fn() } }),
}));
vi.mock("../src/components/ListProvenance", () => ({ AlbumListProvenance: () => null }));
vi.mock("../src/components/PublishCollectionButton", () => ({
  PublishCollectionButton: () => null,
  collectionSlugSuggestion: () => "exact-album",
}));

import Album from "../src/pages/Album";
import { buildCanonicalAlbumJspf } from "../src/lib/albumJspf";

describe("canonical album ordering and playback honesty", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useGetAlbum.mockReturnValue({
      data: {
        releaseGroupMbid: "release-group",
        canonicalAlbumHref: "/album/release-group",
        title: "Exact Album",
        primaryType: "Album",
        releaseYear: 2026,
        knowledge: null,
        tracks: [
          { mbid: "track-1", title: "Popular first", artist: "Exact Artist", artistMbid: "artist-id", artworkUrl: null, spinCount: 2, lastSpunAt: null },
          { mbid: "track-2", title: "Another known track", artist: "Exact Artist", artistMbid: "artist-id", artworkUrl: null, spinCount: 0, lastSpunAt: null },
        ],
      },
      isLoading: false,
      isError: false,
    });
  });
  afterEach(cleanup);

  it("does not present Lore ranking as release positions or advertise unverified previews", () => {
    render(<Album />);
    expect(screen.getByText("Known tracks")).toBeTruthy();
    expect(screen.getByText(/release order not yet verified/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /preview album/i })).toBeNull();
    expect(screen.getByTestId("album-preview-unavailable").textContent)
      .toContain("no verified in-app preview capability");
    expect(screen.getByTestId("back-to-dial").getAttribute("href"))
      .toBe("/library?view=songs&scroll=240");
    expect(screen.getAllByTestId("album-track")[1]?.textContent).toContain("Kept");
    expect(screen.getByTestId("download-jspf")).toBeTruthy();
    expect(screen.getByTestId("download-jspf").textContent).toContain("Export JSPF");
    expect(screen.queryByText(/parachord/i)).toBeNull();
    expect(screen.queryByText(/no exact provider album links have been verified/i)).toBeNull();
  });

  it("builds a provider-neutral canonical album handoff without inventing release order", () => {
    const jspf = buildCanonicalAlbumJspf({
      releaseGroupMbid: "release-group",
      title: "Exact Album",
      artist: "Exact Artist",
      artworkUrl: null,
      tracks: [
        { mbid: "track-1", title: "One", artist: "Exact Artist", artworkUrl: null },
        { mbid: "", title: "Unresolved gap", artist: "Exact Artist", artworkUrl: null },
      ],
      providerAlbumLinks: {
        spotify: "https://open.spotify.com/album/0123456789012345678901",
        appleMusic: "https://music.apple.com/us/album/exact/1",
        qobuz: "https://www.qobuz.com/us-en/album/exact/1",
      },
    });
    expect(jspf.playlist.meta["lore:release-group"]).toBe("release-group");
    expect(jspf.playlist.meta["lore:order"]).toBe("unverified");
    expect(jspf.playlist.meta["lore:album-apple-music"]).toContain("music.apple.com");
    expect(jspf.playlist.meta["lore:album-qobuz"]).toContain("qobuz.com");
    expect(jspf.playlist.track).toHaveLength(1);
    expect(jspf.playlist.track[0]?.identifier).toEqual(["musicbrainz:recording:track-1"]);
  });
});