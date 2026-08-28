import { db, pickersTable, rssArticlesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { upsertPicker } from "./picks.js";

/**
 * Blog / critic RSS worker. Polls a tastemaker feed and, per post, tries to
 * extract a featured artist + track from the post TITLE and tags first, then a
 * simple in-text match, resolves it to the MBID spine, and logs a pick
 * (source='blog_post', trust_tier=2). We store ONLY the resolved pick + a link
 * to the exact post — never the post body text. Posts with no confident track
 * match are skipped; we never guess.
 *
 * The XML parse is deliberately dependency-free and lenient: RSS/Atom feeds in
 * the wild are messy, and this is best-effort ingest, not a validator.
 */

const MAX_ARTICLE_AUTHOR_LENGTH = 160;
const MAX_ARTICLE_EXCERPT_LENGTH = 280;

/** A single parsed feed item — resolved pick source plus lightweight metadata. */
export interface BlogItem {
  title: string;
  link: string;
  /** Post publish date, when the feed provides one. */
  publishedAt?: Date;
  /** Category/tag terms — a strong hint for artist/track extraction. */
  tags: string[];
  /** Stable id for idempotent dedup (guid/id, else the link). */
  guid: string;
  /** Feed-provided byline, when available. */
  author?: string;
  /** Feed-provided article image URL, when available and safe. */
  imageUrl?: string;
  /** Short plain-text feed summary; full article content is never retained. */
  excerpt?: string;
}

/** Only absolute web links are safe to persist and render as publisher links. */
export function isSafeArticleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function firstTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]!) : undefined;
}

function attributeValue(markup: string, attribute: string): string | undefined {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = markup.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m ? decodeEntities(m[1]!) : undefined;
}

function allTags(block: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const v = decodeEntities(m[1]!);
    if (v) out.push(v);
  }
  return out;
}

/** Atom links carry the url in an href attribute, not as text. */
function atomLink(block: string): string | undefined {
  const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]!) : undefined;
}

