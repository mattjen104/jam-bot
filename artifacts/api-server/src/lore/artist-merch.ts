import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as https from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  artistMerchProductsTable,
  artistMerchSourceTargetsTable,
  db,
  type ArtistMerchProduct,
  type InsertArtistMerchProduct,
  type InsertArtistMerchSourceTarget,
} from "@workspace/db";
import { isSafeSupportUrl } from "./support-ladder.js";

export type MerchSource = "bandcamp" | "artist_store" | "label_store";

export type MerchEvidenceInput = {
  artistMbid: string;
  title: string;
  destinationUrl: string;
  imageUrl?: string | null;
  source: MerchSource;
  sourceUrl: string;
  providerProductId?: string | null;
  verification?: "exact" | "trusted";
  fetchedAt?: Date;
  expiresAt: Date;
};

/**
 * Parse only explicit product/store anchors from an already-approved source
 * page. The caller supplies the canonical artist MBID and source type; this
 * parser never searches the web or attempts to infer an artist from text.
 */
export function extractApprovedMerchLinks(
  html: string,
  input: {
    artistMbid: string;
    sourceUrl: string;
    source: MerchSource;
    expiresAt: Date;
  },
  now = new Date(),
): MerchEvidenceInput[] {
  const links: MerchEvidenceInput[] = [];
  const anchorRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const imageRe = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/i;
  const productWords = /\b(shop|store|merch|merchandise|vinyl|record|album|shirt|hoodie|buy|purchase)\b/i;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null && links.length < 40) {
    const rawText = match[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!rawText || !productWords.test(`${match[1]} ${rawText}`)) continue;
    let destinationUrl: string;
    try {
      destinationUrl = new URL(match[1]!, input.sourceUrl).toString();
    } catch {
      continue;
    }
    let imageUrl: string | null = null;
    const image = match[2]!.match(imageRe);
    if (image?.[1]) {
      try {
        imageUrl = new URL(image[1], input.sourceUrl).toString();
      } catch {
        imageUrl = null;
      }
    }
    links.push({
      artistMbid: input.artistMbid,
      title: rawText.slice(0, 240),
      destinationUrl,
      imageUrl,
      source: input.source,
      sourceUrl: input.sourceUrl,
      verification: input.source === "bandcamp" ? "exact" : "trusted",
      fetchedAt: now,
      expiresAt: input.expiresAt,
    });
  }
  return collectApprovedMerchEvidence(links, now);
}

const APPROVED_HOSTS = [
  "bandcamp.com",
  "bigcartel.com",
  "bonfire.com",
  "fourthwall.com",
  "hellomerch.com",
  "merchbar.com",
  "myshopify.com",
  "shop.app",
  "shopify.com",
  "spring.com",
  "square.site",
];

export function safeMerchUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!isSafeSupportUrl(url.toString())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type MerchPageCollectionTarget = {
  artistMbid: string;
  sourceUrl: string;
  source: MerchSource;
  expiresAt: Date;
};

type ResolvedPublicAddress = {
  address: string;
  family: 4 | 6;
};

