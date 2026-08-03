import { describe, expect, it } from "vitest";
import { topArtistsFromSpins, type DialSpin } from "../src/hooks/useDialData";

function spin(artist: string, hitField: "isLibraryHit" | "isArtistHit" = "isLibraryHit"): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    title: "Track",
    artist,
    playedAt: new Date(0).toISOString(),
    isLibraryHit: hitField === "isLibraryHit",
    isArtistHit: hitField === "isArtistHit",
    isFirstSpin: false,
  };
}

describe("topArtistsFromSpins", () => {
  it("excludes legacy domain metadata from ranked listener artists", () => {
    expect(topArtistsFromSpins([
      spin("wellsfargo.com"),
      spin("Björk"),
      spin("https://sponsor.example.com"),
      spin("坂本龍一"),
    ])).toEqual(["Björk", "坂本龍一"]);
  });

  it("preserves valid international artists while trimming display whitespace", () => {
    expect(topArtistsFromSpins([
      spin("  Кино  "),
      spin("فيروز"),
      spin("  Radiohead"),
    ])).toEqual(["Кино", "فيروز", "Radiohead"]);
  });
});