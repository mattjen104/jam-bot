import { describe, it, expect } from "vitest";
import { parseGeniusSearch } from "../src/turntable/genius.js";

describe("Genius search parsing", () => {
  const body = {
    response: {
      hits: [
        {
          result: {
            url: "https://genius.com/Other-artist-song-lyrics",
            primary_artist: { name: "Other Artist" },
          },
        },
        {
          result: {
            url: "https://genius.com/M83-midnight-city-lyrics",
            primary_artist: { name: "M83" },
          },
        },
      ],
    },
  };

  it("prefers the hit whose primary artist matches", () => {
    expect(parseGeniusSearch(body, "M83")).toBe(
      "https://genius.com/M83-midnight-city-lyrics",
    );
  });

  it("matches artists case- and punctuation-insensitively", () => {
    expect(
      parseGeniusSearch(
        {
          response: {
            hits: [
              {
                result: {
                  url: "https://genius.com/song",
                  primary_artist: { name: "Beyoncé" },
                },
              },
            ],
          },
        },
        "beyonce",
      ),
    ).toBe("https://genius.com/song");
  });

  it("falls back to the first hit with a URL when no artist matches", () => {
    expect(parseGeniusSearch(body, "Nobody")).toBe(
      "https://genius.com/Other-artist-song-lyrics",
    );
  });

  it("takes the first hit when no artist is supplied", () => {
    expect(parseGeniusSearch(body)).toBe(
      "https://genius.com/Other-artist-song-lyrics",
    );
  });

  it("returns null on no usable hits", () => {
    expect(parseGeniusSearch({ response: { hits: [] } })).toBeNull();
    expect(parseGeniusSearch({})).toBeNull();
    expect(
      parseGeniusSearch({ response: { hits: [{ result: {} }] } }, "X"),
    ).toBeNull();
  });
});
