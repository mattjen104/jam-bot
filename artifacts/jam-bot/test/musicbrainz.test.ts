import { describe, it, expect } from "vitest";
import {
  parseIsrcRecordingId,
  parseRecordingCredits,
  parseWorkWriters,
} from "../src/turntable/musicbrainz.js";

describe("MusicBrainz ISRC lookup parsing", () => {
  it("returns the first recording id", () => {
    expect(
      parseIsrcRecordingId({
        recordings: [{ id: "rec-1" }, { id: "rec-2" }],
      }),
    ).toBe("rec-1");
  });

  it("skips entries without an id, returns null when none", () => {
    expect(parseIsrcRecordingId({ recordings: [{}, { id: "rec-x" }] })).toBe(
      "rec-x",
    );
    expect(parseIsrcRecordingId({ recordings: [] })).toBeNull();
    expect(parseIsrcRecordingId({})).toBeNull();
  });
});

describe("MusicBrainz recording credits parsing", () => {
  it("extracts artist id, producers/engineers, instrument performers, and work ids", () => {
    const credits = parseRecordingCredits("rec-1", {
      "artist-credit": [{ artist: { id: "art-1", name: "M83" } }],
      relations: [
        { type: "producer", artist: { name: "Justin Meldal-Johnsen" } },
        { type: "engineer", artist: { name: "Some Engineer" } },
        {
          type: "instrument",
          artist: { name: "Anthony Gonzalez" },
          attributes: ["synthesizer"],
        },
        { type: "vocal", artist: { name: "Anthony Gonzalez" } },
        { type: "performance", work: { id: "work-1" } },
      ],
    });
    expect(credits.recordingId).toBe("rec-1");
    expect(credits.artistId).toBe("art-1");
    expect(credits.artistName).toBe("M83");
    expect(credits.personnel).toContainEqual({
      role: "producer",
      name: "Justin Meldal-Johnsen",
    });
    expect(credits.personnel).toContainEqual({
      role: "synthesizer",
      name: "Anthony Gonzalez",
    });
    // vocal rel with no attributes falls back to "performer"
    expect(credits.personnel).toContainEqual({
      role: "performer",
      name: "Anthony Gonzalez",
    });
    expect(credits.workIds).toEqual(["work-1"]);
  });

  it("dedupes identical role+name credits and handles an empty body", () => {
    const credits = parseRecordingCredits("rec-2", {
      relations: [
        { type: "producer", artist: { name: "X" } },
        { type: "producer", artist: { name: "X" } },
      ],
    });
    expect(credits.personnel).toEqual([{ role: "producer", name: "X" }]);

    const empty = parseRecordingCredits("rec-3", {});
    expect(empty.personnel).toEqual([]);
    expect(empty.workIds).toEqual([]);
    expect(empty.artistId).toBeUndefined();
  });
});

describe("MusicBrainz work writers parsing", () => {
  it("keeps only composer/lyricist/writer rels", () => {
    const writers = parseWorkWriters({
      relations: [
        { type: "composer", artist: { name: "Composer A" } },
        { type: "lyricist", artist: { name: "Lyricist B" } },
        { type: "publishing", artist: { name: "Some Publisher" } },
      ],
    });
    expect(writers).toEqual([
      { role: "composer", name: "Composer A" },
      { role: "lyricist", name: "Lyricist B" },
    ]);
  });
});
