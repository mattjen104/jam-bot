import { describe, it, expect } from "vitest";
import {
  isEraGenreStation,
  isSleepStation,
  matchesWordBoundary,
  ERA_GENRE_ERA_PATTERNS,
  ERA_GENRE_GENRE_PATTERNS,
  ERA_GENRE_FIP_SLUGS,
} from "../src/lore/radio-browser.js";

// ---------------------------------------------------------------------------
// matchesWordBoundary — the shared word-boundary matcher
// ---------------------------------------------------------------------------

describe("matchesWordBoundary", () => {
  it("matches whole words case-insensitively", () => {
    expect(matchesWordBoundary("100% ACID JAZZ", "jazz")).toBe(true);
    expect(matchesWordBoundary("Celtic Music Radio", "celtic")).toBe(true);
    expect(matchesWordBoundary("RADIO BOB - 70er Rock", "70er")).toBe(true);
  });

  it("does NOT match accidental substrings", () => {
    // The canonical false positive: "gems" must not classify "Experimentalgems".
    expect(matchesWordBoundary("Experimentalgems", "gems")).toBe(false);
    // "ska" inside "Alaska" / "Nebraska".
    expect(matchesWordBoundary("Alaska Public Radio", "ska")).toBe(false);
    // "soul" inside "Seoul".
    expect(matchesWordBoundary("Radio Seoul", "soul")).toBe(false);
    // "house" inside "Warehouse".
    expect(matchesWordBoundary("The Warehouse Sessions", "house")).toBe(false);
  });

  it("respects boundaries at string edges", () => {
    expect(matchesWordBoundary("jazz", "jazz")).toBe(true);
    expect(matchesWordBoundary("jazzy", "jazz")).toBe(false);
  });

  it("matches multi-word patterns verbatim with boundaries", () => {
    expect(matchesWordBoundary("Best of Drum and Bass", "drum and bass")).toBe(true);
    expect(matchesWordBoundary("Classic Hits FM", "classic hits")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isEraGenreStation — era patterns
// ---------------------------------------------------------------------------

describe("isEraGenreStation — era patterns", () => {
  const eraNames = [
    "80s Alive",
    "All Oldies Channel",
    "Gen X Radio",
    "RADIO BOB - 70er Rock",
    "SomaFM Underground 80s",
    "80s80s Rock",
    "Retro FM",
    "Flower Power Radio",
    "Classic Rock 109",
  ];
  for (const name of eraNames) {
    it(`classifies "${name}"`, () => {
      expect(isEraGenreStation(name)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// isEraGenreStation — genre patterns
// ---------------------------------------------------------------------------

describe("isEraGenreStation — genre patterns", () => {
  const genreNames = [
    "100% ACID JAZZ",
    "Laut.FM Shoegaze",
    "WICN Jazz", // curated-feeling, still bucketed per user decision
    "Celtic Music Radio",
    "Concertzender Folk it!",
    "EPIC CLASSICAL",
    "Radio Caprice - Reggae",
    "SomaFM Metal Detector",
    "SomaFM Suburbs of Goa",
  ];
  for (const name of genreNames) {
    it(`classifies "${name}"`, () => {
      expect(isEraGenreStation(name)).toBe(true);
    });
  }

  it("does NOT classify a name that only substring-matches a genre keyword", () => {
    expect(isEraGenreStation("Experimentalgems")).toBe(false);
    expect(isEraGenreStation("Alaska Public Radio")).toBe(false);
  });

  it("does NOT classify the curated core", () => {
    for (const name of ["KEXP", "NTS 1", "KCRW", "BBC Radio 6 Music", "Radio Paradise"]) {
      expect(isEraGenreStation(name)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isEraGenreStation — FIP sub-channel slugs
// ---------------------------------------------------------------------------

describe("isEraGenreStation — FIP slugs", () => {
  for (const slug of ERA_GENRE_FIP_SLUGS) {
    it(`classifies FIP sub-channel slug "${slug}"`, () => {
      // Use a name that alone would not match, to prove the slug drives it.
      expect(isEraGenreStation("FIP", slug)).toBe(true);
    });
  }

  it("does NOT classify FIP Main or FIP Electro", () => {
    expect(isEraGenreStation("FIP", "fip-main")).toBe(false);
    expect(isEraGenreStation("FIP Electro", "fip-electro")).toBe(false);
  });

  it("classifies the radio-browser duplicate 'FIP Musiques du monde' by name", () => {
    // The RB duplicate carries no English genre keyword; the "musiques du monde"
    // French phrase pattern brings it into the bucket without a dedicated slug.
    expect(isEraGenreStation("FIP Musiques du monde", "fip-musiques-du-monde")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Precedence — ambient pool and blocklist win first
// ---------------------------------------------------------------------------

describe("isEraGenreStation — precedence", () => {
  it("non-music utility blocklisting takes precedence over era/genre", () => {
    expect(isSleepStation("Deep Sleep Jazz")).toBe(false);
    expect(isEraGenreStation("Deep Sleep Jazz")).toBe(false);
  });

  it("blocklisted names take precedence over era/genre", () => {
    // "Lofi Hip Hop Radio" matches genre "hip hop" but is blocklisted.
    expect(isEraGenreStation("Lofi Hip Hop Radio")).toBe(false);
  });

  it("empty / missing names never classify", () => {
    expect(isEraGenreStation("")).toBe(false);
    expect(isEraGenreStation(null)).toBe(false);
    expect(isEraGenreStation(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pattern constants sanity
// ---------------------------------------------------------------------------

describe("era/genre pattern constants", () => {
  it("include the confirmed era + genre keywords", () => {
    expect(ERA_GENRE_ERA_PATTERNS).toContain("oldies");
    expect(ERA_GENRE_ERA_PATTERNS).toContain("70er");
    expect(ERA_GENRE_ERA_PATTERNS).toContain("classic rock");
    expect(ERA_GENRE_GENRE_PATTERNS).toContain("jazz");
    expect(ERA_GENRE_GENRE_PATTERNS).toContain("shoegaze");
    expect(ERA_GENRE_GENRE_PATTERNS).toContain("drum and bass");
  });
});
