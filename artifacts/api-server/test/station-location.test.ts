import { describe, expect, it } from "vitest";
import {
  coarseUsCityLocation,
  distanceMiles,
  isNearbyRadius,
  resolveUsZip,
  usableCoordinates,
} from "../src/lore/station-location.js";

describe("station location", () => {
  it("resolves a ZIP locally to a coarse locality centroid", () => {
    expect(resolveUsZip("94110")).toMatchObject({
      city: "San Francisco",
      region: "CA",
      country: "US",
    });
    expect(resolveUsZip("9411")).toBeNull();
    expect(resolveUsZip("00000")).toBeNull();
  });

  it("derives a labeled coarse city centroid for seeded US stations", () => {
    expect(coarseUsCityLocation({
      city: "Davis",
      region: "CA",
      country: "United States",
    })).toMatchObject({
      locationSource: "zip_city_centroid",
      locationConfidence: "coarse",
    });
  });

  it("computes straight-line distance and validates release radii", () => {
    const sf = resolveUsZip("94110")!;
    const oakland = resolveUsZip("94612")!;
    expect(distanceMiles(sf, oakland)).toBeGreaterThan(5);
    expect(distanceMiles(sf, oakland)).toBeLessThan(20);
    expect([25, 50, 100, 250].every(isNearbyRadius)).toBe(true);
    expect(isNearbyRadius(10)).toBe(false);
  });

  it("rejects missing, impossible, and null-island coordinates", () => {
    expect(usableCoordinates(37, -122)).toBe(true);
    expect(usableCoordinates(0, 0)).toBe(false);
    expect(usableCoordinates(91, -122)).toBe(false);
    expect(usableCoordinates(null, -122)).toBe(false);
  });
});