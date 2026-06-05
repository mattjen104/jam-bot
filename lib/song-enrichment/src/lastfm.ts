import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Minimal Last.fm client for the track-context (genre/era/story) feature.
 *
 * Last.fm is the source for crowd-sourced genre tags and "similar artists",
 * both keyed to an artist. When MusicBrainz already resolved a canonical artist
 * id we pass it as `mbid` for a precise lookup; otherwise we fall back to the
 * artist name (with autocorrect on). Everything runs OFF the playback hot path.
 *
 * API rules we honor:
 *  - An API key is REQUIRED. We use `config.LASTFM_API_KEY` and skip the
 *    feature when unset.
 *  - Calls are funneled through `lastfmFetch`, serialized behind a small
 *    spacing gate so overlapping enrichments stay polite.
 *
 * Network functions are thin; response-shape handling lives in exported pure
 * parsers so it can be locked down with unit tests.
 */

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_MIN_INTERVAL_MS = 250;
const LASTFM_TIMEOUT_MS = 10_000;

/** Whether Last.fm lookups are configured (an API key is required). */
export function lastfmEnabled(): boolean {
  return !!config.LASTFM_API_KEY?.trim();
}

// Generic, low-signal Last.fm tags that say nothing about the music itself.
// Filtered out so the card shows real genres, not folksonomy noise.
const JUNK_TAGS = new Set([
  "seen live",
  "favorites",
  "favourites",
  "favorite",
  "favourite",
  "spotify",
  "albums i own",
  "vinyl",
  "awesome",
  "love",
  "beautiful",
  "amazing",
  "good",
  "cool",
  "best",
  "under 2000 listeners",
  "my music",
  "music",
]);

let lastfmChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function lastfmFetch(params: Record<string, string>): Promise<unknown> {
  const key = config.LASTFM_API_KEY?.trim();
  if (!key) throw new Error("Last.fm not configured");
  const qs = new URLSearchParams({ ...params, api_key: key, format: "json" });
  const run = lastfmChain.then(async () => {
    await sleep(LASTFM_MIN_INTERVAL_MS);
    const res = await fetch(`${LASTFM_BASE}?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Last.fm ${res.status} for ${params.method}`);
    }
    return res.json();
  });
  // Keep the chain alive even when a call rejects, so one failure doesn't
  // wedge every later request.
  lastfmChain = run.catch(() => undefined);
  return run;
}

/** Pure: clean genre tags from an artist.getTopTags body, capped. */
export function parseArtistTags(body: unknown, cap = 5): string[] {
  const b = body as {
    toptags?: { tag?: Array<{ name?: string }> };
  };
  const raw = b?.toptags?.tag ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const name = t?.name?.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (JUNK_TAGS.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}

/** Pure: similar artist names from an artist.getSimilar body, capped. */
export function parseSimilarArtists(body: unknown, cap = 4): string[] {
  const b = body as {
    similarartists?: { artist?: Array<{ name?: string }> };
  };
  const raw = b?.similarartists?.artist ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    const name = a?.name?.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}

/** Best-effort genre tags for an artist. Never throws; [] on miss/disabled. */
export async function fetchArtistTags(
  artist: string,
  mbid?: string,
): Promise<string[]> {
  if (!lastfmEnabled()) return [];
  const a = artist.trim();
  if (!a && !mbid) return [];
  try {
    const params: Record<string, string> = {
      method: "artist.gettoptags",
      autocorrect: "1",
    };
    if (mbid) params.mbid = mbid;
    else params.artist = a;
    const body = await lastfmFetch(params);
    return parseArtistTags(body);
  } catch (err) {
    logger.warn("Last.fm tags lookup failed", { artist, error: String(err) });
    return [];
  }
}

/** Best-effort similar artists. Never throws; [] on miss/disabled. */
export async function fetchSimilarArtists(
  artist: string,
  mbid?: string,
): Promise<string[]> {
  if (!lastfmEnabled()) return [];
  const a = artist.trim();
  if (!a && !mbid) return [];
  try {
    const params: Record<string, string> = {
      method: "artist.getsimilar",
      autocorrect: "1",
      limit: "8",
    };
    if (mbid) params.mbid = mbid;
    else params.artist = a;
    const body = await lastfmFetch(params);
    return parseSimilarArtists(body);
  } catch (err) {
    logger.warn("Last.fm similar lookup failed", {
      artist,
      error: String(err),
    });
    return [];
  }
}
