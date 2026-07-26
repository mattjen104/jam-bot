import { db, stationsTable, type Station } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logSpinIfChanged } from "./resolve.js";
import { parseStreamTitle, isJunkMetadata } from "./icy.js";
import type { NowPlayingRaw } from "./types.js";

/**
 * Multiplexed now-playing tier — one request (or one connection) covers many
 * stations.
 *
 *  - Icecast hosts expose `/status-json.xsl`, listing every mount on the host
 *    in a single response. Stations sharing a host are grouped and polled by
 *    ONE short-interval fetch per host, fanned out to each enrolled mount
 *    (~10s effective latency, no held-open sockets).
 *  - AzuraCast instances expose an SSE endpoint that multiplexes all their
 *    stations over one connection (instant updates). On persistent SSE
 *    failure the instance degrades to polling its aggregate
 *    `/api/nowplaying` — still one request for the whole host — and, failing
 *    everything, stations fall back to per-station interval polling via a
 *    hook injected by the poller.
 *
 * Classification is probed once per host at enrollment (or one-off backfill)
 * and persisted on each station's nowPlayingConfig as
 * `multiplex: { kind: "icecast" | "azuracast" | "none", shortcode? }`, so
 * boots never re-probe. Metadata dispatch goes through the exact same
 * pipeline as every other tier (`logSpinIfChanged`): dedup, junk/ad
 * filtering, and the live spin feed behave identically.
 */

const HOST_POLL_MS = 10_000;
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_STAGGER_MS = 300;
const SSE_BACKOFF_FLOOR_MS = 5_000;
const SSE_BACKOFF_CAP_MS = 300_000;
const SSE_FAILURE_WINDOW_MS = 10 * 60_000;
const SSE_FAILURE_LIMIT = 5;
const SSE_IDLE_TIMEOUT_MS = 90_000;

export type MultiplexKind = "icecast" | "azuracast" | "none";

export interface MultiplexConfig {
  kind: MultiplexKind;
  /** AzuraCast station shortcode (channel key), when kind = azuracast. */
  shortcode?: string;
  probedAt?: string;
}

/** Fallback hook installed by the poller: per-station interval polling. */
type ReenrollHook = (station: Station) => void;
let fallbackToInterval: ReenrollHook = () => {};
let reenrollStation: ReenrollHook = () => {};

/**
 * Install poller hooks. `fallback` schedules classic per-station interval
 * polling (used when every multiplexed path for a host is dead). `reenroll`
 * re-routes a station after a probe classifies its host (goes through the
 * poller's normal enroll path so watcher/lease/hidden rules are honored).
 */
export function initHostMultiplex(hooks: {
  fallback: ReenrollHook;
  reenroll: ReenrollHook;
}): void {
  fallbackToInterval = hooks.fallback;
  reenrollStation = hooks.reenroll;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Origin (protocol://host:port) of a stream URL, or null when unparseable. */
export function streamOrigin(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Pathname of a URL (mount identity on a host), or null. */
export function mountPath(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).pathname || "/";
  } catch {
    return null;
  }
}

export interface IcecastMount {
  /** Mount path from listenurl (e.g. "/stream" ). */
  path: string;
  /** Raw StreamTitle-equivalent text, or null when the mount has none. */
  streamTitle: string | null;
}

/**
 * Parse an Icecast `/status-json.xsl` body into per-mount now-playing text.
 * `icestats.source` may be a single object, an array, or absent. A mount's
 * text prefers `artist` + `title` (joined "Artist - Title"), falling back to
 * bare `title`.
 */
export function parseIcecastStatus(body: unknown): IcecastMount[] {
  const icestats = (body as { icestats?: unknown })?.icestats as
    | Record<string, unknown>
    | undefined;
  if (!icestats) return [];
  const raw = icestats["source"];
  const sources: Array<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>)
    : raw && typeof raw === "object"
      ? [raw as Record<string, unknown>]
      : [];
  const out: IcecastMount[] = [];
  for (const src of sources) {
    const listenurl = typeof src["listenurl"] === "string" ? src["listenurl"] : null;
    const path = listenurl ? mountPath(listenurl) : null;
    if (!path) continue;
    const title = typeof src["title"] === "string" ? src["title"].trim() : "";
    const artist = typeof src["artist"] === "string" ? src["artist"].trim() : "";
    const streamTitle = artist && title ? `${artist} - ${title}` : title || null;
    out.push({ path, streamTitle });
  }
  return out;
}

