/**
 * The home page has one additional lens that is intentionally not part of
 * DialView's full-feed lens model: the recent First plays archive.
 */

import { readDialLens, writeDialLens } from "./dialLensState";

export type HomeLens = "radio" | "firstPlays" | "press";

const LS_HOME_LENS_KEY = "lore:homeLens";

export function parseHomeLens(raw: string | null | undefined): HomeLens {
  if (raw === "firstPlays") return "firstPlays";
  if (raw === "press") return "press";
  return "radio";
}

export function readHomeLens(): HomeLens {
  try {
    const stored = localStorage.getItem(LS_HOME_LENS_KEY);
    if (stored != null) return parseHomeLens(stored);
    // Preserve the existing home preference for listeners who have not
    // visited since the home-only lens was introduced.
    return readDialLens() === "press" ? "press" : "radio";
  } catch {
    return "radio";
  }
}

export function writeHomeLens(lens: HomeLens): void {
  try {
    localStorage.setItem(LS_HOME_LENS_KEY, lens);
  } catch {
    // localStorage unavailable — the home lens won't survive a reload.
  }

  // Keep Radio and Press aligned with the existing full-feed preference.
  // First plays is home-only and must not change /feed's active lens.
  if (lens === "radio" || lens === "press") {
    writeDialLens(lens);
  }
}