/**
 * deriveStationCategories — server-side per-station category derivation for
 * the `stationCategories` array emitted by /api/stations.
 *
 * Contract under test:
 *  - source=null (hand-seeded) longtail-tier stations surface in "discovery"
 *  - source="curated" longtail-tier stations surface in "discovery"
 *  - radio_browser stations need a quality signal to surface in "discovery"
 *  - tier="flagship" stations always carry "flagship"
 *  - the retired "classics"/"longtail" ids are never emitted
 */
import { describe, expect, it } from "vitest";
import { deriveStationCategories } from "../src/routes/lore/shared.js";
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Station;
}

describe("deriveStationCategories", () => {
  it("tags source=null longtail-tier stations as discovery (hand-seeded manual rows)", () => {
    const cats = deriveStationCategories(
      makeStation({ source: null, tier: "longtail" }),
    );
    expect(cats).toContain("discovery");
    expect(cats).not.toContain("longtail");
  });

  it("tags curated longtail-tier stations as discovery", () => {
    const cats = deriveStationCategories(
      makeStation({ source: "curated", tier: "longtail" }),
    );
    expect(cats).toContain("discovery");
  });

  it("tags radio_browser stations as discovery only with a quality signal", () => {
    // No quality signal: excluded (too noisy).
    expect(
      deriveStationCategories(
        makeStation({ source: "radio_browser", tier: "longtail" }),
        "unscored",
      ),
    ).not.toContain("discovery");
    // Scored above the noise floor: included.
    expect(
      deriveStationCategories(
        makeStation({ source: "radio_browser" }),
        "proven",
      ),
    ).toContain("discovery");
    // A non-null discoveryScore alone is also a signal.
    expect(
      deriveStationCategories(
        makeStation({ source: "radio_browser", discoveryScore: 42 }),
        null,
      ),
    ).toContain("discovery");
  });

  it("tags flagship-tier stations as flagship", () => {
    const cats = deriveStationCategories(makeStation({ tier: "flagship" }));
    expect(cats).toContain("flagship");
  });

  it("never emits the retired classics/longtail ids", () => {
    const fixtures = [
      makeStation({ source: "curated", tier: "longtail" }),
      makeStation({ source: "radio_browser", tier: "longtail", discoveryScore: 10 }),
      makeStation({ source: null, tier: "flagship" }),
      makeStation({ nowPlayingSource: "spinitron", tags: ["college"] }),
    ];
    for (const station of fixtures) {
      const cats = deriveStationCategories(station, "proven");
      expect(cats).not.toContain("classics");
      expect(cats).not.toContain("longtail");
    }
  });
});
