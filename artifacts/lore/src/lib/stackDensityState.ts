/**
 * stackDensityState — the SplitHome Stack band's display density.
 *
 * Three densities, cycled from a small key on the StackPagerBar:
 *   - "normal"  (default): 5 full rows per page (play button, year, album,
 *                artist, relationship credit) — the classic CompactStack.
 *   - "compact": 10 half-height rows per page — the relationship credit
 *                segment drops off the collapsed row text.
 *   - "micro":   15 one-third-height rows per page — year + album title
 *                only, no artist, no credit.
 *
 * Unlike the dial's micro keypad, the Stack's third density stays a row
 * list — there is no unlimited "whole library" mode.
 *
 * Like the dial density, this is local-first listener state: persisted in
 * localStorage, never sent to the server. Reading falls back to "normal"
 * on any malformed/missing value so an old client (or a corrupted key)
 * simply reverts to the classic five-row view.
 *
 * Pure helpers, kept out of SplitHome so the rules are unit-testable
 * without the component tree. Mirrors dialDensityState.ts.
 */

export type StackDensity = "normal" | "compact" | "micro";

const LS_STACK_DENSITY_KEY = "lore:stackDensity";

/** Parse a raw stored value; anything unrecognized → "normal". */
export function parseStackDensity(raw: string | null | undefined): StackDensity {
  return raw === "compact" || raw === "micro" ? raw : "normal";
}

/** Read the persisted density. Safe under SSR/jsdom without localStorage. */
export function readStackDensity(): StackDensity {
  try {
    return parseStackDensity(localStorage.getItem(LS_STACK_DENSITY_KEY));
  } catch {
    return "normal";
  }
}

/** Persist the density. Failures (private mode, quota) are silently ignored. */
export function writeStackDensity(density: StackDensity): void {
  try {
    localStorage.setItem(LS_STACK_DENSITY_KEY, density);
  } catch {
    // localStorage unavailable — the density simply won't survive a reload.
  }
}

/** The cycle order: normal → compact → micro → normal. */
export function nextStackDensity(density: StackDensity): StackDensity {
  if (density === "normal") return "compact";
  if (density === "compact") return "micro";
  return "normal";
}

/**
 * Album rows shown per Stack page at a density: 5 full rows (normal),
 * 10 half-height rows (compact), or 15 one-third-height rows (micro).
 */
export function stackPageSize(density: StackDensity): number {
  if (density === "compact") return 10;
  if (density === "micro") return 15;
  return 5;
}
