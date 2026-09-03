import { db, stationsTable } from "@workspace/db";
import { and, eq, isNotNull, lt, or, isNull, sql, inArray } from "drizzle-orm";
import { isBlockedByRobots } from "./blog-crossref.js";

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
const MAX_LOGO_BYTES = 2_000_000;
const MAX_HOMEPAGE_BYTES = 2_000_000;
const MAX_ROBOTS_BYTES = 256_000;
const MAX_MANIFEST_BYTES = 500_000;
const MAX_LOGO_CANDIDATES = 8;
/** The largest home mark is 58 CSS px; 112+ px stays crisp at roughly 2x. */
export const MIN_STATION_LOGO_SIDE = 112;
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
  logoSource?: string | null;
}

export interface StationLogoCandidate {
  url: string;
  kind: "structured" | "image" | "manifest" | "apple-touch" | "icon" | "social";
  priority: number;
  declaredWidth: number | null;
  declaredHeight: number | null;
}

export interface StationLogoResult {
  url: string;
  width: number | null;
  height: number | null;
  vector: boolean;
}

type SafeUrlFn = (url: string) => boolean | Promise<boolean>;
type RobotsBlockedFn = (
  origin: string,
  fetchFn: typeof fetch,
  safeUrl: SafeUrlFn,
) => Promise<boolean>;

async function loadStaleTargets(limit: number): Promise<ScrapeTarget[]> {
  const cutoff = new Date(Date.now() - RESCRAPE_AFTER_MS);
  const rows = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      homepageUrl: stationsTable.homepageUrl,
      logoSource: stationsTable.logoSource,
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
          isNull(stationsTable.logoCheckedAt),
          lt(stationsTable.logoCheckedAt, cutoff),
          isNull(stationsTable.storeCheckedAt),
          lt(stationsTable.storeCheckedAt, cutoff),
        ),
      ),
    )
    .orderBy(
      sql`least(${stationsTable.homepageScrapedAt}, ${stationsTable.logoCheckedAt}) asc nulls first`,
    )
    .limit(limit);

  return rows
    .filter((r): r is typeof r & { homepageUrl: string } => Boolean(r.homepageUrl))
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      homepageUrl: r.homepageUrl!,
      logoSource: r.logoSource,
    }));
}

function tagAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([:\w-]+)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag)) !== null) {
    attrs.set(match[1]!.toLowerCase(), match[3]!.trim());
  }
  return attrs;
}

function resolveHttpUrl(raw: string | null | undefined, baseUrl: string): string | null {
  if (!raw || raw.startsWith("data:")) return null;
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function declaredSize(raw: string | undefined): { width: number | null; height: number | null } {
  if (!raw) return { width: null, height: null };
  const sizes = [...raw.matchAll(/(\d+)x(\d+)/gi)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))
    .filter((size) => Number.isFinite(size.width) && Number.isFinite(size.height));
  if (sizes.length === 0) return { width: null, height: null };
  return sizes.sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
}

function candidate(
  rawUrl: string | null | undefined,
  baseUrl: string,
  kind: StationLogoCandidate["kind"],
  priority: number,
  size: { width: number | null; height: number | null } = {
    width: null,
    height: null,
  },
): StationLogoCandidate | null {
  const url = resolveHttpUrl(rawUrl, baseUrl);
  if (!url) return null;
  return {
    url,
    kind,
    priority,
    declaredWidth: size.width,
    declaredHeight: size.height,
  };
}

function dedupeCandidates(candidates: StationLogoCandidate[]): StationLogoCandidate[] {
  const byUrl = new Map<string, StationLogoCandidate>();
  for (const entry of candidates) {
    const existing = byUrl.get(entry.url);
    if (!existing || entry.priority > existing.priority) byUrl.set(entry.url, entry);
  }
  return [...byUrl.values()].sort((a, b) => b.priority - a.priority);
}

