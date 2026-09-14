import { describe, expect, it } from "vitest";
import {
  composeStationCatalog,
  explicitStationDecades,
  explicitStationFormats,
  catalogStationType,
  type CatalogStation,
} from "../src/lore/station-catalog.js";
import { resolveUsZip } from "../src/lore/station-location.js";

function station(slug: string, overrides: Partial<CatalogStation> = {}): CatalogStation {
  return {
    slug,
    name: slug,
    city: "San Francisco",
    region: "CA",
    country: "US",
    latitude: 37.7749,
    longitude: -122.4194,
    locationSource: "curated",
    locationConfidence: "verified",
    streamUrl: `https://example.test/${slug}`,
    active: true,
    hidden: false,
    crossingEligible: true,
    tags: [],
    discoveryScore: 0,
    libraryCrossings: 0,
    libraryArtistCrossings: 0,
    live: false,
    ...overrides,
  };
}

describe("station catalog read model", () => {
  it("normalizes explicit decade tags and never derives one from a station name", () => {
    expect(explicitStationDecades(["decade-1980s", "80s", "electronic"])).toEqual(["1980s"]);
    expect(explicitStationDecades(["1980s nostalgia radio"])).toEqual([]);
    expect(explicitStationFormats(["electronic", "1980s", "not-a-format"])).toEqual(["electronic"]);
  });

  it("uses editorial tags and flags rather than current-track evidence for type", () => {
    expect(catalogStationType({ tags: ["college"], eraGenreMode: false, sleepMode: false })).toBe("campus");
    expect(catalogStationType({ tags: [], eraGenreMode: true, sleepMode: false })).toBe("specialist");
    expect(catalogStationType({ tags: [], eraGenreMode: false, sleepMode: false })).toBe("discovery");
  });

  it("ranks local stations by verified proximity and campus/independent priority", () => {
    const origin = resolveUsZip("94110")!;
    const result = composeStationCatalog(
      [
        station("near-core", { latitude: 37.77, longitude: -122.42, tags: ["anchor"] }),
        station("far-campus", { latitude: 38.58, longitude: -121.49, tags: ["college"] }),
        station("unknown-location", { latitude: null, longitude: null, locationSource: null, locationConfidence: null }),
      ],
      "local",
      { stationTypes: [], formats: [], decades: [] },
      "recommended",
      origin,
      100,
      10,
    );
    expect(result.items.map((item) => item.station.slug)).toEqual(["near-core", "far-campus"]);
    expect(result.composition.omittedUnknownLocation).toBe(1);
    expect(result.items.every((item) => item.proximity.verified)).toBe(true);
  });

  it("composes OR within a family and AND between families", () => {
    const result = composeStationCatalog(
      [
        station("eighties-electronic", { tags: ["specialist", "electronic", "decade-1980s"] }),
        station("nineties-jazz", { tags: ["specialist", "jazz", "decade-1990s"] }),
        station("eighties-jazz", { tags: ["specialist", "jazz", "decade-1980s"] }),
      ],
      "all",
      { stationTypes: ["specialist"], formats: ["electronic", "jazz"], decades: ["1980s"] },
      "name",
      null,
      50,
      10,
    );
    expect(result.items.map((item) => item.station.slug)).toEqual(["eighties-electronic", "eighties-jazz"]);
    expect(result.composition.semantics).toEqual({ withinFamily: "or", betweenFamilies: "and" });
  });

  it("puts stations with a current observed spin first for Live now", () => {
    const result = composeStationCatalog(
      [station("quiet", { live: false }), station("on-air", { live: true })],
      "all",
      { stationTypes: [], formats: [], decades: [] },
      "live-now",
      null,
      50,
      10,
    );
    expect(result.items.map((item) => item.station.slug)).toEqual(["on-air", "quiet"]);
  });

  it("sorts rarest crossings by positive frequency before zero-evidence fallback", () => {
    const result = composeStationCatalog(
      [
        station("zero", { libraryCrossings: 0 }),
        station("common", { libraryCrossings: 4 }),
        station("rare", { libraryCrossings: 1 }),
      ],
      "for-you",
      { stationTypes: [], formats: [], decades: [] },
      "rarest-crossing",
      null,
      50,
      10,
    );
    expect(result.items.map((item) => item.station.slug)).toEqual(["rare", "common", "zero"]);
  });

  it("uses focused artist crossings as the strongest For You evidence", () => {
    const result = composeStationCatalog(
      [
        station("library-match", { libraryCrossings: 3, focusedArtistCrossings: 0 }),
        station("artist-match", { libraryCrossings: 0, focusedArtistCrossings: 1 }),
      ],
      "for-you",
      { stationTypes: [], formats: [], decades: [] },
      "best-match",
      null,
      50,
      10,
    );
    expect(result.items.map((item) => item.station.slug)).toEqual(["artist-match", "library-match"]);
    expect(result.items[0]!.evidence.focusedArtistCrossings).toBe(1);
  });

  it("uses the frontend's canonical station type and format vocabulary", () => {
    expect(catalogStationType({ tags: ["anchor"], eraGenreMode: false, sleepMode: false })).toBe("core");
    expect(catalogStationType({ tags: ["indie"], eraGenreMode: false, sleepMode: false })).toBe("independent-dj");
    expect(explicitStationFormats(["metal", "experimental"])).toEqual(["rock"]);
    expect(explicitStationFormats(["specialist", "experimental"])).toEqual(["other"]);
  });

  it("requires reviewed Bro Zone membership for the collection and ORs selected zones", () => {
    const result = composeStationCatalog(
      [
        station("seattle", { broZones: ["seattle"] }),
        station("portland", { broZones: ["portland"] }),
        station("unreviewed"),
      ],
      "all",
      { stationTypes: [], formats: [], decades: [], broZonesCollectionOnly: true },
      "name",
      null,
      50,
      10,
    );
    expect(result.items.map((item) => item.station.slug)).toEqual(["portland", "seattle"]);

    const selected = composeStationCatalog(
      [
        station("seattle", { broZones: ["seattle"] }),
        station("portland", { broZones: ["portland"] }),
        station("both", { broZones: ["seattle", "portland"] }),
      ],
      "all",
      { stationTypes: [], formats: [], decades: [], broZones: ["seattle", "portland"] },
      "name",
      null,
      50,
      10,
    );
    expect(selected.items.map((item) => item.station.slug)).toEqual(["both", "portland", "seattle"]);
  });

  it("paginates the fully eligible, deterministically sorted catalog", () => {
    const rows = [station("charlie"), station("alpha"), station("bravo")];
    const first = composeStationCatalog(rows, "all", { stationTypes: [], formats: [], decades: [] }, "name", null, 50, 2, 0);
    const second = composeStationCatalog(rows, "all", { stationTypes: [], formats: [], decades: [] }, "name", null, 50, 2, 2);
    expect(first.composition.eligibleCount).toBe(3);
    expect(first.items.map((item) => item.station.slug)).toEqual(["alpha", "bravo"]);
    expect(second.items.map((item) => item.station.slug)).toEqual(["charlie"]);
    expect([...first.items, ...second.items].map((item) => item.station.slug)).toEqual(["alpha", "bravo", "charlie"]);
  });
});