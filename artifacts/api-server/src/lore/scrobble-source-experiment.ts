import { lookup as dnsLookup } from "node:dns/promises";
import * as https from "node:https";
import net from "node:net";
import { fetchIcyMetadata, parseStreamTitle } from "./icy.js";
import type { NowPlayingRaw } from "./types.js";

export const SCROBBLE_EXPERIMENT_SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 8_000;
const LASTFM_URL = "https://ws.audioscrobbler.com/2.0/";
const ROCKSKY_URL =
  "https://api.rocksky.app/xrpc/app.rocksky.actor.getActorScrobbles";
const HANDLE_RESOLVER =
  "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle";

export type ExperimentSource = "icy" | "lastfm" | "rocksky_history" | "rocksky_status";
export type IdentityConfidence = "verified" | "candidate" | "listener_control";

export interface ScrobbleExperimentTarget {
  stationSlug: string;
  icyStreamUrl?: string;
  lastfmUser?: string;
  rockskyActor?: string;
  identityConfidence: IdentityConfidence;
  identityEvidenceUrl?: string;
}

export interface ExperimentObservation {
  schemaVersion: 1;
  /** Runner-assigned identity so comparisons never depend on wall-clock rounding. */
  sampleId?: number;
  /** Runner-assigned identity separating repeated uses of the same output path. */
  runId?: string;
  stationSlug: string;
  source: ExperimentSource;
  identityConfidence: IdentityConfidence;
  account?: string;
  observedAt: string;
  providerAt?: string;
  expiresAt?: string;
  nowPlaying: NowPlayingRaw | null;
  current: boolean;
  requestBytes: number;
  elapsedMs: number;
  httpStatus?: number;
  error?: string;
}

export interface ExperimentSummary {
  observations: number;
  usable: number;
  errors: number;
  agreements: number;
  disagreements: number;
  incomparable: number;
  bytesBySource: Partial<Record<ExperimentSource, number>>;
  observationsBySource: Partial<Record<ExperimentSource, number>>;
}

interface FetchJsonResult {
  body: unknown;
  bytes: number;
  elapsedMs: number;
  status: number;
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function fetchJson(
  url: URL | string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FetchJsonResult> {
  const started = performance.now();
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const result = {
    body: text ? (JSON.parse(text) as unknown) : null,
    bytes: Buffer.byteLength(text),
    elapsedMs: Math.round(performance.now() - started),
    status: response.status,
  };
  if (!response.ok) {
    const message = clean(object(result.body)?.["message"]) ?? response.statusText;
    throw Object.assign(new Error(`HTTP ${response.status}: ${message}`), { result });
  }
  return result;
}

export function isPrivateExperimentIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(v6)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  return mapped?.[1] ? isPrivateExperimentIp(mapped[1]) : false;
}

async function publicAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Untrusted endpoint must be credential-free HTTPS");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Untrusted endpoint host is not public");
  }
  if (net.isIP(host)) {
    if (isPrivateExperimentIp(host)) {
      throw new Error("Untrusted endpoint resolved to a private address");
    }
    return { address: host, family: net.isIPv4(host) ? 4 : 6 };
  }
  const addresses = await dnsLookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateExperimentIp(entry.address))) {
    throw new Error("Untrusted endpoint DNS did not resolve exclusively to public addresses");
  }
  const selected = addresses[0]!;
  return { address: selected.address, family: selected.family === 6 ? 6 : 4 };
}

/**
 * Fetch actor-controlled DID/PDS JSON without SSRF or DNS-rebinding exposure.
 * Every redirect is revalidated and each request is pinned to the public
 * address returned by that validation.
 */