/**
 * Extract logo-like assets explicitly declared by the official station page.
 * Pure and deliberately conservative: generic page imagery is ignored.
 */
export function extractStationLogoCandidates(
  html: string,
  baseUrl: string,
): StationLogoCandidate[] {
  const found: StationLogoCandidate[] = [];

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = tagAttributes(match[0]);
    const rel = (attrs.get("rel") ?? "").toLowerCase();
    if (!rel.includes("icon")) continue;
    const size = declaredSize(attrs.get("sizes"));
    const isApple = rel.includes("apple-touch");
    const entry = candidate(
      attrs.get("href"),
      baseUrl,
      isApple ? "apple-touch" : "icon",
      isApple ? 700 : 620,
      size,
    );
    if (entry) found.push(entry);
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = tagAttributes(match[0]);
    const signal = [
      attrs.get("alt"),
      attrs.get("class"),
      attrs.get("id"),
      attrs.get("itemprop"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!/\b(logo|brand|station-mark)\b/.test(signal)) continue;
    const entry = candidate(
      attrs.get("src") ?? attrs.get("data-src"),
      baseUrl,
      "image",
      820,
      {
        width: Number(attrs.get("width")) || null,
        height: Number(attrs.get("height")) || null,
      },
    );
    if (entry) found.push(entry);
  }

  for (const match of html.matchAll(
    /<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi,
  )) {
    const attrs = tagAttributes(match[0]);
    const entry = candidate(attrs.get("content"), baseUrl, "social", 250);
    if (entry) found.push(entry);
  }

  for (const match of html.matchAll(/"logo"\s*:\s*"([^"]+)"/gi)) {
    const entry = candidate(match[1], baseUrl, "structured", 900);
    if (entry) found.push(entry);
  }

  return dedupeCandidates(found);
}

export function extractManifestUrl(html: string, baseUrl: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = tagAttributes(match[0]);
    if (!(attrs.get("rel") ?? "").toLowerCase().split(/\s+/).includes("manifest")) continue;
    return resolveHttpUrl(attrs.get("href"), baseUrl);
  }
  return null;
}

export function extractManifestLogoCandidates(
  manifest: unknown,
  manifestUrl: string,
): StationLogoCandidate[] {
  if (!manifest || typeof manifest !== "object") return [];
  const icons = (manifest as { icons?: unknown }).icons;
  if (!Array.isArray(icons)) return [];
  return dedupeCandidates(
    icons.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const icon = raw as { src?: unknown; sizes?: unknown };
      const entry = candidate(
        typeof icon.src === "string" ? icon.src : null,
        manifestUrl,
        "manifest",
        760,
        declaredSize(typeof icon.sizes === "string" ? icon.sizes : undefined),
      );
      return entry ? [entry] : [];
    }),
  );
}

