import { describe, it, expect } from "vitest";
import {
  parseArtistTags,
  parseSimilarArtists,
} from "../src/turntable/lastfm.js";

describe("Last.fm tag parsing", () => {
  it("returns clean genre tags, capped and deduped", () => {
    const tags = parseArtistTags({
      toptags: {
        tag: [
          { name: "electronic" },
          { name: "Electronic" }, // dup (case-insensitive)
          { name: "seen live" }, // junk
          { name: "shoegaze" },
          { name: "dream pop" },
          { name: "synthpop" },
          { name: "ambient" },
        ],
      },
    });
    expect(tags).toEqual([
      "electronic",
      "shoegaze",
      "dream pop",
      "synthpop",
      "ambient",
    ]);
  });

  it("drops folksonomy noise and respects a custom cap", () => {
    expect(
      parseArtistTags(
        {
          toptags: {
            tag: [
              { name: "favorites" },
              { name: "rock" },
              { name: "albums i own" },
              { name: "indie" },
            ],
          },
        },
        1,
      ),
    ).toEqual(["rock"]);
  });

  it("returns [] on empty/malformed bodies", () => {
    expect(parseArtistTags({})).toEqual([]);
    expect(parseArtistTags({ toptags: {} })).toEqual([]);
    expect(parseArtistTags({ toptags: { tag: [{ name: "  " }] } })).toEqual([]);
  });
});

describe("Last.fm similar-artist parsing", () => {
  it("returns similar artist names, capped and deduped", () => {
    const similar = parseSimilarArtists({
      similarartists: {
        artist: [
          { name: "Boards of Canada" },
          { name: "Tycho" },
          { name: "Tycho" }, // dup
          { name: "Bonobo" },
          { name: "Four Tet" },
          { name: "Jon Hopkins" },
        ],
      },
    });
    expect(similar).toEqual([
      "Boards of Canada",
      "Tycho",
      "Bonobo",
      "Four Tet",
    ]);
  });

  it("returns [] on empty/malformed bodies", () => {
    expect(parseSimilarArtists({})).toEqual([]);
    expect(parseSimilarArtists({ similarartists: { artist: [] } })).toEqual([]);
  });
});
