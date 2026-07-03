import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Minimal Genius client for the track-context feature: a lyrics/annotations
 * link for the recording. We do a single search by title + artist and take the
 * best hit, preferring one whose primary artist matches. We only ever surface
 * the canonical Genius URL — we never scrape or store lyrics.
 *
 * Token-gated (an API access token from genius.com/api-clients) and
 * rate-limited behind a small spacing gate. Pure parser is exported for tests;
 * the fetcher never throws.
 */

const GENIUS_BASE = "https://api.genius.com";
const GENIUS_MIN_INTERVAL_MS = 250;
const GENIUS_TIMEOUT_MS = 10_000;

/** Whether Genius lookups are configured (an access token is required). */
export function geniusEnabled(): boolean {
  return !!config.GENIUS_ACCESS_TOKEN?.trim();
}

let geniusChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function geniusFetch(pathWithQuery: string): Promise<unknown> {
  const token = config.GENIUS_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("Genius not configured");
  const run = geniusChain.then(async () => {
    await sleep(GENIUS_MIN_INTERVAL_MS);
    const res = await fetch(`${GENIUS_BASE}${pathWithQuery}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(GENIUS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Genius ${res.status} for ${pathWithQuery}`);
    return res.json();
  });
  geniusChain = run.catch(() => undefined);
  return run;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Pure: pick the best lyrics URL from a Genius search body. When `artist` is
 * given, prefer a hit whose primary artist matches it; otherwise fall back to
 * the first hit with a URL. Returns null when nothing usable is present.
 */
export function parseGeniusSearch(
  body: unknown,
  artist?: string,
): string | null {
  const b = body as {
    response?: {
      hits?: Array<{
        result?: { url?: string; primary_artist?: { name?: string } };
      }>;
    };
  };
  const hits = b?.response?.hits ?? [];
  const want = artist ? norm(artist) : "";
  let fallback: string | null = null;
  for (const h of hits) {
    const url = h?.result?.url?.trim();
    if (!url) continue;
    if (!fallback) fallback = url;
    if (!want) return url;
    const name = norm(h.result?.primary_artist?.name ?? "");
    if (name && (name.includes(want) || want.includes(name))) return url;
  }
  return fallback;
}

/** Best-effort Genius lyrics URL. Never throws; null on miss/disabled. */
export async function fetchGeniusUrl(
  title: string,
  artist: string,
): Promise<string | null> {
  if (!geniusEnabled()) return null;
  const q = `${title} ${artist}`.trim();
  if (!q) return null;
  try {
    const body = await geniusFetch(`/search?q=${encodeURIComponent(q)}`);
    return parseGeniusSearch(body, artist);
  } catch (err) {
    logger.warn("Genius lookup failed", { title, artist, error: String(err) });
    return null;
  }
}

/**
 * Pure: extract the Genius song id from a search response body.
 * Prefers a hit whose primary artist name overlaps with `artist`.
 */
export function parseGeniusSongId(
  body: unknown,
  artist?: string,
): number | null {
  const b = body as {
    response?: {
      hits?: Array<{
        result?: {
          id?: number;
          url?: string;
          primary_artist?: { name?: string };
        };
      }>;
    };
  };
  const hits = b?.response?.hits ?? [];
  const want = artist ? norm(artist) : "";
  let fallback: number | null = null;
  for (const h of hits) {
    const id = h?.result?.id;
    if (typeof id !== "number") continue;
    if (!fallback) fallback = id;
    if (!want) return id;
    const name = norm(h.result?.primary_artist?.name ?? "");
    if (name && (name.includes(want) || want.includes(name))) return id;
  }
  return fallback;
}

/** One referent (lyric annotation anchor) from the Genius Referents API. */
export interface GeniusReferent {
  geniusAnnotationId: number;
  /** The lyric fragment text the annotation is anchored to. */
  fragment: string;
  /** Deep link to this annotation on genius.com (song page with anchor). */
  geniusUrl: string;
  /** True when Genius marks the annotation as artist-verified. */
  verified: boolean;
  /** Net upvotes (votes_total) at fetch time. */
  voteCount: number;
}

/**
 * Fetch qualifying referents for a Genius song id.
 * Filters to annotations with voteCount >= 5 OR verified=true.
 * Never throws; returns [] on error or when token is absent.
 */
export async function fetchGeniusReferents(
  songId: number,
): Promise<GeniusReferent[]> {
  if (!geniusEnabled()) return [];
  try {
    const body = await geniusFetch(
      `/referents?song_id=${songId}&text_format=plain&per_page=50`,
    );
    const b = body as {
      response?: {
        referents?: Array<{
          fragment?: string;
          annotations?: Array<{
            id?: number;
            verified?: boolean;
            votes_total?: number;
            url?: string;
          }>;
        }>;
      };
    };
    const referents = b?.response?.referents ?? [];
    const results: GeniusReferent[] = [];
    for (const ref of referents) {
      const fragment = ref.fragment?.trim();
      if (!fragment) continue;
      for (const ann of ref.annotations ?? []) {
        const id = ann.id;
        if (typeof id !== "number") continue;
        const verified = !!ann.verified;
        const voteCount = ann.votes_total ?? 0;
        if (!verified && voteCount < 5) continue;
        const url = ann.url?.trim();
        if (!url) continue;
        results.push({ geniusAnnotationId: id, fragment, geniusUrl: url, verified, voteCount });
      }
    }
    return results;
  } catch (err) {
    logger.warn("Genius referents fetch failed", { songId, error: String(err) });
    return [];
  }
}

/**
 * Fetch the Genius song id for a recording.
 *
 * Resolution order (stops at first hit):
 *  1. ISRC search — if an ISRC is available, query `q={isrc}` which returns
 *     an exact match when Genius has it indexed (highest precision).
 *  2. Title + artist search — existing fallback.
 *
 * Returns null on miss/error. Never throws.
 */
export async function fetchGeniusSongId(
  title: string,
  artist: string,
  isrc?: string | null,
): Promise<number | null> {
  if (!geniusEnabled()) return null;
  try {
    if (isrc?.trim()) {
      const body = await geniusFetch(
        `/search?q=${encodeURIComponent(isrc.trim())}`,
      );
      const id = parseGeniusSongId(body, artist);
      if (id !== null) return id;
    }
    const q = `${title} ${artist}`.trim();
    if (!q) return null;
    const body = await geniusFetch(`/search?q=${encodeURIComponent(q)}`);
    return parseGeniusSongId(body, artist);
  } catch (err) {
    logger.warn("Genius song-id lookup failed", { title, artist, isrc, error: String(err) });
    return null;
  }
}
