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

/**
 * Query Odesli for a single entity URL (e.g. `spotify:track:<id>`). Kept generic
 * — not Spotify-ID-first — so a track resolved from radio can be looked up by
 * whatever platform reference we managed to find for it.
 */
async function odesliFetch(entityUrl: string): Promise<unknown> {
  const params = new URLSearchParams({
    url: entityUrl,
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
    if (!res.ok) throw new Error(`Odesli ${res.status} for ${entityUrl}`);
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
    const body = await odesliFetch(`spotify:track:${spotifyTrackId.trim()}`);
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

/** A deep link tagged by how precisely it points at the track. */
export interface RecordingLink {
  name: string;
  url: string;
  /** "exact" = resolved via Odesli; "search" = artist+title search on a service. */
  kind: "exact" | "search";
}

export interface RecordingLinks {
  platforms: RecordingLink[];
  /** Odesli landing page, when we had a platform reference to resolve. */
  pageUrl?: string;
  fetchedAtMs: number;
}

/** Universal per-service search links, built from artist + title. */
const SEARCH_LINK_BUILDERS: Array<{ name: string; build: (q: string) => string }> = [
  { name: "Spotify", build: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}` },
  { name: "Apple Music", build: (q) => `https://music.apple.com/us/search?term=${encodeURIComponent(q)}` },
  { name: "YouTube Music", build: (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}` },
  { name: "YouTube", build: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { name: "Amazon Music", build: (q) => `https://music.amazon.com/search/${encodeURIComponent(q)}` },
  { name: "Tidal", build: (q) => `https://listen.tidal.com/search?q=${encodeURIComponent(q)}` },
  { name: "Deezer", build: (q) => `https://www.deezer.com/search/${encodeURIComponent(q)}` },
  { name: "Qobuz", build: (q) => `https://open.qobuz.com/search/${encodeURIComponent(q)}` },
  { name: "Bandcamp", build: (q) => `https://bandcamp.com/search?q=${encodeURIComponent(q)}` },
  { name: "SoundCloud", build: (q) => `https://soundcloud.com/search?q=${encodeURIComponent(q)}` },
  { name: "Pandora", build: (q) => `https://www.pandora.com/search/${encodeURIComponent(q)}/all` },
];

/**
 * Pure: universal search deep links for a track. These always work (no API, no
 * auth) so a listener can always click through to a service — the reliable floor
 * beneath Odesli's exact links.
 */
export function buildSearchLinks(artist: string, title: string): RecordingLink[] {
  const q = `${artist} ${title}`.trim();
  if (!q) return [];
  return SEARCH_LINK_BUILDERS.map(({ name, build }) => ({
    name,
    url: build(q),
    kind: "search" as const,
  }));
}

function recordingCacheKey(recordingId: string): string {
  return `odesli:mbrec:${recordingId}`;
}

/**
 * Resolve cross-service deep links for a track keyed by its MusicBrainz Recording
 * ID (the spine), caching per MBID (`odesli:mbrec:<id>`). Exact links come from
 * Odesli when a `spotifyTrackId` reference is available; universal artist+title
 * search links are always appended so a listener can click through even when no
 * exact match exists (e.g. Spotify unconfigured). Never throws.
 */
/** Parsed metadata returned when resolving an arbitrary music service URL. */
export interface ResolvedSong {
  artist: string;
  title: string;
  thumbnailUrl?: string;
  /** Spotify track ID extracted from the Odesli response (when Spotify is in the entity map). */
  spotifyTrackId?: string;
  /** The song.link landing page. */
  pageUrl?: string;
}

/**
 * Resolve ANY music service URL (Spotify, Apple Music, Bandcamp, Tidal, etc.)
 * to cross-platform metadata via Odesli. Used for inbound link unfurling in
 * the jam-bot: a foreign URL comes in, this extracts artist/title/spotifyTrackId
 * so the caller can look up the Lore recording.
 *
 * Never throws — a failure returns null and the caller skips the unfurl.
 */
export async function resolveAnyUrl(url: string): Promise<ResolvedSong | null> {
  try {
    const body = await odesliFetch(url);
    const b = body as {
      entityUniqueId?: string;
      pageUrl?: string;
      entitiesByUniqueId?: Record<
        string,
        {
          id?: string;
          type?: string;
          title?: string;
          artistName?: string;
          thumbnailUrl?: string;
          apiProvider?: string;
        }
      >;
    };
    const entities = b?.entitiesByUniqueId;
    if (!entities) return null;

    // Primary entity = the one that matched the input URL.
    const primaryId = b.entityUniqueId;
    const primary = (primaryId ? entities[primaryId] : null) ?? Object.values(entities)[0];
    if (!primary) return null;

    const artist = primary.artistName?.trim() ?? "";
    const title = primary.title?.trim() ?? "";
    const thumbnailUrl = primary.thumbnailUrl?.trim() || undefined;

    // Find Spotify entity for its track ID (used for DB lookup).
    const spotifyEntity = Object.values(entities).find(
      (e) => e.apiProvider === "spotify",
    );
    const spotifyTrackId = spotifyEntity?.id?.trim() || undefined;

    const pageUrl = b.pageUrl?.trim() || undefined;

    if (!artist && !title) return null;
    return { artist, title, thumbnailUrl, spotifyTrackId, pageUrl };
  } catch (err) {
    logger.warn("Odesli resolveAnyUrl failed", { url, error: String(err) });
    return null;
  }
}

export async function fetchRecordingLinks(args: {
  recordingId: string;
  artist: string;
  title: string;
  spotifyTrackId?: string;
}): Promise<RecordingLinks | null> {
  const recordingId = args.recordingId?.trim();
  if (!recordingId) return null;
  const key = recordingCacheKey(recordingId);

  try {
    const raw = getTrackContext(key, ttlMs());
    if (raw) return JSON.parse(raw) as RecordingLinks;
  } catch (err) {
    logger.warn("Odesli recording cache read failed", { key, error: String(err) });
  }

  const searchLinks = buildSearchLinks(args.artist ?? "", args.title ?? "");
  let exact: RecordingLink[] = [];
  let pageUrl: string | undefined;

  const spotifyTrackId = args.spotifyTrackId?.trim();
  if (spotifyTrackId && trackLinksEnabled()) {
    try {
      const body = await odesliFetch(`spotify:track:${spotifyTrackId}`);
      const parsed = parseOdesliLinks(body);
      exact = parsed.platforms.map((p) => ({ ...p, kind: "exact" as const }));
      pageUrl = parsed.pageUrl;
    } catch (err) {
      logger.warn("Odesli recording lookup failed", {
        recordingId,
        error: String(err),
      });
    }
  }

  // Exact links win; fill remaining services with search links (dedup by name).
  const seen = new Set(exact.map((p) => p.name));
  const platforms = [...exact, ...searchLinks.filter((s) => !seen.has(s.name))];
  const links: RecordingLinks = { platforms, pageUrl, fetchedAtMs: Date.now() };

  try {
    setTrackContext(key, JSON.stringify(links));
  } catch (err) {
    logger.warn("Odesli recording cache write failed", { key, error: String(err) });
  }

  return links.platforms.length || links.pageUrl ? links : null;
}
