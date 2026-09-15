/**
 * Reviewed station profiles for Lore.
 *
 * Profile copy is kept in research batches so each batch can be reviewed
 * independently. This module is the single typed aggregation point used by
 * the API and the legacy homepage-blurb helper.
 */
import { STATION_PROFILES as STATION_PROFILES_BATCH_1 } from "./station-profiles/batch-1.js";
import { STATION_PROFILES as STATION_PROFILES_BATCH_2 } from "./station-profiles/batch-2.js";
import { STATION_PROFILES_BATCH_3 } from "./station-profiles/batch-3.js";
import { STATION_PROFILES_BATCH_4 } from "./station-profiles/batch-4.js";
import { STATION_PROFILES as STATION_PROFILES_BATCH_5 } from "./station-profiles/batch-5.js";

export type StationProfileSource = {
  label: string;
  url: string;
  type: "official" | "independent";
};

export type StationProfile = {
  name: string;
  summary: string;
  description: string;
  sources: readonly StationProfileSource[];
  reviewedAt: "2026-09-15";
};

/**
 * The five batches intentionally use a few different export names. Aliasing
 * those names at the import boundary makes the merged roster explicit and
 * prevents one batch's generic STATION_PROFILES export from shadowing another.
 */
export const STATION_PROFILES = {
  ...STATION_PROFILES_BATCH_1,
  ...STATION_PROFILES_BATCH_2,
  ...STATION_PROFILES_BATCH_3,
  ...STATION_PROFILES_BATCH_4,
  ...STATION_PROFILES_BATCH_5,
} as const satisfies Record<string, StationProfile>;

export type StationProfileSlug = keyof typeof STATION_PROFILES;

/** Return the reviewed profile for a station, or null when it has none. */
export function getStationProfile(slug: string): StationProfile | null {
  return STATION_PROFILES[slug as StationProfileSlug] ?? null;
}

/** Return the reviewed summary for compatibility with existing callers. */
export function getStationDescription(slug: string): string | undefined {
  return getStationProfile(slug)?.summary;
}

/**
 * Legacy export retained for consumers that used the old summary-only map.
 * It is derived from the canonical profile roster so the two cannot drift.
 */
export const STATION_DESCRIPTION_OVERRIDES = Object.fromEntries(
  Object.entries(STATION_PROFILES).map(([slug, profile]) => [slug, profile.summary]),
) as { [K in StationProfileSlug]: string };