export interface AzuraStationInfo {
  shortcode: string;
  /** All listen/mount URLs advertised for the station. */
  urls: string[];
}

/** Parse an AzuraCast `/api/nowplaying` body into station shortcodes + URLs. */
export function parseAzuraStations(body: unknown): AzuraStationInfo[] {
  if (!Array.isArray(body)) return [];
  const out: AzuraStationInfo[] = [];
  for (const entry of body as Array<Record<string, unknown>>) {
    const station = entry?.["station"] as Record<string, unknown> | undefined;
    const shortcode =
      typeof station?.["shortcode"] === "string" ? station["shortcode"] : null;
    if (!shortcode) continue;
    const urls: string[] = [];
    const listenUrl = station?.["listen_url"];
    if (typeof listenUrl === "string" && listenUrl) urls.push(listenUrl);
    const mounts = station?.["mounts"];
    if (Array.isArray(mounts)) {
      for (const m of mounts as Array<Record<string, unknown>>) {
        const u = m?.["url"] ?? m?.["listen_url"];
        if (typeof u === "string" && u) urls.push(u);
      }
    }
    out.push({ shortcode, urls });
  }
  return out;
}

/**
 * Extract `{ shortcode, rawArtist, rawTitle }` from an AzuraCast now-playing
 * object (the `np` payload used by both the aggregate API and SSE pushes).
 */
export function extractAzuraNowPlaying(np: unknown): {
  shortcode: string | null;
  rawArtist: string;
  rawTitle: string;
} | null {
  const n = np as Record<string, unknown> | undefined;
  if (!n) return null;
  const station = n["station"] as Record<string, unknown> | undefined;
  const shortcode =
    typeof station?.["shortcode"] === "string" ? station["shortcode"] : null;
  const nowPlaying = n["now_playing"] as Record<string, unknown> | undefined;
  const song = nowPlaying?.["song"] as Record<string, unknown> | undefined;
  const artist = typeof song?.["artist"] === "string" ? song["artist"].trim() : "";
  const title = typeof song?.["title"] === "string" ? song["title"].trim() : "";
  if (!title && !artist) {
    // Fall back to the combined text field ("Artist - Title").
    const text = typeof song?.["text"] === "string" ? song["text"].trim() : "";
    if (!text) return null;
    const parsed = parseStreamTitle(text);
    if (!parsed) return null;
    return {
      shortcode,
      rawArtist: parsed.rawArtist ?? "",
      rawTitle: parsed.rawTitle,
    };
  }
  if (!title) return null;
  return { shortcode, rawArtist: artist, rawTitle: title };
}

/** Read the persisted multiplex classification off a station's config. */
export function getMultiplexConfig(station: Station): MultiplexConfig | null {
  const config = (station.nowPlayingConfig ?? {}) as Record<string, unknown>;
  const m = config["multiplex"] as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return null;
  const kind = m["kind"];
  if (kind !== "icecast" && kind !== "azuracast" && kind !== "none") return null;
  const out: MultiplexConfig = { kind };
  if (typeof m["shortcode"] === "string") out.shortcode = m["shortcode"];
  return out;
}

function stationStreamUrl(station: Station): string | null {
  const config = (station.nowPlayingConfig ?? {}) as Record<string, unknown>;
  const fromConfig = config["streamUrl"];
  if (typeof fromConfig === "string" && fromConfig) return fromConfig;
  return station.streamUrl || null;
}

// ---------------------------------------------------------------------------
// Shared dispatch — identical pipeline to every other tier
// ---------------------------------------------------------------------------