async function fetchPinnedPublicJson(
  rawUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  redirects = 3,
): Promise<FetchJsonResult> {
  const started = performance.now();
  let current = new URL(rawUrl);
  let transferred = 0;
  for (let hop = 0; hop <= redirects; hop++) {
    const pinned = await publicAddress(current);
    const response = await new Promise<{
      status: number;
      statusText: string;
      location?: string;
      text: string;
    }>((resolve, reject) => {
      const request = https.get(
        current,
        {
          headers: { Accept: "application/json" },
          lookup: (_hostname, options, callback) => {
            if (options.all) {
              callback(null, [pinned]);
              return;
            }
            callback(null, pinned.address, pinned.family);
          },
          timeout: timeoutMs,
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          incoming.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1_000_000) {
              incoming.destroy(new Error("Untrusted endpoint response exceeded 1 MB"));
              return;
            }
            chunks.push(chunk);
          });
          incoming.on("error", reject);
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              statusText: incoming.statusMessage ?? "",
              ...(incoming.headers.location ? { location: incoming.headers.location } : {}),
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      request.on("timeout", () => request.destroy(new Error("Untrusted endpoint timed out")));
      request.on("error", reject);
    });
    transferred += Buffer.byteLength(response.text);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || hop === redirects) {
        throw new Error("Untrusted endpoint redirect limit exceeded");
      }
      current = new URL(response.location, current);
      continue;
    }
    const body = response.text ? (JSON.parse(response.text) as unknown) : null;
    const result = {
      body,
      bytes: transferred,
      elapsedMs: Math.round(performance.now() - started),
      status: response.status,
    };
    if (response.status < 200 || response.status >= 300) {
      const message = clean(object(body)?.["message"]) ?? response.statusText;
      throw Object.assign(new Error(`HTTP ${response.status}: ${message}`), { result });
    }
    return result;
  }
  throw new Error("Untrusted endpoint redirect limit exceeded");
}

function baseObservation(
  target: ScrobbleExperimentTarget,
  source: ExperimentSource,
  account?: string,
): Omit<ExperimentObservation, "nowPlaying" | "current" | "requestBytes" | "elapsedMs"> {
  return {
    schemaVersion: SCROBBLE_EXPERIMENT_SCHEMA_VERSION,
    stationSlug: target.stationSlug,
    source,
    identityConfidence: target.identityConfidence,
    ...(account ? { account } : {}),
    observedAt: new Date().toISOString(),
  };
}

function failedObservation(
  target: ScrobbleExperimentTarget,
  source: ExperimentSource,
  error: unknown,
  account?: string,
): ExperimentObservation {
  const result = object(object(error)?.["result"]);
  return {
    ...baseObservation(target, source, account),
    nowPlaying: null,
    current: false,
    requestBytes: Number(result?.["bytes"] ?? 0),
    elapsedMs: Number(result?.["elapsedMs"] ?? 0),
    ...(Number.isFinite(Number(result?.["status"]))
      ? { httpStatus: Number(result?.["status"]) }
      : {}),
    error: error instanceof Error ? error.message : String(error),
  };
}

/** Pure Last.fm recent-tracks parser. A completed scrobble is not "current". */
export function parseLastFmRecentTracks(body: unknown): {
  nowPlaying: NowPlayingRaw | null;
  current: boolean;
  providerAt?: string;
} {
  const recent = object(object(body)?.["recenttracks"]);
  const rawTracks = recent?.["track"];
  const first = Array.isArray(rawTracks) ? object(rawTracks[0]) : object(rawTracks);
  if (!first) return { nowPlaying: null, current: false };
  const artistValue = first["artist"];
  const artist =
    clean(artistValue) ?? clean(object(artistValue)?.["#text"]) ?? clean(object(artistValue)?.["name"]);
  const title = clean(first["name"]);
  if (!artist || !title) return { nowPlaying: null, current: false };
  const attributes = object(first["@attr"]);
  const current = clean(attributes?.["nowplaying"])?.toLowerCase() === "true";
  const date = object(first["date"]);
  const uts = Number(clean(date?.["uts"]));
  return {
    nowPlaying: {
      rawArtist: artist,
      rawTitle: title,
      ...(clean(first["album"]) ? { album: clean(first["album"]) } : {}),
    },
    current,
    ...(!current && Number.isFinite(uts)
      ? { providerAt: new Date(uts * 1000).toISOString() }
      : {}),
  };
}

