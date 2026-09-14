/**
 * Canonical listener-facing state for the Radio browse remote.
 *
 * This module deliberately contains no React or API concerns.  A radio
 * station can be projected into RadioBrowseStation by any surface (the live
 * dial, the front door, or a focused sound deck), while the rules for lenses,
 * filters, sorting, URL state, and paging stay identical everywhere.
 */
import type { AgeTier } from "./dialAgeFilter";
import { BRO_ZONE_KEYS, type BroZone } from "./broZones";
/** Listener-facing values shared by the /api/explore catalog read model. */
export type RadioBrowseStationType =
  | "campus"
  | "specialist"
  | "core"
  | "public"
  | "independent-dj"
  | "discovery"
  | "ambient";
export type RadioBrowseFormat =
  | "ambient"
  | "folk"
  | "rock"
  | "jazz"
  | "era"
  | "world"
  | "electronic"
  | "groove"
  | "classical"
  | "other";

export type RadioBrowseLens = "local" | "for-you" | "all";
export type RadioBrowseSort =
  | "recommended"
  | "nearest"
  | "best-match"
  | "rarest-crossing"
  | "live-now"
  | "name";
export type RadioBrowseDecade =
  | "1960s"
  | "1970s"
  | "1980s"
  | "1990s"
  | "2000s"
  | "2010s"
  | "2020s";

export const RADIO_BROWSE_LENSES: readonly RadioBrowseLens[] = [
  "local",
  "for-you",
  "all",
] as const;

export const RADIO_BROWSE_SORTS: readonly RadioBrowseSort[] = [
  "recommended",
  "nearest",
  "best-match",
  "rarest-crossing",
  "live-now",
  "name",
] as const;

export const RADIO_BROWSE_DECADES: readonly RadioBrowseDecade[] = [
  "1960s",
  "1970s",
  "1980s",
  "1990s",
  "2000s",
  "2010s",
  "2020s",
] as const;

export const RADIO_BROWSE_FORMATS: readonly { value: RadioBrowseFormat; label: string }[] = [
  { value: "ambient", label: "Ambient" },
  { value: "folk", label: "Folk" },
  { value: "rock", label: "Rock" },
  { value: "jazz", label: "Jazz" },
  { value: "era", label: "Era" },
  { value: "world", label: "World" },
  { value: "electronic", label: "Electronic" },
  { value: "groove", label: "Groove" },
  { value: "classical", label: "Classical" },
  { value: "other", label: "Other" },
] as const;

export const RADIO_BROWSE_STATION_TYPES: readonly { value: RadioBrowseStationType; label: string }[] = [
  { value: "campus", label: "Campus" },
  { value: "specialist", label: "Specialist" },
  { value: "core", label: "Core" },
  { value: "public", label: "Public" },
  { value: "independent-dj", label: "Independent DJ" },
  { value: "discovery", label: "Discovery" },
  { value: "ambient", label: "Ambient" },
] as const;

export interface CoarseLocality {
  /** A US ZIP is kept as entered only so the locality can be restored locally. */
  zip?: string;
  city?: string;
  state?: string;
}

export interface RadioBrowseFilters {
  /** OR within this family; an empty list means every station type. */
  stationTypes: readonly RadioBrowseStationType[];
  /** OR within this family; an empty list means every Specialist format. */
  specialistFormats: readonly RadioBrowseFormat[];
  /** Explicit station tags only, never inferred from the current recording. */
  decades: readonly RadioBrowseDecade[];
  /** Constraints on the resolved recording playing now. */
  playingNow: readonly AgeTier[];
  broZones: readonly BroZone[];
  followedOnly: boolean;
  supportOnly: boolean;
}

export interface RadioBrowseState {
  lens: RadioBrowseLens;
  sort: RadioBrowseSort;
  filters: RadioBrowseFilters;
  locality: CoarseLocality | null;
  /** A focused Library artist is a For You ranking input, not a new lens. */
  focusedArtist: string | null;
  focusedSound: string | null;
  page: number;
}

/**
 * Deliberately narrow station projection.  The adapter in a component can
 * populate this from DialStation without making this state model depend on
 * the API client's generated Station type.
 */
export interface RadioBrowseStation {
  slug: string;
  name: string;
  city?: string | null;
  region?: string | null;
  playable?: boolean;
  isLive?: boolean;
  stationTypes?: readonly RadioBrowseStationType[];
  specialistFormats?: readonly RadioBrowseFormat[];
  decadeTags?: readonly string[];
  tags?: readonly string[];
  proximityMiles?: number | null;
  crossings?: number;
  artistCrossings?: number;
  rarestCrossing?: number;
  score?: number;
  support?: boolean;
  followed?: boolean;
  broZones?: readonly BroZone[];
  currentTrack?: {
    releaseYear?: number | null;
    ageTier?: AgeTier | null;
  } | null;
  /** Optional stable source order for deterministic ties. */
  sourceIndex?: number;
}

