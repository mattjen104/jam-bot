import { db, recordingsTable, trackClaimsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * TheAudioDB album review → track claim pipeline.
 *
 * Uses TheAudioDB's free public API (no key required) to find a community
 * review and score for a recording's album. When a confident artist + album
 * match is found, a published `track_claim` is stored so the Album
 * Investigation sheet can surface the score and a link.
 *
 * API: https://www.theaudiodb.com/api/v1/json/2/searchalbum.php?s={artist}&a={album}
 *
 * Policy:
 * - One claim per recording per album (idempotent via externalId).
 * - Stores numeric score + truncated English review in claim `text`.
 * - Validation requires both artist AND album token overlap ≥ 50%.
 * - Misses use an in-memory TTL cooldown (no permanent DB sentinel) so
 *   transient failures are automatically retried after the cooldown expires.
 * - Off the hot path: call fire-and-forget from the knowledge route.
 */

export const AUDIODB_HANDLE = "audiodb";
const AUDIODB_BASE = "https://www.theaudiodb.com/api/v1/json/2";
const AUDIODB_HOME = "https://www.theaudiodb.com";
const FETCH_TIMEOUT_MS = 8_000;

/** Max chars of review prose stored in the claim text. */
const MAX_REVIEW_CHARS = 300;

/** In-memory cooldown to avoid re-querying the API for recent misses. */
const recentlyChecked = new Map<string, number>(); // mbid → checked-at ms
const MISS_COOLDOWN_MS = 24 * 60 * 60_000; // 24 hours
const MISS_COOLDOWN_MAX = 5_000;

// --------------------------------------------------------------------------
// TheAudioDB response types (minimal — only fields we actually use)
// --------------------------------------------------------------------------

export interface AudioDbAlbum {
  idAlbum?: string;
  strAlbum?: string;
  strArtist?: string;
  intScore?: string | null;   // "9.0" — community average
  intScoreVotes?: string | null;
  strReview?: string | null;  // English prose review
}

interface AudioDbResponse {
  album?: AudioDbAlbum[] | null;
}

// --------------------------------------------------------------------------
// Token-overlap validation
// --------------------------------------------------------------------------

/** Tokenise for fuzzy matching: lowercase, strip punct, split on whitespace. */
export function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * True when `a` and `b` share ≥ 50% of the shorter string's significant
 * tokens in the longer string. Direction-agnostic.
 */
export function roughlyMatches(a: string, b: string): boolean {
  const tA = tokenise(a);
  const tB = new Set(tokenise(b));
  if (!tA.length || !tB.size) return false;
  const hits = tA.filter((t) => tB.has(t)).length;
  return hits / tA.length >= 0.5 || hits / tB.size >= 0.5;
}

// --------------------------------------------------------------------------
// API fetch (injectable for testing)
// --------------------------------------------------------------------------

/**
 * Query TheAudioDB for albums matching artist + album title.
 * Returns an empty array on any network or parse error.
 *
 * @param fetchFn  Injected for testing; defaults to the global `fetch`.
 */
export async function queryAudioDb(
  artist: string,
  albumTitle: string,
  fetchFn: typeof fetch = fetch,
): Promise<AudioDbAlbum[]> {
  try {
    const url = new URL(`${AUDIODB_BASE}/searchalbum.php`);
    url.searchParams.set("s", artist);
    url.searchParams.set("a", albumTitle);

    const res = await fetchFn(url.toString(), {
      headers: { "User-Agent": "lore-radio/1.0 (contact@lore.radio)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as AudioDbResponse;
    return data?.album ?? [];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------
// Match selection (pure — testable without DB or network)
// --------------------------------------------------------------------------

/**
 * Pick the first album in an AudioDB result list that matches the expected
 * artist and album title by token overlap.
 *
 * Returns null when no item meets the threshold — never guesses.
 */
export function pickMatchingAlbum(
  items: AudioDbAlbum[],
  artist: string,
  albumTitle: string,
): AudioDbAlbum | null {
  for (const item of items) {
    const itemArtist = item.strArtist ?? "";
    const itemTitle = item.strAlbum ?? "";
    if (roughlyMatches(artist, itemArtist) && roughlyMatches(albumTitle, itemTitle)) {
      return item;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Claim text builder (pure)
// --------------------------------------------------------------------------

/**
 * Build a short, factual claim text from an AudioDB album entry.
 * Never stores verbatim review prose beyond MAX_REVIEW_CHARS.
 */
export function buildClaimText(album: AudioDbAlbum): string {
  const score = album.intScore ? `Rated ${album.intScore}/10.` : null;
  const votes = album.intScoreVotes ? ` (${album.intScoreVotes} votes)` : "";
  const reviewSnippet = album.strReview
    ? album.strReview.slice(0, MAX_REVIEW_CHARS).replace(/\s+\S*$/, "") + "…"
    : null;

  const parts: string[] = [];
  if (score) parts.push(`${score}${votes}`);
  if (reviewSnippet) parts.push(reviewSnippet);
  return parts.join(" ") || "Reviewed on TheAudioDB.";
}

// --------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------

/**
 * Fetch the TheAudioDB album review for the recording's canonical album and
 * store it as a published track_claim.
 *
 * Only runs when `albumTitle` is non-null (requires Spotify album context).
 * Uses an in-memory cooldown for misses so transient failures are retried
 * after 24 h without writing a permanent DB sentinel.
 *
 * @returns true when a new claim was stored, false otherwise.
 */
export async function fetchAudioDbReview(
  mbid: string,
  albumTitle: string | null | undefined,
): Promise<boolean> {
  if (!albumTitle) return false;

  try {
    // Idempotency: skip if we already have a claim for this recording.
    const existing = await db
      .select({ id: trackClaimsTable.id })
      .from(trackClaimsTable)
      .where(eq(trackClaimsTable.externalId, `${AUDIODB_HANDLE}:${mbid}:review`))
      .limit(1);
    if (existing.length > 0) return false;

    // In-memory cooldown: skip if we recently got a miss for this recording.
    const lastChecked = recentlyChecked.get(mbid);
    if (lastChecked && Date.now() - lastChecked < MISS_COOLDOWN_MS) return false;

    const [rec] = await db
      .select({ artist: recordingsTable.artist })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, mbid))
      .limit(1);
    if (!rec) return false;

    const items = await queryAudioDb(rec.artist, albumTitle);
    const match = pickMatchingAlbum(items, rec.artist, albumTitle);

    if (!match) {
      // Record the miss in-memory so we don't hammer the API on every request.
      if (recentlyChecked.size > MISS_COOLDOWN_MAX) recentlyChecked.clear();
      recentlyChecked.set(mbid, Date.now());
      return false;
    }

    const albumUrl = match.idAlbum
      ? `${AUDIODB_HOME}/album/${match.idAlbum}`
      : AUDIODB_HOME;

    await db
      .insert(trackClaimsTable)
      .values({
        mbid,
        text: buildClaimText(match),
        sourceLabel: "TheAudioDB",
        sourceUrl: albumUrl,
        sourceHandle: AUDIODB_HANDLE,
        externalId: `${AUDIODB_HANDLE}:${mbid}:review`,
        status: "published",
      })
      .onConflictDoNothing();

    console.info(
      `[lore] audiodb: stored review claim for ${rec.artist} — ${albumTitle} (score: ${match.intScore ?? "n/a"})`,
    );
    return true;
  } catch (err) {
    console.warn("[lore] audiodb review fetch failed:", mbid, err);
    return false;
  }
}
