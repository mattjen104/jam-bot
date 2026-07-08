import { db, pickersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { discoverFeedUrl, extractFeedLinksFromHtml } from "./blog.js";
import { slugify } from "./picks.js";

/**
 * Cross-reference discovery module.
 *
 * After a blog feed is ingested, its post page URLs are queued here for HTML
 * scraping. The scraper fetches each post page, extracts outbound `<a href>`
 * links to unknown external domains, and runs RSS feed auto-discovery on each
 * new domain. Discovered feeds are inserted as inactive longtail pickers
 * awaiting human review.
 *
 * Constraints:
 *  - Only depth-1 hops (from post page to external domain; no recursive crawl).
 *  - Rate-limited: at most 1 post-page fetch every 2 seconds.
 *  - Respects robots.txt: checks `Disallow: /` for `User-agent: *` before
 *    fetching any page on a new domain.
 *  - Duplicate domains (already in pickers or already queued) are skipped.
 *  - No body text is stored at any stage.
 */

const FETCH_INTERVAL_MS = 2_000;
const ROBOTS_TIMEOUT_MS = 5_000;
const PAGE_TIMEOUT_MS = 10_000;
const DISCOVERY_TIMEOUT_MS = 12_000;

/** Post page URLs waiting to be scraped for outbound links. */
let postQueue: string[] = [];
/** Domains already discovered this session (prevents duplicate probes). */
const seenDomains = new Set<string>();
let drainTimer: NodeJS.Timeout | null = null;

/** Extract the eTLD+1 hostname from a URL string. Returns null on error. */
export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Extract unique absolute HTTP/HTTPS outbound link origins (scheme + hostname)
 * from an HTML blob, excluding the source domain.
 *
 * @param html         Raw HTML of the page.
 * @param baseUrl      URL of the page (used to resolve relative hrefs).
 * @param sourceDomain Hostname of the blog post — self-links are excluded.
 */
export function extractOutboundLinks(
  html: string,
  baseUrl: string,
  sourceDomain: string,
): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  const re = /href=["']([^"'#?]{4,}?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const abs = new URL(m[1]!, base);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (abs.hostname === sourceDomain) continue; // self-link
      const origin = abs.origin; // "https://example.com"
      if (!seen.has(origin)) {
        seen.add(origin);
        out.push(origin);
      }
    } catch {
      /* malformed href — skip */
    }
  }
  return out;
}

/**
 * Returns true if the site's robots.txt explicitly disallows all crawling
 * for `User-agent: *`. Fails open (returns false) on any fetch error.
 */
export async function isCrawlBlocked(
  siteOrigin: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const robotsUrl = `${siteOrigin}/robots.txt`;
    const res = await fetchFn(robotsUrl, {
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      headers: { "User-Agent": "Lore-Discovery-Bot/1.0" },
    });
    if (!res.ok) return false;
    return isBlockedByRobots(await res.text());
  } catch {
    return false;
  }
}

/**
 * Pure: parse robots.txt and return true if `User-agent: *` has `Disallow: /`.
 */
export function isBlockedByRobots(robotsTxt: string): boolean {
  let inStarBlock = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      inStarBlock = value === "*";
    } else if (inStarBlock && key === "disallow" && value === "/") {
      return true;
    }
  }
  return false;
}

/**
 * Drain one post URL from the queue:
 *  1. Fetch the post page HTML.
 *  2. Extract outbound links to external domains.
 *  3. For each new domain: check robots.txt, run feed discovery.
 *  4. Upsert an inactive picker for any discovered feed.
 */
async function drainOne(opts: { fetchFn?: typeof fetch } = {}): Promise<void> {
  const postUrl = postQueue.shift();
  if (!postUrl) return;

  const sourceDomain = extractDomain(postUrl);
  if (!sourceDomain) return;

  const fetchFn = opts.fetchFn ?? fetch;

  let html = "";
  try {
    const res = await fetchFn(postUrl, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: { Accept: "text/html", "User-Agent": "Lore-Discovery-Bot/1.0" },
    });
    if (!res.ok) return;
    html = await res.text();
  } catch {
    return; // unreachable post — silently skip
  }

  const origins = extractOutboundLinks(html, postUrl, sourceDomain);

  for (const origin of origins) {
    const domain = extractDomain(origin);
    if (!domain || seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    try {
      const blocked = await isCrawlBlocked(origin, { fetchFn });
      if (blocked) {
        console.info(`[crossref] robots.txt blocks ${domain} — skipping`);
        continue;
      }

      const feedUrl = await discoverFeedUrl(origin, {
        fetchFn,
        timeoutMs: DISCOVERY_TIMEOUT_MS,
      });
      if (!feedUrl) continue;

      // Only insert if a picker for this handle doesn't already exist.
      const handle = slugify(domain);
      if (!handle) continue;
      const existing = await db
        .select({ id: pickersTable.id })
        .from(pickersTable)
        .where(eq(pickersTable.handle, handle))
        .limit(1);
      if (existing.length > 0) continue;

      await db
        .insert(pickersTable)
        .values({
          pickerType: "blog",
          name: domain,
          handle,
          homeUrl: origin,
          sourceRef: { feedUrl },
          trustTier: 2,
          active: false,
          description: `Cross-reference candidate discovered from blog outbound links.`,
        })
        .onConflictDoNothing({ target: pickersTable.handle });

      console.info(`[crossref] queued new candidate: ${domain} (${feedUrl})`);
    } catch (err) {
      console.error(`[crossref] discovery failed for ${domain}`, err);
    }
  }
}

function scheduleDrain(opts: { fetchFn?: typeof fetch } = {}): void {
  if (drainTimer !== null || postQueue.length === 0) return;
  drainTimer = setTimeout(async () => {
    drainTimer = null;
    await drainOne(opts);
    if (postQueue.length > 0) scheduleDrain(opts);
  }, FETCH_INTERVAL_MS);
}

/**
 * Queue a set of blog post URLs for cross-reference discovery. Deduplicates
 * by post hostname against already-seen domains so the same blog isn't queued
 * multiple times.
 *
 * @param postUrls     Absolute blog post page URLs (e.g. from parsed feed items).
 * @param sourceDomain Domain we are already tracking — post URLs from it will
 *                     still be fetched to extract THEIR outbound links.
 */
export function queueCrossRefDiscovery(
  postUrls: string[],
  sourceDomain: string,
  opts: { fetchFn?: typeof fetch } = {},
): void {
  for (const url of postUrls) {
    const domain = extractDomain(url);
    if (!domain) continue;
    // We DO queue the source domain's own post pages — we want to read their
    // outbound links. Dedup by full URL (not domain) to avoid re-scraping the
    // same post.
    if (!postQueue.includes(url)) {
      postQueue.push(url);
    }
  }
  scheduleDrain(opts);
}

/** Reset queue and state (for tests). */
export function resetCrossRefQueue(): void {
  postQueue = [];
  seenDomains.clear();
  if (drainTimer !== null) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
}
