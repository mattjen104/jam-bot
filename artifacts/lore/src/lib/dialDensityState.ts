/**
 * dialDensityState — the SplitHome dial band's display density.
 *
 * Three densities, cycled from the scan remote:
 *   - "normal"  (default): 5 full rows per page (play button, now-playing
 *                sentence, scan checkbox) — the classic CompactDial.
 *   - "compact": 10 name-only rows per page — ordinal + station name, tap
 *                to tune in, no expansion.
 *   - "micro":   15 numbered keypad buttons per page, three across like a
 *                telephone keypad — tap a number to tune in.
 *
 * Like the lens/radio-mode state, this is local-first listener state:
 * persisted in localStorage, never sent to the server. Reading falls back to
 * "normal" on any malformed/missing value so an old client (or a corrupted
 * key) simply reverts to the classic five-row view.
 *
 * Pure helpers, kept out of SplitHome so the rules are unit-testable without
 * the component tree. Mirrors the shape of dialRadioMode.ts.
 */

export type DialDensity = "normal" | "compact" | "micro";

const LS_DIAL_DENSITY_KEY = "lore:dialDensity";

/** Parse a raw stored value; anything unrecognized → "normal". */
export function parseDialDensity(raw: string | null | undefined): DialDensity {
  return raw === "compact" || raw === "micro" ? raw : "normal";
}

/** Read the persisted density. Safe under SSR/jsdom without localStorage. */
export function readDialDensity(): DialDensity {
  try {
    return parseDialDensity(localStorage.getItem(LS_DIAL_DENSITY_KEY));
  } catch {
    return "normal";
  }
}

/** Persist the density. Failures (private mode, quota) are silently ignored. */
export function writeDialDensity(density: DialDensity): void {
  try {
    localStorage.setItem(LS_DIAL_DENSITY_KEY, density);
  } catch {
    // localStorage unavailable — the density simply won't survive a reload.
  }
}

/** The cycle order: normal → compact → micro → normal. */
export function nextDialDensity(density: DialDensity): DialDensity {
  if (density === "normal") return "compact";
  if (density === "compact") return "micro";
  return "normal";
}

/**
 * Rows shown per scan page at a density: 5 full rows (normal), 10 name-only
 * remote keys (compact), or 15 keypad buttons (micro).
 */
export function dialPageSize(density: DialDensity): number {
  if (density === "compact") return 10;
  if (density === "micro") return 15;
  return 5;
}
