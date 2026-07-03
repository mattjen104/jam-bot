import { db, recordingsTable, trackClaimsTable } from "@workspace/db";
import { eq, like, and } from "drizzle-orm";

/**
 * Wikipedia track and album article claims pipeline.
 *
 * Queries the public MediaWiki API (no key required) and the MusicBrainz API
 * to find Wikipedia articles matching a recording's title + artist (track level)
 * and the recording's canonical album (album level). When confirmed via infobox
 * field matching against known MB metadata, draft `track_claim` rows are created
 * for each target section.
 *
 * Policy:
 * - Never stores Wikipedia prose — only the section URL pointer.
 * - Confirmation uses explicit infobox field extraction (|artist=, |name=) matched
 *   against known MB metadata; falls back to token-overlap when fields are absent.
 * - Skips disambiguation pages, stubs (< 2 sections), pages with wrong infobox.
 * - Idempotent per scope: `wikipedia:{mbid}:` prefix for track claims,
 *   `wikipedia-album:{mbid}:` prefix for album claims.
 * - Off the hot path: intended to be called fire-and-forget from boot or a
 *   background job, never awaited on a request.
 */

const MW_API = "https://en.wikipedia.org/w/api.php";
const MB_API = "https://musicbrainz.org/ws/2";
const UA = "lore-radio/1.0 (https://lore.radio; contact@lore.radio)";

const TARGET_SECTIONS = new Set([
  "Recording",
  "Production",
  "Composition",
  "Background",
  "Critical reception",
]);

// --------------------------------------------------------------------------
// MusicBrainz rate limiter (1 req / 1.2 s) — kept module-local.
// --------------------------------------------------------------------------

let lastMbCallMs = 0;
const MB_MIN_INTERVAL_MS = 1200;

async function mbSleep(): Promise<void> {
  const now = Date.now();
  const wait = lastMbCallMs + MB_MIN_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMbCallMs = Date.now();
}

interface MbRelease {
  id: string;
  title: string;
  date?: string;
  "release-group"?: { "primary-type"?: string };
}

/**
 * Fetch the MusicBrainz releases linked to a recording MBID.
 * Uses a polite 1.2s inter-request delay and returns [] on any error.
 */
async function fetchMbReleases(mbid: string): Promise<MbRelease[]> {
  try {
    await mbSleep();
    const url = `${MB_API}/recording/${encodeURIComponent(mbid)}?inc=releases&fmt=json`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { releases?: MbRelease[] };
    return data.releases ?? [];
  } catch {
    return [];
  }
}

/**
 * Pick the canonical release: prefer Album type, then earliest date.
 */
function pickCanonicalRelease(releases: MbRelease[]): MbRelease | null {
  const albums = releases.filter(
    (r) => r["release-group"]?.["primary-type"] === "Album",
  );
  const pool = albums.length > 0 ? albums : releases;
  const sorted = [...pool].sort((a, b) =>
    (a.date ?? "9999").localeCompare(b.date ?? "9999"),
  );
  return sorted[0] ?? null;
}

// --------------------------------------------------------------------------
// MediaWiki helpers
// --------------------------------------------------------------------------

/** A MediaWiki section descriptor returned by action=parse. */
interface MwSection {
  index: string;
  anchor: string;
  line: string;
  number: string;
  level: string;
}

/** Strip inline HTML tags from a MediaWiki section title. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

/** Fetch JSON from the MediaWiki API, returning null on any network failure. */
async function mwFetch(params: Record<string, string>): Promise<unknown> {
  const url = new URL(MW_API);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`MediaWiki API HTTP ${r.status}`);
  return r.json();
}

// --------------------------------------------------------------------------
// Infobox field extraction — primary confirmation mechanism
// --------------------------------------------------------------------------

/**
 * Normalize a string for fuzzy comparison: lowercase, strip punctuation,
 * collapse whitespace.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `a` and `b` share at least `threshold` fraction of `a`'s tokens
 * in `b`. Both strings must be non-empty.
 */
function roughlyMatches(a: string, b: string, threshold = 0.5): boolean {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  const tokA = na.split(" ").filter((w) => w.length > 2);
  const tokB = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (tokA.length === 0) return false;
  const hits = tokA.filter((w) => tokB.has(w)).length;
  return hits / tokA.length >= threshold;
}

/**
 * Extract the first infobox block whose opening line matches `typeRe`.
 * Uses brace-depth tracking to handle nested templates inside the infobox.
 * Returns "" when not found.
 */