function stripMarkup(value: string): string {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\s*(?:br|p|div|li|h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedText(value: string | undefined, maxLength: number): string | undefined {
  const text = value ? stripMarkup(value) : "";
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function itemAuthor(block: string): string | undefined {
  const rawCandidates = [
    firstTag(block, "dc:creator"),
    firstTag(block, "creator"),
    firstTag(block, "author"),
  ];
  for (const raw of rawCandidates) {
    if (!raw) continue;
    const nestedName = firstTag(raw, "name");
    const author = boundedText(nestedName ?? raw, MAX_ARTICLE_AUTHOR_LENGTH);
    if (author) return author;
  }
  return undefined;
}

function hasImageExtension(url: string): boolean {
  return /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(url);
}

function itemImageUrl(block: string): string | undefined {
  const mediaRe = /<media:(content|thumbnail)\b[^>]*>/gi;
  let mediaMatch: RegExpExecArray | null;
  while ((mediaMatch = mediaRe.exec(block))) {
    const markup = mediaMatch[0]!;
    const url = attributeValue(markup, "url");
    if (!url || !isSafeArticleUrl(url)) continue;
    if (
      mediaMatch[1]!.toLowerCase() === "thumbnail" ||
      attributeValue(markup, "medium")?.toLowerCase() === "image" ||
      attributeValue(markup, "type")?.toLowerCase().startsWith("image/") ||
      hasImageExtension(url)
    ) {
      return url;
    }
  }

  const enclosureRe = /<enclosure\b[^>]*>/gi;
  let enclosureMatch: RegExpExecArray | null;
  while ((enclosureMatch = enclosureRe.exec(block))) {
    const markup = enclosureMatch[0]!;
    const url = attributeValue(markup, "url");
    const type = attributeValue(markup, "type")?.toLowerCase();
    if (
      url &&
      isSafeArticleUrl(url) &&
      (type?.startsWith("image/") || hasImageExtension(url))
    ) {
      return url;
    }
  }

  const imageBlock = block.match(/<image\b[^>]*>[\s\S]*?<\/image>/i)?.[0];
  const nestedUrl = imageBlock ? firstTag(imageBlock, "url") : undefined;
  if (nestedUrl && isSafeArticleUrl(nestedUrl)) return nestedUrl;
  return undefined;
}

function toDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Pure: extract channel-level genre/category tags from an RSS or Atom feed.
 * These appear as `<category>` children of `<channel>` or `<feed>`, distinct
 * from the per-item categories. Values are lowercased and de-duped. Returns an
 * empty array for feeds with no channel categories.
 */
export function extractChannelTags(xml: string): string[] {
  // Strip item/entry blocks first so we don't pick up per-item categories.
  const channelXml = xml
    .replace(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi, "")
    .replace(/<(item|entry)\s*\/>/gi, "");
  const tags: string[] = [];
  const re = /<category[^>]*>([^<]+)<\/category>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(channelXml))) {
    const v = decodeEntities(m[1]!).toLowerCase().trim();
    if (v && !tags.includes(v)) tags.push(v);
  }
  return tags.slice(0, 30); // cap at 30 to keep tags column manageable
}

/**
 * Pure: parse an RSS or Atom feed body into BlogItem[]. Only lightweight
 * source metadata is kept; full article content is never retained.
 */
export function parseFeedItems(xml: string): BlogItem[] {
  const out: BlogItem[] = [];
  // RSS <item> and Atom <entry> both delimit one post.
  const re = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[2]!;
    const title = firstTag(block, "title");
    const link = firstTag(block, "link") || atomLink(block);
    if (!title || !link || !isSafeArticleUrl(link)) continue;
    const guid =
      firstTag(block, "guid") || firstTag(block, "id") || link;
    const publishedAt =
      toDate(firstTag(block, "pubDate")) ??
      toDate(firstTag(block, "published")) ??
      toDate(firstTag(block, "updated")) ??
      toDate(firstTag(block, "dc:date"));
    const tags = [
      ...allTags(block, "category"),
      ...allTags(block, "dc:subject"),
    ];
    const author = itemAuthor(block);
    const imageUrl = itemImageUrl(block);
    const excerpt = boundedText(
      firstTag(block, "description") ?? firstTag(block, "summary"),
      MAX_ARTICLE_EXCERPT_LENGTH,
    );
    out.push({
      title,
      link,
      tags,
      guid,
      ...(publishedAt ? { publishedAt } : {}),
      ...(author ? { author } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(excerpt ? { excerpt } : {}),
    });
  }
  return out;
}

/** An artist/track guess pulled from a post title (+ tags). */
export interface ArtistTrackGuess {
  artist: string;
  title: string;
}

// Common editorial prefixes stripped before parsing "Artist – Track".
// Covers the review/premiere conventions of the metal/jazz/experimental blogs
// in the roster (Decibel "Album Premiere:", NCS "AN NCS VIDEO PREMIERE:",
// The Obelisk "Album Review:", etc.).
const PREFIX_RE =
  /^\s*(an\s+ncs\s+(video\s+|audio\s+)?premiere|(track|song|album|video|ep|single|demo)\s+premiere|premiere|exclusive|listen|watch|video|new (music|track|song|video)|stream|full (album|ep) stream|(album|ep|demo|track|single)\s+review|review|song of the day|album of the week)\s*[:\-–—]\s*/i;

// Dash-family separators used between artist and title. Includes the tilde
// (A Closer Listen "Artist ~ Album") and double-colon (Aquarium Drunkard
// "Artist :: Title") house styles.
const DASH_RE = /\s+(?:[-–—~]|::)\s+/;

// Trailing review-suffix noise on the title side of a dash split — the house
// style of Angry Metal Guy / Last Rites ("Artist – Album Review").
const REVIEW_SUFFIX_RE = /\s+(album\s+|ep\s+|demo\s+)?review$/i;

// Trailing rating stars / half-stars (Free Jazz Collective "Album (Label, 2026) ****½").
const RATING_TAIL_RE = /[\s*½]+$/;

/**
 * Pure: best-effort artist/track extraction from a post title, with tags as a
 * fallback hint. Handles the dominant tastemaker headline shapes:
 *   - "Artist – "Track"" / "Artist — Track" / "Artist - Track"
 *   - "Premiere: Artist – Track" (editorial prefix stripped)
 *   - "Artist "Track"" (quoted track, no dash)
 * Returns null when no confident split exists — the caller then SKIPS the post
 * rather than guessing. Deliberately conservative: a wrong pick poisons the
 * spine, an omitted one costs nothing.
 */
export function extractArtistTrack(
  rawTitle: string,
  tags: string[] = [],
): ArtistTrackGuess | null {
  const trimmed = rawTitle.trim();
  const title = trimmed.replace(PREFIX_RE, "").trim();
  const prefixStripped = title !== trimmed;
  if (!title) return null;

  // Shape 1: Artist <dash> Track (optionally with the track quoted).
  const dash = title.match(DASH_RE);
  if (dash && dash.index != null) {
    const artist = title.slice(0, dash.index).trim();
    let track = title.slice(dash.index + dash[0].length).trim();
    const quoted = track.match(/[""'"]([^""'"]+)[""'"]/);
    if (quoted) track = quoted[1]!.trim();
    // Trailing rating stars ("Album (Label, 2026) ****½") are noise.
    track = track.replace(RATING_TAIL_RE, "").trim();
    // A trailing " (…)" annotation ("(Official Video)", "(Label, 2026)") is
    // noise, not a title.
    track = track.replace(/\s*[([][^)\]]*[)\]]\s*$/g, "").trim();
    // "Artist – Album Review" (AMG/Last Rites house style) — the trailing
    // "Review" is editorial, not part of the work's title.
    track = track.replace(REVIEW_SUFFIX_RE, "").trim();
    // If "review(s)" survives in the ARTIST side, this is a review headline
    // whose dash separates headline from blurb ("Gracie Abrams: X review –
    // bloodless anthems…", "DISGRUNTLED DAD REVIEWS…: BAND – ALBUM"), not
    // artist from title. Skip — never guess.
    const reviewishArtist = /\breviews?\b/i.test(artist);
    if (
      !reviewishArtist &&
      artist &&
      track &&
      artist.length <= 120 &&
      track.length <= 160
    ) {
      return { artist, title: track };
    }
  }

  // Shape 1b: "Album Review: Artist, Title" (The Obelisk house style). Only
  // attempted when an editorial prefix was actually stripped — a bare comma in
  // an arbitrary headline is far too weak a signal on its own.
  if (prefixStripped && !dash) {
    const comma = title.match(/^([^,]{1,120}),\s+(.{1,160})$/);
    if (comma) {
      const artist = comma[1]!.trim();
      let work = comma[2]!.trim();
      work = work.replace(/\s*[([][^)\]]*[)\]]\s*$/g, "").trim();
      // Multiple commas mean a sentence, not "Artist, Title" — skip.
      if (artist && work && !work.includes(",")) {
        return { artist, title: work };
      }
    }
  }

  // Shape 2: Artist "Track" — quoted track with the artist before it. The
  // artist portion must be name-like (<= 4 words): a longer run before the quote
  // is an editorial sentence ("Our review of the new single"), not an artist, so
  // we fall through to the tag hint rather than log a wrong pick.
  const quoted = title.match(/^(.+?)\s+[""'"]([^""'"]+)[""'"]/);
  if (quoted) {
    const artist = quoted[1]!.trim();
    const track = quoted[2]!.trim();
    if (artist && track && artist.split(/\s+/).length <= 4) {
      return { artist, title: track };
    }
  }

  // Shape 3: a single "artist" tag + a quoted track anywhere in the title.
  const artistTag = tags.find((t) => t && t.length <= 120);
  const anyQuoted = title.match(/[""'"]([^""'"]+)[""'"]/);
  if (artistTag && anyQuoted) {
    return { artist: artistTag.trim(), title: anyQuoted[1]!.trim() };
  }

  return null;
}

