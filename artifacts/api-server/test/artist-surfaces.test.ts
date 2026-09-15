import { describe, expect, it } from "vitest";
import {
  buildAlbumReadModel,
  dedupeMerchProducts,
  normalizeArtistName,
  selectTasteRecordings,
} from "../src/routes/me/artist-surfaces.js";

describe("artist-centered read models", () => {
  it("uses exact library artist identities and seed-only name fallback", () => {
    const rows = [
      { mbid: "kept", title: "Kept", artist: "A Band", artistMbid: "artist-a", artworkUrl: null },
      { mbid: "same", title: "Same", artist: "A Band", artistMbid: "artist-a", artworkUrl: null },
      { mbid: "seed", title: "Seed", artist: "The Seed", artistMbid: null, artworkUrl: null },
      { mbid: "other", title: "Other", artist: "A Band", artistMbid: "artist-other", artworkUrl: null },
    ];
    const selected = selectTasteRecordings(rows, new Set(["artist-a"]), [
      normalizeArtistName("The Seed"),
    ]);
    expect(selected.map((row) => row.mbid)).toEqual(["kept", "same", "seed"]);
    // This read-model calculation never adds a library keep.
    expect(rows).toHaveLength(4);
  });

  it("deduplicates merch by safe destination and requires an image", () => {
    const rows = [
      {
        title: "Album",
        artist: "Artist",
        imageUrl: "https://img.example/album.jpg",
        destinationUrl: "https://shop.example/album/",
        source: "artist_direct",
        provider: "bandcamp",
        kind: "artist_direct",
      },
      {
        title: "Duplicate",
        artist: "Artist",
        imageUrl: "https://img.example/other.jpg",
        destinationUrl: "https://shop.example/album",
        source: "label",
        provider: "label",
        kind: "label",
      },
      {
        title: "No image",
        artist: "Artist",
        imageUrl: null,
        destinationUrl: "https://shop.example/no-image",
        source: "artist_direct",
        provider: null,
        kind: "artist_direct",
      },
      {
        title: "Unsafe",
        artist: "Artist",
        imageUrl: "https://img.example/unsafe.jpg",
        destinationUrl: "javascript:alert(1)",
        source: "artist_direct",
        provider: null,
        kind: "artist_direct",
      },
    ];
    expect(dedupeMerchProducts(rows)).toEqual([
      {
        title: "Album",
        artist: "Artist",
        imageUrl: "https://img.example/album.jpg",
        destinationUrl: "https://shop.example/album/",
        source: "artist_direct",
        provider: "bandcamp",
        kind: "artist_direct",
      },
    ]);
  });

  it("deduplicates primary release groups while retaining honest counts", () => {
    const rows = [
      {
        releaseGroupMbid: "rg",
        title: "Album",
        primaryType: "Album",
        releaseYear: 2020,
        recordingMbid: "b",
        artist: "Artist",
        artistMbid: "artist",
        artworkUrl: "https://img.example/album.jpg",
      },
      {
        releaseGroupMbid: "rg",
        title: "Album",
        primaryType: "Album",
        releaseYear: 2020,
        recordingMbid: "a",
        artist: "Artist",
        artistMbid: "artist",
        artworkUrl: null,
      },
      {
        releaseGroupMbid: "single",
        title: "Single",
        primaryType: "Single",
        releaseYear: 2021,
        recordingMbid: "s",
        artist: "Artist",
        artistMbid: "artist",
        artworkUrl: "https://img.example/single.jpg",
      },
    ];
    expect(buildAlbumReadModel(rows, new Set(["a"]), new Map([["a", 2], ["b", 1]]))).toEqual([
      {
        releaseGroupMbid: "rg",
        title: "Album",
        artist: "Artist",
        artistMbid: "artist",
        artworkUrl: "https://img.example/album.jpg",
        releaseYear: 2020,
        primaryType: "Album",
        firstRecordingMbid: "a",
        trackCount: 2,
        libraryTrackCount: 1,
        spinCount: 3,
      },
    ]);
  });
});