/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useGetCollection, useGetCollectionPlayerCapability } = vi.hoisted(() => ({
  useGetCollection: vi.fn(),
  useGetCollectionPlayerCapability: vi.fn(),
}));

vi.mock("wouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useParams: () => ({ slug: "mixed-set" }),
  useSearch: () => "",
}));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetCollection,
  useGetCollectionJspf: () => ({ data: undefined }),
  useGetCollectionPlayerCapability,
}));
vi.mock("../src/hooks/usePublicCollectionCredits", () => ({
  usePublicCollectionCredits: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("../src/lib/meHooks", () => ({
  useMyLibraryMbids: () => ({ data: { mbids: [] } }),
}));
vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({ ride: { active: false, current: null, startReplay: vi.fn(), stop: vi.fn() } }),
}));

import PublicCollection from "../src/pages/PublicCollection";

describe("non-canonical collection playback capability", () => {
  afterEach(cleanup);

  it("shows the unavailable reason without offering preview", () => {
    useGetCollection.mockReturnValue({
      data: {
        schema: "lore.collection.v1",
        kind: "playlist",
        slug: "mixed-set",
        title: "Mixed set",
        description: null,
        curatorNotes: null,
        coverArt: null,
        entries: [{ identity: "mbid", mbid: "track-1", title: "Track", artist: "Artist" }],
        provenance: { authority: "lore", public: true },
        canonicalAlbumHref: null,
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    useGetCollectionPlayerCapability.mockReturnValue({
      data: { available: false, reason: "No compatible player is available." },
      isError: false,
    });
    render(<PublicCollection />);
    expect(screen.getByText("No compatible player is available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
  });
});