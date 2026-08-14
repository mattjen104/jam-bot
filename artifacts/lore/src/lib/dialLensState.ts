/**
 * dialLensState — the Dial's lens toggle (Radio | Press), with room for a
 * third "Shows" lens later.
 *
 * Lenses are exclusive views over the same feed surface:
 *   - "radio": the live-station crossing feed (default, today's behavior)
 *   - "press": scraped-metadata mentions of the listener's taste (blog picks,
 *     year-end lists, track claims)
 *
 * The active lens is local-first listener state: persisted in localStorage,
 * never sent to the server (like dial pins and the journal). Reading falls
 * back to "radio" on any malformed/missing value so an old or corrupted key
 * can never blank the Dial.
 *
 * Pure helpers, kept out of DialView so the rules are unit-testable without
 * the component tree.
 */

export type DialLens = "radio" | "press";

export const DIAL_LENSES: readonly DialLens[] = ["radio", "press"] as const;

const LS_LENS_KEY = "lore:dialLens";

/** Parse a raw stored value into a lens; anything unknown → "radio". */
export function parseDialLens(raw: string | null | undefined): DialLens {
  return raw === "press" ? "press" : "radio";
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
