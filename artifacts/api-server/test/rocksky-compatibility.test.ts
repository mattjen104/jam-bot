import { describe, expect, it } from "vitest";
import {
  classifyRockskySong,
  type RockskyManifestItem,
} from "../src/lore/rocksky-compatibility.js";

const item: RockskyManifestItem = {
  sampleId: "isrc:1",
  stratum: "isrc",
  spinId: 1,
  stationId: 1,
  playedAt: "2026-09-18T00:00:00.000Z",
  confidence: "isrc",
  rawArtist: "The Clientele",
  rawTitle: "Since K Got Over Me",
  mbid: "recording-1",
  isrc: "GBABC1234567",
  recordingArtist: "The Clientele",
  recordingTitle: "Since K Got Over Me",
  durationMs: 240_000,
  activeLibraryItem: false,
};

describe("classifyRockskySong", () => {
  it("classifies matching identity and normalized text as exact", () => {
    expect(classifyRockskySong(item, "isrc", item.isrc!, {
      artist: "the clientele",
      title: "Since K Got Over Me",
      mbId: item.mbid!,
      isrc: item.isrc!,
    })).toEqual({ matchClass: "exact", conflicts: [] });
  });

  it("keeps identifier agreement when display metadata differs", () => {
    expect(classifyRockskySong(item, "isrc", item.isrc!, {
      artist: "The Clientele",
      title: "Since K Got Over Me - Remastered",
      mbId: item.mbid!,
      isrc: item.isrc!,
    }).matchClass).toBe("compatible");
  });

  it("surfaces an identifier disagreement instead of accepting the text", () => {
    expect(classifyRockskySong(item, "mbid", item.mbid!, {
      artist: item.recordingArtist!,
      title: item.recordingTitle!,
      mbId: "different-recording",
      isrc: item.isrc!,
    })).toEqual({
      matchClass: "identifier_conflict",
      conflicts: ["mbid", "lore_mbid"],
    });
  });
});