function dispatchStreamTitle(station: Station, streamTitle: string): void {
  const parsed = parseStreamTitle(streamTitle);
  if (!parsed) return;
  const rawArtist = parsed.rawArtist ?? "";
  if (isJunkMetadata(rawArtist, parsed.rawTitle)) return;
  const np: NowPlayingRaw = {
    rawArtist,
    rawTitle: parsed.rawTitle,
    ...(parsed.durationMs ? { durationMs: parsed.durationMs } : {}),
    ...(parsed.sourceRecordingId
      ? { recordingId: parsed.sourceRecordingId }
      : {}),
  };
  void logSpinIfChanged(station, np).then((wrote) => {
    if (wrote) {
      console.info(
        `[lore] ${station.slug} now playing (host): ${np.rawArtist} — ${np.rawTitle}`,
      );
    }
  });
}

function dispatchArtistTitle(
  station: Station,
  rawArtist: string,
  rawTitle: string,
): void {
  if (isJunkMetadata(rawArtist, rawTitle)) return;
  const np: NowPlayingRaw = { rawArtist, rawTitle };
  void logSpinIfChanged(station, np).then((wrote) => {
    if (wrote) {
      console.info(
        `[lore] ${station.slug} now playing (host): ${rawArtist} — ${rawTitle}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Icecast / AzuraCast-poll host groups (one request per host per tick)
// ---------------------------------------------------------------------------

interface HostGroup {
  origin: string;
  flavor: "icecast" | "azuracast-poll";
  /** stationId → station row (fresh enough; carries slug + config). */
  stations: Map<number, Station>;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
}

const hostGroups = new Map<string, HostGroup>();

function groupKey(origin: string, flavor: HostGroup["flavor"]): string {
  return `${flavor}\u001f${origin}`;
}

async function pollHostGroup(group: HostGroup): Promise<void> {
  if (group.inFlight) return; // overlap guard — one fetch per host at a time
  group.inFlight = true;
  try {
    if (group.flavor === "icecast") {
      const res = await fetch(`${group.origin}/status-json.xsl`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) return;
      const mounts = parseIcecastStatus(await res.json());
      if (mounts.length === 0) return;
      const byPath = new Map(mounts.map((m) => [m.path, m]));
      for (const station of group.stations.values()) {
        const url = stationStreamUrl(station);
        const path = url ? mountPath(url) : null;
        const mount = path ? byPath.get(path) : undefined;
        if (mount?.streamTitle) dispatchStreamTitle(station, mount.streamTitle);
      }
    } else {
      const res = await fetch(`${group.origin}/api/nowplaying`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) return;
      const body = (await res.json()) as unknown[];
      if (!Array.isArray(body)) return;
      const byShortcode = new Map<number, string>();
      for (const [id, s] of group.stations) {
        const sc = getMultiplexConfig(s)?.shortcode;
        if (sc) byShortcode.set(id, sc);
      }
      for (const entry of body) {
        const np = extractAzuraNowPlaying(entry);
        if (!np?.shortcode) continue;
        for (const [id, sc] of byShortcode) {
          if (sc !== np.shortcode) continue;
          const station = group.stations.get(id);
          if (station) dispatchArtistTitle(station, np.rawArtist, np.rawTitle);
        }
      }
    }
  } catch {
    // Transient host failure — next tick retries; per-station history is
    // unaffected (dedup means missed ticks only add latency, never dupes).
  } finally {
    group.inFlight = false;
  }
}

function joinHostGroup(
  origin: string,
  flavor: HostGroup["flavor"],
  station: Station,
): void {
  const key = groupKey(origin, flavor);
  let group = hostGroups.get(key);
  if (!group) {
    group = { origin, flavor, stations: new Map(), timer: null, inFlight: false };
    hostGroups.set(key, group);
    group.timer = setInterval(() => void pollHostGroup(group!), HOST_POLL_MS);
    // First tick promptly so a newly enrolled station shows up fast.
    setTimeout(() => void pollHostGroup(group!), 1_000);
  }
  group.stations.set(station.id, station);
}

// ---------------------------------------------------------------------------
// AzuraCast SSE (one connection per instance)
// ---------------------------------------------------------------------------

interface SseConn {
  origin: string;
  /** stationId → station row; shortcodes derived from each station's config. */
  stations: Map<number, Station>;
  abort: AbortController | null;
  reconnectTimer: NodeJS.Timeout | null;
  backoffMs: number;
  failureTimestamps: number[];
  /** Bumped on every membership change so a stale loop exits. */
  generation: number;
  dead: boolean;
}

const sseConns = new Map<string, SseConn>();

function sseSubs(conn: SseConn): Record<string, object> {
  const subs: Record<string, object> = {};
  for (const s of conn.stations.values()) {
    const sc = getMultiplexConfig(s)?.shortcode;
    if (sc) subs[`station:${sc}`] = {};
  }
  return subs;
}

function dispatchSsePayload(conn: SseConn, payload: unknown): void {
  const p = payload as Record<string, unknown>;
  const npObjects: unknown[] = [];
  // Initial connect frame: { connect: { subs: { "station:x": { publications: [{ data: { np } }] } } } }
  const connect = p["connect"] as Record<string, unknown> | undefined;
  const subs = connect?.["subs"] as Record<string, unknown> | undefined;
  if (subs) {
    for (const sub of Object.values(subs)) {
      const pubs = (sub as Record<string, unknown>)?.["publications"];
      if (!Array.isArray(pubs)) continue;
      for (const pub of pubs) {
        const data = (pub as Record<string, unknown>)?.["data"] as
          | Record<string, unknown>
          | undefined;
        if (data?.["np"]) npObjects.push(data["np"]);
      }
    }
  }
  // Update frame: { channel, pub: { data: { np } } }
  const pub = p["pub"] as Record<string, unknown> | undefined;
  const pubData = pub?.["data"] as Record<string, unknown> | undefined;
  if (pubData?.["np"]) npObjects.push(pubData["np"]);

  for (const npRaw of npObjects) {
    const np = extractAzuraNowPlaying(npRaw);
    if (!np?.shortcode) continue;
    for (const station of conn.stations.values()) {
      if (getMultiplexConfig(station)?.shortcode !== np.shortcode) continue;
      dispatchArtistTitle(station, np.rawArtist, np.rawTitle);
    }
  }
}

/** Demote every station on a dead SSE instance to the aggregate host poller. */
function degradeSseToPolling(conn: SseConn): void {
  conn.dead = true;
  if (conn.abort) conn.abort.abort();
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
  sseConns.delete(conn.origin);
  console.warn(
    `[lore:mux] azuracast SSE ${conn.origin} giving up; degrading ${conn.stations.size} station(s) to aggregate polling`,
  );
  for (const station of conn.stations.values()) {
    joinHostGroup(conn.origin, "azuracast-poll", station);
  }
}

function sseOnFailure(conn: SseConn, message: string): void {
  if (conn.dead) return;
  const now = Date.now();
  conn.failureTimestamps = conn.failureTimestamps.filter(
    (t) => now - t < SSE_FAILURE_WINDOW_MS,
  );
  conn.failureTimestamps.push(now);
  if (conn.failureTimestamps.length >= SSE_FAILURE_LIMIT) {
    degradeSseToPolling(conn);
    return;
  }
  console.warn(
    `[lore:mux] azuracast SSE ${conn.origin}: ${message}; reconnecting in ${Math.round(conn.backoffMs / 1000)}s`,
  );
  conn.reconnectTimer = setTimeout(() => connectSse(conn), conn.backoffMs);
  conn.backoffMs = Math.min(conn.backoffMs * 2, SSE_BACKOFF_CAP_MS);
}

function connectSse(conn: SseConn): void {
  if (conn.dead || conn.stations.size === 0) return;
  const generation = ++conn.generation;
  const abort = new AbortController();
  conn.abort = abort;

  const cfConnect = encodeURIComponent(JSON.stringify({ subs: sseSubs(conn) }));
  const url = `${conn.origin}/api/live/nowplaying/sse?cf_connect=${cfConnect}`;

  void (async () => {
    let idleTimer: NodeJS.Timeout | null = null;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort.abort(), SSE_IDLE_TIMEOUT_MS);
    };
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      armIdle();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (conn.generation !== generation) return; // membership changed
        armIdle();
        // Success signal — reset backoff/failures once bytes flow.
        conn.backoffMs = SSE_BACKOFF_FLOOR_MS;
        conn.failureTimestamps = [];
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trimEnd();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json || json === "{}") continue; // keepalive ping
          try {
            dispatchSsePayload(conn, JSON.parse(json));
          } catch {
            // Malformed frame — skip; the stream continues.
          }
        }
      }
      throw new Error("stream ended");
    } catch (err) {
      if (conn.generation !== generation || conn.dead) return;
      sseOnFailure(conn, err instanceof Error ? err.message : String(err));
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  })();
}

function joinSse(origin: string, station: Station): void {
  let conn = sseConns.get(origin);
  if (!conn) {
    conn = {
      origin,
      stations: new Map(),
      abort: null,
      reconnectTimer: null,
      backoffMs: SSE_BACKOFF_FLOOR_MS,
      failureTimestamps: [],
      generation: 0,
      dead: false,
    };
    sseConns.set(origin, conn);
  }
  conn.stations.set(station.id, station);
  // (Re)connect with the updated subscription set.
  if (conn.abort) conn.abort.abort();
  if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
  connectSse(conn);
}

// ---------------------------------------------------------------------------
// Public tier API (used by the poller)
// ---------------------------------------------------------------------------

/**
 * Route a station into the multiplexed tier when its host classification
 * supports it. Returns true when the station is now covered (host group or
 * SSE), false when the caller should use per-station interval polling.
 */
export function tryJoinHostGroup(station: Station): boolean {
  if (station.nowPlayingSource !== "radio_browser_icy") return false;
  const mux = getMultiplexConfig(station);
  if (!mux || mux.kind === "none") return false;
  const url = stationStreamUrl(station);
  const origin = url ? streamOrigin(url) : null;
  if (!origin) return false;
  if (mux.kind === "icecast") {
    joinHostGroup(origin, "icecast", station);
    return true;
  }
  if (mux.kind === "azuracast" && mux.shortcode) {
    joinSse(origin, station);
    return true;
  }
  return false;
}

/** Remove a station from every host group / SSE connection, tearing down the
 * host poller or connection when the last station leaves. */
export function leaveHostGroups(stationId: number): void {
  for (const [key, group] of hostGroups) {
    if (!group.stations.delete(stationId)) continue;
    if (group.stations.size === 0) {
      if (group.timer) clearInterval(group.timer);
      hostGroups.delete(key);
    }
  }
  for (const [origin, conn] of sseConns) {
    if (!conn.stations.delete(stationId)) continue;
    if (conn.stations.size === 0) {
      conn.dead = true;
      if (conn.abort) conn.abort.abort();
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      sseConns.delete(origin);
    } else {
      // Reconnect with the reduced subscription set.
      if (conn.abort) conn.abort.abort();
      connectSse(conn);
    }
  }
}

/** Stop everything (tests / shutdown). */
export function stopHostMultiplex(): void {
  for (const group of hostGroups.values()) {
    if (group.timer) clearInterval(group.timer);
  }
  hostGroups.clear();
  for (const conn of sseConns.values()) {
    conn.dead = true;
    if (conn.abort) conn.abort.abort();
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
  }
  sseConns.clear();
  probedHosts.clear();
}

// ---------------------------------------------------------------------------
// Host capability probe (once per host; persisted per station)
// ---------------------------------------------------------------------------

/** Hosts with a probe finished or in flight this process. */
const probedHosts = new Map<string, Promise<ProbeResult>>();

interface ProbeResult {
  kind: MultiplexKind;
  azStations: AzuraStationInfo[];
}

async function probeHost(origin: string): Promise<ProbeResult> {
  // AzuraCast first — an AzuraCast instance often also serves Icecast status,
  // but the SSE feed is strictly better when available.
  try {
    const res = await fetch(`${origin}/api/nowplaying`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) {
      const azStations = parseAzuraStations(await res.json());
      if (azStations.length > 0) return { kind: "azuracast", azStations };
    }
  } catch {
    // Not AzuraCast — try Icecast.
  }
  try {
    const res = await fetch(`${origin}/status-json.xsl`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as { icestats?: unknown };
      if (body && typeof body === "object" && "icestats" in body) {
        return { kind: "icecast", azStations: [] };
      }
    }
  } catch {
    // Neither — plain per-station polling remains.
  }
  return { kind: "none", azStations: [] };
}

/** Match a station's stream URL against AzuraCast station listen URLs. */
export function matchAzuraShortcode(
  stationUrl: string,
  azStations: AzuraStationInfo[],
): string | null {
  const path = mountPath(stationUrl);
  if (!path) return null;
  for (const az of azStations) {
    for (const u of az.urls) {
      if (mountPath(u) === path) return az.shortcode;
    }
  }
  return null;
}

/**
 * Queue a one-time capability probe for a station's host. No-op when the
 * station already carries a persisted classification. On completion the
 * classification is persisted to the station's nowPlayingConfig and the
 * station is re-enrolled through the poller (which routes it into the new
 * tier live). Probes are deduplicated per host within the process.
 */
export function queueHostProbe(station: Station): void {
  if (getMultiplexConfig(station)) return; // already classified
  const url = stationStreamUrl(station);
  const origin = url ? streamOrigin(url) : null;
  if (!origin) return;

  let probe = probedHosts.get(origin);
  if (!probe) {
    probe = probeHost(origin);
    probedHosts.set(origin, probe);
  }

  void probe
    .then(async (result) => {
      const streamUrl = stationStreamUrl(station);
      const mux: MultiplexConfig = { kind: result.kind, probedAt: new Date().toISOString() };
      if (result.kind === "azuracast" && streamUrl) {
        const shortcode = matchAzuraShortcode(streamUrl, result.azStations);
        if (shortcode) mux.shortcode = shortcode;
        else mux.kind = "none"; // instance found but this mount isn't on it
      }
      // Persist via an atomic jsonb merge — only the `multiplex` key is
      // touched, so a concurrent admin edit to any other config field can
      // never be clobbered by a read-merge-write race.
      const [updated] = await db
        .update(stationsTable)
        .set({
          nowPlayingConfig: sql`coalesce(${stationsTable.nowPlayingConfig}, '{}'::jsonb) || ${JSON.stringify({ multiplex: mux })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(stationsTable.id, station.id))
        .returning();
      if (!updated || mux.kind === "none" || updated.hidden) return;
      // Live re-route through the poller's normal enroll path.
      reenrollStation(updated);
      console.info(
        `[lore:mux] ${updated.slug}: host ${origin} classified as ${mux.kind}` +
          (mux.shortcode ? ` (shortcode ${mux.shortcode})` : ""),
      );
    })
    .catch((err) => {
      console.error(`[lore:mux] probe failed for ${origin}`, err);
    });
}

/**
 * One-off backfill: probe hosts for every existing interval-tier ICY station
 * that has no persisted classification yet. Staggered so hundreds of distinct
 * hosts don't get probed in the same tick. Safe to call every boot — stations
 * already classified are skipped, so steady-state cost is zero.
 */
export function backfillHostProbes(stations: Station[]): void {
  const pending = stations.filter(
    (s) =>
      s.nowPlayingSource === "radio_browser_icy" &&
      !s.hidden &&
      !getMultiplexConfig(s),
  );
  if (pending.length === 0) return;
  console.info(`[lore:mux] probing hosts for ${pending.length} unclassified station(s)`);
  // Stagger per distinct host (dedup happens in queueHostProbe).
  const seen = new Set<string>();
  let i = 0;
  for (const station of pending) {
    const url = stationStreamUrl(station);
    const origin = url ? streamOrigin(url) : null;
    if (!origin) continue;
    const delay = seen.has(origin) ? 0 : PROBE_STAGGER_MS * i++;
    seen.add(origin);
    setTimeout(() => queueHostProbe(station), delay);
  }
}

/** Snapshot for logging/diagnostics: host groups + SSE connections. */
export function getMultiplexStatus(): {
  hostGroups: Array<{ origin: string; flavor: string; stations: number }>;
  sse: Array<{ origin: string; stations: number }>;
} {
  return {
    hostGroups: [...hostGroups.values()].map((g) => ({
      origin: g.origin,
      flavor: g.flavor,
      stations: g.stations.size,
    })),
    sse: [...sseConns.values()].map((c) => ({
      origin: c.origin,
      stations: c.stations.size,
    })),
  };
}

/** Expose the interval fallback for future use (SSE + poll both dead). */
export function fallbackStationToInterval(station: Station): void {
  fallbackToInterval(station);
}
