import { distanceMiles, usableCoordinates, type ZipCentroid } from "./station-location.js";

/**
 * Listener-facing station taxonomy.  These values deliberately describe the
 * station, not the recording currently playing on it.
 */
export const CATALOG_STATION_TYPES = [
  "campus",
  "specialist",
  "core",
  "public",
  "independent-dj",
  "discovery",
  "ambient",
] as const;
export type CatalogStationType = (typeof CATALOG_STATION_TYPES)[number];

/** Must stay aligned with specialistCategories.ts in the Lore client. */
export const CATALOG_FORMATS = [
  "ambient",
  "folk",
  "rock",
  "jazz",
  "era",
  "world",
  "electronic",
  "groove",
  "classical",
  "other",
] as const;
export type CatalogFormat = (typeof CATALOG_FORMATS)[number];

/** Must stay aligned with radioBrowseState.ts in the Lore client. */
export const CATALOG_DECADES = [
  "1960s",
  "1970s",
  "1980s",
  "1990s",
  "2000s",
  "2010s",
  "2020s",
] as const;
export type CatalogDecade = (typeof CATALOG_DECADES)[number];
export const CATALOG_PLAYING_NOW = ["first", "current", "catalog", "deep"] as const;
export type CatalogPlayingNow = (typeof CATALOG_PLAYING_NOW)[number];

export const CATALOG_LENSES = ["local", "for-you", "all"] as const;
export type CatalogLens = (typeof CATALOG_LENSES)[number];

export const CATALOG_SORTS = [
  "recommended",
  "nearest",
  "best-match",
  "rarest-crossing",
  "live-now",
  "name",
] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export interface CatalogStation {
  slug: string;
  name: string;
  org?: string | null;
  city: string | null;
  region: string | null;
  country?: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource?: string | null;
  locationConfidence?: string | null;
  streamUrl?: string | null;
  active?: boolean;
  hidden?: boolean;
  crossingEligible?: boolean;
  stationClass?: string | null;
  tags: string[];
  eraGenreMode?: boolean;
  sleepMode?: boolean;
  discoveryScore: number | null;
  libraryCrossings: number;
  libraryArtistCrossings: number;
  /** Crossings for the focused artist, when the listener supplied one. */
  focusedArtistCrossings?: number;
  live: boolean;
  currentAgeTier?: CatalogPlayingNow | null;
  broZones?: string[];
  support?: boolean;
  followed?: boolean;
  qualityTier?: string | null;
  sortOrder?: number | null;
}

export interface CatalogFilters {
  stationTypes: CatalogStationType[];
  formats: CatalogFormat[];
  decades: CatalogDecade[];
  playingNow?: CatalogPlayingNow[];
  broZones?: string[];
  /** Require membership in the reviewed Bro Zones collection even when no
   * individual zone chip is selected. */
  broZonesCollectionOnly?: boolean;
  followedOnly?: boolean;
  supportOnly?: boolean;
}

export interface CatalogCandidate {
  station: CatalogStation;
  stationType: CatalogStationType;
  formats: CatalogFormat[];
  decades: CatalogDecade[];
  proximity: {
    verified: boolean;
    distanceMiles: number | null;
  };
  evidence: {
    libraryCrossings: number;
    libraryArtistCrossings: number;
    focusedArtistCrossings: number;
    discoveryScore: number | null;
  };
  score: number;
}

export interface CatalogComposition {
  lens: CatalogLens;
  sort: CatalogSort;
  claim: string;
  filters: CatalogFilters;
  semantics: {
    withinFamily: "or";
    betweenFamilies: "and";
  };
  eligibleCount: number;
  returnedCount: number;
  omittedUnknownLocation: number;
  partial: {
    locality: boolean;
    personalization: boolean;
  };
}

const TYPE_BY_SHARED_CATEGORY: Record<string, CatalogStationType> = {
  campus: "campus",
  specialist: "specialist",
  anchor: "core",
  public: "public",
  indie: "independent-dj",
  discovery: "discovery",
  ambient: "ambient",
};

/**
 * Convert station tags and legacy flags into the listener taxonomy.  The
 * legacy `eraGenreMode` flag is an editorial station classification, so it is
 * safe to use as a Specialist fallback.  No recording, spin, or now-playing
 * field is consulted here.
 */
export function catalogStationType(station: Pick<CatalogStation, "tags" | "eraGenreMode" | "sleepMode"> & { sharedCategory?: string | null }): CatalogStationType {
  if (station.sleepMode || station.tags.includes("ambient")) return "ambient";
  if (station.tags.includes("college") || station.tags.includes("campus")) return "campus";
  if (station.eraGenreMode || station.tags.includes("specialist")) return "specialist";
  if (station.sharedCategory && TYPE_BY_SHARED_CATEGORY[station.sharedCategory]) {
    return TYPE_BY_SHARED_CATEGORY[station.sharedCategory];
  }
  if (station.tags.includes("anchor") || station.tags.includes("core")) return "core";
  if (station.tags.includes("public")) return "public";
  if (station.tags.includes("indie") || station.tags.includes("independent-dj")) return "independent-dj";
  return "discovery";
}

