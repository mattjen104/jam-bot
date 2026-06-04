import { describe, it, expect } from "vitest";
import {
  parseIsrcRecordingId,
  parseRecordingCredits,
  parseWorkWriters,
  parseArtistReleaseGroups,
  parseArtistRelations,
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

describe("MusicBrainz artist release-group parsing", () => {
  it("keeps primary works newest-first, drops secondary types and dups, caps", () => {
    const groups = parseArtistReleaseGroups({
      "release-groups": [
        {
          id: "rg-old",
          title: "Dead Cities",
          "first-release-date": "2003-03-01",
          "primary-type": "Album",
        },
        {
          id: "rg-new",
          title: "Hurry Up",
          "first-release-date": "2011-10-18",
          "primary-type": "Album",
        },
        // Secondary-typed (compilation/live) is excluded.
        {
          id: "rg-comp",
          title: "Best Of",
          "first-release-date": "2015-01-01",
          "primary-type": "Album",
          "secondary-types": ["Compilation"],
        },
        // Duplicate title is dropped.
        { id: "rg-dup", title: "Hurry Up", "primary-type": "Album" },
        // No id/title -> skipped.
        { title: "No Id" },
      ],
    });
    expect(groups.map((g) => g.title)).toEqual(["Hurry Up", "Dead Cities"]);
    expect(groups[0]).toMatchObject({ id: "rg-new", year: 2011 });
    expect(groups.some((g) => g.title === "Best Of")).toBe(false);
  });

  it("caps the list and tolerates junk input", () => {
    const many = {
      "release-groups": Array.from({ length: 10 }, (_, i) => ({
        id: `rg-${i}`,
        title: `Album ${i}`,
        "first-release-date": `20${10 + i}-01-01`,
        "primary-type": "Album",
      })),
    };
    expect(parseArtistReleaseGroups(many, 3)).toHaveLength(3);
    expect(parseArtistReleaseGroups(null)).toEqual([]);
    expect(parseArtistReleaseGroups({})).toEqual([]);
  });
});

describe("MusicBrainz artist relations parsing", () => {
  it("keeps id-carrying related artists, drops self/dups/url rels, caps", () => {
    const collabs = parseArtistRelations({
      id: "art-self",
      relations: [
        { type: "member of band", artist: { id: "art-beck", name: "Beck" } },
        { type: "collaboration", artist: { id: "art-nin", name: "Nine Inch Nails" } },
        // Self-reference is dropped.
        { type: "is person", artist: { id: "art-self", name: "Me" } },
        // Duplicate id is dropped.
        { type: "supporting musician", artist: { id: "art-beck", name: "Beck" } },
        // No artist id (e.g. a url relation) -> skipped.
        { type: "wikipedia" },
        { type: "tribute", artist: { name: "Nameless Id" } },
      ],
    });
    expect(collabs.map((c) => c.artistId)).toEqual(["art-beck", "art-nin"]);
    expect(collabs[0]).toMatchObject({ name: "Beck", relation: "member of band" });
  });

  it("caps the list and tolerates junk input", () => {
    const many = {
      relations: Array.from({ length: 12 }, (_, i) => ({
        type: "collaboration",
        artist: { id: `art-${i}`, name: `Artist ${i}` },
      })),
    };
    expect(parseArtistRelations(many, 3)).toHaveLength(3);
    expect(parseArtistRelations(null)).toEqual([]);
    expect(parseArtistRelations({})).toEqual([]);
  });
});