export type MerchResolveAllFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export type MerchPinnedRequestFn = (
  options: https.RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

const MAX_MERCH_SOURCE_BYTES = 1_000_000;

function ipv4Number(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return (
    ((octets[0]! << 24) >>> 0) |
    (octets[1]! << 16) |
    (octets[2]! << 8) |
    octets[3]!
  ) >>> 0;
}

function ipv4IsPublic(address: string): boolean {
  const value = ipv4Number(address);
  if (value == null) return false;
  const inRange = (start: number, end: number) => value >= start && value <= end;
  return !(
    inRange(0x00000000, 0x00ffffff) || // 0/8
    inRange(0x0a000000, 0x0affffff) || // RFC1918
    inRange(0x64400000, 0x647fffff) || // carrier-grade NAT
    inRange(0x7f000000, 0x7fffffff) || // loopback
    inRange(0xa9fe0000, 0xa9feffff) || // link-local
    inRange(0xac100000, 0xac1fffff) || // RFC1918
    inRange(0xc0000000, 0xc00000ff) || // IETF protocol assignments
    inRange(0xc0000200, 0xc00002ff) || // TEST-NET-1
    inRange(0xc0586300, 0xc05863ff) || // 6to4 relay anycast
    inRange(0xc0a80000, 0xc0a8ffff) || // RFC1918
    inRange(0xc6120000, 0xc613ffff) || // benchmarking
    inRange(0xc6336400, 0xc63364ff) || // TEST-NET-2
    inRange(0xcb007100, 0xcb0071ff) || // TEST-NET-3
    inRange(0xe0000000, 0xffffffff) // multicast and reserved
  );
}

function ipv6Words(address: string): number[] | null {
  let normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = normalized.indexOf("%");
  if (zone >= 0) normalized = normalized.slice(0, zone);
  if (isIP(normalized) !== 6) return null;
  const expandPart = (part: string): string[] => {
    if (!part.includes(".")) return [part];
    const value = ipv4Number(part);
    if (value == null) return [];
    return [
      ((value >>> 16) & 0xffff).toString(16),
      (value & 0xffff).toString(16),
    ];
  };
  const marker = normalized.indexOf("::");
  const left = marker >= 0 ? normalized.slice(0, marker) : normalized;
  const right = marker >= 0 ? normalized.slice(marker + 2) : "";
  const leftParts = left ? left.split(":").flatMap(expandPart) : [];
  const rightParts = right ? right.split(":").flatMap(expandPart) : [];
  if (
    leftParts.length + rightParts.length > 8 ||
    (marker < 0 && leftParts.length !== 8)
  ) {
    return null;
  }
  const zeros = marker >= 0 ? 8 - leftParts.length - rightParts.length : 0;
  const parts = [...leftParts, ...Array.from({ length: zeros }, () => "0"), ...rightParts];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) {
    return null;
  }
  return parts.map((part) => parseInt(part, 16));
}

function ipv6Prefix(words: number[], prefixLength: number): bigint {
  const value = words.reduce((result, word) => (result << 16n) | BigInt(word), 0n);
  return value >> BigInt(128 - prefixLength);
}

function ipv6IsPublic(address: string): boolean {
  const words = ipv6Words(address);
  if (!words) return false;
  const zero = words.every((word) => word === 0);
  const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mapped) {
    const mappedIpv4 =
      `${words[6]! >>> 8}.${words[6]! & 255}.${words[7]! >>> 8}.${words[7]! & 255}`;
    return ipv4IsPublic(mappedIpv4);
  }
  const ipv4Compatible = words.slice(0, 6).every((word) => word === 0);
  return !(
    zero ||
    loopback ||
    ipv4Compatible ||
    ipv6Prefix(words, 7) === 0x7en || // ULA fc00::/7
    ipv6Prefix(words, 10) === 0x3fan || // link-local fe80::/10
    ipv6Prefix(words, 10) === 0x3fbn || // deprecated site-local fec0::/10
    ipv6Prefix(words, 8) === 0xffn || // multicast ff00::/8
    ipv6Prefix(words, 32) === 0x20010db8n || // documentation
    ipv6Prefix(words, 48) === 0x200102n || // benchmarking
    ipv6Prefix(words, 28) === 0x20010n || // ORCHID / special-use
    ipv6Prefix(words, 28) === 0x2001020n || // ORCHIDv2
    ipv6Prefix(words, 16) === 0x2002n || // deprecated 6to4
    ipv6Prefix(words, 16) === 0x3ffen || // deprecated 6bone
    ipv6Prefix(words, 20) === 0x3fff0n || // documentation
    ipv6Prefix(words, 32) === 0x20010000n // Teredo special-use block
  );
}

