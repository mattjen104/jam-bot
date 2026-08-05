/**
 * Rumours by Fleetwood Mac — universal album art placeholder.
 * Used as both the initial fallback (when artworkUrl is null) and the
 * onError recovery (when an external CDN URL fails to load).
 *
 * Cover Art Archive: release-group 3e0b2fe7-c6d3-41a5-843a-73ffe5c6c57f
 */
export const RUMOURS =
  "https://coverartarchive.org/release-group/3e0b2fe7-c6d3-41a5-843a-73ffe5c6c57f/front-500";

/** Drop-in onError handler: swaps a broken image to the Rumours cover. */
export function onArtError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.src !== RUMOURS) img.src = RUMOURS;
}
