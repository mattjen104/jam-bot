import { db, recordingsTable, trackClaimsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/**
 * AllMusic album review → track claim pipeline.
 *
 * Scrapes AllMusic album pages to extract the professional star rating (1–5)
 * and stores it as a published `track_claim`. AllMusic covers jazz, folk,
 * country, rock and most of the catalogue that Lore's stations play —
 * complementing Pitchfork's indie-skewed coverage.
 *
 * Approach:
 *  1. GET the AllMusic album search page for "{artist} {title}".
 *  2. Parse HTML to find the best-matching album result link.
 *  3. GET the album page and extract the numeric rating from the HTML.
 *  4. Persist a published `track_claim` on a confident match.
 *
 * Policy:
 * - One claim per recording (idempotent via externalId).
 * - Miss sentinel stored as a `draft` claim so the same recording is not
 *   re-scraped on every request across server restarts.
 * - Never fabricates a rating — skips if parsing returns nothing clean.
 * - Off the hot path: call fire-and-forget from the knowledge route.
 */

export const ALLMUSIC_HANDLE = "allmusic";
const ALLMUSIC_HOME = "https://www.allmusic.com";
const ALLMUSIC_SEARCH_BASE = "https://www.allmusic.com/search/albums/";
const ALLMUSIC_ALLOWED_HOST = "www.allmusic.com";
const FETCH_TIMEOUT_MS = 10_000;
const MISS_EXTERNAL_ID_PREFIX = `${ALLMUSIC_HANDLE}:miss:`;
const HIT_EXTERNAL_ID_PREFIX = `${ALLMUSIC_HANDLE}:review:`;

/**
 * SSRF guard: convert a raw href from scraped HTML to a safe AllMusic URL.
 * - Root-relative paths (/album/…) are resolved against the AllMusic origin.
 * - Absolute URLs are only accepted when the protocol is exactly `https:` and
 *   the host is exactly `www.allmusic.com`.
 * Returns null for anything that doesn't meet these criteria.
 */
function toSafeAllMusicUrl(rawHref: string): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;
  try {
    // Root-relative paths are safe to resolve — they always land on ALLMUSIC_HOME.
    const resolved = trimmed.startsWith("/")
      ? new URL(trimmed, ALLMUSIC_HOME)
      : new URL(trimmed);
    if (resolved.protocol !== "https:" || resolved.hostname !== ALLMUSIC_ALLOWED_HOST) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token-overlap matching (same pattern as audiodb.ts)
// ---------------------------------------------------------------------------

/** Tokenise for fuzzy matching: lowercase, strip punct, split on whitespace. */
export function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * True when `a` and `b` share ≥ 50 % of the shorter string's tokens.
 * Direction-agnostic.
 */
export function roughlyMatches(a: string, b: string): boolean {
  const tA = tokenise(a);
  const tB = new Set(tokenise(b));
  if (!tA.length || !tB.size) return false;
  const hits = tA.filter((t) => tB.has(t)).length;
  return hits / tA.length >= 0.5 || hits / tB.size >= 0.5;
}

// ---------------------------------------------------------------------------
// HTML scraping helpers
// ---------------------------------------------------------------------------

/**
 * Extract all album result links from an AllMusic search results page.
 * Returns an array of { url, title, artist } for each found result card.
 *
 * AllMusic search HTML (server-rendered) includes album cards with anchors
 * inside `.info` blocks. We parse with lightweight regex since we don't
 * have a DOM library available.
 */
export function parseSearchResults(
  html: string,
): Array<{ url: string; title: string; artist: string }> {
  const results: Array<{ url: string; title: string; artist: string }> = [];

  // Each result is a <td class="info"> block
  // Title link: <div class="title"><a href="/album/...">Title</a></div>
  // Artist: <div class="subtitle"><a ...>Artist</a></div>

  // Match the whole info block
  const blockRe = /<td[^>]+class="[^"]*info[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRe.exec(html)) !== null) {
    const block = blockMatch[1] ?? "";

    // Extract title + href
    const titleMatch = /<div[^>]+class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a\s[^>]*href="([^"]*album[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!titleMatch) continue;

    const rawHref = titleMatch[1] ?? "";
    const rawTitle = stripTags(titleMatch[2] ?? "");

    // Extract artist
    const artistMatch = /<div[^>]+class="[^"]*subtitle[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const rawArtist = artistMatch ? stripTags(artistMatch[1] ?? "") : "";

    if (!rawHref || !rawTitle) continue;

    const url = toSafeAllMusicUrl(rawHref);
    if (!url) continue; // reject off-host or non-https hrefs
    results.push({ url, title: rawTitle.trim(), artist: rawArtist.trim() });
  }

  return results;
}

/**
 * Extract the AllMusic star rating from an album page's HTML.
 *
 * AllMusic encodes ratings as a CSS class: `rating-N` where N is 0–10
 * (representing 0–5 stars in 0.5-star increments, i.e. N/2 stars).
 *
 * The rating appears on the `allmusic-rating` element, e.g.:
 *   <div class="allmusic-rating rating-8">
 * → 8/2 = 4.0 stars
 *
 * Returns null when the rating is absent or unparseable.
 */
export function parseRating(html: string): number | null {
  // Primary: allmusic-rating element with rating-N class
  const ratingRe = /class="[^"]*allmusic-rating[^"]*rating-(\d+)[^"]*"/i;
  const m = ratingRe.exec(html);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n / 2;
  }

  // Fallback: look for rating-N inside a standalone element (class order reversed)
  const reversedRe = /class="[^"]*rating-(\d+)[^"]*allmusic-rating[^"]*"/i;
  const m2 = reversedRe.exec(html);
  if (m2) {
    const n = parseInt(m2[1]!, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n / 2;
  }

  return null;
}