export function isPublicResolvedAddress(address: string, family: number): boolean {
  return family === 4
    ? ipv4IsPublic(address)
    : family === 6
      ? ipv6IsPublic(address)
      : false;
}

export async function resolvePublicMerchAddresses(
  hostname: string,
  lookupFn: MerchResolveAllFn = dnsLookup,
): Promise<ResolvedPublicAddress[]> {
  const results = await lookupFn(hostname, { all: true, verbatim: true });
  const addresses = results
    .filter((result): result is ResolvedPublicAddress =>
      (result.family === 4 || result.family === 6) &&
      isPublicResolvedAddress(result.address, result.family),
    )
    .map((result) => ({ address: result.address, family: result.family as 4 | 6 }));
  // Reject the whole hostname if DNS returned any unsafe answer. Keeping a
  // public answer from a mixed response would permit DNS rebinding via the
  // unsafe answer on another connection attempt.
  if (
    results.length === 0 ||
    addresses.length !== results.length
  ) {
    throw new Error("Merch source DNS did not resolve exclusively to public addresses");
  }
  return addresses;
}

export async function readPinnedHttpsHtml(
  sourceUrl: string,
  options: {
    timeoutMs: number;
    lookupFn?: MerchResolveAllFn;
    requestFn?: MerchPinnedRequestFn;
  },
): Promise<{ contentType: string; html: string }> {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:") throw new Error("Merch source must use HTTPS");
  let resolveTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    resolvePublicMerchAddresses(parsed.hostname, options.lookupFn),
    new Promise<never>((_, reject) => {
      resolveTimer = setTimeout(
        () => reject(new Error("Merch source DNS lookup timed out")),
        options.timeoutMs,
      );
    }),
  ]).finally(() => {
    if (resolveTimer) clearTimeout(resolveTimer);
  });
  const pinned = addresses[0]!;
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const requestFn = options.requestFn ?? https.request;
    const finish = (error?: Error, value?: { contentType: string; html: string }) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value!);
    };
    const request = requestFn(
      {
        protocol: "https:",
        hostname: parsed.hostname,
        host: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        servername: parsed.hostname,
        rejectUnauthorized: true,
        lookup: ((
          lookupHostname: string,
          lookupOptions: { all?: boolean },
          callback: (
            error: Error | null,
            address?: string | Array<{ address: string; family: number }>,
            family?: number,
          ) => void,
        ) => {
          if (lookupHostname !== parsed.hostname) {
            callback(new Error("Pinned merch lookup hostname mismatch"));
            return;
          }
          // Node's auto-family connection path requests all results and expects
          // LookupAddress[]. Returning the legacy scalar shape there produces
          // `Invalid IP address: undefined` before a socket is opened.
          if (lookupOptions.all) {
            callback(null, [pinned]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        }) as NonNullable<https.RequestOptions["lookup"]>,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "LoreRadio/1.0 (+verified artist merch collector)",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          request.destroy();
          finish(new Error("Merch source redirects are not allowed"));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          request.destroy();
          finish(new Error(`Merch source returned ${status}`));
          return;
        }
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > MAX_MERCH_SOURCE_BYTES) {
            response.destroy();
            request.destroy();
            finish(new Error("Merch source exceeded 1MB limit"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => finish(undefined, {
          contentType: String(response.headers["content-type"] ?? ""),
          html: Buffer.concat(chunks).toString("utf8"),
        }));
        response.on("error", (error) => finish(error));
      },
    );
    const timer = setTimeout(() => {
      request.destroy(new Error("Merch source request timed out"));
      finish(new Error("Merch source request timed out"));
    }, options.timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timer);
      finish(error);
    });
    request.on("close", () => clearTimeout(timer));
    request.end();
  });
}

const ARTIST_MBID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_REFRESH_MS = 24 * 60 * 60 * 1000;
const SOURCE_ERROR_RETRY_MS = 60 * 60 * 1000;

