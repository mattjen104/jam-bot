/**
 * deriveStationCategories — server-side per-station category derivation for
 * the `stationCategories` array emitted by /api/stations.
 *
 * The seven categories form a mutually exclusive editorial taxonomy with the
 * precedence: ambient > campus > specialist > anchor > public > indie >
 * discovery.
 *
 * Contract under test:
 *  - exactly ONE category is emitted per station
 *  - each rung is reachable via its tag/flag/allowlist input
 *  - precedence resolves ambiguous stations (e.g. campus beats specialist)
 *  - discovery is the unconditional fallback (no quality gating)
 *  - retired ids ("spinitron", "flagship", "genre", "lore", "college",
 *    "classics", "longtail") are never emitted
 */
import { describe, expect, it } from "vitest";
import { categoryDiagnostic, deriveStationCategories } from "../src/routes/lore/shared.js";
import type { Station } from "@workspace/db";

function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: 1,
    slug: "test-station",
    name: "Test Station",
    org: null,
    country: "US",
    city: null,
    ianaTimezone: null,
    streamUrl: "https://stream.example/test",
    streamQuality: null,
    streamFormat: null,
    mode: "live",
    homepageUrl: null,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    discoveryScore: null,
    homepageBlurb: null,
    upcomingShowCount: 0,
    tier: null,
    source: null,
    nowPlayingSource: null,
    nowPlayingConfig: null,
    automationClass: null,
    active: true,
    hidden: false,
    favorite: false,
    sleepMode: false,
    eraGenreMode: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Station;
}

describe("deriveStationCategories", () => {
  it("always emits exactly one category", () => {
    const fixtures = [
      makeStation(),
      makeStation({ sleepMode: true, tags: ["college"] }),
      makeStation({ slug: "kexp", tier: "flagship" }),
      makeStation({ source: "radio_browser", tier: "longtail" }),
      makeStation({ tags: ["college", "specialist", "anchor"] }),
    ];
    for (const station of fixtures) {
      expect(deriveStationCategories(station)).toHaveLength(1);
    }
  });

  it("classifies sleep-mode or ambient-tagged stations as ambient", () => {
    expect(deriveStationCategories(makeStation({ sleepMode: true }))).toEqual(["ambient"]);
    expect(deriveStationCategories(makeStation({ tags: ["ambient"] }))).toEqual(["ambient"]);
  });

  it("classifies college-tagged stations as campus", () => {
    expect(deriveStationCategories(makeStation({ tags: ["college"] }))).toEqual(["campus"]);
  });

  it("classifies era-genre-mode or specialist-tagged stations as specialist", () => {
    expect(deriveStationCategories(makeStation({ eraGenreMode: true }))).toEqual(["specialist"]);
    expect(deriveStationCategories(makeStation({ tags: ["specialist"] }))).toEqual(["specialist"]);
  });

  it("classifies Core stations by the compatible anchor tag or slug allowlist", () => {
    expect(deriveStationCategories(makeStation({ tags: ["anchor"] }))).toEqual(["anchor"]);
    for (const slug of [
      "kexp", "wfmu", "nts-1", "nts-2", "bbc-6music", "fip-main",
      "kcrw-eclectic24", "wwoz", "kutx",
      "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f",
      "rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631",
      "dublab", "rinse-fm",
    ]) {
      expect(deriveStationCategories(makeStation({ slug }))).toEqual(["anchor"]);
    }
  });

  it("classifies public/community stations by tag or slug allowlist", () => {
    expect(deriveStationCategories(makeStation({ tags: ["public"] }))).toEqual(["public"]);
    for (const slug of ["wbgo", "wpfw", "wdiy", "ckua"]) {
      expect(deriveStationCategories(makeStation({ slug }))).toEqual(["public"]);
    }
  });

  it("classifies independent DJ stations by tag or slug allowlist", () => {
    expect(deriveStationCategories(makeStation({ tags: ["indie"] }))).toEqual(["indie"]);
    for (const slug of [
      "worldwide-fm", "refuge-worldwide", "balamii",
      "the-lot-radio", "radio-nopal", "lookout-fm",
    ]) {
      expect(deriveStationCategories(makeStation({ slug }))).toEqual(["indie"]);
    }
  });

  it("falls back to discovery for everything else, with no quality gating", () => {
    // Curated longtail rows.
    expect(deriveStationCategories(makeStation({ source: "curated", tier: "longtail" }))).toEqual(["discovery"]);
    // Hand-seeded source=null rows.
    expect(deriveStationCategories(makeStation({ source: null, tier: "longtail" }))).toEqual(["discovery"]);
    // Radio Browser rows now qualify even when unscored — discovery is the
    // unconditional fallback in the mutually exclusive taxonomy.
    expect(
      deriveStationCategories(makeStation({ source: "radio_browser" }), "unscored"),
    ).toEqual(["discovery"]);
  });

  it("resolves ambiguous stations by precedence (ambient > campus > specialist > anchor > public > indie)", () => {
    expect(
      deriveStationCategories(makeStation({ sleepMode: true, tags: ["college"] })),
    ).toEqual(["ambient"]);
    expect(
      deriveStationCategories(makeStation({ tags: ["college", "specialist"] })),
    ).toEqual(["campus"]);
    expect(
      deriveStationCategories(makeStation({ slug: "kexp", eraGenreMode: true })),
    ).toEqual(["specialist"]);
    expect(
      deriveStationCategories(makeStation({ slug: "kexp", tags: ["public"] })),
    ).toEqual(["anchor"]);
    expect(
      deriveStationCategories(makeStation({ tags: ["public", "indie"] })),
    ).toEqual(["public"]);
  });

  it("never emits retired category ids", () => {
    const fixtures = [
      makeStation({ source: "curated", tier: "longtail" }),
      makeStation({ source: "radio_browser", tier: "longtail", discoveryScore: 10 }),
      makeStation({ source: null, tier: "flagship" }),
      makeStation({ nowPlayingSource: "spinitron", tags: ["college"] }),
      makeStation({ slug: "kexp", tier: "flagship" }),
    ];
    for (const station of fixtures) {
      const cats = deriveStationCategories(station, "proven");
      for (const retired of ["spinitron", "flagship", "genre", "lore", "college", "classics", "longtail"]) {
        expect(cats).not.toContain(retired);
      }
    }
  });
});

describe("categoryDiagnostic", () => {
  it("reports an explicit college tag as evidence", () => {
    expect(categoryDiagnostic(makeStation({ tags: ["college"] }))).toMatchObject({
      category: "campus", evidence: "explicit_tag",
    });
  });

  it("flags a university organization for review without promoting it", () => {
    expect(categoryDiagnostic(makeStation({ slug: "wxyz", org: "Example University" }))).toEqual({
      category: "discovery", evidence: "fallback_suspicious_org",
    });
  });
});
