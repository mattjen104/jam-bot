import { describe, expect, it } from "vitest";
import {
  artistFirstStationScore,
  validScoringArtist,
  type ArtistFirstScoreRow,
} from "../src/routes/me/crossings.js";

const artist = (
  key: string,
  name: string,
  recordings: string[] = [],
  canonical = true,
) => ({ key, name, recordings, canonical });

function row(
  stationSlug: string,
  artists: ArtistFirstScoreRow["artists"],
  recordings: string[] = [],
  overrides: Partial<ArtistFirstScoreRow> = {},
): ArtistFirstScoreRow {
  return {
    stationSlug,
    artists,
    recordings,
    crossings: recordings.length,
    artistCrossings: artists.length,
    stationCount: 100,
    ...overrides,
  };
}

describe("artist-first crossing score", () => {
  it("rejects invalid display identities", () => {
    expect(validScoringArtist("Unknown")).toBe(false);
    expect(validScoringArtist("Various Artists")).toBe(false);
    expect(validScoringArtist("https://station.example.com")).toBe(false);
    expect(validScoringArtist("Broadcast")).toBe(true);
  });

  it("keeps display names separate from canonical keys", () => {
    const target = row("target", [artist("mbid:rare", "The Rare Artist", ["r1"])], ["r1"]);
    const result = artistFirstStationScore(target, [target]);
    expect(result.samples[0]?.artist).toBe("The Rare Artist");
    expect(result.samples[0]?.artist).not.toContain("mbid:");
  });

  it("uses only the two rarest recordings for an artist's deep-cut modifier", () => {
    const baseline = [
      row("target", [artist("a", "Artist", ["r1", "r2", "r3"])], ["r1", "r2", "r3"]),
      row("other", [artist("other", "Other", ["x"])], ["x"]),
    ];
    const two = row("target", [artist("a", "Artist", ["r1", "r2"])], ["r1", "r2", "r3"]);
    const three = row("target", [artist("a", "Artist", ["r1", "r2", "r3"])], ["r1", "r2", "r3"]);
    expect(artistFirstStationScore(three, baseline).score)
      .toBeCloseTo(artistFirstStationScore(two, baseline).score, 12);
  });

  it("rewards distinct breadth while shrinking sparse evidence", () => {
    const narrow = row("narrow", [artist("a", "A")]);
    const broad = row("broad", [
      artist("a", "A"),
      artist("b", "B"),
      artist("c", "C"),
      artist("d", "D"),
    ]);
    const baseline = [narrow, broad];
    expect(artistFirstStationScore(broad, baseline).score)
      .toBeGreaterThan(artistFirstStationScore(narrow, baseline).score);
  });

  it("bounds novelty and repeat effects and orders samples deterministically", () => {
    const target = row(
      "target",
      [artist("b", "Beta", ["r2"]), artist("a", "Alpha", ["r1"])],
      ["r1", "r2"],
      { repeats: { a: 1000, b: 1000 }, novelRecordings: 1000 },
    );
    const baseline = [target];
    const result = artistFirstStationScore(target, baseline);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.samples.map((sample) => sample.artist)).toEqual(["Alpha", "Beta"]);
  });
});