export function isCanonicalArtistMbid(value: string): boolean {
  return ARTIST_MBID_RE.test(value.trim());
}

/**
 * Normalize an operator-approved source target before it enters the durable
 * collection queue. Bandcamp targets must actually be Bandcamp pages; other
 * source types may be an artist/label-owned HTTPS page, with the operator
 * approval acting as the provenance boundary.
 */
export function normalizeApprovedMerchSourceTarget(input: {
  artistMbid: string;
  sourceUrl: string;
  source: MerchSource;
}): { artistMbid: string; sourceUrl: string; source: MerchSource } | null {
  if (!["bandcamp", "artist_store", "label_store"].includes(input.source)) {
    return null;
  }
  if (!isCanonicalArtistMbid(input.artistMbid)) return null;
  const sourceUrl = safeMerchUrl(input.sourceUrl);
  if (!sourceUrl) return null;
  let hostname: string;
  try {
    hostname = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (
    input.source === "bandcamp" &&
    hostname !== "bandcamp.com" &&
    !hostname.endsWith(".bandcamp.com")
  ) {
    return null;
  }
  return {
    artistMbid: input.artistMbid.trim().toLowerCase(),
    sourceUrl,
    source: input.source,
  };
}

export async function upsertArtistMerchSourceTarget(
  target: Omit<InsertArtistMerchSourceTarget, "refreshAfter"> & {
    refreshAfter?: Date;
  },
): Promise<{
  artistMbid: string;
  sourceUrl: string;
  source: MerchSource;
  status: "active" | "paused";
  refreshAfter: Date;
}> {
  const now = new Date();
  const sourceUrl = safeMerchUrl(target.sourceUrl);
  if (!sourceUrl || !target.artistMbid.trim()) {
    throw new Error("Artist merch source target must use a safe source URL and canonical artist MBID");
  }
  const refreshAfter = target.refreshAfter ?? now;
  await db
    .insert(artistMerchSourceTargetsTable)
    .values({
      ...target,
      sourceUrl,
      refreshAfter,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        artistMerchSourceTargetsTable.artistMbid,
        artistMerchSourceTargetsTable.sourceUrl,
      ],
      set: {
        source: target.source,
        status: target.status ?? "active",
        refreshAfter,
        updatedAt: now,
      },
    });
  return {
    artistMbid: target.artistMbid,
    sourceUrl,
    source: target.source as MerchSource,
    status: (target.status ?? "active") as "active" | "paused",
    refreshAfter,
  };
}

/**
 * Small reviewed bootstrap roster so the merch surface has real sources after
 * a fresh migration. These are canonical artist identities already present in
 * Lore's starter library and public artist-owned storefronts verified on
 * 2026-09-15. Keep this list evidence-based; never derive store URLs from names.
 */
export const VERIFIED_ARTIST_MERCH_SOURCE_SEEDS: readonly {
  artistMbid: string;
  sourceUrl: string;
  source: MerchSource;
}[] = [
  {
    artistMbid: "647221d0-f6b1-4e03-924c-c59b8059536f",
    sourceUrl: "https://chromeo.bandcamp.com/merch",
    source: "bandcamp",
  },
  {
    artistMbid: "2e222fce-02ae-4221-b1c6-3c3242b423b6",
    sourceUrl: "https://odesza.bandcamp.com/merch",
    source: "bandcamp",
  },
  {
    artistMbid: "d5cc67b8-1cc4-453b-96e8-44487acdebea",
    sourceUrl: "https://shop.beachhousebaltimore.com/",
    source: "artist_store",
  },
];

export async function seedVerifiedArtistMerchSources(): Promise<number> {
  let seeded = 0;
  for (const input of VERIFIED_ARTIST_MERCH_SOURCE_SEEDS) {
    const target = normalizeApprovedMerchSourceTarget(input);
    if (!target) {
      console.error("[artist-merch] rejected reviewed source seed", input.sourceUrl);
      continue;
    }
    await upsertArtistMerchSourceTarget({
      ...target,
      status: "active",
    });
    seeded++;
  }
  return seeded;
}

