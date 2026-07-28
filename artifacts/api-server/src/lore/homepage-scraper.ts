import { db, stationsTable } from "@workspace/db";
import { and, eq, isNotNull, lt, or, isNull, sql } from "drizzle-orm";
import { isCrawlBlocked } from "./blog-crossref.js";

/**
 * Best-effort station-homepage scraper. Stations only carry a homepage *URL*
 * (radio-browser has no description field), so a short blurb — good for
 * letting listeners preview a station before tuning in — has to be pulled
 * from the page itself. Deliberately the smallest thing that works: one
 * slow, self-rescheduling loop that visits a handful of stale homepages per
 * tick, respects robots.txt, and never fabricates a blurb when the fetch or
 * parse comes up empty. Never blocks the dial, never retried aggressively —
 * homepages change on the order of months, not minutes.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BLURB_LEN = 280;
// Re-scrape cadence: a homepage that hasn't been (re)scraped in 30 days is
// eligible again. New stations (homepageScrapedAt null) are always eligible.
const RESCRAPE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
// Small batch per tick so one pass over ~600 stations spreads out gently
// instead of bursting dozens of outbound fetches at once.
const BATCH_SIZE = 5;
const TICK_MS = 20_000;
// Let boot-time work (seeding, pollers) settle before the first scrape.
const WARMUP_MS = 90_000;

interface ScrapeTarget {
  id: number;
  slug: string;
  homepageUrl: string;
}

async function loadStaleTargets(limit: number): Promise<ScrapeTarget[]> {
  const cutoff = new Date(Date.now() - RESCRAPE_AFTER_MS);
  const rows = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      homepageUrl: stationsTable.homepageUrl,
    })
    .from(stationsTable)
    .where(
      and(
        eq(stationsTable.active, true),
        eq(stationsTable.hidden, false),
        isNotNull(stationsTable.homepageUrl),
        or(
          isNull(stationsTable.homepageScrapedAt),
          lt(stationsTable.homepageScrapedAt, cutoff),
        ),
      ),
    )
    .orderBy(sql`${stationsTable.homepageScrapedAt} asc nulls first`)
    .limit(limit);

  return rows
    .filter((r): r is ScrapeTarget => Boolean(r.homepageUrl))
    .map((r) => ({ id: r.id, slug: r.slug, homepageUrl: r.homepageUrl! }));
}

/**
 * Scan the homepage HTML for a donate / support / membership link.
 * Pure, no I/O. Resolves relative hrefs against `baseUrl`.
 *
 * Strategy (prefer specificity over recall to reduce false positives):
 *   1. Exact-path keyword in href (`/donate`, `/support`, `/membership`,
 *      `/pledge`, `/give`, `/contribute`, `/sustain`, `/fund`).
 *   2. Link-text keyword match when the href at least starts with http/https
 *      and is not an anchor-only `#…` href.
 * Anchor-only hrefs (`#…`) are always skipped.
 */
export function extractDonateLink(
  html: string,
  baseUrl: string,
): string | null {
  // Keywords for href path matching (exact path segment match, lowercase).
  const hrefPathKeywords =
    /\/(donate|support|membership|pledge|give|contribute|sustain|fund)(\/|$|\?|#)/i;
  // Keywords for link-text matching (looser — only used as a fallback).
  const textKeywords =
    /\b(donate|support|membership|pledge|contribute|sustain|give|fund)\b/i;

  // Extract all <a href="...">...</a> pairs from the HTML.
  // We only need href and the text content between the tags.
  const anchorRe = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let hrefFallback: string | null = null;

  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const rawHref = match[1].trim();
    // Skip anchor-only hrefs.
    if (rawHref.startsWith("#")) continue;

    // Resolve to an absolute URL (relative paths are common on homepages).
    let resolved: string;
    try {
      resolved = new URL(rawHref, baseUrl).href;
    } catch {
      continue;
    }
    // Only accept http(s) links.
    if (!/^https?:\/\//i.test(resolved)) continue;

    // Tier 1: path-based match — strongest signal, return immediately.
    const parsedPath = (() => {
      try {
        return new URL(resolved).pathname;
      } catch {
        return "";
      }
    })();
    if (hrefPathKeywords.test(parsedPath)) return resolved;

    // Tier 2: link-text match — store the first candidate and keep scanning
    // in case a tier-1 hit appears later.
    if (hrefFallback === null) {
      const linkText = match[2].replace(/<[^>]*>/g, " ").trim();
      if (textKeywords.test(linkText)) {
        hrefFallback = resolved;
      }
    }
  }

  return hrefFallback;
}

/** Pull a title/meta-description-sized excerpt out of raw HTML. Pure, no I/O. */
export function extractBlurb(html: string): string | null {
  // Prefer an explicit meta description — it's the site's own summary.
  const metaMatch =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ) ??
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    ) ??
    html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    );

  const raw = metaMatch?.[1];
  const cleaned = decodeEntities(raw ?? "").trim();
  if (cleaned) return cleaned.slice(0, MAX_BLURB_LEN);

  // Fall back to <title> — thinner, but still real, first-party text.
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = decodeEntities(titleMatch?.[1] ?? "").trim();
  return title ? title.slice(0, MAX_BLURB_LEN) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Scrape one station's homepage. Never throws — always writes
 * homepageScrapedAt (so the cadence advances even on failure/robots-block),
 * and only writes homepageBlurb when a real excerpt was found. A failed or
 * blocked scrape leaves any previously-scraped blurb in place rather than
 * clobbering it with nothing.
 */
