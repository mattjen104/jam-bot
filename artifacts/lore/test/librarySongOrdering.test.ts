import { describe, expect, it } from "vitest";
import { compareLibrarySongs, libraryEra } from "../src/lib/librarySongOrdering";
import type { LibraryItem } from "../src/lib/meHooks";

const item = (mbid: string, year: number | null, genre?: string): LibraryItem => ({
  mbid, addedAt: "2026-01-01", provenance: { kind: "keep" },
  recording: {
    title: mbid, artist: "Artist", albumTitle: "Album", artworkUrl: null,
    releaseYear: year, spotifyUrl: null, genres: genre ? [genre] : null,
  },
});

describe("shared Library song ordering", () => {
  it("puts semantic current/catalog/deep/unknown eras in deterministic parity order", () => {
    const songs = [item("unknown", null), item("deep", 1990), item("current", 2026), item("catalog", 2023)];
    const ordered = [...songs].sort((a, b) => compareLibrarySongs(a, b, "era"));
    expect(ordered.map(song => song.mbid)).toEqual(["current", "catalog", "deep", "unknown"]);
    expect(libraryEra(songs[0])).toBe("unknown");
  });

  it("uses the same genre comparator regardless of presentation", () => {
    const songs = [item("z", 2000, "rock"), item("a", 2000, "jazz")];
    expect([...songs].sort((a, b) => compareLibrarySongs(a, b, "genre")).map(song => song.mbid))
      .toEqual(["a", "z"]);
  });
});