/**
 * 30-second preview resolution via the public iTunes Search API.
 *
 * The ride experience needs a short, playable clip per track. Apple's Search
 * API is public (no key, no auth), returns a real `previewUrl` hosted on
 * Apple's own CDN, and is queried by artist + title. We resolve it SERVER-SIDE
 * (the browser can't rely on CORS here) but we only ever hand the browser the
 * preview URL — the audio bytes still stream directly from Apple to the client,
 * so Lore never hosts, proxies, or re-encodes audio. Best-effort: any failure
 * yields nulls and the UI degrades to link-outs. Never throws.
 */

const ITUNES_SEARCH = "https://itunes.apple.com/search";
const ITUNES_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface RecordingPreview {
  /** Apple-hosted 30s preview, or null when none was found. */
  previewUrl: string | null;
  /** Higher-res cover from iTunes, or null. A best-effort artwork fallback. */
  artworkUrl: string | null;
  /** Provenance of the preview; null when unresolved. */
  source: string | null;
}

const EMPTY: RecordingPreview = {
  previewUrl: null,
  artworkUrl: null,
  source: null,
};

/** Normalize a string for loose title/artist comparison. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // drop "(remaster)", "[live]" etc.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface ItunesResult {
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
}

/**
 * Pure: choose the best preview from an iTunes Search body for a given
 * artist+title. Prefers a result whose artist and title both loosely match;
 * falls back to the first result that has a preview. Upscales the 100x100
 * artwork thumbnail to 600x600. Returns nulls when nothing usable is present.
 */
export function parseItunesPreview(
  body: unknown,
  artist: string,
  title: string,
): RecordingPreview {
  const results = (body as { results?: ItunesResult[] })?.results;
  if (!Array.isArray(results) || results.length === 0) return EMPTY;

  const wantArtist = norm(artist);
  const wantTitle = norm(title);

  const scored = results
    .filter((r) => typeof r.previewUrl === "string" && r.previewUrl.length > 0)
    .map((r) => {
      const a = norm(r.artistName ?? "");
      const t = norm(r.trackName ?? "");
      const artistHit =
        wantArtist.length > 0 && (a.includes(wantArtist) || wantArtist.includes(a));
      const titleHit =
        wantTitle.length > 0 && (t.includes(wantTitle) || wantTitle.includes(t));
      const score = (artistHit ? 2 : 0) + (titleHit ? 1 : 0);
      return { r, score };
    })
    .sort((x, y) => y.score - x.score);

  const best = scored[0]?.r;
  if (!best?.previewUrl) return EMPTY;

  const artworkUrl = best.artworkUrl100
    ? best.artworkUrl100.replace(/100x100bb\.jpg$/, "600x600bb.jpg")
    : null;

  return { previewUrl: best.previewUrl, artworkUrl, source: "itunes" };
}

const cache = new Map<string, { value: RecordingPreview; at: number }>();

/**
 * Resolve (and cache, keyed by MBID) the preview for a recording. Best-effort:
 * returns all-null on any failure and caches even the miss so we don't re-query
 * a dud on every ride. Never throws.
 */
export async function resolvePreview(
  mbid: string,
  artist: string,
  title: string,
): Promise<RecordingPreview> {
  const key = mbid.trim();
  if (!key) return EMPTY;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const term = `${artist} ${title}`.trim();
  if (!term) return EMPTY;

  let value: RecordingPreview = EMPTY;
  try {
    const params = new URLSearchParams({
      term,
      entity: "song",
      limit: "5",
      country: "US",
    });
    const res = await fetch(`${ITUNES_SEARCH}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = await res.json();
      value = parseItunesPreview(body, artist, title);
    }
  } catch (err) {
    console.error("[lore] preview resolve failed", mbid, err);
    value = EMPTY;
  }

  cache.set(key, { value, at: Date.now() });
  return value;
}