// --- List-candidate detection (stage 1 of the two-stage list pipeline) -----
//
// RSS answers "a list was published", not "what's on it". Posts that look like
// year-end / best-of / roundup features are flagged and queued for the
// separate extraction stage instead of being mis-parsed as one artist–track.
const LIST_TITLE_RES: RegExp[] = [
  /\b(top|best)\s+\d+\b/i,
  /\bbest\s+(albums|songs|tracks|records|releases|eps|reissues|metal|jazz)\b/i,
  /\b(albums|songs|tracks|records|releases|eps)\s+of\s+(the\s+year|the\s+month|the\s+week|20\d\d)\b/i,
  /\byear[- ]end\b/i,
  /\bmid[- ]?year\b/i,
  /\baoty\b/i,
  /\bmost\s+anticipated\b/i,
  /\brecord\(?s?\)?\s+o'?\s*the\s+month\b/i,
  /\bupcoming\b.{0,40}\breleases\b/i,
  /\broundup\b/i,
  // "Year in Music/Review/Albums 2024" — common editorial format (NME, Pitchfork)
  /\byear\s+in\s+(music|review|albums|songs|tracks|culture)\b/i,
  // "Albums/Songs/Tracks of 2024" without "the year" (Under the Radar, etc.)
  /\b(albums|songs|tracks|records|releases)\s+of\s+(?:19[5-9]\d|20[0-4]\d)\b/i,
];