/** Naively strip HTML tags from a string. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// ---------------------------------------------------------------------------
// Network helpers (injectable for testing)
// ---------------------------------------------------------------------------

export interface FetchFn {
  (url: string, init?: RequestInit): Promise<Response>;
}

/**
 * Search AllMusic for albums matching the given query string.
 * Returns the HTML of the search results page, or null on failure.
 */
export async function fetchSearchPage(
  query: string,
  fetchFn: FetchFn = fetch,
): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `${ALLMUSIC_SEARCH_BASE}${encoded}`;
    const res = await fetchFn(url, {
      headers: {
        "User-Agent": "lore-radio/1.0 (https://lore.radio; contact@lore.radio)",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Fetch an AllMusic album page and return its HTML, or null on failure.
 */
export async function fetchAlbumPage(
  url: string,
  fetchFn: FetchFn = fetch,
): Promise<string | null> {
  // Defense-in-depth: reject any URL that isn't HTTPS on www.allmusic.com,
  // even if the caller somehow bypassed parseSearchResults validation.
  if (toSafeAllMusicUrl(url) === null) {
    console.warn("[allmusic] fetchAlbumPage: rejected off-host URL", url);
    return null;
  }
  try {
    const res = await fetchFn(url, {
      headers: {
        "User-Agent": "lore-radio/1.0 (https://lore.radio; contact@lore.radio)",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claim text builder (pure — testable without DB or network)
// ---------------------------------------------------------------------------

/**
 * Build the claim text for an AllMusic rating.
 * e.g. "Rated 4.5/5 stars."
 */
export function buildClaimText(stars: number): string {
  // Display as integer when whole number, one decimal otherwise
  const display = Number.isInteger(stars) ? String(stars) : stars.toFixed(1);
  return `Rated ${display}/5 stars.`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Scrape the AllMusic album review for the recording's canonical album and
 * store it as a published track_claim (sourceHandle: 'allmusic').
 *
 * Only runs when `albumTitle` is non-null.
 * Stores a `draft` miss-sentinel so the same recording is not re-scraped
 * on every request.
 *
 * @returns true when a new published claim was stored, false otherwise.
 */
export async function fetchAllMusicReview(
  mbid: string,
  albumTitle: string | null | undefined,
  fetchFn: FetchFn = fetch,
): Promise<boolean> {
  if (!albumTitle) return false;

  try {
    // Idempotency: skip if we already have a published claim OR a miss sentinel.
    const hitId = `${HIT_EXTERNAL_ID_PREFIX}${mbid}`;
    const missId = `${MISS_EXTERNAL_ID_PREFIX}${mbid}`;

    const existing = await db
      .select({ id: trackClaimsTable.id, status: trackClaimsTable.status })
      .from(trackClaimsTable)
      .where(
        and(
          eq(trackClaimsTable.mbid, mbid),
          eq(trackClaimsTable.sourceHandle, ALLMUSIC_HANDLE),
        ),
      )
      .limit(1);

    if (existing.length > 0) return false;

    // Fetch the artist name for matching.
    const [rec] = await db
      .select({ artist: recordingsTable.artist })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, mbid))
      .limit(1);
    if (!rec) return false;

    // Search AllMusic for artist + album.
    const query = `${rec.artist} ${albumTitle}`;
    const searchHtml = await fetchSearchPage(query, fetchFn);

    if (!searchHtml) {
      // Network failure — do not write a sentinel, allow retry.
      return false;
    }

    // Find the best-matching result.
    const results = parseSearchResults(searchHtml);
    const match = results.find(
      (r) => roughlyMatches(rec.artist, r.artist) && roughlyMatches(albumTitle, r.title),
    );

    if (!match) {
      // Store a miss sentinel so we don't re-scrape.
      await db
        .insert(trackClaimsTable)
        .values({
          mbid,
          text: "No AllMusic review found.",
          sourceLabel: "AllMusic",
          sourceUrl: ALLMUSIC_HOME,
          sourceHandle: ALLMUSIC_HANDLE,
          externalId: missId,
          status: "draft",
        })
        .onConflictDoNothing();
      return false;
    }

    // Fetch the matched album page.
    const albumHtml = await fetchAlbumPage(match.url, fetchFn);
    if (!albumHtml) {
      // Network failure — do not write a sentinel, allow retry.
      return false;
    }

    const stars = parseRating(albumHtml);
    if (stars === null) {
      // Page loaded but no rating found — store miss sentinel.
      await db
        .insert(trackClaimsTable)
        .values({
          mbid,
          text: "No AllMusic rating found.",
          sourceLabel: "AllMusic",
          sourceUrl: match.url,
          sourceHandle: ALLMUSIC_HANDLE,
          externalId: missId,
          status: "draft",
        })
        .onConflictDoNothing();
      return false;
    }

    // Store published claim.
    await db
      .insert(trackClaimsTable)
      .values({
        mbid,
        text: buildClaimText(stars),
        sourceLabel: "AllMusic",
        sourceUrl: match.url,
        sourceHandle: ALLMUSIC_HANDLE,
        externalId: hitId,
        status: "published",
      })
      .onConflictDoNothing();

    console.info(
      `[lore] allmusic: stored rating claim for ${rec.artist} — ${albumTitle} (${stars}/5 stars)`,
    );
    return true;
  } catch (err) {
    console.warn("[lore] allmusic review fetch failed:", mbid, err);
    return false;
  }
}
