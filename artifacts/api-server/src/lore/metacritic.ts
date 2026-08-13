import { db, trackClaimsTable, recordingReleaseGroupsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";

/**
 * Metacritic album critic score → track claim pipeline.
 *
 * Metacritic aggregates professional critic reviews and is the canonical
 * "critical consensus" number for albums — particularly valuable for 1990s–
 * 2000s albums that predate Pitchfork's dominance.
 *
 * Approach:
 *  1. Slugify the artist and album title into the Metacritic URL pattern.
 *  2. Fetch the album page and extract the structured `application/ld+json`
 *     block, which includes `aggregateRating.ratingValue` and
 *     `aggregateRating.reviewCount` — this is stable and does not require
 *     brittle HTML parsing.
 *  3. Store a published `track_claims` row per release-group MBID.
 *
 * Policy:
 * - One claim per release-group MBID (idempotent via externalId).
 * - Rate-limit: 1 request / 5 seconds to stay polite.
 * - Miss sentinel stored as `draft` so the same album is not re-scraped on
 *   every knowledge-route visit across server restarts.
 * - Off the hot path: call fire-and-forget from the knowledge route when a
 *   release-group MBID is available.
 * - 24-hour miss cooldown (in-memory) to avoid repeated scraping on transient
 *   Metacritic changes.
 */

export const METACRITIC_HANDLE = "metacritic";
const METACRITIC_HOME = "https://www.metacritic.com";
const FETCH_TIMEOUT_MS = 12_000;
const RATE_LIMIT_MS = 5_000; // 1 req / 5 s

/**
 * External ID scheme:
 *   Miss sentinel  — "metacritic:miss:{releaseGroupMbid}"    (1 per album, draft)
 *   Per-recording  — "metacritic:hit:{releaseGroupMbid}:{recordingMbid}"  (published)
 *
 * On first call:
 *   - Fetch the Metacritic page; if a score is found, query ALL recordings in
 *     recording_release_groups for that release group and store a per-recording
 *     claim for each — so the score surfaces in every kept track's investigation
 *     sheet, not just the one that triggered the enrichment.
 *
 * On subsequent calls for a different recording on the same album:
 *   - Check if any per-recording hit already exists for this release group.
 *   - If yes, reuse its claim text (no page re-fetch); store only for the new
 *     recording (idempotent via its own externalId).
 *   - If miss sentinel exists, skip without fetching.
 */
const MISS_EXTERNAL_ID_PREFIX = `${METACRITIC_HANDLE}:miss:`;
const HIT_EXTERNAL_ID_PREFIX = `${METACRITIC_HANDLE}:hit:`;

// In-memory cooldown for recent misses (avoids hammering Metacritic when it
// changes slugging patterns). Cleared wholesale on cap.
const recentMisses = new Map<string, number>(); // releaseGroupMbid → checked-at ms
const MISS_COOLDOWN_MS = 24 * 60 * 60_000; // 24 hours
const MISS_COOLDOWN_MAX = 5_000;

// Module-level rate limiter.
let lastFetchMs = 0;

async function rateLimitSleep(): Promise<void> {
  const now = Date.now();
  const wait = lastFetchMs + RATE_LIMIT_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchMs = Date.now();
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

/**
 * Slugify a string for use in a Metacritic URL: lowercase, replace non-
 * alphanumeric characters with hyphens, collapse runs, trim.
 */
export function metacriticSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Strip a leading definite/indefinite article ("The ", "A ", "An ") from an
 * artist name, case-insensitively. Metacritic commonly indexes artists by
 * surname/core name — e.g. "The Smashing Pumpkins" → "Smashing Pumpkins".
 */
export function stripLeadingArticle(s: string): string {
  return s.replace(/^(?:the|an?)\s+/i, "");
}

/**
 * Build candidate Metacritic album page URLs to try in order.
 * Metacritic has used several URL conventions; we try the most common forms.
 *
 *   Pattern A: /music/{album-slug}/                      (older, artist-less URL)
 *   Pattern B: /music/{album-slug}/{artist-slug}/        (newer, with full artist slug)
 *   Pattern B′: /music/{album-slug}/{article-stripped}/  (Metacritic drops leading "The"/"A"/"An")
 *   Pattern C: /music/{artist-slug}-{album-slug}/        (alternate slug form)
 *   Pattern C′: /music/{article-stripped}-{album-slug}/  (article-stripped alternate)
 */
export function metacriticCandidateUrls(
  artist: string,
  albumTitle: string,
): string[] {
  const albumSlug = metacriticSlug(albumTitle);
  const artistSlug = metacriticSlug(artist);
  const artistSlugNoArticle = metacriticSlug(stripLeadingArticle(artist));

  const urls: string[] = [
    // Pattern A — artist-less (older Metacritic pages)
    `${METACRITIC_HOME}/music/${albumSlug}/`,
    // Pattern B — newer form with full artist slug
    `${METACRITIC_HOME}/music/${albumSlug}/${artistSlug}/`,
  ];

  // Pattern B′ — article-stripped artist slug (e.g. "smashing-pumpkins" instead of
  // "the-smashing-pumpkins"). Only add when it differs from the full slug.
  if (artistSlugNoArticle !== artistSlug) {
    urls.push(`${METACRITIC_HOME}/music/${albumSlug}/${artistSlugNoArticle}/`);
  }

  // Pattern C — artist-prefixed slug form
  urls.push(`${METACRITIC_HOME}/music/${artistSlug}-${albumSlug}/`);

  // Pattern C′ — article-stripped artist-prefixed form
  if (artistSlugNoArticle !== artistSlug) {
    urls.push(`${METACRITIC_HOME}/music/${artistSlugNoArticle}-${albumSlug}/`);
  }

  return urls;
}

// ---------------------------------------------------------------------------
// HTML scraping — ld+json extraction (no HTML parser dependency)
// ---------------------------------------------------------------------------

interface LdJsonRating {
  ratingValue?: number | string | null;
  reviewCount?: number | string | null;
  ratingCount?: number | string | null;
}

interface LdJsonBlock {
  "@type"?: string;
  aggregateRating?: LdJsonRating;
}

/**
 * Extract the first `application/ld+json` block from an HTML page and return
 * the parsed JSON (or null on any parse failure).
 */
export function extractLdJson(html: string): LdJsonBlock | null {
  const scriptRe =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as LdJsonBlock;
      }
    } catch {
      // Try next script block.
    }
  }
  return null;
}

