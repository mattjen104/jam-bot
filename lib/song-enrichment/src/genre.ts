import { fetchRecordingGenreYear } from "./musicbrainz.js";
import { fetchArtistTags } from "./lastfm.js";
import { logger } from "./logger.js";

export interface GenreYear {
  /** Ranked genre tags, most-relevant first. [] means unknown — never fabricated. */
  genres: string[];
  /** First-release year, or null when unknown. */
  year: number | null;
}

/**
 * Recording genre + release-year enrichment: MusicBrainz recording-level
 * genres (`inc=genres`, aggregated folksonomy across its releases) are the
 * primary source, since they're per-track and grounded in real tagging data.
 * When MusicBrainz has no genres for the recording (common — many recordings
 * are undertagged) OR the recording id isn't a real MusicBrainz id (e.g. a
 * Spotify-only synthetic id), we fall back to the artist's Last.fm top tags —
 * coarser (artist-level, not track-level) but still a real signal rather than
 * a guess.
 *
 * Release year is MusicBrainz-only (Last.fm doesn't reliably expose it); a
 * synthetic/non-MB recording id yields `year: null`.
 *
 * Deliberately off the hot path: this makes 1-2 network calls and is meant to
 * be called from enrichment/backfill flows, never from playback-critical code.
 * Never throws — worst case returns `{ genres: [], year: null }`.
 */
export async function fetchGenreAndYear(
  recordingId: string,
  artist: string,
  artistMbid?: string | null,
): Promise<GenreYear> {
  // MusicBrainz recording ids are real UUIDs; synthetic ids (e.g. "sp:...")
  // can't be looked up there, so skip straight to the Last.fm fallback.
  const isMbId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    recordingId,
  );

  let genres: string[] = [];
  let year: number | null = null;

  if (isMbId) {
    try {
      const mb = await fetchRecordingGenreYear(recordingId);
      genres = mb.genres;
      year = mb.year;
    } catch (err) {
      logger.warn("MusicBrainz genre/year enrichment failed", {
        recordingId,
        error: String(err),
      });
    }
  }

  if (genres.length === 0 && artist.trim()) {
    try {
      genres = await fetchArtistTags(artist, artistMbid ?? undefined);
    } catch (err) {
      logger.warn("Last.fm genre fallback failed", { artist, error: String(err) });
    }
  }

  return { genres, year };
}