/**
 * Fetch one explicitly approved page for a background job, extract a bounded
 * snapshot, and apply removal semantics atomically at the artist level.
 * Listener request paths must only call loadArtistMerch().
 */
export async function collectArtistMerchPage(
  target: MerchPageCollectionTarget,
  options: {
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    now?: Date;
    lookupFn?: MerchResolveAllFn;
    requestFn?: MerchPinnedRequestFn;
  } = {},
): Promise<number> {
  const sourceUrl = safeMerchUrl(target.sourceUrl);
  if (!sourceUrl || !target.artistMbid.trim()) return 0;
  const now = options.now ?? new Date();
  if (options.fetchFn) {
    // This seam exists for deterministic unit tests only. Production calls
    // always use readPinnedHttpsHtml, which resolves and pins public DNS
    // answers before opening the TLS connection.
    if (process.env.NODE_ENV !== "test") {
      throw new Error("Injected merch fetch is only available in tests");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    try {
      const response = await options.fetchFn(sourceUrl, {
        signal: controller.signal,
        redirect: "error",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "LoreRadio/1.0 (+verified artist merch collector)",
        },
      });
      if (!response.ok) throw new Error(`Merch source returned ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new Error("Merch source did not return HTML");
      }
      if (!response.body) throw new Error("Merch source returned no body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_MERCH_SOURCE_BYTES) {
          await reader.cancel("Merch source exceeded 1MB limit");
          throw new Error("Merch source exceeded 1MB limit");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const html = new TextDecoder().decode(bytes);
      const rows = extractApprovedMerchLinks(html, {
        ...target,
        sourceUrl,
      }, now);
      return persistMerchEvidence(target.artistMbid, sourceUrl, rows, now);
    } finally {
      clearTimeout(timer);
    }
  }
  const response = await readPinnedHttpsHtml(sourceUrl, {
    timeoutMs: options.timeoutMs ?? 15_000,
    lookupFn: options.lookupFn,
    requestFn: options.requestFn,
  });
  if (!response.contentType.toLowerCase().includes("text/html")) {
    throw new Error("Merch source did not return HTML");
  }
  const rows = extractApprovedMerchLinks(response.html, {
    ...target,
    sourceUrl,
  }, now);
  return persistMerchEvidence(target.artistMbid, sourceUrl, rows, now);
}

export function normalizeMerchDestination(value: string): string | null {
  const safe = safeMerchUrl(value);
  return safe ? safe.replace(/\/+$/, "") : null;
}

function hostAllowedForSource(url: string, source: MerchSource, sourceUrl: string): boolean {
  let destination: URL;
  let provenance: URL;
  try {
    destination = new URL(url);
    provenance = new URL(sourceUrl);
  } catch {
    return false;
  }
  const destinationHost = destination.hostname.toLowerCase();
  const provenanceHost = provenance.hostname.toLowerCase();
  if (source === "bandcamp") {
    return destinationHost === "bandcamp.com" || destinationHost.endsWith(".bandcamp.com");
  }
  // Artist/label stores may use a hosted commerce provider, but evidence must
  // come from the artist's approved source page (never a generic search hit).
  return (
    destinationHost === provenanceHost ||
    APPROVED_HOSTS.some((host) => destinationHost === host || destinationHost.endsWith(`.${host}`))
  );
}

/**
 * Filter collector output before it is persisted or shown. This function is
 * deliberately pure so ingestion jobs can parse/fetch in the background while
 * listener requests remain read-only.
 */
export function collectApprovedMerchEvidence(
  rows: MerchEvidenceInput[],
  now = new Date(),
): MerchEvidenceInput[] {
  const seen = new Set<string>();
  const accepted: MerchEvidenceInput[] = [];
  for (const row of rows) {
    if (!row.artistMbid || !row.title.trim()) continue;
    const destinationUrl = normalizeMerchDestination(row.destinationUrl);
    const sourceUrl = safeMerchUrl(row.sourceUrl);
    const imageUrl = safeMerchUrl(row.imageUrl);
    if (
      !destinationUrl ||
      !sourceUrl ||
      !hostAllowedForSource(destinationUrl, row.source, sourceUrl) ||
      row.expiresAt.getTime() <= now.getTime() ||
      !["exact", "trusted"].includes(row.verification ?? "trusted")
    ) {
      continue;
    }
    const key = `${row.artistMbid}:${destinationUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push({
      ...row,
      title: row.title.trim(),
      destinationUrl,
      sourceUrl,
      imageUrl,
      fetchedAt: row.fetchedAt ?? now,
      verification: row.verification ?? "trusted",
    });
  }
  return accepted;
}

/** Persist one bounded collection batch and mark omitted old rows removed. */
export async function persistMerchEvidence(
  artistMbid: string,
  sourceUrl: string,
  rows: MerchEvidenceInput[],
  now = new Date(),
): Promise<number> {
  const normalizedSourceUrl = safeMerchUrl(sourceUrl);
  if (!normalizedSourceUrl) throw new Error("Merch snapshot source URL is unsafe");
  const accepted = collectApprovedMerchEvidence(
    rows.filter((row) => row.artistMbid === artistMbid),
    now,
  );
  await db.transaction(async (tx) => {
    await tx
      .update(artistMerchProductsTable)
      .set({
        status: "removed",
        removedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(artistMerchProductsTable.artistMbid, artistMbid),
          eq(artistMerchProductsTable.sourceUrl, normalizedSourceUrl),
          eq(artistMerchProductsTable.status, "active"),
        ),
      );
    // The update above intentionally marks only this source's previous
    // snapshot removed. Put accepted evidence back to active below.
    for (const row of accepted) {
      const insert: InsertArtistMerchProduct = {
        artistMbid: row.artistMbid,
        title: row.title,
        destinationUrl: row.destinationUrl,
        imageUrl: row.imageUrl ?? null,
        source: row.source,
        sourceUrl: row.sourceUrl,
        providerProductId: row.providerProductId ?? null,
        verification: row.verification ?? "trusted",
        fetchedAt: row.fetchedAt ?? now,
        expiresAt: row.expiresAt,
        removedAt: null,
        status: "active",
        updatedAt: now,
      };
      await tx
        .insert(artistMerchProductsTable)
        .values(insert)
        .onConflictDoUpdate({
          target: [
            artistMerchProductsTable.artistMbid,
            artistMerchProductsTable.destinationUrl,
            artistMerchProductsTable.sourceUrl,
          ],
          set: {
            title: insert.title,
            imageUrl: insert.imageUrl,
            source: insert.source,
            providerProductId: insert.providerProductId,
            verification: insert.verification,
            fetchedAt: insert.fetchedAt,
            expiresAt: insert.expiresAt,
            removedAt: null,
            status: "active",
            updatedAt: now,
          },
        });
    }
  });
  return accepted.length;
}

const MERCH_POLL_INTERVAL_MS = 15 * 60 * 1000;
const MERCH_POLL_WARMUP_MS = 30_000;
const MERCH_BATCH_SIZE = 8;
const MERCH_CONCURRENCY = 2;
let merchPollTimer: ReturnType<typeof setTimeout> | null = null;
let merchPollRunning = false;

async function refreshDueMerchTargets(): Promise<void> {
  if (merchPollRunning) return;
  merchPollRunning = true;
  try {
    const now = new Date();
    const targets = await db
      .select()
      .from(artistMerchSourceTargetsTable)
      .where(and(
        eq(artistMerchSourceTargetsTable.status, "active"),
        lte(artistMerchSourceTargetsTable.refreshAfter, now),
      ))
      .orderBy(asc(artistMerchSourceTargetsTable.refreshAfter))
      .limit(MERCH_BATCH_SIZE);
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const target = targets[cursor++]!;
        const fetchedAt = new Date();
        const nextRefresh = new Date(fetchedAt.getTime() + SOURCE_REFRESH_MS);
        try {
          await collectArtistMerchPage({
            artistMbid: target.artistMbid,
            sourceUrl: target.sourceUrl,
            source: target.source as MerchSource,
            expiresAt: nextRefresh,
          });
          await db
            .update(artistMerchSourceTargetsTable)
            .set({
              lastFetchedAt: fetchedAt,
              lastSuccessAt: fetchedAt,
              lastError: null,
              refreshAfter: nextRefresh,
              updatedAt: fetchedAt,
            })
            .where(eq(artistMerchSourceTargetsTable.id, target.id));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await db
            .update(artistMerchSourceTargetsTable)
            .set({
              lastFetchedAt: fetchedAt,
              lastError: message.slice(0, 500),
              refreshAfter: new Date(fetchedAt.getTime() + SOURCE_ERROR_RETRY_MS),
              updatedAt: fetchedAt,
            })
            .where(eq(artistMerchSourceTargetsTable.id, target.id));
        }
      }
    };
    await Promise.all(Array.from({ length: MERCH_CONCURRENCY }, () => worker()));
  } finally {
    merchPollRunning = false;
  }
}

export function startArtistMerchPoller(): void {
  if (merchPollTimer) return;
  const run = async () => {
    try {
      await refreshDueMerchTargets();
    } catch (error) {
      console.error("[artist-merch] refresh batch failed", error);
    } finally {
      merchPollTimer = setTimeout(run, MERCH_POLL_INTERVAL_MS);
    }
  };
  merchPollTimer = setTimeout(run, MERCH_POLL_WARMUP_MS);
}

export function stopArtistMerchPoller(): void {
  if (merchPollTimer) clearTimeout(merchPollTimer);
  merchPollTimer = null;
}

export type PublicMerchProduct = {
  title: string;
  artist: string;
  artistMbid: string;
  imageUrl: string | null;
  destinationUrl: string;
  source: string;
  provider: string | null;
  kind: "artist_direct" | "label" | "bandcamp" | "product";
};

export function publicMerchProduct(
  row: ArtistMerchProduct,
  artist: string,
): PublicMerchProduct | null {
  const destinationUrl = normalizeMerchDestination(row.destinationUrl);
  const sourceUrl = safeMerchUrl(row.sourceUrl);
  if (
    !destinationUrl ||
    !sourceUrl ||
    !hostAllowedForSource(destinationUrl, row.source as MerchSource, sourceUrl) ||
    row.status !== "active" ||
    row.verification !== "exact" && row.verification !== "trusted" ||
    row.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }
  return {
    title: row.title,
    artist,
    artistMbid: row.artistMbid,
    imageUrl: safeMerchUrl(row.imageUrl),
    destinationUrl,
    source: row.source,
    provider: row.providerProductId,
    kind: row.source === "bandcamp" ? "bandcamp" : "product",
  };
}

export async function loadArtistMerch(
  artistMbids: string[],
  now = new Date(),
): Promise<ArtistMerchProduct[]> {
  if (!artistMbids.length) return [];
  return db
    .select()
    .from(artistMerchProductsTable)
    .where(
      and(
        inArray(artistMerchProductsTable.artistMbid, artistMbids),
        eq(artistMerchProductsTable.status, "active"),
        inArray(artistMerchProductsTable.verification, ["exact", "trusted"]),
        or(isNull(artistMerchProductsTable.expiresAt), gt(artistMerchProductsTable.expiresAt, now)),
      ),
    );
}