export async function scrapeStationHomepage(
  target: ScrapeTarget,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<{ scraped: boolean; blocked: boolean }> {
  const fetchFn = opts.fetchFn ?? fetch;
  let origin: string;
  try {
    origin = new URL(target.homepageUrl).origin;
  } catch {
    // Malformed homepage URL — mark attempted so it isn't retried every tick.
    await db
      .update(stationsTable)
      .set({ homepageScrapedAt: new Date() })
      .where(eq(stationsTable.id, target.id));
    return { scraped: false, blocked: false };
  }

  const blocked = await isCrawlBlocked(origin, { fetchFn });
  if (blocked) {
    console.info(`[homepage-scraper] robots.txt blocks ${target.slug} (${origin})`);
    await db
      .update(stationsTable)
      .set({ homepageScrapedAt: new Date() })
      .where(eq(stationsTable.id, target.id));
    return { scraped: false, blocked: true };
  }

  try {
    const res = await fetchFn(target.homepageUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Lore-Discovery-Bot/1.0",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      await db
        .update(stationsTable)
        .set({ homepageScrapedAt: new Date() })
        .where(eq(stationsTable.id, target.id));
      return { scraped: false, blocked: false };
    }
    const html = await res.text();
    const blurb = extractBlurb(html);
    const donateLink = extractDonateLink(html, target.homepageUrl);

    // Write blurb unconditionally (overwriting stale text is fine).
    // Write donate_url only when the DB value is currently null — manual
    // entries must never be clobbered.
    await db
      .update(stationsTable)
      .set({
        ...(blurb ? { homepageBlurb: blurb } : {}),
        homepageScrapedAt: new Date(),
      })
      .where(eq(stationsTable.id, target.id));

    if (donateLink) {
      const updated = await db
        .update(stationsTable)
        .set({ donateUrl: donateLink })
        .where(
          and(eq(stationsTable.id, target.id), isNull(stationsTable.donateUrl)),
        )
        .returning({ id: stationsTable.id });
      if (updated.length > 0) {
        console.info(
          `[homepage-scraper] donate link found for ${target.slug}: ${donateLink}`,
        );
      }
    }

    return { scraped: Boolean(blurb), blocked: false };
  } catch (err) {
    console.warn(`[homepage-scraper] fetch failed for ${target.slug}`, err);
    await db
      .update(stationsTable)
      .set({ homepageScrapedAt: new Date() })
      .where(eq(stationsTable.id, target.id));
    return { scraped: false, blocked: false };
  }
}

let started = false;
let timer: NodeJS.Timeout | null = null;

/**
 * OPERATOR NOTE — force an immediate donate-link back-fill pass:
 *
 * The scraper only visits stations whose `homepage_scraped_at` is null or
 * older than 30 days. To force every station that currently lacks a
 * `donate_url` to be re-scraped right away (without waiting for the normal
 * 30-day cadence), run:
 *
 *   UPDATE stations
 *   SET    homepage_scraped_at = NULL
 *   WHERE  donate_url IS NULL
 *     AND  active = true
 *     AND  hidden = false
 *     AND  homepage_url IS NOT NULL;
 *
 * The scraper loop will pick them up in batches of 5 every 20 s.
 * No other changes are needed — `donate_url` writes are conditional on the
 * column being NULL, so manually-curated entries are safe.
 */

/** Start the homepage-scraper loop. Idempotent — safe to call once at boot. */
export function startHomepageScraper(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const targets = await loadStaleTargets(BATCH_SIZE);
      for (const target of targets) {
        await scrapeStationHomepage(target);
      }
    } catch (err) {
      console.error("[lore] homepage scraper tick failed", err);
    }
    timer = setTimeout(tick, TICK_MS);
  };
  timer = setTimeout(tick, WARMUP_MS);
}

/** Stop the homepage scraper (tests / graceful shutdown). */
export function stopHomepageScraper(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}
