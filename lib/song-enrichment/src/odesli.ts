import { config } from "./config.js";
import { logger } from "./logger.js";
import { getTrackContext, setTrackContext } from "./cache.js";

/**
 * Odesli / song.link client for the consolidated track card's "Links" tab.
 *
 * Given a Spotify track id, Odesli returns the SAME track on other platforms
 * (Apple Music, YouTube, Tidal, Deezer, Amazon, etc.) plus a shareable
 * song.link landing page. Like every other enrichment source this runs OFF the
 * playback hot path, is cached by canonical key, never fabricates (the links
 * come straight from Odesli), and never throws — a failure just yields null and
 * the Links tab is hidden.
 *
 * API rules we honor:
 *  - No API key is required for modest volume; `config.ODESLI_API_KEY` is sent
 *    only when set.
 *  - Calls are funneled through `odesliFetch`, serialized behind a small
 *    spacing gate so overlapping enrichments stay polite.
 */

const ODESLI_BASE = "https://api.song.link/v1-alpha.1/links";
const ODESLI_MIN_INTERVAL_MS = 250;
const ODESLI_TIMEOUT_MS = 10_000;

/** A single platform link. */
export interface TrackLink {
  /** Friendly platform label, e.g. "Apple Music". */
  name: string;
  url: string;
}

export interface TrackLinks {
  /** Curated, ordered set of platform links (Spotify excluded — it's the source). */
  platforms: TrackLink[];
  /** The song.link landing page that lists every platform. */
  pageUrl?: string;
  fetchedAtMs: number;
}

/** Platforms we surface, in display order, with friendly labels. */
const PLATFORM_LABELS: Array<[string, string]> = [
  ["appleMusic", "Apple Music"],
  ["youtube", "YouTube"],
  ["youtubeMusic", "YouTube Music"],
  ["tidal", "Tidal"],
  ["amazonMusic", "Amazon Music"],
  ["deezer", "Deezer"],
  ["soundcloud", "SoundCloud"],
  ["pandora", "Pandora"],
];

/** Whether the Links tab is enabled. No key required. */
export function trackLinksEnabled(): boolean {
  return config.TRACK_LINKS_ENABLED;
}

let odesliChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function odesliFetch(spotifyTrackId: string): Promise<unknown> {
  const params = new URLSearchParams({
    url: `spotify:track:${spotifyTrackId}`,
    userCountry: "US",
    songIfSingle: "true",
  });
  const key = config.ODESLI_API_KEY?.trim();
  if (key) params.set("key", key);
  const run = odesliChain.then(async () => {
    await sleep(ODESLI_MIN_INTERVAL_MS);
    const res = await fetch(`${ODESLI_BASE}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(ODESLI_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Odesli ${res.status} for ${spotifyTrackId}`);
    return res.json();
  });
  // Keep the chain alive even when a call rejects.
  odesliChain = run.catch(() => undefined);
  return run;
}

/** Pure: curated platform links + landing page from an Odesli response body. */
export function parseOdesliLinks(body: unknown): {
  platforms: TrackLink[];
  pageUrl?: string;
} {
  const b = body as {
    pageUrl?: string;
    linksByPlatform?: Record<string, { url?: string }>;
  };
  const byPlatform = b?.linksByPlatform ?? {};
  const platforms: TrackLink[] = [];
  const seenUrls = new Set<string>();
  for (const [key, label] of PLATFORM_LABELS) {
    const url = byPlatform[key]?.url?.trim();
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    platforms.push({ name: label, url });
  }
  return { platforms, pageUrl: b?.pageUrl?.trim() || undefined };
}

const ttlMs = (): number =>
  config.TRACK_CONTEXT_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

function cacheKey(spotifyTrackId: string): string {
  return `odesli:sp:${spotifyTrackId}`;
}

/**
 * Resolve cross-platform links for a Spotify track. Returns null when the
 * feature is off, nothing resolved, or on any failure — never throws, so a
 * caller can fire-and-forget. Results (including empty) are cached so a dud
 * isn't re-queried.
 */
export async function fetchTrackLinks(
  spotifyTrackId: string,
): Promise<TrackLinks | null> {
  if (!trackLinksEnabled() || !spotifyTrackId.trim()) return null;
  const key = cacheKey(spotifyTrackId.trim());

  try {
    const raw = getTrackContext(key, ttlMs());
    if (raw) {
      const cached = JSON.parse(raw) as TrackLinks;
      return cached.platforms.length || cached.pageUrl ? cached : null;
    }
  } catch (err) {
    logger.warn("Odesli cache read failed", { key, error: String(err) });
  }

  let links: TrackLinks;
  try {
    const body = await odesliFetch(spotifyTrackId.trim());
    const { platforms, pageUrl } = parseOdesliLinks(body);
    links = { platforms, pageUrl, fetchedAtMs: Date.now() };
  } catch (err) {
    logger.warn("Odesli lookup failed", {
      spotifyTrackId,
      error: String(err),
    });
    return null;
  }

  try {
    setTrackContext(key, JSON.stringify(links));
  } catch (err) {
    logger.warn("Odesli cache write failed", { key, error: String(err) });
  }

  return links.platforms.length || links.pageUrl ? links : null;
}