function extractInfoboxBlock(wikitext: string, typeRe: RegExp): string {
  const m = typeRe.exec(wikitext);
  if (!m) return "";
  const start = m.index;
  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") {
      depth++;
      i++;
    } else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
      depth--;
      if (depth === 0) return wikitext.slice(start, i + 2);
      i++;
    }
  }
  // Unterminated infobox — return up to 3000 chars as best-effort.
  return wikitext.slice(start, start + 3000);
}

/**
 * Read a named field from an infobox block.
 * Strips wikilinks [[Target|Label]] → "Label" and HTML tags.
 * Tries each field name in order; returns "" when none found.
 */
function getInfoboxField(infobox: string, ...fields: string[]): string {
  for (const field of fields) {
    // Match "|fieldname = value" stopping at the next pipe, brace, or newline
    const re = new RegExp(`\\|\\s*${field}\\s*=([^|{}\\n]+)`, "i");
    const m = re.exec(infobox);
    if (m) {
      return m[1]
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[Target|Label]] → Label
        .replace(/\[\[([^\]]+)\]\]/g, "$1") // [[Target]] → Target
        .replace(/<[^>]+>/g, "") // strip HTML
        .replace(/'{2,3}/g, "") // strip wikitext bold/italic
        .trim();
    }
  }
  return "";
}

// --------------------------------------------------------------------------
// Article confirmation — track and album variants
// --------------------------------------------------------------------------

