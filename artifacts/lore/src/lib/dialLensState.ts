/**
 * dialLensState — the Dial's lens toggle (Radio | Press | Shows).
 *
 * Lenses are exclusive views over the same feed surface:
 *   - "radio": the live-station crossing feed (default, today's behavior)
 *   - "press": scraped-metadata mentions of the listener's taste (blog picks,
 *     year-end lists, track claims)
 *   - "shows": upcoming concerts for artists in the listener's Stack,
 *     powered by Bandsintown
 *
 * The active lens is local-first listener state: persisted in localStorage,
 * never sent to the server (like dial pins and the journal). Reading falls
 * back to "radio" on any malformed/missing value so an old or corrupted key
 * can never blank the Dial.
 *
 * Pure helpers, kept out of DialView so the rules are unit-testable without
 * the component tree.
 */

export type DialLens = "radio" | "press" | "shows";

export const DIAL_LENSES: readonly DialLens[] = ["radio", "press", "shows"] as const;

const LS_LENS_KEY = "lore:dialLens";

/** Parse a raw stored value into a lens; anything unknown → "radio". */
export function parseDialLens(raw: string | null | undefined): DialLens {
  if (raw === "press") return "press";
  if (raw === "shows") return "shows";
  return "radio";
}

/** Read the persisted lens. Safe under SSR/jsdom without localStorage. */
export function readDialLens(): DialLens {
  try {
    return parseDialLens(localStorage.getItem(LS_LENS_KEY));
  } catch {
    return "radio";
  }
}

/** Persist the lens. Failures (private mode, quota) are silently ignored. */
export function writeDialLens(lens: DialLens): void {
  try {
    localStorage.setItem(LS_LENS_KEY, lens);
  } catch {
    // localStorage unavailable — the lens simply won't survive a reload.
  }
}

// ---------------------------------------------------------------------------
// Shows city — listener's city for concert proximity sorting.
// Local-first, never sent to the server as a profile field; included only as
// a query parameter when fetching the Shows feed.
// ---------------------------------------------------------------------------

const LS_SHOWS_CITY_KEY = "lore:showsCity";

/** Read the persisted city. Null when not set or localStorage unavailable. */
export function readShowsCity(): string | null {
  try {
    return localStorage.getItem(LS_SHOWS_CITY_KEY) || null;
  } catch {
    return null;
  }
}

/** Persist the city. Pass null to clear it. Failures are silently ignored. */
export function writeShowsCity(city: string | null): void {
  try {
    if (city) {
      localStorage.setItem(LS_SHOWS_CITY_KEY, city);
    } else {
      localStorage.removeItem(LS_SHOWS_CITY_KEY);
    }
  } catch {
    // localStorage unavailable — the city won't survive a reload.
  }
}
