/**
 * dialAgeFilter — maps a spin's provenance to an age tier.
 *
 * Tiers:
 *   "first"   — Lore's first play of a brand-new song: the spin is the
 *               recording's first-ever archive play (isFirstSpin) AND it
 *               qualifies as a premiere:
 *                 - releaseDate known: the spin's playedAt date is on or
 *                   before the release date, reading partial dates
 *                   permissively (year-only `2025` → 2025-12-31; year-month
 *                   `2025-11` → 2025-11-30) so coarse MusicBrainz data never
 *                   hides a real premiere.
 *                 - releaseDate absent but releaseYear known: the release
 *                   year is ≥ the spin's calendar year (year-granularity
 *                   fallback while dates backfill).
 *                 - both absent: NOT "first" — tier stays null and the row
 *                   passes all filters (never hidden by missing data).
 *               A first-ever archive play of an older catalog track falls
 *               through to Current/Catalog/Deep by release year.
 *   "current" — released within the last 18 months (0–18 months old).
 *   "catalog" — released 19–60 months ago.
 *   "deep"    — released more than 60 months ago.
 *   null      — no age data; the row passes through any active age filter
 *               (never hidden by unknown age).
 *
 * The Current/Catalog/Deep comparison is year-based (integer arithmetic)
 * rather than day-accurate. This is intentional: release years are often the
 * only granularity MusicBrainz provides for older music, and sub-year
 * precision would produce misleading results. Only the premiere (First)
 * check uses full dates.
 */

export type AgeTier = "first" | "current" | "catalog" | "deep";

export const AGE_TIER_DEFINITIONS: {
  tier: AgeTier;
  command: `/${AgeTier}`;
  /** Compact label used by the full-Dial filter bar's pipe-separated menu. */
  label: string;
  /** Longer discovery label for the SplitHome console chips (falls back to label). */
  chipLabel?: string;
  title: string;
}[] = [
  { tier: "first",   command: "/first",   label: "First",   chipLabel: "Premiere", title: "First Lore play of a brand-new release (on or before its release date)" },
  { tier: "current", command: "/current", label: "Current", title: "Released within the last 18 months" },
  { tier: "catalog", command: "/catalog", label: "Catalog", title: "Released 18–60 months ago" },
  { tier: "deep",    command: "/deep",    label: "Deep",    title: "Released 60+ months ago" },
];

/**
 * Expand a MusicBrainz partial-ISO date (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) to
 * the LAST possible day it could mean, as a `YYYY-MM-DD` string. Permissive
 * by design: a premiere spin should still qualify when MusicBrainz only knows
 * the year or month. Returns null for anything outside the three forms.
 */
export function expandPartialReleaseDateEnd(
  releaseDate: string | null | undefined,
): string | null {
  if (!releaseDate) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(releaseDate.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  if (mo == null) return `${y}-12-31`;
  const month = Number(mo);
  if (month < 1 || month > 12) return null;
  if (d != null) {
    const day = Number(d);
    if (day < 1 || day > 31) return null;
    return `${y}-${mo}-${d}`;
  }
  // Last day of the given month. Day 0 of month+1 = last day of month.
  const lastDay = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
  return `${y}-${mo}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Whether a spin qualifies as a premiere: aired on or before the release
 * date (permissive partial-date expansion), or — when only the release year
 * is known — released in the spin's calendar year or later.
 *
 * Dates compare as UTC calendar days (`YYYY-MM-DD` strings); a same-day spin
 * qualifies regardless of time-of-day.
 */
export function isPremierePlay(
  playedAt: string | Date,
  releaseDate: string | null | undefined,
  releaseYear: number | null | undefined,
): boolean {
  const played = playedAt instanceof Date ? playedAt : new Date(playedAt);
  if (Number.isNaN(played.getTime())) return false;
  const playedDay = played.toISOString().slice(0, 10);
  const releaseEnd = expandPartialReleaseDateEnd(releaseDate);
  if (releaseEnd) return playedDay <= releaseEnd;
  if (releaseYear != null) return releaseYear >= played.getUTCFullYear();
  return false;
}

/**
 * Return the age tier for a spin, or null when there is no age data.
 *
 * @param isFirstSpin - whether this is the recording's first-ever Lore play
 * @param releaseYear - MusicBrainz first-release year (integer), or null/undefined
 * @param releaseDate - MusicBrainz first-release date in partial-ISO form, or null/undefined
 * @param playedAt    - when the spin aired; defaults to now (live rows)
 * @param nowYear     - the current year; defaults to new Date().getFullYear()
 */
export function spinAgeTier(
  isFirstSpin: boolean,
  releaseYear: number | null | undefined,
  releaseDate?: string | null,
  playedAt?: string | Date | null,
  nowYear: number = new Date().getFullYear(),
): AgeTier | null {
  if (isFirstSpin) {
    // Tier "first" = premiere: Lore's first play of a brand-new song.
    // First archive plays of older catalog fall through to the year tiers.
    if (isPremierePlay(playedAt ?? new Date(), releaseDate, releaseYear)) {
      return "first";
    }
  }
  if (releaseYear == null) return null;
  // Age in "fractional years": use months-via-years for integer release years.
  // A song released in 2023 with nowYear=2025 is 2 years old. We multiply by
  // 12 to get approximate months, erring toward "older" at year boundaries.
  const approxMonths = (nowYear - releaseYear) * 12;
  if (approxMonths <= 18) return "current";
  if (approxMonths <= 60) return "catalog";
  return "deep";
}

/**
 * Returns true when a row should be SHOWN given the active tier filter set.
 *
 * Rules:
 *   - If no tiers are active (empty set), all rows pass.
 *   - If the spin's tier is null OR undefined (no release year, not
 *     isFirstSpin, or an older payload shape without the field), the row
 *     always passes — we never hide a row solely due to missing release data.
 *   - Otherwise the spin's tier must be in the active set.
 */
export function rowPassesAgeTierFilter(
  tier: AgeTier | null | undefined,
  activeTiers: ReadonlySet<AgeTier>,
): boolean {
  if (activeTiers.size === 0) return true;
  if (tier == null) return true;
  return activeTiers.has(tier);
}