const DECADE_ALIASES: Record<string, CatalogDecade> = {
  "60s": "1960s",
  "70s": "1970s",
  "80s": "1980s",
  "90s": "1990s",
  "00s": "2000s",
  "10s": "2010s",
  "20s": "2020s",
  "60er": "1960s",
  "70er": "1970s",
  "80er": "1980s",
  "90er": "1990s",
};

/**
 * Return only explicit decade tags.  In particular, this does not inspect the
 * station name, recent profile, current recording, or a track release year.
 * The aliases support existing Radio Browser tags while giving the API one
 * stable vocabulary.
 */
export function explicitStationDecades(tags: readonly string[]): CatalogDecade[] {
  const decades = new Set<CatalogDecade>();
  for (const raw of tags) {
    const normalized = raw.trim().toLowerCase().replace(/_/g, "-");
    const value = normalized
      .replace(/^decade[:=-]?/, "")
      .replace(/^era[:=-]?/, "")
      .replace(/^decades?[:=-]?/, "");
    const canonical = DECADE_ALIASES[value] ??
      (CATALOG_DECADES.includes(value as CatalogDecade) ? value as CatalogDecade : null);
    if (canonical) decades.add(canonical);
  }
  return [...decades].sort();
}

const FORMAT_TAG_ALIASES: Record<string, CatalogFormat> = {
  ambient: "ambient", chillout: "ambient", lounge: "ambient", drone: "ambient",
  folk: "folk", country: "folk", celtic: "folk", americana: "folk", bluegrass: "folk",
  rock: "rock", metal: "rock", punk: "rock", "post-rock": "rock", "post-punk": "rock",
  jazz: "jazz", blues: "jazz", "free jazz": "jazz", "nu-jazz": "jazz",
  oldies: "era", retro: "era", revival: "era", decade: "era", "new wave": "era",
  "60s": "era", "70s": "era", "80s": "era", "90s": "era", "00s": "era",
  world: "world", reggae: "world", latin: "world", ska: "world",
  electronic: "electronic", edm: "electronic", techno: "electronic", house: "electronic",
  trance: "electronic", electro: "electronic", club: "electronic", idm: "electronic",
  groove: "groove", soul: "groove", funk: "groove", motown: "groove", "r&b": "groove",
  classical: "classical", baroque: "classical", opera: "classical",
};

export function explicitStationFormats(tags: readonly string[]): CatalogFormat[] {
  const formats = new Set<CatalogFormat>();
  for (const raw of tags) {
    const format = FORMAT_TAG_ALIASES[raw.trim().toLowerCase()];
    if (format) formats.add(format);
  }
  // A Specialist station with no recognized subcategory remains available via
  // the explicit "Other" chip instead of being silently unfilterable.
  if (formats.size === 0 && tags.some((tag) => tag.trim().toLowerCase() === "specialist")) {
    formats.add("other");
  }
  return [...formats].sort();
}

export function verifiedStationProximity(
  station: Pick<CatalogStation, "latitude" | "longitude" | "locationSource" | "locationConfidence">,
  origin: ZipCentroid | null,
): { verified: boolean; distanceMiles: number | null } {
  const latitude = station.latitude;
  const longitude = station.longitude;
  const verified = usableCoordinates(latitude, longitude) &&
    Boolean(station.locationSource && station.locationConfidence);
  return {
    verified,
    distanceMiles: verified && origin
      ? Math.round(distanceMiles(origin, {
        latitude,
        longitude: longitude as number,
      }) * 10) / 10
      : null,
  };
}

function compareName(a: CatalogCandidate, b: CatalogCandidate): number {
  return a.station.name.localeCompare(b.station.name, undefined, { sensitivity: "base" }) ||
    a.station.slug.localeCompare(b.station.slug);
}

/**
 * Compose one eligible catalog. Eligibility is resolved before ranking, so a
 * sort can never pull a station into (or push one out of) the result set.
 */