function pngDimensions(data: Buffer): { width: number; height: number } | null {
  if (
    data.length < 33 ||
    data.readUInt32BE(0) !== 0x89504e47 ||
    data.readUInt32BE(4) !== 0x0d0a1a0a ||
    data.readUInt32BE(8) !== 13 ||
    data.subarray(12, 16).toString() !== "IHDR"
  ) {
    return null;
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function jpegDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = data[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        width: data.readUInt16BE(offset + 7),
        height: data.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  return null;
}

/** Read dimensions from common station-logo raster formats without image deps. */
export function readStationLogoDimensions(
  data: Buffer,
  contentType: string,
): { width: number; height: number } | null {
  const png = pngDimensions(data);
  if (png) return png;
  const jpeg = jpegDimensions(data);
  if (jpeg) return jpeg;

  const normalized = contentType.toLowerCase();
  if (
    normalized.includes("gif") &&
    data.length >= 13 &&
    (data.subarray(0, 6).toString() === "GIF87a" ||
      data.subarray(0, 6).toString() === "GIF89a")
  ) {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }

  if (
    (normalized.includes("icon") || normalized.includes("ico")) &&
    data.length >= 22 &&
    data.readUInt16LE(0) === 0 &&
    data.readUInt16LE(2) === 1
  ) {
    const count = Math.min(data.readUInt16LE(4), 64);
    let width = 0;
    let height = 0;
    for (let index = 0; index < count; index++) {
      const offset = 6 + index * 16;
      if (offset + 16 > data.length) break;
      width = Math.max(width, data[offset] || 256);
      height = Math.max(height, data[offset + 1] || 256);
    }
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (
    data.length >= 30 &&
    data.subarray(0, 4).toString() === "RIFF" &&
    data.readUInt32LE(4) + 8 <= data.length &&
    data.subarray(8, 12).toString() === "WEBP" &&
    data.subarray(12, 16).toString() === "VP8X"
  ) {
    return {
      width: 1 + data.readUIntLE(24, 3),
      height: 1 + data.readUIntLE(27, 3),
    };
  }

  return null;
}

async function defaultSafeUrl(url: string): Promise<boolean> {
  const { isSafeArtworkUrl } = await import("./share.js");
  return isSafeArtworkUrl(url);
}

import { STATION_NETWORK_USER_AGENT } from "./network-policy.js";

async function fetchSafe(
  url: string,
  fetchFn: typeof fetch,
  safeUrl: SafeUrlFn,
  accept: string,
): Promise<{ response: Awaited<ReturnType<typeof fetch>>; finalUrl: string } | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await safeUrl(current))) return null;
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetchFn(current, {
        headers: { Accept: accept, "User-Agent": STATION_NETWORK_USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, current).href;
      continue;
    }
    return response.ok ? { response, finalUrl: current } : null;
  }
  return null;
}

async function readBoundedResponse(
  response: Awaited<ReturnType<typeof fetch>>,
  maxBytes: number,
): Promise<Buffer | null> {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const reader = response.body?.getReader?.();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } catch {
      return null;
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  }

  // Lightweight unit-test doubles do not expose a ReadableStream.
  if (typeof response.arrayBuffer === "function") {
    const data = Buffer.from(await response.arrayBuffer());
    return data.length <= maxBytes ? data : null;
  }
  if (typeof response.text === "function") {
    const data = Buffer.from(await response.text(), "utf8");
    return data.length <= maxBytes ? data : null;
  }
  return null;
}

async function safeRobotsBlocked(
  origin: string,
  fetchFn: typeof fetch,
  safeUrl: SafeUrlFn,
): Promise<boolean> {
  const robotsUrl = new URL("/robots.txt", origin).href;
  const fetched = await fetchSafe(
    robotsUrl,
    fetchFn,
    safeUrl,
    "text/plain,*/*;q=0.5",
  );
  // If a site does not let us retrieve its policy, do not assume permission.
  if (!fetched) return true;
  const data = await readBoundedResponse(fetched.response, MAX_ROBOTS_BYTES);
  return data ? isBlockedByRobots(data.toString("utf8")) : true;
}

