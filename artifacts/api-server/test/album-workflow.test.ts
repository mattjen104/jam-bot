import { describe, expect, it } from "vitest";
import {
  aggregateAlbums,
  cleanPicks,
  resolveTransitionMetadata,
} from "../src/routes/me/album-workflow.js";

describe("album workflow read model", () => {
  it("accepts only recording MBID picks and removes duplicates", () => {
    expect(cleanPicks(["a", "a", "", 4, " b "])).toEqual(["a", "b"]);
  });

  it("groups active recordings by release group without inventing an edition", () => {
    const rows = [
      {
        releaseGroupMbid: "rg-1",
        title: "Album",
        releaseYear: 1999,
        recordingMbid: "r-1",
        artist: "Artist",
        artistMbid: "a-1",
        artworkUrl: null,
      },
      {
        releaseGroupMbid: "rg-1",
        title: "Album",
        releaseYear: 1999,
        recordingMbid: "r-2",
        artist: "Artist",
        artistMbid: "a-1",
        artworkUrl: "https://art.example/album.jpg",
      },
    ] as never;
    const [album] = aggregateAlbums(rows, new Map());
    expect(album).toMatchObject({
      releaseGroupMbid: "rg-1",
      state: "inbox",
      trackCount: 2,
      activeTrackMbids: ["r-1", "r-2"],
    });
    expect(album?.artworkUrl).toBe("https://art.example/album.jpg");
  });

  it("preserves filing metadata on a state-only transition", () => {
    expect(resolveTransitionMetadata(
      { note: "Filed note", picks: ["r-1"] },
      undefined,
      undefined,
      new Set(["r-1"]),
    )).toEqual({ note: "Filed note", picks: ["r-1"] });
  });

  it("applies explicit filing changes and drops picks outside the active album", () => {
    expect(resolveTransitionMetadata(
      { note: "Old", picks: ["r-1"] },
      null,
      ["r-2", "not-active"],
      new Set(["r-1", "r-2"]),
    )).toEqual({ note: null, picks: ["r-2"] });
  });
});