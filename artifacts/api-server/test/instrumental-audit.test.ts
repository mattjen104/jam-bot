import { describe, expect, it } from "vitest";
import {
  classifyInstrumentalStation,
  instrumentalDirectoryHints,
  officialInstrumentalClaim,
  type InstrumentalAuditTrack,
} from "../src/lore/instrumental-audit.js";

function track(
  lyricStatus: InstrumentalAuditTrack["lyricStatus"],
  index: number,
): InstrumentalAuditTrack {
  return {
    mbid: `recording-${index}`,
    artist: `Artist ${index}`,
    title: `Track ${index}`,
    playedAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
    genres: ["post-rock"],
    lyricStatus,
  };
}

describe("classifyInstrumentalStation", () => {
  it("confirms only an official claim with complete corroboration and no contradiction", () => {
    expect(classifyInstrumentalStation({
      officialFormatClaim: true,
      officialEvidenceSource: "https://station.example/format",
      directoryHints: ["instrumental"],
      tracks: [track("instrumental", 1), track("instrumental", 2), track("instrumental", 3)],
    })).toBe("confirmed_instrumental");
  });

  it("does not treat genuine LRCLIB misses as instrumental evidence", () => {
    expect(classifyInstrumentalStation({
      officialFormatClaim: true,
      officialEvidenceSource: "https://station.example/format",
      directoryHints: ["instrumental"],
      tracks: [track("no_result", 1), track("no_result", 2), track("no_result", 3)],
    })).toBe("unknown_insufficient");
  });

  it("keeps a drone-tagged station with a vocal contradiction unknown", () => {
    expect(classifyInstrumentalStation({
      officialFormatClaim: false,
      officialEvidenceSource: null,
      directoryHints: ["drone"],
      tracks: [
        track("instrumental", 1),
        track("instrumental", 2),
        track("instrumental", 3),
        track("lyrics_found", 4),
      ],
    })).toBe("unknown_insufficient");
  });

  it("uses mostly for corroborated evidence lacking an official claim", () => {
    expect(classifyInstrumentalStation({
      officialFormatClaim: false,
      officialEvidenceSource: null,
      directoryHints: ["instrumental"],
      tracks: [track("instrumental", 1), track("instrumental", 2), track("instrumental", 3)],
    })).toBe("mostly_instrumental");
  });

  it("does not call a sparse handful of positives mostly instrumental", () => {
    expect(classifyInstrumentalStation({
      officialFormatClaim: false,
      officialEvidenceSource: null,
      directoryHints: ["instrumental"],
      tracks: [
        track("instrumental", 1),
        track("instrumental", 2),
        track("instrumental", 3),
        ...Array.from({ length: 9 }, (_, index) => track("no_result", index + 4)),
      ],
    })).toBe("unknown_insufficient");
  });

  it("keeps strong partial evidence unknown while provider work is incomplete", () => {
    expect(classifyInstrumentalStation({
      officialFormatClaim: false,
      officialEvidenceSource: null,
      directoryHints: ["instrumental"],
      tracks: [
        ...Array.from({ length: 18 }, (_, index) => track("instrumental", index)),
        ...Array.from({ length: 6 }, (_, index) => track("transient_failure", index + 18)),
      ],
    })).toBe("unknown_insufficient");
  });

  it("keeps sparse official evidence unknown", () => {
    expect(classifyInstrumentalStation({
      officialFormatClaim: true,
      officialEvidenceSource: "https://station.example/format",
      directoryHints: [],
      tracks: [track("instrumental", 1), track("instrumental", 2)],
    })).toBe("unknown_insufficient");
  });
});

describe("instrumental candidate evidence", () => {
  it("treats drone names and tags as hints, not official claims", () => {
    expect(instrumentalDirectoryHints("Deep Drone Radio", ["ambient"])).toContain(
      "deep drone radio",
    );
    expect(officialInstrumentalClaim({ evidenceUrl: "https://example.com" })).toBeNull();
  });

  it("requires an official evidence URL or source for a claim", () => {
    expect(officialInstrumentalClaim({ instrumentalClaim: true })).toBeNull();
    expect(officialInstrumentalClaim({
      instrumentalClaim: true,
      evidenceUrl: "https://nightride.fm/",
    })).toEqual({ source: "https://nightride.fm/", note: undefined });
  });
});