export const EMPTY_RADIO_BROWSE_FILTERS: RadioBrowseFilters = {
  stationTypes: [],
  specialistFormats: [],
  decades: [],
  playingNow: [],
  broZones: [],
  followedOnly: false,
  supportOnly: false,
};

export const RADIO_BROWSE_LENS_LABELS: Record<RadioBrowseLens, string> = {
  local: "Local",
  "for-you": "For You",
  all: "All",
};

export function createRadioBrowseState(options: {
  locality?: CoarseLocality | null;
  hasTasteEvidence?: boolean;
  lens?: RadioBrowseLens;
} = {}): RadioBrowseState {
  const locality = normalizeLocality(options.locality);
  const requested = options.lens === "for-you" && !options.hasTasteEvidence
    ? "local"
    : options.lens ?? "local";
  return {
    lens: requested,
    sort: "recommended",
    filters: { ...EMPTY_RADIO_BROWSE_FILTERS },
    locality,
    focusedArtist: null,
    focusedSound: null,
    page: 1,
  };
}

export function normalizeZip(value: string): string | null {
  const zip = value.trim().replace(/\s+/g, "");
  return /^\d{5}$/.test(zip) ? zip : null;
}

export function normalizeLocality(value: CoarseLocality | null | undefined): CoarseLocality | null {
  if (!value) return null;
  const zip = value.zip ? normalizeZip(value.zip) : null;
  const city = value.city?.trim().replace(/\s+/g, " ").slice(0, 80) || undefined;
  const state = value.state?.trim().toUpperCase().slice(0, 2) || undefined;
  return zip || city || state ? { ...(zip ? { zip } : {}), ...(city ? { city } : {}), ...(state ? { state } : {}) } : null;
}

export function toggleRadioFilter<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function setRadioBrowseLens(state: RadioBrowseState, lens: RadioBrowseLens): RadioBrowseState {
  return {
    ...state,
    lens,
    sort: "recommended",
    page: 1,
    focusedSound: null,
  };
}

export function setRadioBrowseSort(state: RadioBrowseState, sort: RadioBrowseSort): RadioBrowseState {
  return { ...state, sort, page: 1 };
}

export function patchRadioBrowseFilters(
  state: RadioBrowseState,
  filters: Partial<RadioBrowseFilters>,
): RadioBrowseState {
  return {
    ...state,
    filters: { ...state.filters, ...filters },
    page: 1,
  };
}

export function focusForYou(
  state: RadioBrowseState,
  artist: string | null,
): RadioBrowseState {
  const focusedArtist = normalizeRadioArtistFocus(artist);
  return { ...state, lens: "for-you", focusedArtist, page: 1 };
}

export function normalizeRadioArtistFocus(value: string | null | undefined): string | null {
  const normalized = value
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120) ?? "";
  return normalized || null;
}

export function focusSound(
  state: RadioBrowseState,
  sound: string | null,
): RadioBrowseState {
  const focusedSound = sound?.trim() || null;
  return {
    ...state,
    focusedSound,
    filters: focusedSound && isRadioBrowseDecade(focusedSound)
      ? { ...state.filters, decades: [focusedSound] }
      : state.filters,
    page: 1,
  };
}

export function resetRadioBrowseState(state: RadioBrowseState): RadioBrowseState {
  return createRadioBrowseState({ locality: state.locality });
}

export function isRadioBrowseLens(value: string | null | undefined): value is RadioBrowseLens {
  return value === "local" || value === "for-you" || value === "all";
}

export function isRadioBrowseSort(value: string | null | undefined): value is RadioBrowseSort {
  return RADIO_BROWSE_SORTS.includes(value as RadioBrowseSort);
}

export function isRadioBrowseDecade(value: string | null | undefined): value is RadioBrowseDecade {
  return RADIO_BROWSE_DECADES.includes(value as RadioBrowseDecade);
}

function parseList<T extends string>(value: string | null, allowed: readonly T[]): T[] {
  if (!value) return [];
  const values = value.split(",").filter((item): item is T => allowed.includes(item as T));
  return [...new Set(values)];
}

function parseBoolean(value: string | null): boolean {
  return value === "1" || value === "true";
}

/**
 * URL state is intentionally flat and human-readable.  Unknown values are
 * ignored so an old bookmark can never make the browse surface disappear.
 */
