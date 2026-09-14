import { describe, expect, test } from "vitest";
import type { DialStation } from "../src/hooks/useDialData";
import {
  sortBroZoneStationsByDistance,
  stationDistanceMiles,
} from "../src/lib/broZoneProximity";

function station(
  slug: string,
  latitude: number | null,
  longitude: number | null,
  locationConfidence: "verified" | "directory" | "coarse" | null = "verified",
): DialStation {
  return {
    station: {
      slug,
      name: slug.toUpperCase(),
      latitude,
      longitude,
      locationConfidence,
    },
  } as unknown as DialStation;
}

describe("Bro Zone proximity", () => {
  const seattle = { latitude: 47.6062, longitude: -122.3321 };

  test("sorts known station-base locations by distance and keeps unknowns last", () => {
    const unknown = station("unknown", null, null, null);
    const losAngeles = station("la", 34.0522, -118.2437);
    const portland = station("portland", 45.5152, -122.6784);

    expect(sortBroZoneStationsByDistance(
      [unknown, losAngeles, portland],
      seattle,
    ).map((item) => item.station.slug)).toEqual(["portland", "la", "unknown"]);
  });

  test("preserves the reviewed collection order when no ZIP is supplied", () => {
    const first = station("first", null, null, null);
    const second = station("second", 45.5152, -122.6784);
    expect(sortBroZoneStationsByDistance([first, second], null)).toEqual([first, second]);
  });

  test("returns an honest straight-line distance for located stations only", () => {
    expect(stationDistanceMiles(station("portland", 45.5152, -122.6784), seattle))
      .toBeGreaterThan(140);
    expect(stationDistanceMiles(station("unknown", null, null, null), seattle)).toBeNull();
  });
});