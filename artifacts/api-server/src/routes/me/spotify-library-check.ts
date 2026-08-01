/**
 * Spotify /me/tracks/contains seam.
 *
 * Extracted from the Phase 3 retry pass so tests can replace this function via
 * vi.mock without needing to intercept globalThis.fetch or getFreshToken.
 */

import { getFreshToken } from "./auth.js";
import { type serviceConnectionsTable } from "@workspace/db";

/** Endpoint for checking whether tracks are saved in the user's Spotify library. */
const SPOTIFY_ME_TRACKS_CONTAINS = "https://api.spotify.com/v1/me/tracks/contains";
/** Max IDs per Spotify /me/tracks/contains call (Spotify hard cap). */
const SPOTIFY_CONTAINS_BATCH_SIZE = 50;
/** Timeout for each /me/tracks/contains HTTP request. */
const SPOTIFY_CONTAINS_TIMEOUT_MS = 20_000;

/**
 * Checks whether the given Spotify track IDs are saved in the authenticated
 * user's Spotify library.
 *
 * Returns a `Set<string>` of externalIds that are saved, or `null` on any
 * failure (token refresh failed, non-OK API response, network error, timeout).
 *
 * An empty externalIds array returns an empty Set immediately without hitting
 * the network.
 *
 * Production callers must treat `null` as "cannot verify — skip candidate" to
 * avoid ghost-restoring a deliberate removal.
 */
export async function checkSpotifyLibraryContains(
  conn: typeof serviceConnectionsTable.$inferSelect,
  externalIds: string[],
): Promise<Set<string> | null> {
  if (externalIds.length === 0) return new Set();

  const accessToken = await getFreshToken(conn);
  if (!accessToken) {
    console.warn("[spotify/contains] token refresh failed");
    return null;
  }

  const savedIds = new Set<string>();

  for (let i = 0; i < externalIds.length; i += SPOTIFY_CONTAINS_BATCH_SIZE) {
    const batch = externalIds.slice(i, i + SPOTIFY_CONTAINS_BATCH_SIZE);
    const ids = batch.join(",");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SPOTIFY_CONTAINS_TIMEOUT_MS);
    try {
      const res = await fetch(
        `${SPOTIFY_ME_TRACKS_CONTAINS}?ids=${ids}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal },
      );
      if (res.ok) {
        const saved = await res.json() as boolean[];
        for (let j = 0; j < batch.length; j++) {
          if (saved[j]) savedIds.add(batch[j]!);
        }
      } else {
        console.warn(`[spotify/contains] API returned ${res.status}`);
        return null;
      }
    } catch {
      console.warn("[spotify/contains] network error or timeout");
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return savedIds;
}
