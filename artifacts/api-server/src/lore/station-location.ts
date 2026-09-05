import zipcodes from "zipcodes-us";

export const NEARBY_RADII_MILES = [25, 50, 100, 250] as const;
export type NearbyRadiusMiles = (typeof NEARBY_RADII_MILES)[number];

export interface StationLocation {
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: string | null;
  locationConfidence: string | null;
}

export interface ZipCentroid {
  city: string;
  region: string;
  country: "US";
  latitude: number;
  longitude: number;
}

export const ZIP_DATASET = Object.freeze({
  name: "GeoNames US postal codes",
  version: "zipcodes-us 1.1.3 / data checked 2026-05-08",
  license: "CC BY 4.0",
  sourceUrl: "https://www.geonames.org/postal-codes/",
});

export function usableCoordinates(
  latitude: unknown,
  longitude: unknown,
): latitude is number {
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

export function resolveUsZip(zip: string): ZipCentroid | null {
  if (!/^\d{5}$/.test(zip)) return null;
  const found = zipcodes.find(zip);
  if (
    !found.isValid ||
    !usableCoordinates(found.latitude, found.longitude) ||
    !found.city ||
    !found.stateCode
  ) {
    return null;
  }
  return {
    city: found.city,
    region: found.stateCode,
    country: "US",
    latitude: found.latitude,
    longitude: found.longitude,
  };
}

function isUsCountry(country: string | null | undefined): boolean {
  const normalized = country?.trim().toLowerCase();
  return normalized === "us" || normalized === "usa" || normalized === "united states";
}

export function coarseUsCityLocation(input: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): Pick<StationLocation, "latitude" | "longitude" | "locationSource" | "locationConfidence"> | null {
  if (!input.city || !input.region || !isUsCountry(input.country)) return null;
  const matches = zipcodes.findByCity(input.city.trim(), input.region.trim());
  const usable = matches.filter((row) => usableCoordinates(row.latitude, row.longitude));
  if (usable.length === 0) return null;
  return {
    latitude: usable.reduce((sum, row) => sum + row.latitude, 0) / usable.length,
    longitude: usable.reduce((sum, row) => sum + row.longitude, 0) / usable.length,
    locationSource: "zip_city_centroid",
    locationConfidence: "coarse",
  };
}

export function distanceMiles(
  from: Pick<ZipCentroid, "latitude" | "longitude">,
  to: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusMiles = 3_958.7613;
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isNearbyRadius(value: number): value is NearbyRadiusMiles {
  return (NEARBY_RADII_MILES as readonly number[]).includes(value);
}