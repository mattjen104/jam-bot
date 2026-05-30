import { config } from "./config.js";
import { logger } from "./logger.js";
import { searchTrack } from "./spotify/client.js";
import { curateTourPicks, writeTourTidbits } from "./llm/openrouter.js";

export interface TourTrack {
  trackId: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  tidbit: string;
}

export interface CuratedTour {
  theme: string;
  intro: string;
  tracks: TourTrack[];
}

/**
 * Pull an explicit track count out of a tour request ("a 5-track tour of
 * dub", "give us a 10 song tour of soul"). Falls back to the configured
 * default and is always clamped to JAM_TOUR_MAX_TRACKS.
 */
export function parseTourLength(text: string): number {
  const m = text.match(/\b(\d{1,2})\s*-?\s*(?:track|song|tune)s?\b/i);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (n >= 1) return Math.min(n, config.JAM_TOUR_MAX_TRACKS);
  }
  return config.JAM_TOUR_DEFAULT_TRACKS;
}

/**
 * Deterministic detector for "stop the tour" style asks. Kept off the LLM so
 * ending a tour never depends on a network call.
 */
export function isStopTourRequest(text: string): boolean {
  return (
    /\b(stop|end|cancel|kill|quit|halt)\b[^.!?]*\btour\b/i.test(text) ||
    /\btour\b[^.!?]*\b(over|off|done|stop|enough)\b/i.test(text)
  );
}

/**
 * Deterministic detector for "save this tour" style asks. Kept off the LLM so
 * persisting a tour as a playlist never depends on a network round-trip.
 * Requires an explicit "tour"/"playlist" anchor so ordinary chatter that
 * happens to contain "save" doesn't trigger a playlist create.
 */
export function isSaveTourRequest(text: string): boolean {
  return /\bsave\b[^.!?]*\b(tour|playlist)\b/i.test(text);
}

/**
 * Build a guided tour for a theme: ask the model for real picks, resolve
 * each against Spotify search (dropping anything that can't be found so we
 * never queue a fabricated track), then narrate the resolved set. A small
 * buffer of extra picks is requested so a few unfindable ones don't shrink
 * the tour below the requested length.
 */
export async function buildTour(
  theme: string,
  count: number,
): Promise<CuratedTour> {
  const want = Math.min(Math.max(count, 1), config.JAM_TOUR_MAX_TRACKS);

  let curation;
  try {
    curation = await curateTourPicks(theme, want + 3);
  } catch (err) {
    logger.error("Tour curation failed", { theme, error: String(err) });
    return { theme, intro: "", tracks: [] };
  }
  if (!curation.picks.length) {
    return { theme, intro: curation.intro, tracks: [] };
  }

  // Resolve picks to REAL Spotify tracks. Unfindable picks are dropped, never
  // fabricated; dedup so the model repeating itself doesn't double-queue.
  const resolved: Omit<TourTrack, "tidbit">[] = [];
  const seen = new Set<string>();
  for (const pick of curation.picks) {
    if (resolved.length >= want) break;
    const query = `${pick.title} ${pick.artist}`.trim();
    if (!query) continue;
    let hit;
    try {
      hit = await searchTrack(query);
    } catch (err) {
      logger.warn("Tour: Spotify search failed for pick", {
        query,
        error: String(err),
      });
      continue;
    }
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id);
    resolved.push({
      trackId: hit.id,
      uri: hit.uri,
      title: hit.title,
      artist: hit.artist,
      album: hit.album,
    });
  }
  if (!resolved.length) {
    return { theme, intro: curation.intro, tracks: [] };
  }

  // Narrate the RESOLVED tracks (real title/artist/album), not the raw picks,
  // so tidbits describe what will actually play. If narration fails, fall
  // back to a minimal factual line rather than blocking the tour.
  let tidbits: string[] = [];
  try {
    tidbits = await writeTourTidbits(
      theme,
      resolved.map((r) => ({ title: r.title, artist: r.artist, album: r.album })),
    );
  } catch (err) {
    logger.warn("Tour tidbit generation failed; using minimal tidbits", {
      theme,
      error: String(err),
    });
  }

  const tracks: TourTrack[] = resolved.map((r, i) => ({
    ...r,
    tidbit:
      tidbits[i]?.trim() || `"${r.title}" — ${r.artist}, from ${r.album}.`,
  }));
  return { theme, intro: curation.intro, tracks };
}
