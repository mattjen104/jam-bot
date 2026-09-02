/**
 * Genre breakdown + discovery-score aggregation shared by every page that
 * shows "what does this station/show/DJ/list actually play" (station,
 * show/run, DJ/picker, curated list). Pure, in-process math over rows already
 * pulled from the DB — no per-spin recompute, no live queries beyond the one
 * batch fetch the caller already needs to do. Degrades to nulls/unknown
 * rather than fabricating a genre or a score from partial data.
 */
import { isJunkArtistValue, isJunkMetadata } from "./icy.js";

export interface GenreCount {
  genre: string;
  count: number;
}

export interface GenreBreakdown {
  /** Top genres by track count, most-played first. */
  top: GenreCount[];
  /** Tracks resolved but with no genre data (never enriched, or truly tagless). */
  unknownCount: number;
  /** Total tracks considered (resolved + unresolved). */
  totalCount: number;
}

export type StationReadinessTier = "ready" | "provisional" | "insufficient";

export interface StationRecentProfile {
  windowDays: 90;
  sampleSize: number;
  resolvedCount: number;
  uniqueTrackCount: number;
  uniqueArtistCount: number;
  resolutionRate: number;
  genreTaggedCount: number;
  genreCoverage: number;
  datedTrackCount: number;
  datedTrackCoverage: number;
  excludedCount: number;
  top: GenreCount[];
  unknownGenreCount: number;
  latestSpinAt: string | null;
  updatedAt: string;
  readinessTier: StationReadinessTier;
}

export interface StationFreshnessSignal {
  windowDays: 30;
  sampleSize: number;
  resolvedCount: number;
  resolutionRate: number;
  latestSpinAt: string | null;
  hasRecentUsableSpin: boolean;
  updatedAt: string;
}

export interface RecentStationSpinRow {
  mbid: string | null;
  artistMbid: string | null;
  artist: string | null;
  title: string | null;
  rawArtist: string | null;
  rawTitle: string | null;
  showName: string | null;
  djName: string | null;
  genres: string[] | null;
  releaseYear: number | null;
  playedAt: Date;
}

const MIN_READY_RESOLVED = 50;
const MIN_READY_TRACKS = 40;
const MIN_READY_ARTISTS = 30;
const MIN_PROVISIONAL_RESOLVED = 20;
const MIN_PROVISIONAL_TRACKS = 15;
const MIN_PROVISIONAL_ARTISTS = 10;
const MIN_READY_GENRE_TAGGED = 10;
const MIN_READY_GENRE_SUPPORT = 3;
const MAX_MATERIAL_EXCLUSION_RATE = 0.5;

const POLLUTED_GENRES = new Set([
  "",
  "unknown",
  "unknown genre",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
]);