export function parseRadioBrowseUrl(search: string): Partial<RadioBrowseState> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawLens = params.get("lens");
  const rawSort = params.get("sort");
  return {
    ...(isRadioBrowseLens(rawLens) ? { lens: rawLens } : {}),
    ...(isRadioBrowseSort(rawSort) ? { sort: rawSort } : {}),
    filters: {
      ...EMPTY_RADIO_BROWSE_FILTERS,
      stationTypes: parseList(params.get("stationType") ?? params.get("type"), [
        "ambient", "campus", "specialist", "core", "public", "independent-dj", "discovery",
      ] as RadioBrowseStationType[]),
      specialistFormats: parseList(params.get("format"), [
        "ambient", "folk", "rock", "jazz", "era", "world", "electronic", "groove", "classical", "other",
      ] as RadioBrowseFormat[]),
      decades: parseList(params.get("decade"), RADIO_BROWSE_DECADES),
      playingNow: parseList(params.get("playing"), ["first", "current", "catalog", "deep"] as AgeTier[]),
      broZones: parseList(params.get("zone") ?? params.get("broZones"), [...BRO_ZONE_KEYS] as BroZone[]),
      followedOnly: parseBoolean(params.get("followed")),
      supportOnly: parseBoolean(params.get("support")),
    },
    ...(params.get("artist") ? { focusedArtist: normalizeRadioArtistFocus(params.get("artist")) } : {}),
    ...(params.get("sound") ? { focusedSound: params.get("sound") } : {}),
    ...(Number(params.get("page")) > 0 ? { page: Math.floor(Number(params.get("page"))) } : {}),
  };
}

export function serializeRadioBrowseUrl(state: RadioBrowseState): string {
  const params = new URLSearchParams();
  if (state.lens !== "local") params.set("lens", state.lens);
  if (state.sort !== "recommended") params.set("sort", state.sort);
  const filters = state.filters;
  if (filters.stationTypes.length) params.set("stationType", [...filters.stationTypes].sort().join(","));
  if (filters.specialistFormats.length) params.set("format", [...filters.specialistFormats].sort().join(","));
  if (filters.decades.length) params.set("decade", [...filters.decades].sort().join(","));
  if (filters.playingNow.length) params.set("playing", [...filters.playingNow].sort().join(","));
  if (filters.broZones.length) params.set("zone", [...filters.broZones].sort().join(","));
  if (filters.followedOnly) params.set("followed", "1");
  if (filters.supportOnly) params.set("support", "1");
  if (state.focusedArtist) params.set("artist", state.focusedArtist);
  if (state.focusedSound) params.set("sound", state.focusedSound);
  if (state.page > 1) params.set("page", String(state.page));
  const value = params.toString();
  return value ? `?${value}` : "";
}

const LOCALITY_KEY = "lore:radioBrowse:locality";

export function readRadioBrowseLocality(): CoarseLocality | null {
  try {
    const raw = localStorage.getItem(LOCALITY_KEY);
    return raw ? normalizeLocality(JSON.parse(raw) as CoarseLocality) : null;
  } catch {
    return null;
  }
}

export function writeRadioBrowseLocality(locality: CoarseLocality | null): void {
  try {
    if (locality) localStorage.setItem(LOCALITY_KEY, JSON.stringify(normalizeLocality(locality)));
    else localStorage.removeItem(LOCALITY_KEY);
  } catch {
    // A blocked device store should not prevent browsing or playback.
  }
}

function stationHasDecade(station: RadioBrowseStation, decade: RadioBrowseDecade): boolean {
  // Decade matching is an exact API vocabulary match. Never infer a decade
  // from a station name, a current recording, or a substring of free text.
  return [...(station.decadeTags ?? [])].some((value) => value.trim().toLowerCase() === decade);
}

function stationHasLocality(station: RadioBrowseStation, locality: CoarseLocality | null): boolean {
  if (!locality) return true;
  const haystack = `${station.city ?? ""} ${station.region ?? ""}`.toLowerCase();
  return Boolean(
    (locality.city && haystack.includes(locality.city.toLowerCase()))
      || (locality.state && haystack.includes(locality.state.toLowerCase())),
  );
}

export function stationPassesRadioBrowseFilters(
  station: RadioBrowseStation,
  filters: RadioBrowseFilters,
  locality: CoarseLocality | null = null,
): boolean {
  const categoryMatch = filters.stationTypes.length === 0
    || (station.stationTypes ?? []).some((category) => filters.stationTypes.includes(category));
  const formatMatch = filters.specialistFormats.length === 0
    || (station.specialistFormats ?? []).some((format) => filters.specialistFormats.includes(format));
  const decadeMatch = filters.decades.length === 0
    || filters.decades.some((decade) => stationHasDecade(station, decade));
  const playingMatch = filters.playingNow.length === 0
    || station.currentTrack?.ageTier == null
    || filters.playingNow.includes(station.currentTrack.ageTier);
  const broZoneMatch = filters.broZones.length === 0
    || filters.broZones.some((zone) => station.broZones?.includes(zone));
  return categoryMatch
    && formatMatch
    && decadeMatch
    && playingMatch
    && broZoneMatch
    && (!filters.followedOnly || station.followed === true)
    && (!filters.supportOnly || station.support === true)
    && (!locality || stationHasLocality(station, locality));
}

