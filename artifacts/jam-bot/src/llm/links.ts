import { lookup } from "node:dns/promises";
import { logger } from "../logger.js";

// Reading arbitrary links the user pastes into Slack. Slack delivers URLs
// wrapped like <https://example.com> or <https://example.com|label>, so we
// unwrap those as well as catch bare URLs. We then fetch each page, pull out
// the human-readable bits (title, description, body text) and hand that to the
// LLM as extra context so it can actually talk about what's behind the link.

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 2_000_000; // stop reading a page after ~2MB
const MAX_TEXT_CHARS = 3_500; // cap text sent to the model per link
const MAX_LINKS = 3; // don't fetch more than this many per message
const MAX_REDIRECTS = 4; // follow at most this many hops, re-validating each

export interface RetrievedLinkEvidence {
  url: string;
  label: string;
  excerpt: string;
  passages?: string[];
  pagePassages?: Array<{ page: number; text: string }>;
}

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
  const evidence = await fetchLinkEvidence(urls);
  return evidence
    .map((item, index) => `[Link ${index + 1}] ${item.url}\n${item.excerpt}`)
    .join("\n\n");
}

/**
 * Fetch user-provided links as structured evidence. Only successfully opened
 * pages are returned, so callers cannot cite an unread URL or an error string.
 */
export async function fetchLinkEvidence(
  urls: string[],
  question = "",
): Promise<RetrievedLinkEvidence[]> {
  const targets = urls.slice(0, MAX_LINKS);
  if (targets.length === 0) return [];

  const parts = await Promise.all(targets.map((u) => fetchOneEvidence(u, question)));
  return parts.filter((part): part is RetrievedLinkEvidence => part !== null);
}

