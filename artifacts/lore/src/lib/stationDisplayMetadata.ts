import type { Station } from "@workspace/api-client-react";
import {
  categoryForTags,
  stationCategoryShortLabel,
  type StationCategory,
} from "./dialCategories";
import {
  specialistSubcategoryForStation,
  specialistSubcategoryLabel,
} from "./specialistCategories";

const STATION_CATEGORIES = new Set<StationCategory>([
  "ambient",
  "campus",
  "specialist",
  "anchor",
  "public",
  "indie",
  "discovery",
]);

export function stationTypeLabel(station: Station): string {
  const supplied = station.stationCategories?.[0];
  const category = supplied && STATION_CATEGORIES.has(supplied as StationCategory)
    ? supplied as StationCategory
    : categoryForTags(station.tags ?? [])[0];

  if (category === "specialist") {
    return specialistSubcategoryLabel(specialistSubcategoryForStation(station));
  }
  return category ? stationCategoryShortLabel(category) : "Station";
}

export function stationLocationAndType(station: Station): string {
  const location = station.city?.trim() || "Location unavailable";
  return `${location} · ${stationTypeLabel(station)}`;
}

export function curatedStationTypeLabel(station: Station): string | null {
  const supplied = station.stationCategories?.[0];
  if (!supplied || !STATION_CATEGORIES.has(supplied as StationCategory)) return null;
  const category = supplied as StationCategory;
  return category === "specialist"
    ? specialistSubcategoryLabel(specialistSubcategoryForStation(station))
    : stationCategoryShortLabel(category);
}

export function stationCardMetadata(station: Station): string | null {
  const parts = [
    station.city?.trim() || null,
    curatedStationTypeLabel(station),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function stationCardSecondarySentence(station: Station): string | null {
  const city = station.city?.trim() || null;
  const region = station.region?.trim() || null;
  const country = station.country?.trim() || null;
  const location = city
    ? [city, region || country].filter(Boolean).join(", ")
    : region || country;
  const type = curatedStationTypeLabel(station);

  if (location && type) return `${type} radio from ${location}.`;
  if (location) return `Broadcasting from ${location}.`;
  if (type) return `${type} radio.`;
  return null;
}