/**
 * Parse a MetaScore and review count from an ld+json block.
 * Returns null when the data is absent or unparseable.
 */
export function parseMetaScore(
  ld: LdJsonBlock,
): { score: number; reviewCount: number } | null {
  const rating = ld.aggregateRating;
  if (!rating) return null;

  const rawScore = rating.ratingValue;
  const rawCount =
    rating.reviewCount ?? rating.ratingCount ?? null;

  const score =
    typeof rawScore === "number"
      ? rawScore
      : typeof rawScore === "string"
        ? parseFloat(rawScore)
        : NaN;

  const reviewCount =
    typeof rawCount === "number"
      ? rawCount
      : typeof rawCount === "string"
        ? parseInt(rawCount, 10)
        : NaN;

  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  if (!Number.isFinite(reviewCount) || reviewCount < 1) return null;

  return { score: Math.round(score), reviewCount };
}

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

/**
 * Try each candidate URL in order. Returns `{ html, url }` for the first
 * successful fetch, or null when all fail.
 */
async function fetchMetacriticPage(
  urls: string[],
): Promise<{ html: string; url: string } | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; lore-radio/1.0; +https://lore.radio)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (res.ok) return { html: await res.text(), url };
      // 404 → try next candidate; 5xx → log and stop.
      if (res.status >= 500) {
        console.warn(`[lore] metacritic: ${res.status} from ${url}`);
        return null;
      }
    } catch {
      // Network failure on this candidate — try next.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Claim text builder
// ---------------------------------------------------------------------------

/**
 * Build the claim text for a Metacritic critic aggregate score.
 * e.g. "Metascore: 93/100 (22 critic reviews)"
 */
export function buildMetacriticClaimText(
  score: number,
  reviewCount: number,
): string {
  return `Metascore: ${score}/100 (${reviewCount} critic review${reviewCount === 1 ? "" : "s"})`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Release-group → recording fan-out
// ---------------------------------------------------------------------------

/**
 * Look up all recording MBIDs that belong to the given release group.
 * Used to fan out a single Metacritic album score to every track's claims row.
 */
async function recordingsForReleaseGroup(
  releaseGroupMbid: string,
): Promise<string[]> {
  const rows = await db
    .select({ recordingMbid: recordingReleaseGroupsTable.recordingMbid })
    .from(recordingReleaseGroupsTable)
    .where(eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid));
  return rows.map((r) => r.recordingMbid);
}

/**
 * Store a published per-recording Metacritic claim.
 * externalId: "metacritic:hit:{releaseGroupMbid}:{recordingMbid}" — unique per track.
 */
async function storeHitClaim(
  recordingMbid: string,
  releaseGroupMbid: string,
  claimText: string,
  sourceUrl: string,
): Promise<boolean> {
  const externalId = `${HIT_EXTERNAL_ID_PREFIX}${releaseGroupMbid}:${recordingMbid}`;
  try {
    const result = await db
      .insert(trackClaimsTable)
      .values({
        mbid: recordingMbid,
        text: claimText,
        sourceLabel: "Metacritic",
        sourceUrl,
        sourceHandle: METACRITIC_HANDLE,
        externalId,
        status: "published",
      })
      .onConflictDoNothing({ target: trackClaimsTable.externalId });
    return (result.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

async function storeMissSentinel(
  mbid: string,
  missId: string,
  pageUrl: string,
): Promise<void> {
  try {
    await db
      .insert(trackClaimsTable)
      .values({
        mbid,
        text: "No Metacritic critic score found.",
        sourceLabel: "Metacritic",
        sourceUrl: pageUrl,
        sourceHandle: METACRITIC_HANDLE,
        externalId: missId,
        status: "draft",
      })
      .onConflictDoNothing({ target: trackClaimsTable.externalId });
  } catch {
    // Sentinel insert failures are non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Scrape the Metacritic album page and store a per-recording `track_claims`
 * row for EVERY recording in the release group — not just the triggering track.
 *
 * Fan-out behaviour:
 *  - First call for any track on the album: fetches the Metacritic page and
 *    looks up all recordings in `recording_release_groups` for this release
 *    group. Stores a claim for each.
 *  - Subsequent calls for a different track on the same album: detects an
 *    existing hit (via LIKE on externalId prefix) and stores just the new
 *    recording's claim using the already-cached claim text — no page re-fetch.
 *  - Miss sentinel: if no score was found, a draft sentinel gates all future
 *    calls for this album (no repeated scraping within 24 h / until server
 *    restart).
 *
 * @returns true when at least one NEW published claim was stored.
 */
export async function fetchMetacriticScore(
  recordingMbid: string,
  artist: string,
  albumTitle: string,
  releaseGroupMbid: string | null,
): Promise<boolean> {
  if (!releaseGroupMbid || !artist || !albumTitle) return false;

  const missId = `${MISS_EXTERNAL_ID_PREFIX}${releaseGroupMbid}`;
  // Per-recording hit prefix: "metacritic:hit:{releaseGroupMbid}:"
  const hitPrefix = `${HIT_EXTERNAL_ID_PREFIX}${releaseGroupMbid}:`;
  const thisRecordingHitId = `${hitPrefix}${recordingMbid}`;

  try {
    // 1. Skip if this recording already has a claim.
    const thisHit = await db
      .select({ id: trackClaimsTable.id })
      .from(trackClaimsTable)
      .where(eq(trackClaimsTable.externalId, thisRecordingHitId))
      .limit(1);
    if (thisHit.length > 0) return false;

    // 2. Skip if the album is known to have no score (miss sentinel).
    const existingMiss = await db
      .select({ id: trackClaimsTable.id })
      .from(trackClaimsTable)
      .where(eq(trackClaimsTable.externalId, missId))
      .limit(1);
    if (existingMiss.length > 0) return false;

    // 3. In-memory miss cooldown (network failures, not DB-stored).
    const lastChecked = recentMisses.get(releaseGroupMbid);
    if (lastChecked && Date.now() - lastChecked < MISS_COOLDOWN_MS) return false;

    // 4. Check for an existing hit for any OTHER recording on this album.
    //    If found, reuse its claim text + URL — no page re-fetch needed.
    const existingHit = await db
      .select({ text: trackClaimsTable.text, sourceUrl: trackClaimsTable.sourceUrl })
      .from(trackClaimsTable)
      .where(like(trackClaimsTable.externalId, `${hitPrefix}%`))
      .limit(1);

    if (existingHit.length > 0 && existingHit[0]) {
      // Album was already fetched; just fan out to this recording.
      const stored = await storeHitClaim(
        recordingMbid,
        releaseGroupMbid,
        existingHit[0].text,
        existingHit[0].sourceUrl,
      );
      return stored;
    }

    // 5. First call for this album — fetch the Metacritic page.
    await rateLimitSleep();

    const candidates = metacriticCandidateUrls(artist, albumTitle);
    const page = await fetchMetacriticPage(candidates);

    if (!page) {
      if (recentMisses.size > MISS_COOLDOWN_MAX) recentMisses.clear();
      recentMisses.set(releaseGroupMbid, Date.now());
      return false;
    }

    const ld = extractLdJson(page.html);
    if (!ld) {
      await storeMissSentinel(recordingMbid, missId, page.url);
      return false;
    }

    const rating = parseMetaScore(ld);
    if (!rating) {
      await storeMissSentinel(recordingMbid, missId, page.url);
      return false;
    }

    // 6. Fan out: store a per-recording claim for every recording in the
    //    release group (not just the triggering track).
    const claimText = buildMetacriticClaimText(rating.score, rating.reviewCount);
    const allMbids = await recordingsForReleaseGroup(releaseGroupMbid);

    // Always include the triggering recording even if not yet in the bridge table.
    const mbidSet = new Set([recordingMbid, ...allMbids]);

    let newClaims = 0;
    for (const mbid of mbidSet) {
      const stored = await storeHitClaim(mbid, releaseGroupMbid, claimText, page.url);
      if (stored) newClaims++;
    }

    console.info(
      `[lore] metacritic: stored ${rating.score}/100 for ${artist} — ${albumTitle} (${newClaims} new claims across ${mbidSet.size} recordings)`,
    );
    return newClaims > 0;
  } catch (err) {
    console.warn("[lore] metacritic fetch failed:", releaseGroupMbid, err);
    return false;
  }
}
