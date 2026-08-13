import { db, recordingsTable, trackClaimsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * Pitchfork album review → track claim pipeline.
 *
 * Searches Pitchfork's undocumented (but stable) internal search API for an
 * album review matching the recording's artist + album title. When a confident
 * match is found, a published `track_claim` is stored so the Album
 * Investigation sheet can surface the score and a link.
 *
 * API: https://pitchfork.com/api/v2/search/?query={query}&types=reviews
 *
 * Policy:
 * - One claim per recording (idempotent via mbid+sourceHandle check).
 * - Stores numeric score + accolade in claim `text`.
 * - When albumHint is supplied: requires BOTH artist AND album token overlap
 *   so a same-artist/wrong-album review is never stored.
 * - When albumHint is absent (background-job path): requires artist overlap
 *   only — less precise but never stores an outright wrong-artist review.
 * - Misses are stored as a durable draft sentinel so the background job
 *   doesn't re-try checked recordings on every pass.
 * - Off the hot path: safe to call fire-and-forget from the knowledge route.
 */

export const PITCHFORK_HANDLE = "pitchfork";
const PITCHFORK_HOME = "https://pitchfork.com";
const PITCHFORK_SEARCH_URL = "https://pitchfork.com/api/v2/search/";
const FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Pitchfork search response types (minimal — only fields we use)
// ---------------------------------------------------------------------------

interface PitchforkArtist {
  display_name?: string;
}

interface PitchforkRating {
  rating?: string | null;
}

interface PitchforkResultItem {
  /** Review page path, e.g. "/reviews/albums/radiohead-ok-computer/". */
  url?: string;
  /** Rating object. */
  rating?: PitchforkRating;
  /** "Best New Music", "Best New Reissue", or null. */
  accolade?: string | null;
  /**
   * Structured artist + album metadata from the tombstone.
   * The per-album entries carry both the album title and its artists.
   */
  tombstone?: {
    albums?: Array<{
      album?: { display_name?: string };
      artists?: PitchforkArtist[];
    }>;
    artists?: PitchforkArtist[];
  };
}

interface PitchforkSearchResponse {
  results?: {
    list?: PitchforkResultItem[];
  };
}

// ---------------------------------------------------------------------------
// Token-overlap helpers (pure — exportable for tests)
// ---------------------------------------------------------------------------

export function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * True when at least one significant token from `source` appears in
 * `candidate`. Used for both artist and album validation.
 */
export function hasTokenOverlap(source: string, candidate: string): boolean {
  const tSrc = tokenise(source);
  const tCand = new Set(tokenise(candidate));
  return tSrc.some((t) => tCand.has(t));
}

// ---------------------------------------------------------------------------
// Response field extractors (pure — exportable for tests)
// ---------------------------------------------------------------------------

/** Extract all artist names from a Pitchfork result item. */
export function extractArtistNames(item: PitchforkResultItem): string[] {
  const names: string[] = [];
  const tombstone = item.tombstone;
  if (!tombstone) return names;

  for (const artist of tombstone.artists ?? []) {
    if (artist.display_name) names.push(artist.display_name);
  }
  for (const albumEntry of tombstone.albums ?? []) {
    for (const artist of albumEntry.artists ?? []) {
      if (artist.display_name) names.push(artist.display_name);
    }
  }
  return names;
}

/** Extract all album display names from a Pitchfork result item. */
export function extractAlbumNames(item: PitchforkResultItem): string[] {
  return (item.tombstone?.albums ?? [])
    .map((a) => a.album?.display_name)
    .filter((n): n is string => !!n);
}

// ---------------------------------------------------------------------------
// Match selection (pure — exportable for tests)
// ---------------------------------------------------------------------------

/**
 * Pick the first result whose artist credit overlaps with `artist`, and
 * (when `albumHint` is supplied) whose album name also overlaps.
 *
 * Requiring BOTH conditions when an albumHint is available prevents storing
 * a same-artist/wrong-album review (a common failure mode for artists who
 * have multiple Pitchfork-reviewed albums).
 *
 * When albumHint is null (background-job path — no Spotify context) we fall
 * back to artist-only validation, which is less precise but still rejects
 * clearly wrong-artist results.
 *
 * Returns null when no item meets the threshold — never guesses.
 */
export function pickMatchingReview(
  items: PitchforkResultItem[],
  artist: string,
  albumHint: string | null,
): PitchforkResultItem | null {
  for (const item of items) {
    const resultArtists = extractArtistNames(item);
    if (resultArtists.length === 0) continue;

    const artistMatches = resultArtists.some((a) => hasTokenOverlap(artist, a));
    if (!artistMatches) continue;

    // When an album title is available, require the result's album to also
    // overlap so we never store a wrong-album review.
    if (albumHint !== null) {
      const resultAlbums = extractAlbumNames(item);
      const albumMatches = resultAlbums.some((a) => hasTokenOverlap(albumHint, a));
      if (!albumMatches) continue;
    }

    return item;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Claim text builder (pure — exportable for tests)
// ---------------------------------------------------------------------------

export function buildPitchforkClaimText(item: PitchforkResultItem): string {
  const score = item.rating?.rating ?? null;
  const accolade = item.accolade ?? null;

  const parts: string[] = [];
  if (score) parts.push(`Rated ${score}/10 by Pitchfork.`);
  if (accolade) parts.push(accolade);
  return parts.join(" ") || "Reviewed by Pitchfork.";
}

// ---------------------------------------------------------------------------
// Network layer (injectable for testing)
// ---------------------------------------------------------------------------

export async function searchPitchfork(
  query: string,
  fetchFn: typeof fetch = fetch,
): Promise<PitchforkResultItem[]> {
  try {
    const url = new URL(PITCHFORK_SEARCH_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("types", "reviews");
    url.searchParams.set("hierarchy", "sections/reviews/albums");
    url.searchParams.set("size", "5");

    const res = await fetchFn(url.toString(), {
      headers: {
        "User-Agent": "lore-radio/1.0 (contact@lore.radio)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as PitchforkSearchResponse;
    return data?.results?.list ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Fetch the Pitchfork album review for a recording and store it as a
 * published track_claim.
 *
 * - When `albumHint` is non-null (investigation-sheet path, Spotify album
 *   name available): searches by artist + album and validates both fields
 *   before storing — prevents wrong-album claims.
 * - When `albumHint` is null (background-job path): searches by artist only
 *   and validates artist overlap only.
 *
 * Idempotent: returns false immediately if ANY pitchfork claim (hit or miss
 * sentinel) already exists for this recording, so the background job never
 * re-fetches a recording it has already processed.
 *
 * On a miss, stores a durable draft sentinel (`pitchfork:{mbid}:checked`)
 * so subsequent job passes skip this recording rather than retrying it
 * indefinitely and starving newer keeps.
 *
 * @returns true when a new **published** claim was stored, false otherwise.
 */
export async function fetchPitchforkReview(
  mbid: string,
  albumHint: string | null = null,
): Promise<boolean> {
  try {
    // Idempotency: skip if ANY pitchfork claim (review or miss sentinel) exists.
    const existing = await db
      .select({ id: trackClaimsTable.id })
      .from(trackClaimsTable)
      .where(
        and(
          eq(trackClaimsTable.mbid, mbid),
          eq(trackClaimsTable.sourceHandle, PITCHFORK_HANDLE),
        ),
      )
      .limit(1);
    if (existing.length > 0) return false;

    const [rec] = await db
      .select({ artist: recordingsTable.artist, title: recordingsTable.title })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, mbid))
      .limit(1);
    if (!rec) return false;

    // When albumHint is given, include it in the search query for better
    // recall. Without it, search by artist alone to avoid contaminating the
    // query with a track title (which is not an album title).
    const searchQuery = albumHint
      ? `${rec.artist} ${albumHint}`
      : rec.artist;

    const items = await searchPitchfork(searchQuery);
    const match = pickMatchingReview(items, rec.artist, albumHint);

    if (!match) {
      // Store a durable miss sentinel (draft, invisible to users) so the
      // background job does not retry this recording on every pass.
      await db
        .insert(trackClaimsTable)
        .values({
          mbid,
          text: "No matching Pitchfork review found.",
          sourceLabel: "Pitchfork",
          sourceUrl: PITCHFORK_HOME,
          sourceHandle: PITCHFORK_HANDLE,
          externalId: `${PITCHFORK_HANDLE}:${mbid}:checked`,
          status: "draft",
        })
        .onConflictDoNothing();
      return false;
    }

    const reviewUrl = match.url
      ? `${PITCHFORK_HOME}${match.url.startsWith("/") ? match.url : `/${match.url}`}`
      : PITCHFORK_HOME;

    await db
      .insert(trackClaimsTable)
      .values({
        mbid,
        text: buildPitchforkClaimText(match),
        sourceLabel: "Pitchfork",
        sourceUrl: reviewUrl,
        sourceHandle: PITCHFORK_HANDLE,
        externalId: `${PITCHFORK_HANDLE}:${mbid}:review`,
        status: "published",
      })
      .onConflictDoNothing();

    console.info(
      `[lore] pitchfork: stored review for ${rec.artist}${albumHint ? ` — ${albumHint}` : ""} (score: ${match.rating?.rating ?? "n/a"})`,
    );
    return true;
  } catch (err) {
    console.warn("[lore] pitchfork review fetch failed:", mbid, err);
    return false;
  }
}
