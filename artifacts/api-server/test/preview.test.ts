import { describe, it, expect } from "vitest";
import { parseItunesPreview } from "../src/lore/preview.js";

/**
 * Pure-unit tests for iTunes preview selection. The network + cache wrapper
 * (resolvePreview) is exercised end-to-end; the matching/upscaling logic below
 * is where the bugs hide: loose title/artist matching, artwork upscaling, and
 * degrading to nulls when nothing is playable. No DB, no network.
 */

function result(
  overrides: Partial<{
    trackName: string;
    artistName: string;
    previewUrl: string;
    artworkUrl100: string;
  }> = {},
) {
  return {
    trackName: "Go Your Own Way",
    artistName: "Fleetwood Mac",
    previewUrl: "https://audio.example/preview.m4a",
    artworkUrl100:
      "https://is1.mzstatic.com/image/thumb/x/y/z.jpg/100x100bb.jpg",
    ...overrides,
  };
}

describe("parseItunesPreview", () => {
  it("returns the exact match and upscales the artwork to 600x600", () => {
    const out = parseItunesPreview(
      { results: [result()] },
      "Fleetwood Mac",
      "Go Your Own Way",
    );
    expect(out.previewUrl).toBe("https://audio.example/preview.m4a");
    expect(out.artworkUrl).toBe(
      "https://is1.mzstatic.com/image/thumb/x/y/z.jpg/600x600bb.jpg",
    );
    expect(out.source).toBe("itunes");
  });

  it("prefers the result whose artist AND title both match", () => {
    const body = {
      results: [
        result({
          trackName: "Go Your Own Way",
          artistName: "A Tribute Band",
          previewUrl: "https://audio.example/wrong.m4a",
        }),
        result({
          trackName: "Go Your Own Way (2004 Remaster)",
          artistName: "Fleetwood Mac",
          previewUrl: "https://audio.example/right.m4a",
        }),
      ],
    };
    const out = parseItunesPreview(body, "Fleetwood Mac", "Go Your Own Way");
    expect(out.previewUrl).toBe("https://audio.example/right.m4a");
  });

  it("matches loosely across bracketed/parenthetical suffixes", () => {
    const out = parseItunesPreview(
      {
        results: [
          result({ trackName: "Otherside [Live]", artistName: "Red Hot Chili Peppers" }),
        ],
      },
      "Red Hot Chili Peppers",
      "Otherside",
    );
    expect(out.previewUrl).toBe("https://audio.example/preview.m4a");
  });

  it("skips results that have no previewUrl", () => {
    const body = {
      results: [
        { trackName: "Go Your Own Way", artistName: "Fleetwood Mac" },
        result({ previewUrl: "https://audio.example/only-one.m4a" }),
      ],
    };
    const out = parseItunesPreview(body, "Fleetwood Mac", "Go Your Own Way");
    expect(out.previewUrl).toBe("https://audio.example/only-one.m4a");
  });

  it("falls back to the first previewable result when nothing matches", () => {
    const out = parseItunesPreview(
      {
        results: [
          result({
            trackName: "Totally Different Song",
            artistName: "Totally Different Artist",
            previewUrl: "https://audio.example/fallback.m4a",
          }),
        ],
      },
      "Fleetwood Mac",
      "Go Your Own Way",
    );
    expect(out.previewUrl).toBe("https://audio.example/fallback.m4a");
  });

  it("returns all-null (never throws) for empty or malformed bodies", () => {
    for (const body of [null, undefined, {}, { results: [] }, { results: "x" }]) {
      const out = parseItunesPreview(body, "Any", "Thing");
      expect(out).toEqual({ previewUrl: null, artworkUrl: null, source: null });
    }
  });

  it("returns a preview with null artwork when the thumbnail is absent", () => {
    const out = parseItunesPreview(
      { results: [result({ artworkUrl100: undefined })] },
      "Fleetwood Mac",
      "Go Your Own Way",
    );
    expect(out.previewUrl).toBe("https://audio.example/preview.m4a");
    expect(out.artworkUrl).toBeNull();
  });
});