async function probeLogo(
  entry: StationLogoCandidate,
  fetchFn: typeof fetch,
  safeUrl: SafeUrlFn,
): Promise<StationLogoResult | null> {
  if (
    entry.declaredWidth != null &&
    entry.declaredHeight != null &&
    Math.min(entry.declaredWidth, entry.declaredHeight) < MIN_STATION_LOGO_SIDE &&
    !entry.url.toLowerCase().includes(".svg")
  ) {
    return null;
  }

  const fetched = await fetchSafe(entry.url, fetchFn, safeUrl, "image/*,*/*;q=0.8");
  if (!fetched) return null;
  const contentType = fetched.response.headers.get("content-type")?.toLowerCase() ?? "";
  const data = await readBoundedResponse(fetched.response, MAX_LOGO_BYTES);
  if (!data || data.length === 0) return null;

  const svgText = data.toString("utf8");
  const vector = contentType.includes("image/svg+xml");
  if (vector) {
    const startsWithSvg =
      /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(svgText);
    const activeContent =
      /<(?:script|foreignObject|iframe|object|embed)\b/i.test(svgText) ||
      /(?:href|xlink:href)\s*=\s*["'](?!#|data:image\/)/i.test(svgText) ||
      /url\(\s*["']?https?:/i.test(svgText);
    if (!startsWithSvg || activeContent) return null;
    return { url: entry.url, width: null, height: null, vector: true };
  }
  if (!contentType.startsWith("image/")) return null;

  const dimensions = readStationLogoDimensions(data, contentType);
  if (!dimensions || Math.min(dimensions.width, dimensions.height) < MIN_STATION_LOGO_SIDE) {
    return null;
  }
  return { url: entry.url, ...dimensions, vector: false };
}

export async function discoverStationLogo(
  html: string,
  pageUrl: string,
  opts: { fetchFn?: typeof fetch; isSafeUrlFn?: SafeUrlFn } = {},
): Promise<StationLogoResult | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const safeUrl = opts.isSafeUrlFn ?? defaultSafeUrl;
  let candidates = extractStationLogoCandidates(html, pageUrl);

  const manifestUrl = extractManifestUrl(html, pageUrl);
  if (manifestUrl) {
    const fetched = await fetchSafe(
      manifestUrl,
      fetchFn,
      safeUrl,
      "application/manifest+json,application/json",
    );
    if (fetched) {
      try {
        const data = await readBoundedResponse(fetched.response, MAX_MANIFEST_BYTES);
        if (!data) throw new Error("manifest exceeds byte limit");
        candidates = dedupeCandidates([
          ...candidates,
          ...extractManifestLogoCandidates(JSON.parse(data.toString("utf8")), fetched.finalUrl),
        ]);
      } catch {
        // Invalid/oversized manifest — declared page assets remain eligible.
      }
    }
  }

  const accepted: Array<{ result: StationLogoResult; score: number }> = [];
  for (const entry of candidates.slice(0, MAX_LOGO_CANDIDATES)) {
    const result = await probeLogo(entry, fetchFn, safeUrl);
    if (!result) continue;
    const quality = result.vector
      ? 400
      : Math.min(320, Math.min(result.width ?? 0, result.height ?? 0));
    accepted.push({ result, score: entry.priority + quality });
  }
  accepted.sort((a, b) => b.score - a.score);
  return accepted[0]?.result ?? null;
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

export interface StationStoreLink {
  url: string;
  label: string;
  signal: "path" | "text";
}

/**
 * Scan the official homepage for a likely purchase destination.
 *
 * This is intentionally narrower than a generic commerce crawler: only
 * explicit anchor links count, and the link itself must be HTTP(S). The
 * homepage is the provenance, so external checkout hosts are allowed when the
 * station has linked to them.
 */
export function extractStoreLink(
  html: string,
  baseUrl: string,
): StationStoreLink | null {
  const hrefPathKeywords =
    /\/(shop|store|merch|merchandise|vinyl|records|products|catalog|tickets?)(\/|$|\?|#)/i;
  const textKeywords =
    /\b(shop|store|merch(?:andise)?|vinyl|records?|buy|purchase|tickets?)\b/i;
  const anchorRe = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const misleadingText =
    /\b(app store|play store|store locator|find (?:a )?store|support store)\b/i;
  const trustedCommerceHosts = [
    "bandcamp.com",
    "bigcartel.com",
    "bonfire.com",
    "etsy.com",
    "eventbrite.com",
    "fourthwall.com",
    "hellomerch.com",
    "merchbar.com",
    "myshopify.com",
    "shop.app",
    "shopify.com",
    "spring.com",
    "square.site",
    "ticketmaster.com",
  ];
  const baseHostname = (() => {
    try {
      return new URL(baseUrl).hostname.toLowerCase();
    } catch {
      return null;
    }
  })();
  if (!baseHostname) return null;
  let textFallback: StationStoreLink | null = null;

  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const rawHref = match[1].trim();
    if (rawHref.startsWith("#")) continue;

    let resolved: string;
    try {
      resolved = new URL(rawHref, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(resolved)) continue;

    const label = decodeEntities(match[2].replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    let parsed: URL;
    try {
      parsed = new URL(resolved);
    } catch {
      continue;
    }
    const hostname = parsed.hostname.toLowerCase();
    const isSameSite =
      hostname === baseHostname ||
      hostname.endsWith(`.${baseHostname}`) ||
      baseHostname.endsWith(`.${hostname}`);
    const isTrustedCommerceHost = trustedCommerceHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
    if (!isSameSite && !isTrustedCommerceHost) continue;
    if (misleadingText.test(label)) continue;

    if (hrefPathKeywords.test(parsed.pathname)) {
      return { url: resolved, label, signal: "path" };
    }
    if (textFallback === null && textKeywords.test(label)) {
      textFallback = { url: resolved, label, signal: "text" };
    }
  }

  return textFallback;
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
  opts: {
    fetchFn?: typeof fetch;
    isSafeUrlFn?: SafeUrlFn;
    isRobotsBlockedFn?: RobotsBlockedFn;
  } = {},
): Promise<{ scraped: boolean; blocked: boolean }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const safeUrl = opts.isSafeUrlFn ?? defaultSafeUrl;
  const robotsBlocked = opts.isRobotsBlockedFn ?? safeRobotsBlocked;
  let pageUrl: URL;
  try {
    pageUrl = new URL(target.homepageUrl);
    // Legacy directory rows contain many plain-http homepages. Upgrade before
    // probing; if the site cannot serve HTTPS, skip it rather than weaken the
    // same public-host policy used by the artwork proxy.
    if (pageUrl.protocol === "http:") pageUrl.protocol = "https:";
    if (pageUrl.protocol !== "https:" || !(await safeUrl(pageUrl.href))) {
      throw new Error("unsafe homepage URL");
    }
  } catch {
    // Malformed homepage URL — mark attempted so it isn't retried every tick.
    await db
      .update(stationsTable)
      .set({
        homepageScrapedAt: new Date(),
        logoCheckedAt: new Date(),
        storeStatus: "unavailable",
        storeCheckedAt: new Date(),
      })
      .where(eq(stationsTable.id, target.id));
    return { scraped: false, blocked: false };
  }

  const blocked = await robotsBlocked(pageUrl.origin, fetchFn, safeUrl);
  if (blocked) {
    console.info(
      `[homepage-scraper] robots.txt blocks ${target.slug} (${pageUrl.origin})`,
    );
    await db
      .update(stationsTable)
      .set({
        homepageScrapedAt: new Date(),
        logoCheckedAt: new Date(),
        storeStatus: "blocked",
        storeCheckedAt: new Date(),
      })
      .where(eq(stationsTable.id, target.id));
    return { scraped: false, blocked: true };
  }

  try {
    const fetched = await fetchSafe(
      pageUrl.href,
      fetchFn,
      safeUrl,
      "text/html,application/xhtml+xml",
    );
    if (!fetched) {
      await db
        .update(stationsTable)
        .set({
          homepageScrapedAt: new Date(),
          logoCheckedAt: new Date(),
          storeStatus: "unavailable",
          storeCheckedAt: new Date(),
        })
        .where(eq(stationsTable.id, target.id));
      return { scraped: false, blocked: false };
    }
    const finalOrigin = new URL(fetched.finalUrl).origin;
    if (
      finalOrigin !== pageUrl.origin &&
      (await robotsBlocked(finalOrigin, fetchFn, safeUrl))
    ) {
      await db
        .update(stationsTable)
        .set({
          homepageScrapedAt: new Date(),
          logoCheckedAt: new Date(),
          storeStatus: "blocked",
          storeCheckedAt: new Date(),
        })
        .where(eq(stationsTable.id, target.id));
      return { scraped: false, blocked: true };
    }
    const pageData = await readBoundedResponse(
      fetched.response,
      MAX_HOMEPAGE_BYTES,
    );
    if (!pageData) {
      await db
        .update(stationsTable)
        .set({
          homepageScrapedAt: new Date(),
          logoCheckedAt: new Date(),
          storeStatus: "unavailable",
          storeCheckedAt: new Date(),
        })
        .where(eq(stationsTable.id, target.id));
      return { scraped: false, blocked: false };
    }
    const html = pageData.toString("utf8");
    const blurb = extractBlurb(html);
    const donateLink = extractDonateLink(html, fetched.finalUrl);
    const storeLink = extractStoreLink(html, fetched.finalUrl);
    // A curated logo is operator-owned. All other sources may be upgraded by
    // an asset declared on the official station homepage.
    const discoveredLogo =
      target.logoSource === "curated"
        ? null
        : await discoverStationLogo(html, fetched.finalUrl, {
            fetchFn,
            isSafeUrlFn: safeUrl,
          });

    // Write blurb unconditionally (overwriting stale text is fine).
    // Write donate_url only when the DB value is currently null — manual
    // entries must never be clobbered.
    await db
      .update(stationsTable)
      .set({
        ...(blurb ? { homepageBlurb: blurb } : {}),
        storeUrl: storeLink?.url ?? null,
        storeLabel: storeLink?.label || null,
        storeSignal: storeLink?.signal ?? null,
        storeStatus: storeLink ? "found" : "not_found",
        storeCheckedAt: new Date(),
        homepageScrapedAt: new Date(),
        logoCheckedAt: new Date(),
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

    if (discoveredLogo) {
      const updated = await db
        .update(stationsTable)
        .set({
          logoUrl: discoveredLogo.url,
          logoSource: "website",
          logoWidth: discoveredLogo.width,
          logoHeight: discoveredLogo.height,
        })
        .where(
          and(
            eq(stationsTable.id, target.id),
            or(
              isNull(stationsTable.logoSource),
              inArray(stationsTable.logoSource, ["radio_browser", "website"]),
            ),
          ),
        )
        .returning({ id: stationsTable.id });
      if (updated.length > 0) {
        console.info(
          `[homepage-scraper] station logo found for ${target.slug}: ${discoveredLogo.url}`,
        );
      }
    }

    return { scraped: Boolean(blurb), blocked: false };
  } catch (err) {
    console.warn(`[homepage-scraper] fetch failed for ${target.slug}`, err);
    await db
      .update(stationsTable)
      .set({
        homepageScrapedAt: new Date(),
        logoCheckedAt: new Date(),
        storeStatus: "unavailable",
        storeCheckedAt: new Date(),
      })
      .where(eq(stationsTable.id, target.id));
    return { scraped: false, blocked: false };
  }
}

let started = false;
let timer: NodeJS.Timeout | null = null;
let batchRunning = false;

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
 * The scraper loop will pick them up in small rate-limited batches.
 * No other changes are needed — `donate_url` writes are conditional on the
 * column being NULL, so manually-curated entries are safe.
 */

/** Run one bounded scraper pass. Exported for admin smoke checks and tests. */
export async function runHomepageScraperBatch(
  limit = BATCH_SIZE,
): Promise<number> {
  if (batchRunning) return 0;
  batchRunning = true;
  try {
    const targets = await loadStaleTargets(limit);
    for (const target of targets) {
      await scrapeStationHomepage(target);
    }
    return targets.length;
  } finally {
    batchRunning = false;
  }
}

/** Start the homepage-scraper loop. Idempotent — safe to call once at boot. */
export function startHomepageScraper(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await runHomepageScraperBatch();
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
