/**
 * dialAgeFilter — maps a spin's provenance to an age tier.
 *
 * Tiers:
 *   "first"   — isFirstSpin=true (first-ever play of this recording in the
 *               Lore archive), regardless of release year.
 *   "current" — released within the last 18 months (0–18 months old).
 *   "catalog" — released 19–60 months ago.
 *   "deep"    — released more than 60 months ago.
 *   null      — releaseYear is absent and isFirstSpin is false; the row
 *               passes through any active age filter (never hidden by
 *               unknown age).
 *
 * The comparison is year-based (integer arithmetic) rather than day-accurate.
 * This is intentional: release years are often the only granularity MusicBrainz
 * provides, and sub-year precision would produce misleading results.
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
  { tier: "first",   command: "/first",   label: "First",   chipLabel: "First play", title: "First-ever play of this recording on any Lore station" },
  { tier: "current", command: "/current", label: "Current", title: "Released within the last 18 months" },
  { tier: "catalog", command: "/catalog", label: "Catalog", title: "Released 18–60 months ago" },
  { tier: "deep",    command: "/deep",    label: "Deep",    title: "Released 60+ months ago" },
];

/**
 * Return the age tier for a spin, or null when the release year is unknown.
 *
 * @param isFirstSpin - whether this is the recording's first-ever Lore play
 * @param releaseYear - MusicBrainz first-release year (integer), or null/undefined
 * @param nowYear     - the current year; defaults to new Date().getFullYear()
 */
export function spinAgeTier(
  isFirstSpin: boolean,
  releaseYear: number | null | undefined,
  nowYear: number = new Date().getFullYear(),
): AgeTier | null {
  if (isFirstSpin) return "first";
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
 *   - If the spin's tier is null (no release year, not isFirstSpin), the row
 *     always passes — we never hide a row solely due to missing release data.
 *   - Otherwise the spin's tier must be in the active set.
 */
export function rowPassesAgeTierFilter(
  tier: AgeTier | null,
  activeTiers: ReadonlySet<AgeTier>,
): boolean {
  if (activeTiers.size === 0) return true;
  if (tier === null) return true;
  return activeTiers.has(tier);
}
