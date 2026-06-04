import { describe, it, expect } from "vitest";
import { parseOdesliLinks } from "../src/turntable/odesli.js";

describe("Odesli link parsing", () => {
  it("curates known platforms in display order, excludes the rest, keeps pageUrl", () => {
    const { platforms, pageUrl } = parseOdesliLinks({
      pageUrl: "https://song.link/s/abc",
      linksByPlatform: {
        // Out of display order on purpose — output should be normalized.
        tidal: { url: "https://tidal.com/track/1" },
        appleMusic: { url: "https://music.apple.com/1" },
        youtube: { url: "https://youtube.com/watch?v=1" },
        spotify: { url: "https://open.spotify.com/track/1" },
        // Unknown platform we don't surface.
        someObscureThing: { url: "https://example.com/1" },
      },
    });
    expect(pageUrl).toBe("https://song.link/s/abc");
    expect(platforms.map((p) => p.name)).toEqual([
      "Apple Music",
      "YouTube",
      "Tidal",
    ]);
    // Spotify (the source) is never listed.
    expect(platforms.some((p) => p.url.includes("open.spotify.com"))).toBe(false);
  });

  it("dedupes identical urls and tolerates missing data", () => {
    const { platforms, pageUrl } = parseOdesliLinks({
      linksByPlatform: {
        youtube: { url: "https://dup/1" },
        youtubeMusic: { url: "https://dup/1" },
      },
    });
    expect(platforms).toHaveLength(1);
    expect(pageUrl).toBeUndefined();

    const empty = parseOdesliLinks({});
    expect(empty.platforms).toEqual([]);
    expect(empty.pageUrl).toBeUndefined();

    const junk = parseOdesliLinks(null);
    expect(junk.platforms).toEqual([]);
  });
});