const SONG_INFOBOX_RE = /\{\{[Ii]nfobox\s+(song|single|music track)/;
const ALBUM_INFOBOX_RE = /\{\{[Ii]nfobox\s+album/;

/**
 * Confirm that a Wikipedia article is genuinely about this recording.
 *
 * Confirmation order:
 * 1. Reject disambiguation pages and "may refer to" pages.
 * 2. Require a song/single infobox (not album, not artist).
 * 3. Extract |artist= and |name= infobox fields and match against known MB
 *    metadata using normalized token overlap. This is the primary guard.
 * 4. When infobox fields are absent, fall back to token-overlap heuristic
 *    in the article intro (first 3000 chars).
 */
function confirmSongArticle(
  wikitext: string,
  artist: string,
  songTitle: string,
): boolean {
  if (
    /\{\{disambiguation/i.test(wikitext) ||
    /may refer to:/i.test(wikitext.slice(0, 500))
  ) {
    return false;
  }
  if (!SONG_INFOBOX_RE.test(wikitext)) return false;

  const infobox = extractInfoboxBlock(wikitext, SONG_INFOBOX_RE);
  const ibArtist = getInfoboxField(infobox, "artist", "artists");
  const ibTitle = getInfoboxField(infobox, "name", "song", "title");

  // Primary: explicit infobox field matching against MB metadata
  if (ibArtist && ibTitle) {
    return roughlyMatches(artist, ibArtist) && roughlyMatches(songTitle, ibTitle);
  }
  if (ibArtist) {
    if (!roughlyMatches(artist, ibArtist)) return false;
  }

  // Fallback: token-overlap heuristic in intro
  const intro = wikitext.slice(0, 3000).toLowerCase();
  const artistTokens = artist
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const titleTokens = songTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const artistHit =
    artistTokens.length === 0 ||
    artistTokens.filter((w) => intro.includes(w)).length >=
      Math.ceil(artistTokens.length / 2);
  const titleHit =
    titleTokens.length === 0 ||
    titleTokens.filter((w) => intro.includes(w)).length >=
      Math.ceil(titleTokens.length / 2);
  return artistHit && titleHit;
}

/**
 * Confirm that a Wikipedia article is genuinely about this album.
 *
 * Requires `{{Infobox album}}` and matches |artist= and |name= fields
 * against known MB metadata. Rejects disambiguation pages.
 */
function confirmAlbumArticle(
  wikitext: string,
  artist: string,
  albumTitle: string,
): boolean {
  if (
    /\{\{disambiguation/i.test(wikitext) ||
    /may refer to:/i.test(wikitext.slice(0, 500))
  ) {
    return false;
  }
  if (!ALBUM_INFOBOX_RE.test(wikitext)) return false;

  const infobox = extractInfoboxBlock(wikitext, ALBUM_INFOBOX_RE);
  const ibArtist = getInfoboxField(infobox, "artist", "artists", "artist1");
  const ibTitle = getInfoboxField(infobox, "name", "album", "title");

  if (ibArtist && ibTitle) {
    return (
      roughlyMatches(artist, ibArtist) && roughlyMatches(albumTitle, ibTitle)
    );
  }
  if (ibArtist) {
    if (!roughlyMatches(artist, ibArtist)) return false;
  }

  // Fallback: title tokens in intro
  const intro = wikitext.slice(0, 3000).toLowerCase();
  const titleTokens = albumTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  return (
    titleTokens.length === 0 ||
    titleTokens.filter((w) => intro.includes(w)).length >=
      Math.ceil(titleTokens.length / 2)
  );
}

// --------------------------------------------------------------------------
// Wikipedia search + page fetch
// --------------------------------------------------------------------------

async function searchArticles(
  query: string,
): Promise<Array<{ pageid: number; title: string }>> {
  try {
    const data = (await mwFetch({
      action: "query",
      list: "search",
      srsearch: query,
      srnamespace: "0",
      srlimit: "3",
      srinfo: "",
      srprop: "",
    })) as { query?: { search?: Array<{ pageid: number; title: string }> } };
    return data?.query?.search ?? [];
  } catch (err) {
    console.warn("[lore] wikipedia search failed:", query, err);
    return [];
  }
}

async function fetchPageData(pageid: number): Promise<{
  wikitext: string;
  sections: MwSection[];
  title: string;
} | null> {
  try {
    const data = (await mwFetch({
      action: "parse",
      pageid: String(pageid),
      prop: "wikitext|sections",
    })) as {
      parse?: {
        title?: string;
        wikitext?: string | { "*": string };
        sections?: MwSection[];
      };
    };
    const p = data?.parse;
    if (!p) return null;
    const wikitext =
      typeof p.wikitext === "string"
        ? p.wikitext
        : (p.wikitext as { "*"?: string })?.["\u002a"] ?? "";
    if (!wikitext || !Array.isArray(p.sections)) return null;
    return { wikitext, sections: p.sections, title: p.title ?? "" };
  } catch (err) {
    console.warn("[lore] wikipedia page fetch failed:", pageid, err);
    return null;
  }
}

// --------------------------------------------------------------------------
// Idempotency checks
// --------------------------------------------------------------------------

async function alreadyChecked(
  mbid: string,
  scope: "wikipedia" | "wikipedia-album",
): Promise<boolean> {
  const prefix = `${scope}:${mbid}:`;
  const probe = await db
    .select({ id: trackClaimsTable.id })
    .from(trackClaimsTable)
    .where(like(trackClaimsTable.externalId, `${prefix}%`))
    .limit(1);
  return probe.length > 0;
}

// --------------------------------------------------------------------------
// Claim insertion helpers
// --------------------------------------------------------------------------

async function insertDraftClaims(
  mbid: string,
  scope: "wikipedia" | "wikipedia-album",
  pageData: { title: string },
  sections: MwSection[],
  pageTitle: string,
): Promise<number> {
  let inserted = 0;
  for (const section of sections) {
    const label = stripHtml(section.line);
    const sectionUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}#${section.anchor}`;
    const externalId = `${scope}:${mbid}:${section.anchor}`;
    try {
      await db
        .insert(trackClaimsTable)
        .values({
          mbid,
          text: "",
          sourceLabel: `Wikipedia — ${pageData.title}`,
          sourceUrl: sectionUrl,
          sourceHandle: scope,
          externalId,
          anchorType: "section",
          anchorValue: label,
          status: "draft",
        })
        .onConflictDoNothing();
      inserted++;
    } catch (err) {
      console.warn("[lore] wikipedia draft insert failed:", externalId, err);
    }
  }
  return inserted;
}

async function storeSentinel(
  mbid: string,
  scope: "wikipedia" | "wikipedia-album",
  label: string,
  articleTitle: string | null,
): Promise<void> {
  try {
    await db
      .insert(trackClaimsTable)
      .values({
        mbid,
        text: "no-target-sections",
        sourceLabel: articleTitle
          ? `Wikipedia — ${articleTitle}`
          : "Wikipedia (no article confirmed)",
        sourceUrl: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(label)}`,
        sourceHandle: scope,
        externalId: `${scope}:${mbid}:__none__`,
        anchorType: null,
        anchorValue: null,
        status: "rejected",
      })
      .onConflictDoNothing();
  } catch (err) {
    console.warn("[lore] wikipedia sentinel insert failed:", mbid, scope, err);
  }
}

// --------------------------------------------------------------------------
// Track-level article pipeline
// --------------------------------------------------------------------------

async function runTrackArticlePipeline(
  mbid: string,
  title: string,
  artist: string,
): Promise<number> {
  if (await alreadyChecked(mbid, "wikipedia")) return 0;

  const candidates = await searchArticles(`"${title}" ${artist} song`);
  for (const candidate of candidates) {
    const pageData = await fetchPageData(candidate.pageid);
    if (!pageData) continue;
    if (pageData.sections.length < 2) continue;
    if (!confirmSongArticle(pageData.wikitext, artist, title)) continue;

    const pageTitle = pageData.title.replace(/ /g, "_");
    const targets = pageData.sections.filter((s) =>
      TARGET_SECTIONS.has(stripHtml(s.line)),
    );

    if (targets.length === 0) {
      await storeSentinel(mbid, "wikipedia", title, pageData.title);
      return 0;
    }

    const n = await insertDraftClaims(
      mbid,
      "wikipedia",
      pageData,
      targets,
      pageTitle,
    );
    console.info(
      `[lore] wikipedia track "${artist} – ${title}": ${n} draft(s) from "${pageData.title}"`,
    );
    return n;
  }

  await storeSentinel(mbid, "wikipedia", title, null);
  return 0;
}

// --------------------------------------------------------------------------
// Album-level article pipeline
// --------------------------------------------------------------------------

async function runAlbumArticlePipeline(
  mbid: string,
  title: string,
  artist: string,
): Promise<number> {
  if (await alreadyChecked(mbid, "wikipedia-album")) return 0;

  const releases = await fetchMbReleases(mbid);
  if (releases.length === 0) {
    await storeSentinel(mbid, "wikipedia-album", title, null);
    return 0;
  }

  const release = pickCanonicalRelease(releases);
  if (!release) {
    await storeSentinel(mbid, "wikipedia-album", title, null);
    return 0;
  }

  const albumTitle = release.title;
  const candidates = await searchArticles(`"${albumTitle}" ${artist} album`);

  for (const candidate of candidates) {
    const pageData = await fetchPageData(candidate.pageid);
    if (!pageData) continue;
    if (pageData.sections.length < 2) continue;
    if (!confirmAlbumArticle(pageData.wikitext, artist, albumTitle)) continue;

    const pageTitle = pageData.title.replace(/ /g, "_");
    const targets = pageData.sections.filter((s) =>
      TARGET_SECTIONS.has(stripHtml(s.line)),
    );

    if (targets.length === 0) {
      await storeSentinel(mbid, "wikipedia-album", albumTitle, pageData.title);
      return 0;
    }

    const n = await insertDraftClaims(
      mbid,
      "wikipedia-album",
      pageData,
      targets,
      pageTitle,
    );
    console.info(
      `[lore] wikipedia album "${artist} – ${albumTitle}": ${n} draft(s) from "${pageData.title}"`,
    );
    return n;
  }

  await storeSentinel(mbid, "wikipedia-album", albumTitle, null);
  return 0;
}

// --------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------

/**
 * Main entry point: run both track-level and album-level Wikipedia pipelines
 * for a recording.
 *
 * - Idempotent per scope: early-exit when sentinel/drafts already exist.
 * - Never throws: all errors are caught and logged.
 * - Off the hot path: call fire-and-forget from the background job; do not
 *   await on a request handler.
 *
 * Returns the total number of draft claims created (both scopes combined).
 */
export async function fetchWikipediaClaims(mbid: string): Promise<{
  draftsCreated: number;
}> {
  let draftsCreated = 0;
  try {
    const [rec] = await db
      .select({ title: recordingsTable.title, artist: recordingsTable.artist })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, mbid))
      .limit(1);
    if (!rec) return { draftsCreated };

    // Run track pipeline first, then album pipeline.
    // Each scope is independently idempotent.
    draftsCreated += await runTrackArticlePipeline(mbid, rec.title, rec.artist);
    draftsCreated += await runAlbumArticlePipeline(mbid, rec.title, rec.artist);
  } catch (err) {
    console.warn("[lore] wikipedia claims pipeline failed:", mbid, err);
  }
  return { draftsCreated };
}

/**
 * True when BOTH track and album Wikipedia checks have already run for this
 * recording (sentinel or drafts present for both scopes).
 */
export async function wikiAlreadyFullyChecked(mbid: string): Promise<boolean> {
  const [trackDone, albumDone] = await Promise.all([
    alreadyChecked(mbid, "wikipedia"),
    alreadyChecked(mbid, "wikipedia-album"),
  ]);
  return trackDone && albumDone;
}
