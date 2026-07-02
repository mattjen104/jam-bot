import { upsertPicker, persistPick } from "./picks.js";

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

/** A single parsed feed item — resolved pick source only, never body text. */
export interface BlogItem {
  title: string;
  link: string;
  /** Post publish date, when the feed provides one. */
  publishedAt?: Date;
  /** Category/tag terms — a strong hint for artist/track extraction. */
  tags: string[];
  /** Stable id for idempotent dedup (guid/id, else the link). */
  guid: string;
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

function toDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Pure: parse an RSS or Atom feed body into BlogItem[]. Only the fields needed
 * to make + link a pick are kept (title, link, date, tags, id) — the body/
 * content is never read, so no article text is ever stored.
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
    if (!title || !link) continue;
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
    out.push({
      title,
      link,
      tags,
      guid,
      ...(publishedAt ? { publishedAt } : {}),
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
const PREFIX_RE =
  /^\s*(premiere|exclusive|listen|watch|video|track premiere|song premiere|new (music|track|song|video)|stream)\s*[:\-–—]\s*/i;

// Dash-family separators used between artist and title.
const DASH_RE = /\s+[\-–—]\s+/;

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
  let title = rawTitle.trim().replace(PREFIX_RE, "").trim();
  if (!title) return null;

  // Shape 1: Artist <dash> Track (optionally with the track quoted).
  const dash = title.match(DASH_RE);
  if (dash && dash.index != null) {
    const artist = title.slice(0, dash.index).trim();
    let track = title.slice(dash.index + dash[0].length).trim();
    const quoted = track.match(/[""'"]([^""'"]+)[""'"]/);
    if (quoted) track = quoted[1]!.trim();
    // A trailing " (…)" annotation ("(Official Video)") is noise, not a title.
    track = track.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/g, "").trim();
    if (artist && track && artist.length <= 120 && track.length <= 160) {
      return { artist, title: track };
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

const FEED_TIMEOUT_MS = 10_000;

export interface BlogIngestResult {
  pickerId: number;
  handle: string;
  name: string;
  items: number;
  matched: number;
  logged: number;
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

  const picker = await upsertPicker({
    pickerType: "blog",
    name: args.name,
    homeUrl: args.homeUrl ?? feedUrl,
    sourceRef: { feedUrl },
    trustTier: 2,
    description: `Championed tracks from ${args.name}.`,
  });

  let items: BlogItem[] = [];
  try {
    const res = await fetch(feedUrl, {
      headers: { Accept: "application/rss+xml, application/atom+xml, text/xml" },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    items = parseFeedItems(await res.text());
  } catch (err) {
    console.error("[lore] blog feed fetch failed", feedUrl, err);
    return {
      pickerId: picker.id,
      handle: picker.handle,
      name: args.name,
      items: 0,
      matched: 0,
      logged: 0,
    };
  }

  let matched = 0;
  let logged = 0;
  for (const item of items) {
    const guess = extractArtistTrack(item.title, item.tags);
    if (!guess) continue; // No confident match — skip, never guess.
    matched++;
    const { logged: wrote } = await persistPick({
      pickerId: picker.id,
      source: "blog_post",
      rawArtist: guess.artist,
      rawTitle: guess.title,
      sourceUrl: item.link,
      context: item.title,
      externalId: `blog:${item.guid}`,
      ...(item.publishedAt ? { pickedAt: item.publishedAt } : {}),
    });
    if (wrote) logged++;
  }

  if (logged > 0) {
    console.info(
      `[lore] blog ${args.name} logged ${logged}/${matched} matched pick(s) from ${items.length} post(s)`,
    );
  }

  return {
    pickerId: picker.id,
    handle: picker.handle,
    name: args.name,
    items: items.length,
    matched,
    logged,
  };
}
