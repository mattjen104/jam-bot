import { describe, expect, test } from "vitest";
import {
  buildAlbumGroups,
  buildArtistGroups,
  parseDemoSongSort,
} from "../src/pages/Library";
import type { LibraryItem } from "../src/lib/meHooks";
import {
  focusedDemoRedirectPath,
  shouldRenderStandalonePlayer,
} from "../src/lib/focusedDemoRouting";

describe("Library Demo", () => {
  test("redirects unsupported demo entry routes while preserving supported details", () => {
    expect(focusedDemoRedirectPath("/")).toBe("/library");
    expect(focusedDemoRedirectPath("/explore")).toBe("/library");
    expect(focusedDemoRedirectPath("/feed?artist=Stereolab")).toBe("/library");
    expect(focusedDemoRedirectPath("/library?view=songs")).toBeNull();
    expect(focusedDemoRedirectPath("/artist/artist-1")).toBeNull();
    expect(focusedDemoRedirectPath("/admin/health")).toBeNull();
    expect(shouldRenderStandalonePlayer("/player", true)).toBe(false);
    expect(shouldRenderStandalonePlayer("/player/history", false)).toBe(true);
  });

  test("accepts each supported Songs organization and rejects legacy values", () => {
    expect(parseDemoSongSort(null)).toBe("added");
    expect(parseDemoSongSort("added")).toBe("added");
    expect(parseDemoSongSort("artist")).toBe("artist");
    expect(parseDemoSongSort("album")).toBe("album");
    expect(parseDemoSongSort("title")).toBe("title");
    expect(parseDemoSongSort("count")).toBe("count");
    expect(parseDemoSongSort("artists")).toBe("added");
  });

  test("derives honest artist and album groups from saved songs", () => {
    const items = [
      {
        mbid: "track-1",
        addedAt: "2026-09-09T00:00:00.000Z",
        recording: {
          title: "French Disko",
          artist: "Stereolab",
          albumTitle: "Oscillons from the Anti-Sun",
          artworkUrl: null,
          releaseYear: 2005,
        },
        provenance: { kind: "keep" },
      },
      {
        mbid: "track-2",
        addedAt: "2026-09-08T00:00:00.000Z",
        recording: {
          title: "Brakhage",
          artist: "Stereolab",
          albumTitle: "Dots and Loops",
          artworkUrl: null,
          releaseYear: 1997,
        },
        provenance: { kind: "keep" },
      },
      {
        mbid: "track-3",
        addedAt: "2026-09-07T00:00:00.000Z",
        recording: {
          title: "Echo's Answer",
          artist: "Broadcast",
          albumTitle: "The Noise Made by People",
          artworkUrl: null,
          releaseYear: 2000,
        },
        provenance: { kind: "keep" },
      },
    ] as LibraryItem[];

    expect(buildAlbumGroups(items).map((group) => group.albumTitle)).toEqual([
      "Oscillons from the Anti-Sun",
      "Dots and Loops",
      "The Noise Made by People",
    ]);
    expect(buildArtistGroups(items).map((group) => [group.artist, group.items.length])).toEqual([
      ["Broadcast", 1],
      ["Stereolab", 2],
    ]);
  });
});