export function composeStationCatalog(
  rows: CatalogStation[],
  lens: CatalogLens,
  filters: CatalogFilters,
  sort: CatalogSort,
  origin: ZipCentroid | null,
  radiusMiles: number,
  limit: number,
  offset = 0,
): { items: CatalogCandidate[]; composition: CatalogComposition } {
  const prepared = rows
    .filter((station) => station.active !== false && station.hidden !== true && station.crossingEligible !== false &&
      Boolean(station.streamUrl?.trim()))
    .map((station) => {
      const stationType = catalogStationType(station);
    const formats = explicitStationFormats(station.tags);
      const decades = explicitStationDecades(station.tags);
      const proximity = verifiedStationProximity(station, origin);
      return {
        station,
        stationType,
        formats,
        decades,
        proximity,
        evidence: {
          libraryCrossings: station.libraryCrossings,
          libraryArtistCrossings: station.libraryArtistCrossings,
          focusedArtistCrossings: Number(station.focusedArtistCrossings ?? 0),
          discoveryScore: station.discoveryScore,
        },
        score: 0,
      };
    })
    .filter((candidate) => {
       const {
         stationTypes,
         formats,
         decades,
         playingNow = [],
         broZones = [],
          broZonesCollectionOnly = false,
         followedOnly = false,
         supportOnly = false,
       } = filters;
      const matchesType = stationTypes.length === 0 || stationTypes.includes(candidate.stationType);
      const matchesFormat = formats.length === 0 || formats.some((format) => candidate.formats.includes(format));
       const matchesDecade = decades.length === 0 || decades.some((decade) => candidate.decades.includes(decade));
       const matchesPlayingNow = playingNow.length === 0 ||
         candidate.station.currentAgeTier == null ||
         playingNow.includes(candidate.station.currentAgeTier);
        const matchesBroZone = broZones.length > 0
          ? broZones.some((zone) => candidate.station.broZones?.includes(zone))
          : !broZonesCollectionOnly || (candidate.station.broZones?.length ?? 0) > 0;
       const matchesFollowed = !followedOnly || candidate.station.followed === true;
       const matchesSupport = !supportOnly || candidate.station.support === true;
      const inRadius = lens !== "local" ||
        (candidate.proximity.verified && candidate.proximity.distanceMiles !== null &&
          candidate.proximity.distanceMiles <= radiusMiles);
       return matchesType && matchesFormat && matchesDecade && matchesPlayingNow &&
         matchesBroZone && matchesFollowed && matchesSupport && inRadius;
    });

  for (const candidate of prepared) {
    const localPriority = candidate.stationType === "campus" || candidate.stationType === "independent-dj" ? 1 : 0;
    candidate.score = lens === "local"
      ? localPriority * 25 - (candidate.proximity.distanceMiles ?? Number.MAX_SAFE_INTEGER)
      : lens === "for-you"
        ? candidate.evidence.libraryCrossings * 10_000 + candidate.evidence.libraryArtistCrossings * 100 +
          candidate.evidence.focusedArtistCrossings * 1_000_000 +
          (candidate.evidence.discoveryScore ?? 0)
        : candidate.evidence.discoveryScore ?? 0;
  }

  prepared.sort((a, b) => {
    if (sort === "name") return compareName(a, b);
    if (sort === "nearest") {
      return (a.proximity.distanceMiles ?? Infinity) - (b.proximity.distanceMiles ?? Infinity) || compareName(a, b);
    }
    if (sort === "rarest-crossing") {
      const aCrossings = a.evidence.libraryCrossings;
      const bCrossings = b.evidence.libraryCrossings;
      // Positive evidence is useful for this sort; stations with no crossing
      // must be the deterministic fallback after every positive count.
      if (aCrossings === 0 && bCrossings > 0) return 1;
      if (bCrossings === 0 && aCrossings > 0) return -1;
      return aCrossings - bCrossings || compareName(a, b);
    }
    if (sort === "live-now") {
      return Number(b.station.live) - Number(a.station.live) || compareName(a, b);
    }
    return b.score - a.score || (lens === "local"
      ? (a.proximity.distanceMiles ?? Infinity) - (b.proximity.distanceMiles ?? Infinity)
      : 0) || compareName(a, b);
  });

  const claim = lens === "local"
    ? "Ranked by verified station proximity, with playable campus and independent stations favored."
    : lens === "for-you"
      ? "Ranked by Library crossings and other saved-music evidence."
      : "The complete eligible station catalog, shown without a personalized ranking claim.";
  const omittedUnknownLocation = lens === "local"
    ? rows.filter((station) => station.active !== false && station.hidden !== true && station.crossingEligible !== false)
      .filter((station) => !verifiedStationProximity(station, origin).verified).length
    : 0;
  const items = prepared.slice(offset, offset + limit);
  return {
    items,
    composition: {
      lens,
      sort,
      claim,
      filters,
      semantics: { withinFamily: "or", betweenFamilies: "and" },
      eligibleCount: prepared.length,
      returnedCount: items.length,
      omittedUnknownLocation,
      partial: {
        locality: lens === "local" && origin === null,
        personalization: lens === "for-you" && rows.every((row) =>
          row.libraryCrossings === 0 &&
          row.libraryArtistCrossings === 0 &&
          Number(row.focusedArtistCrossings ?? 0) === 0),
      },
    },
  };
}