async function fetchOneEvidence(
  url: string,
  question: string,
): Promise<RetrievedLinkEvidence | null> {
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
        return null;
      }
      await assertHostAllowed(parsed.hostname);

      const hopRes = await fetch(current, {
        redirect: "manual",
        headers: {
          // Some sites serve minimal/blocked content to unknown agents.
          "User-Agent":
            "Mozilla/5.0 (compatible; JamBot/1.0; +https://github.com/jam-bot)",
          Accept: "text/html,application/pdf,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.5",
        },
        signal,
      });

      // Manual redirect handling.
      if (hopRes.status >= 300 && hopRes.status < 400) {
        const location = hopRes.headers.get("location");
        if (!location) {
          return null;
        }
        current = new URL(location, current).toString();
        continue;
      }
      res = hopRes;
      break;
    }

    if (!res) {
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const pdfUrl = /\.pdf$/i.test(new URL(current).pathname);
    if (contentType.includes("application/pdf") ||
        (pdfUrl && (contentType.includes("application/octet-stream") || contentType === ""))) {
      const bytes = await readCappedPdf(res);
      const pagePassages = await selectPdfPassages(bytes, question, signal);
      if (!pagePassages.length) return null;
      return {
        url,
        label: new URL(url).hostname,
        excerpt: pagePassages.map(({ page, text }) => `Page ${page}: ${text}`).join("\n").slice(0, MAX_TEXT_CHARS),
        pagePassages,
      };
    }
    const isText =
      contentType.includes("text/") ||
      contentType.includes("html") ||
      contentType.includes("json") ||
      contentType.includes("xml") ||
      contentType === "";
    if (!isText) {
      return null;
    }

    const raw = await readCapped(res);
    const extracted = extractReadable(raw, contentType);
    if (!extracted) {
      return null;
    }
    const title = extracted.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
    const passages = selectPassages(raw, contentType, question);
    if (!passages.length) return null;
    return {
      url,
      label: title || new URL(url).hostname,
      excerpt: extracted,
      passages,
    };
  } catch (err) {
    const reason =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
        ? `timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    logger.warn("Link fetch failed", { url, reason });
    return null;
  }
}

// Reject rather than parse a partial PDF. The network byte cap applies to
// every response, including servers that omit or lie about Content-Length.
async function readCappedPdf(res: Response): Promise<Uint8Array> {
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error("PDF too large");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("PDF body unavailable");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("PDF too large");
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!new TextDecoder("ascii").decode(bytes.subarray(0, 5)).startsWith("%PDF-")) {
    throw new Error("Invalid PDF header");
  }
  return bytes;
}

async function selectPdfPassages(
  bytes: Uint8Array,
  question: string,
  signal: AbortSignal,
): Promise<Array<{ page: number; text: string }>> {
  // Import lazily: ordinary HTML links must not pay for PDF parsing.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: bytes,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const abort = () => { void task.destroy().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) return [];
    const pdf = await task.promise;
    const terms = contentTerms(question.replace(/https?:\/\/\S+/g, " "));
    const ranked: Array<{ page: number; text: string; score: number }> = [];
    // Physical page indices, not potentially misleading printed page labels.
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 40); pageNumber++) {
      if (signal.aborted) return [];
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str + (item.hasEOL ? "\n" : " ");
      }
      lines.push(...line.split(/\n+/).map(collapse).filter((s) => s.length >= 30));
      for (const paragraph of lines) {
        for (let pos = 0; pos < paragraph.length; pos += 450) {
          const text = paragraph.slice(pos, pos + 450).trim();
          if (text.length < 30) continue;
          const score = [...terms].filter((term) => contentTerms(text).has(term)).length;
          if (!terms.size || score > 0) ranked.push({ page: pageNumber, text, score });
        }
      }
      page.cleanup();
    }
    ranked.sort((a, b) => b.score - a.score || a.page - b.page);
    const selected: Array<{ page: number; text: string }> = [];
    let size = 0;
    for (const { page, text } of ranked) {
      if (selected.length >= 8 || size + text.length > MAX_TEXT_CHARS) break;
      selected.push({ page, text });
      size += text.length;
    }
    return selected;
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}

// Select bounded, verbatim body passages, rather than citing the title or a
// metadata summary as proof. Keep paragraph boundaries before collapsing HTML.
// Scoring all paragraphs (not just the first 3,500 chars) allows a relevant
// passage later in an otherwise long page to be found within the same fetch.
function selectPassages(raw: string, contentType: string, question: string): string[] {
  const text = contentType.includes("html") || contentType === "" || contentType.includes("xml")
    ? raw
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(head|script|style|noscript|nav|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(?:p|div|section|article|li|h[1-6]|blockquote|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
    : raw;
  const paragraphs = decodeEntities(text).split(/\n+/).map(collapse).filter((s) => s.length >= 30);
  const chunks = paragraphs.flatMap((paragraph) => {
    const pieces: string[] = [];
    for (let pos = 0; pos < paragraph.length; pos += 450) {
      const piece = paragraph.slice(pos, pos + 450).trim();
      if (piece.length >= 30) pieces.push(piece);
    }
    return pieces;
  });
  const terms = contentTerms(question.replace(/https?:\/\/\S+/g, " "));
  const ranked = chunks.map((text, index) => ({
    text, index,
    score: [...terms].filter((term) => contentTerms(text).has(term)).length,
  })).filter((part) => !terms.size || part.score > 0);
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: string[] = [];
  let size = 0;
  for (const part of ranked) {
    if (selected.length >= 8 || size + part.text.length > MAX_TEXT_CHARS) break;
    selected.push(part.text);
    size += part.text.length;
  }
  return selected;
}

export function contentTerms(text: string): Set<string> {
  const stop = new Set([
    "what", "when", "where", "which", "who", "why", "how", "the", "and",
    "for", "from", "with", "this", "that", "these", "those", "was", "were",
    "are", "did", "does", "has", "have", "had", "about", "into", "can",
    "you", "tell", "me", "its", "his", "her", "they", "them", "their",
    "song", "track", "page", "article", "source", "says", "say",
  ]);
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length >= 3 && !stop.has(word)));
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