/** Reject obvious placeholders before genre counts become listener-facing. */
export function isSupportedGenre(value: string): boolean {
  const genre = value.trim().toLowerCase();
  if (POLLUTED_GENRES.has(genre)) return false;
  if (genre.length > 80 || !/\p{L}/u.test(genre)) return false;
  if (/^(?:https?:\/\/|www\.)/i.test(genre)) return false;
  return true;
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

/**
 * A resolved row can still be unusable evidence when its raw artist is a
 * station/show label. Keep this predicate pure so the job and tests share the
 * exact same gate.
 */
export function isPollutedStationSpin(
  row: Pick<
    RecentStationSpinRow,
    "artist" | "title" | "rawArtist" | "rawTitle" | "showName" | "djName"
  >,
  stationName?: string | null,
): boolean {
  const artist = row.rawArtist?.trim() || row.artist?.trim() || "";
  const title = row.rawTitle?.trim() || row.title?.trim() || "";
  if (!artist || !title) return true;
  if (isJunkMetadata(artist, title) || isJunkArtistValue(artist)) return true;
  const artistKey = normalized(artist);
  const contextualLabels = [stationName, row.showName, row.djName]
    .map(normalized)
    .filter(Boolean);
  if (contextualLabels.includes(artistKey)) return true;

  // Avoid importing the ICY parser into the shared math module. These are the
  // high-confidence pollution cases that matter for an already persisted spin.
  if (artistKey === title.toLocaleLowerCase()) return true;
  if (/^(?:unknown(?: artist)?|artist unknown|station id|automation|commercial|tba|various artists|n\/a|na|none|null|undefined)$/.test(artistKey)) {
    return true;
  }
  if (/^(?:https?:\/\/|www\.)/i.test(artist) || /\.(?:com|net|org|fm|radio)\b/i.test(artist)) {
    return true;
  }
  if (!/\p{L}/u.test(artist)) return true;
  return false;
}

function uniqueGenreTags(rows: RecentStationSpinRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const genres = new Set(
      (row.genres ?? [])
        .map((genre) => genre.trim())
        .filter(isSupportedGenre),
    );
    for (const genre of genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return counts;
}

export function computeStationReadiness(
  profile: Pick<
    StationRecentProfile,
    | "sampleSize"
    | "resolvedCount"
    | "uniqueTrackCount"
    | "uniqueArtistCount"
    | "genreTaggedCount"
    | "excludedCount"
      | "top"
  >,
  freshness: Pick<StationFreshnessSignal, "hasRecentUsableSpin">,
): StationReadinessTier {
  if (!freshness.hasRecentUsableSpin) return "insufficient";
  const exclusionRate =
    profile.sampleSize + profile.excludedCount === 0
      ? 0
      : profile.excludedCount / (profile.sampleSize + profile.excludedCount);
  if (exclusionRate > MAX_MATERIAL_EXCLUSION_RATE) return "insufficient";

  const representative =
    profile.resolvedCount >= MIN_PROVISIONAL_RESOLVED &&
    profile.uniqueTrackCount >= MIN_PROVISIONAL_TRACKS &&
    profile.uniqueArtistCount >= MIN_PROVISIONAL_ARTISTS;
  if (!representative) return "insufficient";

  const supportedGenreCount = profile.top.filter(
    ({ count }) => count >= MIN_READY_GENRE_SUPPORT,
  ).length;
  if (
    profile.resolvedCount >= MIN_READY_RESOLVED &&
    profile.uniqueTrackCount >= MIN_READY_TRACKS &&
    profile.uniqueArtistCount >= MIN_READY_ARTISTS &&
    profile.genreTaggedCount >= MIN_READY_GENRE_TAGGED &&
    supportedGenreCount > 0
  ) {
    return "ready";
  }
  return "provisional";
}

/**
 * Build the stored fact packet for one station's recent spins. The input is
 * already window-bounded by the caller; unresolved rows stay in the sample
 * denominator and polluted rows are excluded before every aggregate.
 */
export function computeRecentStationProfile(
  rows: RecentStationSpinRow[],
  options: {
    stationName?: string | null;
    now?: Date;
    freshnessRows?: RecentStationSpinRow[];
  } = {},
): { profile: StationRecentProfile; freshness: StationFreshnessSignal } {
  const now = options.now ?? new Date();
  const cleanRows = rows.filter(
    (row) => !isPollutedStationSpin(row, options.stationName),
  );
  const resolvedRows = cleanRows.filter((row) => row.mbid != null);
  const trackIds = new Set(resolvedRows.map((row) => row.mbid!));
  const artistIds = new Set(
    resolvedRows
      .map((row) => row.artistMbid ?? normalized(row.artist))
      .filter(Boolean),
  );
  const genreCounts = uniqueGenreTags(resolvedRows);
  const genreTaggedCount = resolvedRows.filter((row) =>
    (row.genres ?? []).some(isSupportedGenre),
  ).length;
  const datedTrackCount = resolvedRows.filter((row) => row.releaseYear != null).length;
  const latestSpin = cleanRows[0]
    ? cleanRows.reduce((latest, row) =>
      row.playedAt > latest.playedAt ? row : latest,
    ).playedAt
    : null;
  const sampleSize = cleanRows.length;
  const profileBase = {
    windowDays: 90 as const,
    sampleSize,
    resolvedCount: resolvedRows.length,
    uniqueTrackCount: trackIds.size,
    uniqueArtistCount: artistIds.size,
    resolutionRate: sampleSize === 0 ? 0 : resolvedRows.length / sampleSize,
    genreTaggedCount,
    genreCoverage: resolvedRows.length === 0 ? 0 : genreTaggedCount / resolvedRows.length,
    datedTrackCount,
    datedTrackCoverage: resolvedRows.length === 0 ? 0 : datedTrackCount / resolvedRows.length,
    excludedCount: rows.length - cleanRows.length,
    top: [...genreCounts.entries()]
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
      .slice(0, 8),
    unknownGenreCount: resolvedRows.length - genreTaggedCount,
    latestSpinAt: latestSpin?.toISOString() ?? null,
    updatedAt: now.toISOString(),
  };

  const freshnessInput = options.freshnessRows ?? rows;
  const cleanFreshnessRows = freshnessInput.filter(
    (row) =>
      row.playedAt >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) &&
      !isPollutedStationSpin(row, options.stationName),
  );
  const resolvedFreshnessRows = cleanFreshnessRows.filter((row) => row.mbid != null);
  const latestFreshness = cleanFreshnessRows.length > 0
    ? cleanFreshnessRows.reduce((latest, row) =>
      row.playedAt > latest.playedAt ? row : latest,
    ).playedAt
    : null;
  const freshness: StationFreshnessSignal = {
    windowDays: 30,
    sampleSize: cleanFreshnessRows.length,
    resolvedCount: resolvedFreshnessRows.length,
    resolutionRate: cleanFreshnessRows.length === 0
      ? 0
      : resolvedFreshnessRows.length / cleanFreshnessRows.length,
    latestSpinAt: latestFreshness?.toISOString() ?? null,
    hasRecentUsableSpin: latestFreshness != null,
    updatedAt: now.toISOString(),
  };
  const profile: StationRecentProfile = {
    ...profileBase,
    readinessTier: computeStationReadiness(profileBase, freshness),
  };
  return { profile, freshness };
}

/** Aggregate genre tags across a set of recordings into a ranked breakdown. */
export function computeGenreBreakdown(
  rows: Array<{ genres: string[] | null }>,
  cap = 8,
): GenreBreakdown {
  const counts = new Map<string, number>();
  let unknownCount = 0;
  for (const row of rows) {
    if (!row.genres || row.genres.length === 0) {
      unknownCount++;
      continue;
    }
    // Count each track once per genre it carries (a track can carry more
    // than one genre) — this is a "what genres show up" breakdown, not a
    // strict partition, so totals across genres can exceed totalCount.
    for (const g of row.genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, cap);
  return { top, unknownCount, totalCount: rows.length };
}

export type DiscoveryLabel = "new-music" | "recent" | "catalog" | "unknown";

export interface DiscoveryScore {
  /** Median track age (air date year − release year) in years, when computable. */
  medianAgeYears: number | null;
  /** 0-100, higher = newer/more "discovery"-leaning; null when no data. */
  score: number | null;
  label: DiscoveryLabel;
  /** Tracks with both a release year and an air date, i.e. usable for scoring. */
  sampleSize: number;
  /** Tracks considered but missing a release year (degraded, not fabricated). */
  unknownCount: number;
}

/** Median of a numeric array (already sorted not required). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function scoreFromAge(ageYears: number): number {
  // Roughly: brand-new (0y) -> 100, 5y old -> ~70, 15y old -> ~30, 25y+ -> ~0.
  // A simple linear decay is legible ("closer to 100 = newer") without
  // pretending to more precision than the underlying MB/Last.fm data has.
  return Math.max(0, Math.min(100, Math.round(100 - ageYears * 4)));
}

export function labelFromScore(score: number): DiscoveryLabel {
  if (score >= 70) return "new-music";
  if (score >= 35) return "recent";
  return "catalog";
}

/**
 * Compute a discovery score from (releaseYear, airedAt) pairs. Age is floored
 * at 0 (a release dated after its air date is a data error, not "negative
 * age"). Rows with no release year are excluded from the score but counted
 * in `unknownCount` so the UI can show "N/total tracks dated".
 */
export function computeDiscoveryScore(
  rows: Array<{ releaseYear: number | null; airedAt: Date }>,
): DiscoveryScore {
  const ages: number[] = [];
  let unknownCount = 0;
  for (const row of rows) {
    if (row.releaseYear == null) {
      unknownCount++;
      continue;
    }
    const airedYear = row.airedAt.getUTCFullYear();
    ages.push(Math.max(0, airedYear - row.releaseYear));
  }
  if (ages.length === 0) {
    return {
      medianAgeYears: null,
      score: null,
      label: "unknown",
      sampleSize: 0,
      unknownCount,
    };
  }
  const medianAgeYears = median(ages);
  const score = scoreFromAge(medianAgeYears);
  return {
    medianAgeYears,
    score,
    label: labelFromScore(score),
    sampleSize: ages.length,
    unknownCount,
  };
}
