/**
 * Genre breakdown + discovery-score aggregation shared by every page that
 * shows "what does this station/show/DJ/list actually play" (station,
 * show/run, DJ/picker, curated list). Pure, in-process math over rows already
 * pulled from the DB — no per-spin recompute, no live queries beyond the one
 * batch fetch the caller already needs to do. Degrades to nulls/unknown
 * rather than fabricating a genre or a score from partial data.
 */

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

function labelFromScore(score: number): DiscoveryLabel {
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
