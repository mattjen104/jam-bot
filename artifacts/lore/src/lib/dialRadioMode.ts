/**
 * dialRadioMode — the "blank radio" feed mode toggled by the `/radio` and
 * `/crossings` CLI commands.
 *
 * radioMode is a sub-state of the existing "radio" lens (it is NOT a fourth
 * lens and never touches the `lore:dialLens` key):
 *   - radioMode = false (default): the crossing-ranked Radio feed — station
 *     rows with a crossing reason lead with the crossing sentence.
 *   - radioMode = true: crossings are suppressed — every row leads with the
 *     live now-playing sentence instead, and the crossing skeleton /
 *     onboarding nudges stay hidden. Pure station discovery by what is on
 *     air right now.
 *
 * Like the lens state, this is local-first listener state: persisted in
 * localStorage, never sent to the server. Reading falls back to `false` on
 * any malformed/missing value so an old client (or a corrupted key) simply
 * reverts to the crossing-ranked view.
 *
 * Pure helpers, kept out of DialView so the rules are unit-testable without
 * the component tree. Mirrors the shape of dialLensState.ts.
 */

const LS_RADIO_MODE_KEY = "lore:radioMode";

/** Parse a raw stored value into the mode flag; anything but "true" → false. */
export function parseRadioMode(raw: string | null | undefined): boolean {
  return raw === "true";
}

/** Read the persisted mode. Safe under SSR/jsdom without localStorage. */
export function readRadioMode(): boolean {
  try {
    return parseRadioMode(localStorage.getItem(LS_RADIO_MODE_KEY));
  } catch {
    return false;
  }
}

/** Persist the mode. Failures (private mode, quota) are silently ignored. */
export function writeRadioMode(on: boolean): void {
  try {
    localStorage.setItem(LS_RADIO_MODE_KEY, on ? "true" : "false");
  } catch {
    // localStorage unavailable — the mode simply won't survive a reload.
  }
}
