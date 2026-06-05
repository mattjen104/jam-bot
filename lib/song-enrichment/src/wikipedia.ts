import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Minimal Wikipedia client for the track-context feature: a short artist bio
 * snippet for the "context" card. We use the MediaWiki action API with a
 * `generator=search` so a single request both finds the best-matching article
 * and returns its intro extract (plain text, first couple of sentences).
 *
 * Wikipedia needs no API key — only a descriptive User-Agent — so the source
 * is gated by a plain on/off config toggle (`TRACK_CONTEXT_WIKIPEDIA`). The
 * pure parser is exported for tests; the fetcher never throws.
 */

const WIKI_BASE = "https://en.wikipedia.org/w/api.php";
const WIKI_UA = "JamBot/1.0 (+https://github.com/jam-bot)";
const WIKI_MIN_INTERVAL_MS = 250;
const WIKI_TIMEOUT_MS = 10_000;

export interface ArtistBio {
  /** Plain-text intro snippet (a sentence or two). */
  extract: string;
  /** The resolved article title. */
  title: string;
  /** Canonical Wikipedia article URL. */
  url: string;
}

/** Whether Wikipedia bio lookups are enabled (no key needed, just a toggle). */
export function wikipediaEnabled(): boolean {
  return config.TRACK_CONTEXT_WIKIPEDIA;
}

let wikiChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function wikiFetch(query: string): Promise<unknown> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "1",
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exsentences: "2",
    redirects: "1",
  });
  const run = wikiChain.then(async () => {
    await sleep(WIKI_MIN_INTERVAL_MS);
    const res = await fetch(`${WIKI_BASE}?${params.toString()}`, {
      headers: { "User-Agent": WIKI_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Wikipedia ${res.status} for ${query}`);
    return res.json();
  });
  wikiChain = run.catch(() => undefined);
  return run;
}

/** Pure: bio snippet from a generator=search + extracts body, or null. */
export function parseWikiSummary(body: unknown): ArtistBio | null {
  const b = body as {
    query?: {
      pages?: Record<
        string,
        { title?: string; extract?: string; missing?: string }
      >;
    };
  };
  const pages = b?.query?.pages;
  if (!pages) return null;
  const first = Object.values(pages)[0];
  if (!first) return null;
  const extract = first.extract?.trim();
  const title = first.title?.trim();
  if (!extract || !title) return null;
  return {
    extract,
    title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(
      title.replace(/\s+/g, "_"),
    )}`,
  };
}

/** Best-effort artist bio. Never throws; null on miss/disabled. */
export async function fetchArtistBio(artist: string): Promise<ArtistBio | null> {
  if (!wikipediaEnabled()) return null;
  const a = artist.trim();
  if (!a) return null;
  try {
    const body = await wikiFetch(a);
    return parseWikiSummary(body);
  } catch (err) {
    logger.warn("Wikipedia bio lookup failed", { artist, error: String(err) });
    return null;
  }
}
