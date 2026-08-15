/**
 * Client-side reading of the server-computed now-playing freshness class.
 *
 * The server derives `freshness` ("fresh" | "aging" | "stale") from the
 * source's expected polling cadence and the age since `observedAt` (when Lore
 * received the metadata). Clients never recompute it — they only gate on it:
 *
 *  - stale items get a subtle "may be delayed" indicator instead of being
 *    presented as playing right now;
 *  - stale items are never counted as confirmed live crossings.
 *
 * Absence of the field (older cached payloads, clients behind the schema)
 * means unknown — treated as NOT stale, so existing behavior is unchanged.
 */

export type NowPlayingFreshness = "fresh" | "aging" | "stale";

/** True only when the payload explicitly says "stale". Unknown ⇒ not stale. */
export function isStaleNowPlaying(
  np: { freshness?: string | null } | null | undefined,
): boolean {
  return np?.freshness === "stale";
}

/**
 * Live-crossing gate: a stale now-playing observation is never counted as a
 * confirmed live crossing — its server-computed hit flags are downgraded to
 * false at the point where the live snapshot becomes the Dial's
 * currentTrack/liveTrack. Fresh/aging (and unknown) pass through unchanged,
 * so existing behavior is preserved for every client that predates the field.
 */
export function gateLiveHitFlags(np: {
  freshness?: string | null;
  isLibraryHit?: boolean;
  isArtistHit?: boolean;
}): { isLibraryHit: boolean; isArtistHit: boolean } {
  const stale = isStaleNowPlaying(np);
  return {
    isLibraryHit: !stale && (np.isLibraryHit ?? false),
    isArtistHit: !stale && (np.isArtistHit ?? false),
  };
}
