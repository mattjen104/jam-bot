import { parseFeedItems } from "./blog.js";
import { upsertPicker, persistPick } from "./picks.js";
import { db, pickersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Bandcamp Daily editorial picker.
 *
 * Bandcamp Daily is Bandcamp's in-house music publication: curated lists,
 * genre primers, and staff picks. Each article typically embeds several
 * Bandcamp players (album or track). We resolve those embedded track IDs to
 * artist+title via the EmbeddedPlayer page and feed them into the picks
 * pipeline.
 *
 * Pipeline:
 *   1. Fetch RSS → parse article list
 *   2. For new articles: fetch article HTML, extract embedded Bandcamp iframes
 *   3. For each iframe: parse album/track IDs from the embed src URL
 *   4. Fetch the EmbeddedPlayer page → extract artist+title from JSON payload
 *   5. Persist picks (resolved via MusicBrainz as usual; unresolved are stored
 *      honestly and backfilled later)
 *
 * Bandcamp-only tracks that don't resolve to a Spotify URI surface a
 * "Listen on Bandcamp →" link on the Song page instead of a play button.
 * No direct audio URL extraction — the embed iframe approach is used elsewhere
 * for legitimate embedding, but Lore's queue can only auto-advance Spotify-
 * backed tracks.
 */

export const BANDCAMP_DAILY_HANDLE = "bandcamp-daily";
const FEED_URL = "https://daily.bandcamp.com/index.rss";
const HOME_URL = "https://daily.bandcamp.com";
const FEED_TIMEOUT_MS = 15_000;
const EMBED_TIMEOUT_MS = 8_000;

// Bandcamp Daily publishes ~3–4 articles per week. 12-hour polling is ample.
const POLL_MS = 12 * 60 * 60 * 1000;
// Let heavier boot work settle first.
const WARMUP_MS = 150_000;

// Limits to stay polite — we fetch the EmbeddedPlayer page per track.
const MAX_ARTICLES_PER_SYNC = 4;
const MAX_TRACKS_PER_ARTICLE = 8;
const INTER_FETCH_DELAY_MS = 1_200;

let pollTimer: ReturnType<typeof setTimeout> | null = null;

// ---- Picker registration ----------------------------------------------------

export async function seedBandcampDailyPicker(): Promise<void> {
  await upsertPicker({
    pickerType: "editorial",
    name: "Bandcamp Daily",
    handle: BANDCAMP_DAILY_HANDLE,
    homeUrl: HOME_URL,
    trustTier: 2,
    description:
      "Bandcamp Daily — staff picks, genre primers, and curated lists from " +
      "Bandcamp's in-house editorial team. Reflects what independent artists " +
      "and labels are releasing right now.",
  });
}

// ---- RSS parsing ------------------------------------------------------------

interface ArticleMeta {
  guid: string;
  title: string;
  link: string;
  publishedAt: Date | null;
}

async function fetchArticleList(): Promise<ArticleMeta[]> {
  const res = await fetch(FEED_URL, {
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: { "User-Agent": `Lore Radio/1.0 (+${HOME_URL})` },
  });
  if (!res.ok) throw new Error(`Bandcamp Daily feed returned ${res.status}`);
  const xml = await res.text();
  const items = parseFeedItems(xml);
  return items.map((item) => ({
    guid: item.guid,
    title: item.title,
    link: item.link,
    publishedAt: item.publishedAt ?? null,
  }));
}

// ---- Embed extraction -------------------------------------------------------

interface EmbedRef {
  albumId: string;
  trackId: string | null;
  embedSrc: string;
}

/**
 * Parse Bandcamp EmbeddedPlayer iframe srcs from raw HTML.
 * Handles both `&amp;` and `&` in src attributes.
 */
export function parseEmbedRefs(html: string): EmbedRef[] {
  const out: EmbedRef[] = [];
  // Match iframe src pointing at bandcamp.com/EmbeddedPlayer
  const iframeRe =
    /src=["']?(https?:\/\/bandcamp\.com\/EmbeddedPlayer\/[^"'\s>]+)["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = iframeRe.exec(html)) && out.length < MAX_TRACKS_PER_ARTICLE) {
    const rawSrc = m[1]!.replace(/&amp;/g, "&");
    const albumMatch = /\balbum=(\d+)/.exec(rawSrc);
    const trackMatch = /\btrack=(\d+)/.exec(rawSrc);
    if (!albumMatch) continue;
    out.push({
      albumId: albumMatch[1]!,
      trackId: trackMatch ? trackMatch[1]! : null,
      embedSrc: rawSrc,
    });
  }
  return out;
}

// ---- Metadata extraction from EmbeddedPlayer page --------------------------

export interface EmbedMeta {
  artist: string;
  title: string;
  bandcampUrl: string | null;
}

/**
 * Fetch the EmbeddedPlayer page and extract artist + title from the JSON
 * payload Bandcamp inlines into the page (`var EmbedData = {...}`).
 * Returns null when the page is unavailable or the data can't be parsed.
 */
export async function fetchEmbedMeta(
  ref: EmbedRef,
): Promise<EmbedMeta | null> {
  try {
    const url = ref.trackId
      ? `https://bandcamp.com/EmbeddedPlayer/album=${ref.albumId}/track=${ref.trackId}/size=small/`
      : `https://bandcamp.com/EmbeddedPlayer/album=${ref.albumId}/size=small/`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      headers: { "User-Agent": `Lore Radio/1.0 (+${HOME_URL})` },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Strategy 1: var EmbedData = {...}; (or window.EmbedData)
    const embedDataMatch =
      /(?:var\s+EmbedData|window\.EmbedData)\s*=\s*(\{[\s\S]*?\});/.exec(html);
    if (embedDataMatch) {
      try {
        const data = JSON.parse(embedDataMatch[1]!) as Record<string, unknown>;
        const artist = asStr(data["artist"]);
        const title = asStr(data["title"]);
        const bandcampUrl = asStr(data["url"]);
        if (artist && title) return { artist, title, bandcampUrl };
      } catch {
        // fall through
      }
    }

    // Strategy 2: application/ld+json structured data
    const ldMatch = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (ldMatch) {
      try {
        const ld = JSON.parse(ldMatch[1]!) as Record<string, unknown>;
        const artist = asStr(ld["byArtist"]) || nestedStr(ld, "byArtist", "name");
        const title = asStr(ld["name"]);
        const bandcampUrl = asStr(ld["url"]);
        if (artist && title) return { artist, title, bandcampUrl };
      } catch {
        // fall through
      }
    }

    // Strategy 3: og:title "Track Title | Artist" + og:site_name / meta tags
    const ogTitleMatch = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/.exec(html);
    const ogUrlMatch = /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/.exec(html);
    if (ogTitleMatch) {
      const raw = decodeHtmlEntities(ogTitleMatch[1]!);
      // Common Bandcamp OG title shapes: "Track | Artist" or "Artist - Track"
      const pipeParts = raw.split(" | ");
      if (pipeParts.length >= 2) {
        const title = pipeParts[0]!.trim();
        const artist = pipeParts[1]!.trim();
        if (title && artist) {
          return {
            artist,
            title,
            bandcampUrl: ogUrlMatch ? decodeHtmlEntities(ogUrlMatch[1]!) : null,
          };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ---- Article sync -----------------------------------------------------------

async function getPickerRow() {
  const [row] = await db
    .select({ id: pickersTable.id, sourceRef: pickersTable.sourceRef })
    .from(pickersTable)
    .where(eq(pickersTable.handle, BANDCAMP_DAILY_HANDLE))
    .limit(1);
  return row ?? null;
}

async function markArticleSeen(
  pickerId: number,
  currentRef: Record<string, unknown> | null,
  guid: string,
): Promise<void> {
  const seen = new Set<string>(
    Array.isArray(currentRef?.["seen"]) ? (currentRef!["seen"] as string[]) : [],
  );
  seen.add(guid);
  // Keep at most the last 200 guids to bound the ledger size.
  const trimmed = [...seen].slice(-200);
  await db
    .update(pickersTable)
    .set({ sourceRef: { seen: trimmed } })
    .where(eq(pickersTable.id, pickerId));
}

async function syncArticle(
  article: ArticleMeta,
  pickerId: number,
): Promise<void> {
  // Fetch the article HTML to extract embedded players.
  let html: string;
  try {
    const res = await fetch(article.link, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: { "User-Agent": `Lore Radio/1.0 (+${HOME_URL})` },
    });
    if (!res.ok) {
      console.warn(`[bandcamp-daily] article fetch failed ${res.status}: ${article.link}`);
      return;
    }
    html = await res.text();
  } catch (err) {
    console.warn(`[bandcamp-daily] article fetch error: ${article.link}`, err);
    return;
  }

  const refs = parseEmbedRefs(html);
  if (refs.length === 0) {
    console.log(`[bandcamp-daily] no embeds found in: ${article.title}`);
    return;
  }

  console.log(
    `[bandcamp-daily] "${article.title}" → ${refs.length} embed(s)`,
  );

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!;
    if (i > 0) await delay(INTER_FETCH_DELAY_MS);

    const meta = await fetchEmbedMeta(ref);
    if (!meta) {
      console.log(`[bandcamp-daily] could not extract metadata for embed ${i + 1}`);
      continue;
    }

    const externalId = `${article.guid}::album=${ref.albumId}${ref.trackId ? `::track=${ref.trackId}` : ""}`;

    await persistPick({
      pickerId,
      source: "blog_post",
      rawArtist: meta.artist,
      rawTitle: meta.title,
      context: article.title,
      sourceUrl: article.link,
      externalId,
      pickedAt: article.publishedAt ?? undefined,
    });
  }
}

// ---- Poller -----------------------------------------------------------------

async function sync(): Promise<void> {
  const picker = await getPickerRow();
  if (!picker) {
    console.warn("[bandcamp-daily] picker row missing — skipping sync");
    return;
  }

  let articles: ArticleMeta[];
  try {
    articles = await fetchArticleList();
  } catch (err) {
    console.error("[bandcamp-daily] RSS fetch failed", err);
    return;
  }

  const seenSet = new Set<string>(
    Array.isArray(picker.sourceRef?.["seen"])
      ? (picker.sourceRef!["seen"] as string[])
      : [],
  );

  const unseen = articles.filter((a) => !seenSet.has(a.guid));
  const batch = unseen.slice(0, MAX_ARTICLES_PER_SYNC);

  if (batch.length === 0) {
    console.log("[bandcamp-daily] nothing new");
    return;
  }

  console.log(`[bandcamp-daily] syncing ${batch.length} new article(s)`);

  for (const article of batch) {
    await syncArticle(article, picker.id);
    await markArticleSeen(picker.id, picker.sourceRef as Record<string, unknown> | null, article.guid);
    await delay(INTER_FETCH_DELAY_MS * 2);
  }
}

export function startBandcampDailyPoller(): void {
  const run = async () => {
    try {
      await sync();
    } catch (err) {
      console.error("[bandcamp-daily] poller error", err);
    } finally {
      pollTimer = setTimeout(run, POLL_MS);
    }
  };
  pollTimer = setTimeout(run, WARMUP_MS);
  console.log(
    `[bandcamp-daily] poller scheduled (warmup ${WARMUP_MS / 1000}s, interval ${POLL_MS / 3600000}h)`,
  );
}

export function stopBandcampDailyPoller(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

// ---- Helpers ----------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function nestedStr(
  obj: Record<string, unknown>,
  key: string,
  prop: string,
): string {
  const nested = obj[key];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return asStr((nested as Record<string, unknown>)[prop]);
  }
  return "";
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
