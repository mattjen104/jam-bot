/**
 * UI preference flags persisted per browser session.
 */

/** Set when the user explicitly opts for the classic site over the webplayer. */
export const PREFER_CLASSIC_KEY = "lore:prefer-classic";

/** Remember (for this session) that the user chose the classic site. */
export function rememberPrefersClassic(): void {
  try {
    sessionStorage.setItem(PREFER_CLASSIC_KEY, "1");
  } catch {
    // sessionStorage unavailable — preference just won't persist
  }
}

/** Whether the user chose the classic site this session. */
export function prefersClassic(): boolean {
  try {
    return sessionStorage.getItem(PREFER_CLASSIC_KEY) === "1";
  } catch {
    return false;
  }
}
