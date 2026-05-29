import { lookup } from "node:dns/promises";
import { logger } from "../logger.js";

// Reading arbitrary links the user pastes into Slack. Slack delivers URLs
// wrapped like <https://example.com> or <https://example.com|label>, so we
// unwrap those as well as catch bare URLs. We then fetch each page, pull out
// the human-readable bits (title, description, body text) and hand that to the
// LLM as extra context so it can actually talk about what's behind the link.

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 2_000_000; // stop reading a page after ~2MB
const MAX_TEXT_CHARS = 3_500; // cap body excerpt per link
const MAX_LINKS = 3; // don't fetch more than this many per message
const MAX_REDIRECTS = 4; // follow at most this many hops, re-validating each

// Slack-wrapped link: <url> or <url|label>. Capture the url part only.
const SLACK_LINK_RE = /<(https?:\/\/[^>|\s]+)(?:\|[^>]*)?>/gi;
// Bare url fallback. Trailing punctuation is trimmed below.
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>()]+/gi;

/**
 * Pull every distinct http(s) URL out of a Slack message, handling Slack's
 * angle-bracket link formatting. Returns an empty array when there are none.
 */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();

  for (const m of text.matchAll(SLACK_LINK_RE)) {
    const url = cleanUrl(m[1]!);
    if (url) found.add(url);
  }

  // Remove the Slack-wrapped links we already captured, then scan for bare
  // ones so we don't double-count the inner url of a <url|label> pair.
  const withoutWrapped = text.replace(SLACK_LINK_RE, " ");
  for (const m of withoutWrapped.matchAll(BARE_URL_RE)) {
    const url = cleanUrl(m[0]);
    if (url) found.add(url);
  }

  return [...found];
}