const LIST_TAG_RES: RegExp[] = [
  /^lists?$/i,
  /year[- ]end/i,
  /best[- ]of/i,
];

/**
 * Pure: does this feed item look like a multi-entry list/feature post
 * (year-end list, best-of, weekly release roundup)? Such posts are queued for
 * the extraction stage rather than parsed as a single artist–track.
 */
export function isListCandidate(title: string, tags: string[] = []): boolean {
  const t = title.trim();
  if (LIST_TITLE_RES.some((re) => re.test(t))) return true;
  return tags.some((tag) => LIST_TAG_RES.some((re) => re.test(tag.trim())));
}

const FEED_TIMEOUT_MS = 10_000;
const DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * Candidate probe paths tried in order when `<link rel="alternate">` is absent.
 * Most blog platforms publish feeds at one of these conventional paths.
 */
const FEED_PROBE_PATHS = [
  "/feed",
  "/feed/",
  "/rss",
  "/rss.xml",
  "/atom.xml",
  "/index.xml",
  "/feed.xml",
];

/**
 * Auto-discover the RSS/Atom feed URL for a blog's home page.
 *
 * Strategy:
 *  1. Fetch the home page and parse `<link rel="alternate" type="application/rss+xml">`.
 *  2. If none found, probe the conventional paths above in order.
 *  3. Validate the first candidate by fetching it and confirming it contains at
 *     least one `<item>` or `<entry>` element.
 *
 * Returns the feed URL string, or `null` if no valid feed is found.
 * Never throws — errors are returned as null.
 */
export async function discoverFeedUrl(
  homeUrl: string,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DISCOVERY_TIMEOUT_MS;

  // ---- Step 1: fetch homepage and look for <link rel="alternate"> -----------
  let candidates: string[] = [];
  try {
    const res = await fetchFn(homeUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "text/html" },
    });
    if (res.ok) {
      const html = await res.text();
      candidates = extractFeedLinksFromHtml(html, homeUrl);
    }
  } catch {
    /* unreachable homepage — will fall through to probe paths */
  }

  // ---- Step 2: conventional probe paths (if no <link> found) ----------------
  if (candidates.length === 0) {
    let base: URL;
    try {
      base = new URL(homeUrl);
    } catch {
      return null;
    }
    for (const path of FEED_PROBE_PATHS) {
      candidates.push(`${base.protocol}//${base.hostname}${path}`);
    }
  }

  // ---- Step 3: validate each candidate ----------------------------------------
  for (const url of candidates) {
    const valid = await isFeedUrl(url, { fetchFn, timeoutMs });
    if (valid) return url;
  }
  return null;
}

/**
 * Pure: extract all RSS/Atom alternate link URLs from an HTML string.
 * Resolves relative hrefs against the supplied base URL.
 */
