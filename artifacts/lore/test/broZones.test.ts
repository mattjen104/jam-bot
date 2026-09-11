import { describe, expect, it } from "vitest";
import {
  BRO_ZONE_DEFINITIONS,
  countBroZones,
  filterBroZones,
  parseBroZones,
  parseBroZoneState,
  filterBroZoneCollection,
  stationBroZones,
  writeBroZoneState,
} from "../src/lib/broZones";

const stations = [
  { slug: "sea", collections: [{ slug: "bro-zones", zone: "seattle" }] },
  { slug: "la", collections: [{ slug: "bro-zones", zone: "los-angeles" }] },
  {
    slug: "multi",
    collections: [{ slug: "bro-zones", zone: "denver" }, { slug: "bro-zones", zone: "cleveland" }],
  },
  { slug: "unreviewed", collections: [{ slug: "editorial", zone: "seattle" }] },
];

describe("Bro Zones state", () => {
  it("parses only reviewed, canonical URL values", () => {
    expect([...parseBroZones("?broZones=seattle,not-a-zone,denver")]).toEqual([
      "seattle",
      "denver",
    ]);
  });

  it("round-trips additive selections in definition order", () => {
    const params = new URLSearchParams();
    writeBroZoneState(params, true, new Set(["north-carolina", "seattle"]));
    expect(parseBroZoneState(`?${params}`)).toMatchObject({ active: true });
    expect(params.get("broZones")).toBe("seattle,north-carolina");
    writeBroZoneState(params, false, new Set());
    expect(params.has("broZones")).toBe(false);
    expect(params.has("collection")).toBe(false);
  });

  it("treats active collection with no regions as the combined eight-zone set", () => {
    const all = filterBroZoneCollection(stations, true, new Set());
    expect(all.map(s => s.slug)).toEqual(["sea", "la", "multi"]);
    expect(filterBroZoneCollection(stations, false, new Set())).toHaveLength(4);
  });

  it("unions multiple reviewed memberships without inferring unknown stations", () => {
    expect(stationBroZones(stations[2])).toEqual(new Set(["denver", "cleveland"]));
    expect(filterBroZones(stations, new Set(["denver", "los-angeles"])).map(s => s.slug))
      .toEqual(["la", "multi"]);
    expect(filterBroZones(stations, new Set())).toHaveLength(4);
  });

  it("reports combined and per-zone counts", () => {
    const counts = countBroZones(stations);
    expect(counts.combined).toBe(3);
    expect(counts.byZone.seattle).toBe(1);
    expect(counts.byZone.denver).toBe(1);
    expect(counts.byZone.cleveland).toBe(1);
    expect(Object.keys(counts.byZone)).toHaveLength(BRO_ZONE_DEFINITIONS.length);
  });
});