export async function observeLastFm(
  target: ScrobbleExperimentTarget,
  apiKey: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ExperimentObservation> {
  const account = target.lastfmUser;
  if (!account) return failedObservation(target, "lastfm", "Last.fm user is missing");
  try {
    const url = new URL(LASTFM_URL);
    url.search = new URLSearchParams({
      method: "user.getrecenttracks",
      user: account,
      api_key: apiKey,
      format: "json",
      limit: "2",
    }).toString();
    const result = await fetchJson(url, timeoutMs);
    const parsed = parseLastFmRecentTracks(result.body);
    return {
      ...baseObservation(target, "lastfm", account),
      ...parsed,
      requestBytes: result.bytes,
      elapsedMs: result.elapsedMs,
      httpStatus: result.status,
    };
  } catch (error) {
    return failedObservation(target, "lastfm", error, account);
  }
}

/** Pure deployed Rocksky actor-history parser. History is never marked current. */
export function parseRockskyActorScrobbles(body: unknown): {
  nowPlaying: NowPlayingRaw | null;
  current: false;
  providerAt?: string;
} {
  const rows = object(body)?.["scrobbles"];
  const first = Array.isArray(rows) ? object(rows[0]) : null;
  const artist = clean(first?.["artist"]);
  const title = clean(first?.["title"]);
  if (!artist || !title) return { nowPlaying: null, current: false };
  const providerAt = clean(first?.["createdAt"]);
  return {
    nowPlaying: {
      rawArtist: artist,
      rawTitle: title,
      ...(clean(first?.["album"]) ? { album: clean(first?.["album"]) } : {}),
    },
    current: false,
    ...(providerAt ? { providerAt } : {}),
  };
}

export async function observeRockskyHistory(
  target: ScrobbleExperimentTarget,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ExperimentObservation> {
  const account = target.rockskyActor;
  if (!account) return failedObservation(target, "rocksky_history", "Rocksky actor is missing");
  try {
    const url = new URL(ROCKSKY_URL);
    url.search = new URLSearchParams({ did: account, limit: "2", offset: "0" }).toString();
    const result = await fetchJson(url, timeoutMs);
    return {
      ...baseObservation(target, "rocksky_history", account),
      ...parseRockskyActorScrobbles(result.body),
      requestBytes: result.bytes,
      elapsedMs: result.elapsedMs,
      httpStatus: result.status,
    };
  } catch (error) {
    return failedObservation(target, "rocksky_history", error, account);
  }
}

export function parseRockskyStatus(body: unknown, now = new Date()): {
  nowPlaying: NowPlayingRaw | null;
  current: boolean;
  providerAt?: string;
  expiresAt?: string;
} {
  const value = object(object(body)?.["value"]);
  const track = object(value?.["track"]);
  const artist = clean(track?.["artist"]) ?? clean(track?.["artistName"]);
  const title = clean(track?.["title"]) ?? clean(track?.["name"]);
  const providerAt = clean(value?.["startedAt"]);
  const expiresAt = clean(value?.["expiresAt"]);
  const current = Boolean(artist && title && expiresAt && Date.parse(expiresAt) > now.getTime());
  return {
    nowPlaying:
      artist && title
        ? {
            rawArtist: artist,
            rawTitle: title,
            ...(clean(track?.["album"]) ? { album: clean(track?.["album"]) } : {}),
          }
        : null,
    current,
    ...(providerAt ? { providerAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

async function resolveDid(actor: string, timeoutMs: number): Promise<{ did: string; bytes: number; elapsedMs: number }> {
  if (actor.startsWith("did:")) return { did: actor, bytes: 0, elapsedMs: 0 };
  const url = new URL(HANDLE_RESOLVER);
  url.searchParams.set("handle", actor);
  const result = await fetchJson(url, timeoutMs);
  const did = clean(object(result.body)?.["did"]);
  if (!did) throw new Error("Handle resolver returned no DID");
  return { did, bytes: result.bytes, elapsedMs: result.elapsedMs };
}

async function discoverPds(did: string, timeoutMs: number): Promise<{ endpoint: string; bytes: number; elapsedMs: number }> {
  const didUrl = did.startsWith("did:plc:")
    ? `https://plc.directory/${encodeURIComponent(did)}`
    : did.startsWith("did:web:")
      ? `https://${did.slice(8).replaceAll(":", "/")}/.well-known/did.json`
      : "";
  if (!didUrl) throw new Error(`Unsupported DID method: ${did}`);
  const result = did.startsWith("did:web:")
    ? await fetchPinnedPublicJson(didUrl, timeoutMs)
    : await fetchJson(didUrl, timeoutMs);
  const services = object(result.body)?.["service"];
  const entry = Array.isArray(services)
    ? services.map(object).find((service) => service?.["type"] === "AtprotoPersonalDataServer")
    : null;
  const endpoint = clean(entry?.["serviceEndpoint"]);
  if (!endpoint) throw new Error("DID document has no AT Protocol PDS");
  return { endpoint, bytes: result.bytes, elapsedMs: result.elapsedMs };
}

export async function observeRockskyStatus(
  target: ScrobbleExperimentTarget,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ExperimentObservation> {
  const account = target.rockskyActor;
  if (!account) return failedObservation(target, "rocksky_status", "Rocksky actor is missing");
  try {
    const resolved = await resolveDid(account, timeoutMs);
    const pds = await discoverPds(resolved.did, timeoutMs);
    const url = new URL("/xrpc/com.atproto.repo.getRecord", pds.endpoint);
    url.search = new URLSearchParams({
      repo: resolved.did,
      collection: "app.rocksky.actor.status",
      rkey: "self",
    }).toString();
    const result = await fetchPinnedPublicJson(url.toString(), timeoutMs);
    return {
      ...baseObservation(target, "rocksky_status", account),
      ...parseRockskyStatus(result.body),
      requestBytes: resolved.bytes + pds.bytes + result.bytes,
      elapsedMs: resolved.elapsedMs + pds.elapsedMs + result.elapsedMs,
      httpStatus: result.status,
    };
  } catch (error) {
    return failedObservation(target, "rocksky_status", error, account);
  }
}

export async function observeIcy(
  target: ScrobbleExperimentTarget,
): Promise<ExperimentObservation> {
  const started = performance.now();
  const base = baseObservation(target, "icy");
  if (!target.icyStreamUrl) return failedObservation(target, "icy", "ICY stream URL is missing");
  try {
    const result = await fetchIcyMetadata(target.icyStreamUrl);
    if (!result.ok) {
      return {
        ...base,
        nowPlaying: null,
        current: false,
        requestBytes: 0,
        elapsedMs: Math.round(performance.now() - started),
        error: `${result.kind}: ${result.message ?? "no detail"}`,
      };
    }
    const parsed = result.streamTitle ? parseStreamTitle(result.streamTitle) : null;
    return {
      ...base,
      nowPlaying: parsed
        ? { rawArtist: parsed.rawArtist ?? "", rawTitle: parsed.rawTitle }
        : null,
      current: Boolean(parsed),
      // fetchIcyMetadata intentionally does not expose transport byte counts.
      requestBytes: 0,
      elapsedMs: Math.round(performance.now() - started),
      httpStatus: 200,
    };
  } catch (error) {
    return failedObservation(target, "icy", error);
  }
}

function identity(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function tracksAgree(
  left: NowPlayingRaw | null,
  right: NowPlayingRaw | null,
): boolean | null {
  if (!left || !right || !left.rawArtist || !right.rawArtist) return null;
  return identity(left.rawArtist) === identity(right.rawArtist) &&
    identity(left.rawTitle) === identity(right.rawTitle);
}

export function summarizeExperiment(observations: ExperimentObservation[]): ExperimentSummary {
  const summary: ExperimentSummary = {
    observations: observations.length,
    usable: 0,
    errors: 0,
    agreements: 0,
    disagreements: 0,
    incomparable: 0,
    bytesBySource: {},
    observationsBySource: {},
  };
  for (const row of observations) {
    if (row.nowPlaying) summary.usable++;
    if (row.error) summary.errors++;
    summary.bytesBySource[row.source] = (summary.bytesBySource[row.source] ?? 0) + row.requestBytes;
    summary.observationsBySource[row.source] =
      (summary.observationsBySource[row.source] ?? 0) + 1;
  }
  const bySample = new Map<string, ExperimentObservation[]>();
  for (const row of observations) {
    const key = `${row.stationSlug}:${row.sampleId ?? row.observedAt.slice(0, 16)}`;
    bySample.set(key, [...(bySample.get(key) ?? []), row]);
  }
  for (const rows of bySample.values()) {
    const icy = rows.find((row) => row.source === "icy");
    for (const row of rows.filter((candidate) => candidate.source !== "icy")) {
      const expiresAt = row.expiresAt ? Date.parse(row.expiresAt) : null;
      const expiresBeforeObservation =
        expiresAt != null && expiresAt <= Date.parse(row.observedAt);
      const comparable =
        icy?.current === true &&
        row.current === true &&
        !expiresBeforeObservation;
      const agreement = comparable
        ? tracksAgree(icy.nowPlaying, row.nowPlaying)
        : null;
      if (agreement === true) summary.agreements++;
      else if (agreement === false) summary.disagreements++;
      else summary.incomparable++;
    }
  }
  return summary;
}

export function modelFleetCost(
  stations: number,
  cadenceSeconds: number,
  measuredBytesPerRequest: number,
): { requestsPerDay: number; requestsPerSecond: number; bytesPerDay: number } {
  const requestsPerDay = Math.ceil((86_400 / cadenceSeconds) * stations);
  return {
    requestsPerDay,
    requestsPerSecond: stations / cadenceSeconds,
    bytesPerDay: requestsPerDay * measuredBytesPerRequest,
  };
}