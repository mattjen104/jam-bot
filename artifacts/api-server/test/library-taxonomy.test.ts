import { describe, expect, it } from "vitest";
import {
  canonicalGenre,
  canonicalGenres,
  releaseEra,
} from "@workspace/song-enrichment";

describe("saved-library listener taxonomy", () => {
  it("keeps the vocabulary bounded and accepts only positive provider evidence", () => {
    expect(canonicalGenre("Jazz")).toBe("jazz");
    expect(canonicalGenre("hip hop")).toBe("hip-hop");
    expect(canonicalGenres(["jazz", "Jazz", "made-up-style"])).toEqual(["jazz"]);
    expect(canonicalGenre("jazzy")).toBeNull();
  });

  it("uses the 18/60 month boundaries", () => {
    const now = new Date("2025-06-15T00:00:00Z");
    expect(releaseEra(2024, now)).toBe("current");
    expect(releaseEra(2023, now)).toBe("catalog");
    expect(releaseEra(2019, now)).toBe("deep");
    expect(releaseEra(null, now)).toBeNull();
  });

  it("deduplicates additive canonical filters without inventing genres", () => {
    expect(canonicalGenres(["Rock", "rock", "unknown", "R&B"])).toEqual(["rock", "r&b"]);
  });
});