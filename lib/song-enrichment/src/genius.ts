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