function crossingScore(station: RadioBrowseStation): number {
  return (station.score ?? 0)
    + (station.crossings ?? 0) * 3
    + (station.artistCrossings ?? 0);
}

export function rankRadioBrowseStations(
  stations: readonly RadioBrowseStation[],
  state: Pick<RadioBrowseState, "lens" | "sort" | "locality" | "filters" | "focusedArtist">,
): RadioBrowseStation[] {
  const eligible = stations.filter((station) =>
    stationPassesRadioBrowseFilters(station, state.filters, null),
  );
  const focused = state.focusedArtist?.trim().toLowerCase() ?? null;
  return [...eligible].sort((a, b) => {
    if (state.sort === "name") return a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
    if (state.sort === "live-now") {
      return Number(b.isLive) - Number(a.isLive)
        || crossingScore(b) - crossingScore(a)
        || a.name.localeCompare(b.name);
    }
    if (state.sort === "nearest") {
      return (a.proximityMiles ?? Number.POSITIVE_INFINITY) - (b.proximityMiles ?? Number.POSITIVE_INFINITY)
        || Number(b.playable) - Number(a.playable)
        || a.name.localeCompare(b.name);
    }
    if (state.sort === "rarest-crossing") {
      return (a.rarestCrossing ?? Number.POSITIVE_INFINITY) - (b.rarestCrossing ?? Number.POSITIVE_INFINITY)
        || a.name.localeCompare(b.name);
    }
    const aFocused = focused && [...(a.tags ?? [])].some((tag) => tag.toLowerCase().includes(focused)) ? 1 : 0;
    const bFocused = focused && [...(b.tags ?? [])].some((tag) => tag.toLowerCase().includes(focused)) ? 1 : 0;
    if (state.lens === "local") {
      return (a.proximityMiles ?? Number.POSITIVE_INFINITY) - (b.proximityMiles ?? Number.POSITIVE_INFINITY)
        || Number(b.playable) - Number(a.playable)
        || Number((b.stationTypes ?? []).some((type) => type === "campus" || type === "independent-dj"))
          - Number((a.stationTypes ?? []).some((type) => type === "campus" || type === "independent-dj"))
        || a.name.localeCompare(b.name);
    }
    if (state.lens === "for-you") {
      return (bFocused ?? 0) - (aFocused ?? 0)
        || crossingScore(b) - crossingScore(a)
        || a.name.localeCompare(b.name);
    }
    return Number(b.playable) - Number(a.playable)
      || a.name.localeCompare(b.name);
  });
}

export function paginateRadioDeck<T>(items: readonly T[], page: number, pageSize = 4): T[] {
  const start = Math.max(0, page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function radioBrowsePageCount(itemCount: number, pageSize = 4): number {
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

export function radioBrowseProvenance(
  state: Pick<RadioBrowseState, "lens" | "locality" | "focusedArtist" | "focusedSound">,
  count: number,
): string {
  if (state.focusedSound) return `${count} stations explicitly tagged ${state.focusedSound}.`;
  if (state.lens === "local") {
    if (state.locality?.city || state.locality?.state) return `${count} playable stations ranked by approximate locality, with independent and campus radio favored.`;
    if (state.locality?.zip) return `${count} playable stations near your coarse ZIP area, with independent and campus radio favored.`;
    return `${count} editorial stations to start with; add a coarse locality to see nearby radio.`;
  }
  if (state.lens === "for-you") {
    if (state.focusedArtist) return `${count} stations ranked by Library crossings and evidence for ${state.focusedArtist}.`;
    return `${count} stations ranked by your Library crossings and saved-artist evidence.`;
  }
  return `${count} eligible stations from the complete catalog, without a personalized ranking claim.`;
}

export const RADIO_SOUND_DESTINATIONS: readonly {
  id: string;
  label: string;
  kind: "format" | "decade";
}[] = [
  { id: "jazz", label: "Jazz", kind: "format" },
  { id: "electronic", label: "Electronic", kind: "format" },
  { id: "ambient", label: "Ambient", kind: "format" },
  { id: "1980s", label: "1980s", kind: "decade" },
  { id: "1990s", label: "1990s", kind: "decade" },
];