function cleanUrl(raw: string): string | null {
  // Strip common trailing punctuation that gets glued onto pasted links.
  let url = raw.replace(/[.,;:!?'")\]]+$/, "");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (isBlockedHost(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// Basic SSRF guard: refuse obviously-internal targets by hostname. Trusted
// private Slack, but there's no reason for the bot to ever fetch
// loopback/metadata/LAN hosts. This is the cheap literal-name pre-filter; the
// authoritative check is isBlockedIp() against DNS-resolved addresses at fetch
// time (see assertHostAllowed), which also defends against DNS-rebinding and
// public hostnames that point at internal IPs.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal") return true;
  // If it's an IP literal, classify it directly.
  if (/^[0-9.]+$/.test(h) || h.includes(":")) return isBlockedIp(h);
  return false;
}

// Classify a concrete IP address (v4 or v6) as private/loopback/link-local.
export function isBlockedIp(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — extract the v4 tail.
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const v4str = mapped ? mapped[1]! : addr;

  const v4 = v4str.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  // IPv6
  if (addr.includes(":")) {
    if (addr === "::1" || addr === "::") return true;
    if (addr.startsWith("fe80:")) return true; // link-local
    if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique-local
    return false;
  }
  // Unknown format → treat as blocked to fail safe.
  return true;
}

// Resolve the hostname and refuse if ANY resolved address is internal. Throws
// a labelled error when the host is blocked or cannot be resolved.
async function assertHostAllowed(hostname: string): Promise<void> {
  const h = hostname.replace(/^\[|\]$/g, "");
  // IP literal: classify directly, no DNS needed.
  if (/^[0-9.]+$/.test(h) || h.includes(":")) {
    if (isBlockedIp(h)) throw new Error("blocked internal address");
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(h, { all: true });
  } catch {
    throw new Error("could not resolve host");
  }
  if (addresses.length === 0) throw new Error("could not resolve host");
  for (const { address } of addresses) {
    if (isBlockedIp(address)) throw new Error("resolves to an internal address");
  }
}

/**
 * Fetch every URL and return a single context block describing what was found,
 * or an empty string if there was nothing usable. Failures are reported
 * explicitly (per link) rather than silently dropped so the model — and the
 * user — knows a link couldn't be read.
 */
export async function fetchLinkContext(urls: string[]): Promise<string> {
  const targets = urls.slice(0, MAX_LINKS);
  if (targets.length === 0) return "";

  const parts = await Promise.all(targets.map((u, i) => fetchOne(u, i + 1)));
  const body = parts.filter(Boolean).join("\n\n");
  return body;
}

async function fetchOne(url: string, index: number): Promise<string> {
  const label = `[Link ${index}] ${url}`;
  // One deadline across all redirect hops so a redirect chain can't extend the
  // total time budget.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    let current = url;
    let res: Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Re-validate every hop: DNS-resolve and block internal addresses. This
      // is what stops redirect-based SSRF and DNS-rebinding, not just the
      // literal-name check done at extraction time.
      const parsed = new URL(current);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `${label}\n(could not be read — unsupported redirect to ${parsed.protocol})`;
      }
      await assertHostAllowed(parsed.hostname);

      const hopRes = await fetch(current, {
        redirect: "manual",
        headers: {
          // Some sites serve minimal/blocked content to unknown agents.
          "User-Agent":
            "Mozilla/5.0 (compatible; JamBot/1.0; +https://github.com/jam-bot)",
          Accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.5",
        },
        signal,
      });

      // Manual redirect handling.
      if (hopRes.status >= 300 && hopRes.status < 400) {
        const location = hopRes.headers.get("location");
        if (!location) {
          return `${label}\n(could not be read — redirect with no location)`;
        }
        current = new URL(location, current).toString();
        continue;
      }
      res = hopRes;
      break;
    }

    if (!res) {
      return `${label}\n(could not be read — too many redirects)`;
    }

    if (!res.ok) {
      return `${label}\n(could not be read — server returned HTTP ${res.status})`;
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const isText =
      contentType.includes("text/") ||
      contentType.includes("html") ||
      contentType.includes("json") ||
      contentType.includes("xml") ||
      contentType === "";
    if (!isText) {
      return `${label}\n(could not be read — not a text/HTML page, content-type: ${contentType || "unknown"})`;
    }

    const raw = await readCapped(res);
    const extracted = extractReadable(raw, contentType);
    if (!extracted) {
      return `${label}\n(opened, but no readable text was found on the page)`;
    }
    return `${label}\n${extracted}`;
  } catch (err) {
    const reason =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
        ? `timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    logger.warn("Link fetch failed", { url, reason });
    return `${label}\n(could not be read — ${reason})`;
  }
}

// Read the response body but stop once we've seen MAX_BYTES so a huge page
// can't blow up memory or stall the handler.
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let out = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  out += decoder.decode();
  return out;
}

function extractReadable(raw: string, contentType: string): string {
  // Non-HTML text (json, plain, xml): just trim and truncate.
  if (!contentType.includes("html") && contentType !== "" && !contentType.includes("xml")) {
    return truncate(collapse(raw), MAX_TEXT_CHARS);
  }

  const title =
    metaContent(raw, "og:title") ??
    tagContent(raw, "title") ??
    metaContent(raw, "twitter:title");
  const description =
    metaContent(raw, "og:description") ??
    metaName(raw, "description") ??
    metaContent(raw, "twitter:description");
  const siteName = metaContent(raw, "og:site_name");

  // Strip out non-content elements, then drop all tags for a plain-text body.
  const stripped = raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const bodyText = truncate(collapse(decodeEntities(stripped)), MAX_TEXT_CHARS);

  const lines: string[] = [];
  if (title) lines.push(`Title: ${collapse(decodeEntities(title))}`);
  if (siteName) lines.push(`Site: ${collapse(decodeEntities(siteName))}`);
  if (description) lines.push(`Summary: ${collapse(decodeEntities(description))}`);
  if (bodyText) lines.push(`Excerpt: ${bodyText}`);
  return lines.join("\n");
}

function tagContent(html: string, tag: string): string | null {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1]!.trim() : null;
}

// <meta property="og:title" content="..."> (property attr, either order)
function metaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]*(?:property|name)=["']${escapeRe(property)}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escapeRe(property)}["']`,
    "i",
  );
  const m = html.match(re) ?? html.match(re2);
  return m ? m[1]!.trim() : null;
}

// <meta name="description" content="...">
function metaName(html: string, name: string): string | null {
  return metaContent(html, name);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "…";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}