export function extractFeedLinksFromHtml(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  // Match <link ... rel="alternate" ... type="application/rss+xml" ...> (any attr order)
  const linkRe = /<link([^>]+)>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const attrs = m[1]!;
    const isAlt = /rel=["']alternate["']/i.test(attrs);
    const isRss =
      /type=["']application\/(rss|atom)\+xml["']/i.test(attrs) ||
      /type=["']text\/xml["']/i.test(attrs);
    if (!isAlt || !isRss) continue;
    const hrefM = attrs.match(/href=["']([^"']+)["']/i);
    if (!hrefM) continue;
    try {
      out.push(new URL(hrefM[1]!, baseUrl).href);
    } catch {
      /* skip malformed href */
    }
  }
  return out;
}

/**
 * Fetch a URL and return true if it looks like an RSS/Atom feed with at least
 * one item. Returns false on any error or if the body has no items.
 */
async function isFeedUrl(
  url: string,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  try {
    const res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/rss+xml, application/atom+xml, text/xml, */*" },
    });
    if (!res.ok) return false;
    const text = await res.text();
    return /<(item|entry)[\s>]/i.test(text);
  } catch {
    return false;
  }
}

export interface BlogIngestResult {
  pickerId: number;
  handle: string;
  name: string;
  items: number;
  matched: number;
  logged: number;
  /** Number of newly retained source articles. */
  inserted?: number;
  /** Retained for API compatibility; RSS ingestion no longer queues lists. */
  listCandidates: number;
  /**
   * Whether the feed fetch succeeded. False means the network/HTTP request
   * itself failed; the poller must treat this as a health failure.
   */
  success: boolean;
  /** Absolute URLs of every item link in the feed — used for cross-ref queueing. */
  feedLinks: string[];
}

/**
 * Ingest one blog feed: upsert its picker, fetch the feed, and log a pick per
 * post that yields a confident artist/track match. Never throws.
 */
export async function ingestBlogFeed(args: {
  feedUrl: string;
  name: string;
  homeUrl?: string;
}): Promise<BlogIngestResult> {
  const feedUrl = args.feedUrl.trim();
  if (!feedUrl) throw new Error("feedUrl is required");

  // Reuse the existing picker for this feed if one exists. Matching on the
  // feedUrl in sourceRef (not a slugified name) is what keeps a seeded picker
  // ("guardian-music") from silently forking into a name-derived duplicate
  // ("the-guardian-music") on every poll.
  // Deterministic when duplicates still exist pre-merge: prefer the active
  // row, then the oldest (canonical seeds have the lowest ids).
  const [existing] = await db
    .select()
    .from(pickersTable)
    .where(
      sql`${pickersTable.pickerType} = 'blog' AND ${pickersTable.sourceRef}->>'feedUrl' = ${feedUrl}`,
    )
    .orderBy(
      sql`${pickersTable.active} DESC, ${pickersTable.id} ASC`,
    )
    .limit(1);
  const picker =
    existing ??
    (await upsertPicker({
      pickerType: "blog",
      name: args.name,
      homeUrl: args.homeUrl ?? feedUrl,
      sourceRef: { feedUrl },
      trustTier: 2,
      description: `Championed tracks from ${args.name}.`,
    }));

  // eslint-disable-next-line no-useless-assignment
  let items: BlogItem[] = [];
  // eslint-disable-next-line no-useless-assignment
  let feedText = "";
  try {
    const res = await fetch(feedUrl, {
      headers: { Accept: "application/rss+xml, application/atom+xml, text/xml" },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    feedText = await res.text();
    items = parseFeedItems(feedText);
  } catch (err) {
    console.error("[lore] blog feed fetch failed", feedUrl, err);
    return {
      pickerId: picker.id,
      handle: picker.handle,
      name: args.name,
      items: 0,
      matched: 0,
      logged: 0,
      listCandidates: 0,
      success: false,
      feedLinks: [],
    };
  }

  // Derive channel-level genre tags from the feed and persist them to the picker.
  // This is best-effort: an empty tag list means the feed has no channel categories.
  const channelTags = extractChannelTags(feedText);
  if (channelTags.length > 0) {
    await db
      .update(pickersTable)
      .set({ tags: channelTags, updatedAt: new Date() })
      .where(eq(pickersTable.id, picker.id))
      .catch((e) =>
        console.error("[lore] blog: failed to write channel tags", feedUrl, e),
      );
  }

  let matched = 0;
  let inserted = 0;
  for (const item of items) {
    const guess = extractArtistTrack(item.title, item.tags);
    if (guess) matched++;
    const wrote = await db.insert(rssArticlesTable).values({
      pickerId: picker.id, guid: item.guid, url: item.link, title: item.title,
      publishedAt: item.publishedAt ?? null, tags: item.tags,
      matchedArtist: guess?.artist ?? null, matchedWork: guess?.title ?? null,
      author: item.author ?? null, imageUrl: item.imageUrl ?? null, excerpt: item.excerpt ?? null,
    }).onConflictDoNothing().returning({ id: rssArticlesTable.id });
    if (wrote.length) inserted++;
  }

  if (inserted > 0) {
    console.info(
      `[lore] blog ${args.name} retained ${inserted}/${items.length} article(s)`,
    );
  }

  return {
    pickerId: picker.id,
    handle: picker.handle,
    name: args.name,
    items: items.length,
    matched,
    logged: 0,
    inserted,
    listCandidates: 0,
    success: true,
    // All item links from the feed — the poller queues these for cross-ref
    // discovery so outbound links from post pages can surface new blog candidates.
    feedLinks: items.map((i) => i.link).filter(Boolean),
  };
}
