import { describe, expect, it } from "vitest";
import type { SongContext } from "@workspace/api-client-react";
import { buildGraph, verifiedMerchForContext } from "./graph";

function context(overrides: Partial<SongContext> = {}): SongContext {
  return {
    track: {
      id: "track",
      name: "Track",
      artists: ["Artist"],
      spotifyUrl: "https://open.spotify.com/track/track",
    },
    knowledge: {
      recordingId: "recording",
      artistId: "artist-mbid",
      artistName: "Artist",
      personnel: [],
      approximate: false,
      fetchedAtMs: 1,
    },
    context: null,
    catalogue: null,
    links: null,
    merch: [],
    insights: [],
    ...overrides,
  };
}

describe("verified merch graph branch", () => {
  it("adds one Support / Buy branch for deduplicated verified destinations", () => {
    const input = context({
      merch: [
        {
          artistMbid: "artist-mbid",
          artist: "Artist",
          title: "Tour shirt",
          destinationUrl: "https://artist.example/shop/shirt",
          imageUrl: null,
          source: "artist_store",
          provider: null,
          kind: "product",
        },
        {
          artistMbid: "artist-mbid",
          artist: "Artist",
          title: "Duplicate",
          destinationUrl: "https://artist.example/shop/shirt/",
          imageUrl: null,
          source: "artist_store",
          provider: null,
          kind: "product",
        },
      ],
    });

    const graph = buildGraph(input);
    expect(graph.nodes.filter((node) => node.category === "support")).toHaveLength(2);
    expect(graph.nodes.find((node) => node.id === "hub:support")?.label).toBe("Support / Buy");
  });

  it("does not fabricate commerce without matching canonical identity", () => {
    const product = {
      artistMbid: "other-artist",
      artist: "Other Artist",
      title: "Shirt",
      destinationUrl: "https://artist.example/shop/shirt",
      imageUrl: null,
      source: "artist_store",
      provider: null,
      kind: "product" as const,
    };
    expect(verifiedMerchForContext(context({ merch: [product] }))).toEqual([]);
    expect(verifiedMerchForContext(context({
      knowledge: null,
      context: null,
      merch: [{ ...product, artistMbid: "artist-mbid" }],
    }))).toEqual([]);
  });

  it("rejects unsafe destinations", () => {
    const input = context({
      merch: [{
        artistMbid: "artist-mbid",
        artist: "Artist",
        title: "Unsafe",
        destinationUrl: "http://127.0.0.1/shop",
        imageUrl: null,
        source: "artist_store",
        provider: null,
        kind: "product",
      }],
    });
    expect(verifiedMerchForContext(input)).toEqual([]);
  });
});