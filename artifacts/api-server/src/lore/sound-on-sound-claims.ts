import { db, recordingsTable, trackClaimsTable, libraryItemsTable } from "@workspace/db";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { parseFeedItems } from "./blog.js";

/**
 * Sound on Sound claims shim.
 *
 * Sound on Sound (SoS) is already a blog-picker in the seed (feedUrl:
 * "https://www.soundonsound.com/feed"), where its articles produce picks via
 * the blog-poller. This module is an **additive claims layer** on top: it re-
 * reads the SoS RSS feed and, for articles whose title mentions an artist name
 * from the listener's library, stores a published `track_claims` row. The
 * picker logic is not replaced — the claims layer is strictly additive.
 *
 * Matching strategy:
 *  1. Load all unique artist names from kept recordings in library_items.
 *  2. For each SoS article, check if its title contains any artist substring
 *     (case-insensitive, token-normalised).
 *  3. On match: create a `track_claims` row for every kept recording by that
 *     artist. Claim text = the article headline (truncated to 120 chars).
 *  4. Gate: only store claims for recordings already on the spine (recordings
 *     table must have the row).
 *
 * Policy:
 * - Idempotent: `externalId: "sos-claim:{article-guid}:{mbid}"`.
 * - 24-hour polling interval.
 * - 10-minute warmup to let boot settle.
 * - Off the hot path — never blocks requests.
 */

const SOS_FEED_URL = "https://www.soundonsound.com/feed";
const SOS_HANDLE = "sound-on-sound";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_CLAIM_TEXT_LEN = 120;
// Only process at most this many new articles per pass to stay polite.
const MAX_ARTICLES_PER_PASS = 20;

const WARMUP_MS = 10 * 60 * 1_000; // 10 min after boot
const RUN_EVERY_MS = 24 * 60 * 60 * 1_000; // 24 hours

// ---------------------------------------------------------------------------
// Artist name normalisation (for matching article titles)
// ---------------------------------------------------------------------------

/**
 * Normalise an artist name for substring matching:
 * lowercase, collapse punctuation and whitespace.
 */
export function normaliseArtistName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when a normalised artist name appears as a word-boundary-respecting
 * substring of a normalised article title. We check for at least 4-char names
 * to avoid short false positives.
 */
export function articleMentionsArtist(
  normTitle: string,
  normArtist: string,
): boolean {
  if (normArtist.length < 4) return false;
  // Simple substring check — word-boundary checking via spaces.
  // e.g. "smashing pumpkins" appears in "smashing pumpkins mellon collie"
  return normTitle.includes(normArtist);
}

// ---------------------------------------------------------------------------
// Feed fetch
// ---------------------------------------------------------------------------

interface SosArticle {
  guid: string;
  title: string;
  link: string;
  publishedAt: Date | null;
}

async function fetchSosFeed(): Promise<SosArticle[]> {
  try {
    const res = await fetch(SOS_FEED_URL, {
      headers: {
        "User-Agent": "lore-radio/1.0 (https://lore.radio; contact@lore.radio)",
        Accept: "application/rss+xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[lore] sos-claims: feed fetch failed HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = parseFeedItems(xml);
    return items.map((item) => ({
      guid: item.guid,
      title: item.title,
      link: item.link,
      publishedAt: item.publishedAt ?? null,
    }));
  } catch (err) {
    console.warn("[lore] sos-claims: feed fetch error", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Kept artist lookup
// ---------------------------------------------------------------------------

interface KeptArtist {
  /** Normalised artist name for matching. */
  normName: string;
  /** Raw artist name (for logging). */
  rawName: string;
  /** All active kept recording MBIDs for this artist. */
  mbids: string[];
}

/**
 * Load all unique artists (and their kept recording MBIDs) from library_items.
 * Returns a map from normalised artist name → KeptArtist.
 */
async function loadKeptArtists(): Promise<Map<string, KeptArtist>> {
  const rows = await db
    .selectDistinct({
      mbid: libraryItemsTable.mbid,
      artist: recordingsTable.artist,
    })
    .from(libraryItemsTable)
    .innerJoin(
      recordingsTable,
      eq(libraryItemsTable.mbid, recordingsTable.mbid),
    )
    .where(
      and(
        isNull(libraryItemsTable.removedAt),
        isNotNull(libraryItemsTable.mbid),
      ),
    );

  const map = new Map<string, KeptArtist>();
  for (const row of rows) {
    if (!row.artist || !row.mbid) continue;
    const normName = normaliseArtistName(row.artist);
    if (!normName || normName.length < 4) continue;
    const existing = map.get(normName);
    if (existing) {
      existing.mbids.push(row.mbid);
    } else {
      map.set(normName, {
        normName,
        rawName: row.artist,
        mbids: [row.mbid],
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Claim storage
// ---------------------------------------------------------------------------

/**
 * Store a published `track_claims` row for a SoS article → recording match.
 * Idempotent via `externalId: "sos-claim:{guid}:{mbid}"`.
 * Returns true when a NEW claim was stored.
 */
async function storeSosClaim(
  mbid: string,
  article: SosArticle,
): Promise<boolean> {
  const externalId = `sos-claim:${article.guid}:${mbid}`;
  const claimText = article.title.length > MAX_CLAIM_TEXT_LEN
    ? article.title.slice(0, MAX_CLAIM_TEXT_LEN - 1) + "…"
    : article.title;

  try {
    const result = await db
      .insert(trackClaimsTable)
      .values({
        mbid,
        text: claimText,
        sourceLabel: "Sound on Sound",
        sourceUrl: article.link,
        sourceHandle: SOS_HANDLE,
        externalId,
        status: "published",
      })
      .onConflictDoNothing({ target: trackClaimsTable.externalId });
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    console.warn("[lore] sos-claims: claim insert failed", externalId, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-pass runner
// ---------------------------------------------------------------------------

async function runPass(): Promise<void> {
  try {
    const [articles, keptArtists] = await Promise.all([
      fetchSosFeed(),
      loadKeptArtists(),
    ]);

    if (articles.length === 0 || keptArtists.size === 0) return;

    // Only process the most recent N articles (already fetched).
    const batch = articles.slice(0, MAX_ARTICLES_PER_PASS);

    let newClaims = 0;

    for (const article of batch) {
      const normTitle = normaliseArtistName(article.title);

      // Find every kept artist mentioned in the title.
      for (const [, keptArtist] of keptArtists) {
        if (!articleMentionsArtist(normTitle, keptArtist.normName)) continue;

        // For each kept recording by this artist, try to store a claim.
        for (const mbid of keptArtist.mbids) {
          const stored = await storeSosClaim(mbid, article);
          if (stored) newClaims++;
        }
      }
    }

    if (newClaims > 0) {
      console.info(
        `[lore] sos-claims: ${newClaims} new claim(s) stored from ${batch.length} article(s)`,
      );
    }
  } catch (err) {
    console.warn("[lore] sos-claims: pass failed", err);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let started = false;
const timers: NodeJS.Timeout[] = [];

/** Start the Sound on Sound claims shim. Idempotent — safe to call once at boot. */
export function startSoundOnSoundClaimsJob(): void {
  if (started) return;
  started = true;

  const warmup = setTimeout(() => {
    void runPass();
    const interval = setInterval(() => void runPass(), RUN_EVERY_MS);
    timers.push(interval);
  }, WARMUP_MS);
  timers.push(warmup);

  console.info("[lore] sos-claims job scheduled (10 min warmup, 24 h interval)");
}

/** Stop the job (tests / graceful shutdown). */
export function stopSoundOnSoundClaimsJob(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
