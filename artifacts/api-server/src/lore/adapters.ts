import type {
  NowPlayingAdapter,
  NowPlayingRaw,
  HistoryAdapter,
  RawSpin,
  ShowAttribution,
  HistorySourceContract,
  HistorySourceFamily,
  FetchRecentOptions,
} from "./types.js";
import { usableShowAttribution } from "@workspace/lore-attribution";
import { XMLParser } from "fast-xml-parser";

/**
 * Per-source adapter registry. Two families, both reading a station's OWN
 * published metadata via official APIs/feeds — never scraping, never touching
 * the audio:
 *
 *  - Now-playing adapters expose only "the current track" with no stable id or
 *    timestamp (Radio Paradise, generic station_page). They drive the
 *    change-detection ingest path.
 *  - History adapters return a batch of recent plays with a stable id +
 *    timestamp (KEXP, Spinitron, BBC). They drive the idempotent, cursor-based
 *    ingest path and can backfill on enroll.
 *
 * Adding a source is writing one adapter + registering it; nothing else in the
 * pipeline changes. Every adapter is best-effort and must never throw.
 */

const FETCH_TIMEOUT_MS = 8000;

async function getJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Parse an ISO/date-ish string to a Date, or undefined when unusable. */
function toDate(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Parse a station-local `YYYY-MM-DD HH:mm:ss` timestamp in an IANA timezone.
 * The WICB archive omits an offset, so treating it as the server timezone
 * would move every summer play four hours late.
 */
function localDateInTimeZone(v: unknown, timeZone: string): Date | undefined {
  const s = str(v);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s ?? "");
  if (!match) return undefined;
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const localAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const offsetAt = (epochMs: number) => {
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(epochMs))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    return (
      Date.UTC(
        values.year,
        values.month - 1,
        values.day,
        values.hour,
        values.minute,
        values.second,
      ) - epochMs
    );
  };
  let epochMs = localAsUtc - offsetAt(localAsUtc);
  epochMs = localAsUtc - offsetAt(epochMs);
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function reportReview(
  opts: FetchRecentOptions | undefined,
  seen: number,
  parsed: number,
): void {
  const rejected = Math.max(0, seen - parsed);
  opts?.onReview?.({
    seen,
    parsed,
    rejected,
    ...(rejected ? { rejectionCounts: { invalid_row: rejected } } : {}),
  });
}

// ---- Radio Paradise (now-playing, change-detection) --------------------

/**
 * Radio Paradise — a single JSON now-playing endpoint per channel. Gives
 * artist/title/album/cover but no MBID or ISRC, so these resolve via text search.
 * Config: `{ chan: "0" }` (0=Main, 1=Mellow, 2=Rock, ...).
 */
export function parseRadioParadiseNowPlaying(
  body: unknown,
): NowPlayingRaw | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const rawArtist = str(obj.artist);
  const rawTitle = str(obj.title);
  if (!rawArtist || !rawTitle) return null;
  const out: NowPlayingRaw = { rawArtist, rawTitle };
  const album = str(obj.album);
  if (album) out.album = album;
  const artwork = str(obj.cover);
  if (artwork) out.artworkUrl = artwork;
  return out;
}

const radioParadise: NowPlayingAdapter = async (config) => {
  const chan = str(config.chan) ?? "0";
  const body = await getJson(
    `https://api.radioparadise.com/api/now_playing?chan=${encodeURIComponent(chan)}`,
  );
  return parseRadioParadiseNowPlaying(body);
};

// ---- station_page (now-playing, config-driven, change-detection) -------

/** Pure: read a dot-path (`a.b.0.c`) from a nested object, or undefined. */
export function pickPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(seg);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Pure: shape a published now-playing JSON body into a NowPlayingRaw using an
 * admin-stored parser config of dot-paths. Returns null when artist or title is
 * missing. This is what lets us enroll a station whose broadcaster publishes a
 * now-playing endpoint without writing a bespoke adapter.
 *
 * Config keys: `artistPath`, `titlePath` (required), `albumPath`,
 * `artworkPath` (optional).
 */
export function parseStationPage(
  body: unknown,
  config: Record<string, unknown>,
): NowPlayingRaw | null {
  const artistPath = str(config.artistPath);
  const titlePath = str(config.titlePath);
  if (!artistPath || !titlePath) return null;
  const rawArtist = str(pickPath(body, artistPath));
  const rawTitle = str(pickPath(body, titlePath));
  if (!rawArtist || !rawTitle) return null;
  const out: NowPlayingRaw = { rawArtist, rawTitle };
  const albumPath = str(config.albumPath);
  if (albumPath) {
    const album = str(pickPath(body, albumPath));
    if (album) out.album = album;
  }
  const artworkPath = str(config.artworkPath);
  if (artworkPath) {
    const artwork = str(pickPath(body, artworkPath));
    if (artwork) out.artworkUrl = artwork;
  }
  return out;
}

const stationPage: NowPlayingAdapter = async (config) => {
  const url = str(config.url);
  if (!url) return null;
  const body = await getJson(url);
  return parseStationPage(body, config);
};

// ---- Configured first-party history surfaces -----------------------------

/**
 * Read a configured history item without inferring missing identity. These
 * adapters are intentionally schema-driven: an operator supplies paths for
 * every field that the station actually publishes.
 */
function parseConfiguredHistoryItems(
  items: unknown[],
  config: Record<string, unknown>,
  sourceUrl: string,
): RawSpin[] {
  const itemPath = (name: string) => str(config[name]);
  const out: RawSpin[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rawArtist = str(pickPath(item, itemPath("artistPath") ?? ""));
    const rawTitle = str(pickPath(item, itemPath("titlePath") ?? ""));
    if (!rawArtist || !rawTitle) continue;
    const spin: RawSpin = {
      rawArtist,
      rawTitle,
      sourceUrl,
      sourceFamily:
        (str(config.sourceFamily) as HistorySourceFamily | undefined) ??
        "official_api",
    };
    const id = str(pickPath(item, itemPath("idPath") ?? ""));
    if (id) spin.externalId = `${str(config.sourceKey) ?? "station"}:${id}`;
    const playedAt = toDate(pickPath(item, itemPath("playedAtPath") ?? ""));
    if (playedAt) spin.playedAt = playedAt;
    const album = str(pickPath(item, itemPath("albumPath") ?? ""));
    if (album) spin.album = album;
    const isrc = str(pickPath(item, itemPath("isrcPath") ?? ""));
    if (isrc) spin.isrc = isrc;
    const recordingId = str(
      pickPath(item, itemPath("recordingIdPath") ?? ""),
    );
    if (recordingId) spin.recordingId = recordingId;
    const duration = Number(
      pickPath(item, itemPath("durationMsPath") ?? ""),
    );
    if (Number.isFinite(duration) && duration > 0) spin.durationMs = duration;
    const showName = str(pickPath(item, itemPath("showPath") ?? ""));
    const djName = str(pickPath(item, itemPath("djPath") ?? ""));
    if (showName) {
      const usable = usableShowAttribution(
        { name: showName, ...(djName ? { djName } : {}) },
        { artist: rawArtist, title: rawTitle },
      );
      if (usable) spin.show = usable;
    }
    const archiveTemplate = str(config.archiveUrl);
    if (archiveTemplate && spin.playedAt) {
      spin.citationUrl = archiveTemplate.replace(
        "{date}",
        spin.playedAt.toISOString().slice(0, 10),
      );
    }
    out.push(spin);
  }
  return out;
}

export function parseHistoryJson(
  body: unknown,
  config: Record<string, unknown>,
  sourceUrl: string,
): RawSpin[] {
  const path = str(config.itemsPath);
  const value = path ? pickPath(body, path) : body;
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : [];
  return parseConfiguredHistoryItems(items, config, sourceUrl);
}

export function parseHistoryRss(
  xml: string,
  config: Record<string, unknown>,
  sourceUrl: string,
): RawSpin[] {
  if (!xml.trim()) return [];
  let parsed: unknown;
  try {
    parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
  } catch {
    return [];
  }
  const path = str(config.itemsPath) ?? "rss.channel.item";
  const value = pickPath(parsed, path);
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : [];
  return parseConfiguredHistoryItems(items, config, sourceUrl);
}

/**
 * Parse JSON-LD ItemList/arrays embedded in a station-published page. This
 * accepts only valid application/ld+json blocks and configured field paths;
 * it never scrapes visible prose or tries to invent a track from page text.
 */
export function parseHistoryJsonLd(
  html: string,
  config: Record<string, unknown>,
  sourceUrl: string,
): RawSpin[] {
  const items: unknown[] = [];
  const re =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const value = JSON.parse(match[1]!.trim()) as unknown;
      const path = str(config.itemsPath);
      const selected = path ? pickPath(value, path) : value;
      if (Array.isArray(selected)) items.push(...selected);
      else if (selected && typeof selected === "object") items.push(selected);
    } catch {
      // One malformed block must not make other structured blocks unusable.
    }
  }
  return parseConfiguredHistoryItems(items, config, sourceUrl);
}

/**
 * Parse WXYC's official daily-playlist JSON. The archive groups playcuts
 * beneath shows, and each playcut's timestamp is the show's epoch-millisecond
 * sign-on time plus its offset in seconds. Non-playcut entries are show
 * markers/talksets and must not become synthetic spins.
 */
export function parseWxycDailyPlaylist(
  body: unknown,
  sourceUrl: string,
  before?: string,
): RawSpin[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const shows = (body as Record<string, unknown>).shows;
  if (!Array.isArray(shows)) return [];
  const beforeMs = before ? Date.parse(before) : Number.NaN;
  const out: RawSpin[] = [];

  for (const show of shows) {
    if (!show || typeof show !== "object" || Array.isArray(show)) continue;
    const showRecord = show as Record<string, unknown>;
    const signonTime = Number(showRecord.signonTime);
    const entries = showRecord.entries;
    if (!Number.isFinite(signonTime) || !Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (record.entryType !== "playcut") continue;
      const id = Number(record.id);
      const offsetSeconds = Number(record.offsetSeconds);
      const rawArtist = str(record.artistName);
      const rawTitle = str(record.songTitle);
      if (
        !Number.isSafeInteger(id) ||
        !Number.isFinite(offsetSeconds) ||
        !rawArtist ||
        !rawTitle
      ) {
        continue;
      }
      const playedAt = new Date(signonTime + offsetSeconds * 1000);
      if (Number.isNaN(playedAt.getTime())) continue;
      if (Number.isFinite(beforeMs) && playedAt.getTime() >= beforeMs) {
        continue;
      }

      const spin: RawSpin = {
        rawArtist,
        rawTitle,
        externalId: `wxyc:${id}`,
        playedAt,
        sourceUrl,
        sourceFamily: "official_api",
      };
      const album = str(record.releaseTitle);
      if (album) spin.album = album;
      out.push(spin);
    }
  }
  return out;
}

/**
 * Parse WICB's official Last 92 JSON. The API supplies a stable play id and a
 * station-local timestamp for every row. The public Last 92 page is retained
 * as the dated source citation; this remains a shallow rolling feed.
 */
export function parseWicbHistory(
  body: unknown,
  sourceUrl = "https://api-v2.wicb.org/song/history/WICB",
): RawSpin[] {
  if (!Array.isArray(body)) return [];
  const out: RawSpin[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = str(record.id);
    const rawArtist = str(record.artist);
    const rawTitle = str(record.title);
    const playedAt = localDateInTimeZone(
      record.timestamp,
      "America/New_York",
    );
    if (!id || !rawArtist || !rawTitle || !playedAt) continue;
    const spin: RawSpin = {
      rawArtist,
      rawTitle,
      externalId: `wicb:${id}`,
      playedAt,
      sourceUrl,
      sourceFamily: "official_api",
      citationUrl: "https://wicb.org/last92/",
    };
    const album = str(record.album);
    if (album) spin.album = album;
    out.push(spin);
  }
  return out;
}

const stationHistoryJson: HistoryAdapter = async (config, opts) => {
  const url = str(config.url);
  if (!url) return [];
  const page = Math.max(opts?.page ?? 0, 0);
  const params = new URLSearchParams();
  const pageParam = str(config.pageParam);
  const limitParam = str(config.limitParam);
  const beforeParam = str(config.beforeParam);
  if (pageParam) params.set(pageParam, String(page));
  if (limitParam) params.set(limitParam, String(Math.min(opts?.limit ?? 50, 200)));
  if (beforeParam && opts?.before) params.set(beforeParam, opts.before);
  const requestUrl = params.size ? `${url}${url.includes("?") ? "&" : "?"}${params}` : url;
  const body = await getJson(requestUrl);
  const parsed = parseHistoryJson(body, config, requestUrl);
  const itemsPath = str(config.itemsPath);
  const rawItems = itemsPath ? pickPath(body, itemsPath) : body;
  const seen = Array.isArray(rawItems) ? rawItems.length : rawItems ? 1 : 0;
  reportReview(opts, seen, parsed.length);
  return parsed;
};

const wicbHistory: HistoryAdapter = async (config, opts) => {
  const url = str(config.url);
  if (!url) return [];
  if ((opts?.page ?? 0) > 0) return [];
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 92);
  const requestUrl = `${url}${url.includes("?") ? "&" : "?"}limit=${limit}`;
  const body = await getJson(requestUrl);
  const parsed = parseWicbHistory(body, requestUrl);
  reportReview(opts, Array.isArray(body) ? body.length : 0, parsed.length);
  return parsed;
};

const wxycHistory: HistoryAdapter = async (config, opts) => {
  const url = str(config.url);
  if (!url) return [];
  const cursor = opts?.before ? new Date(opts.before) : new Date();
  if (Number.isNaN(cursor.getTime())) return [];
  const date = new Date(
    Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()),
  );
  const dateParam = str(config.dateParam) ?? "date";
  const fetchDay = async (day: Date) => {
    const params = new URLSearchParams({
      [dateParam]: day.toISOString().slice(0, 10),
    });
    const requestUrl = `${url}${url.includes("?") ? "&" : "?"}${params}`;
    const body = await getJson(requestUrl);
    const parsed = parseWxycDailyPlaylist(body, requestUrl, opts?.before);
    const shows =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).shows
        : undefined;
    const seen = Array.isArray(shows)
      ? shows.reduce((sum, show) => {
          if (!show || typeof show !== "object" || Array.isArray(show)) {
            return sum;
          }
          const entries = (show as Record<string, unknown>).entries;
          return sum + (Array.isArray(entries) ? entries.length : 0);
        }, 0)
      : 0;
    return { parsed, seen };
  };

  let result = await fetchDay(date);
  // A cursor can land after the final play of its UTC day. Only then step back
  // one day; otherwise, filtering the cursor day preserves late entries that
  // happened before the cursor but were not in the previous slice.
  if (opts?.before && result.parsed.length === 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    result = await fetchDay(date);
  }
  reportReview(opts, result.seen, result.parsed.length);
  return result.parsed;
};
const stationHistoryRss: HistoryAdapter = async (config, opts) => {
  const url = str(config.url);
  if (!url) return [];
  if ((opts?.page ?? 0) > 0) return [];
  const res = await fetch(url, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const parsed = parseHistoryRss(await res.text(), config, url);
  reportReview(opts, parsed.length, parsed.length);
  return parsed;
};

const stationHistoryJsonLd: HistoryAdapter = async (config, opts) => {
  const url = str(config.url);
  if (!url) return [];
  if ((opts?.page ?? 0) > 0) return [];
  const res = await fetch(url, {
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const parsed = parseHistoryJsonLd(await res.text(), config, url);
  reportReview(opts, parsed.length, parsed.length);
  return parsed;
};

// ---- KEXP (history, backfill-capable) ----------------------------------

/**
 * Pure: KEXP v2 `/plays` results → RawSpin[]. KEXP already carries a
 * MusicBrainz `recording_id`, so these land on the spine with no resolution.
 * `airbreak`/non-trackplay entries are dropped. `showMap` (fetched separately +
 * cached) attributes program + host; missing entries just omit attribution.
 */
export function parseKexpPlays(
  body: unknown,
  showMap: Map<number, { name: string; djName?: string }> = new Map(),
): RawSpin[] {
  const b = body as { results?: Array<Record<string, unknown>> };
  const out: RawSpin[] = [];
  for (const play of b.results ?? []) {
    if (str(play.play_type) && play.play_type !== "trackplay") continue;
    const rawArtist = str(play.artist);
    const rawTitle = str(play.song);
    if (!rawArtist || !rawTitle) continue;
    const spin: RawSpin = { rawArtist, rawTitle };
    const id = play.id != null ? String(play.id) : undefined;
    if (id) spin.externalId = `kexp:${id}`;
    const playedAt = toDate(play.airdate);
    if (playedAt) spin.playedAt = playedAt;
    const album = str(play.album);
    if (album) spin.album = album;
    const artwork = str(play.image_uri) ?? str(play.thumbnail_uri);
    if (artwork) spin.artworkUrl = artwork;
    const recordingId = str(play.recording_id);
    if (recordingId) spin.recordingId = recordingId;
    const showId = typeof play.show === "number" ? play.show : undefined;
    if (showId != null) {
      const show = showMap.get(showId);
       const usable = usableShowAttribution(show, { artist: rawArtist, title: rawTitle });
       if (usable) spin.show = usable;
    }
    out.push(spin);
  }
  return out;
}

// In-memory KEXP show cache: show id -> program/host. Bounded (a handful of
// shows recur) and best-effort — a failed lookup just omits attribution.
const kexpShowCache = new Map<number, { name: string; djName?: string }>();

async function kexpShowInfo(
  showId: number,
): Promise<{ name: string; djName?: string } | undefined> {
  const cached = kexpShowCache.get(showId);
  if (cached) return cached;
  try {
    const body = (await getJson(
      `https://api.kexp.org/v2/shows/${showId}/`,
    )) as Record<string, unknown>;
    const name = str(body.program_name);
    if (!name) return undefined;
    const hosts = Array.isArray(body.host_names)
      ? (body.host_names as unknown[]).map((h) => str(h)).filter(Boolean)
      : [];
    const info: { name: string; djName?: string } = { name };
    if (hosts.length) info.djName = hosts.join(", ");
    kexpShowCache.set(showId, info);
    return info;
  } catch {
    return undefined;
  }
}

const kexpApi: HistoryAdapter = async (_config, opts) => {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 200);
  const offset = Math.max(opts?.page ?? 0, 0) * limit;
  // Deep-history anchor: KEXP's `airdate_before` returns plays strictly older
  // than the ISO timestamp, newest-first — the backfill job walks it backwards.
  const before = opts?.before
    ? `&airdate_before=${encodeURIComponent(opts.before)}`
    : "";
  const body = (await getJson(
    `https://api.kexp.org/v2/plays/?format=json&limit=${limit}&offset=${offset}${before}`,
  )) as { results?: Array<Record<string, unknown>> };
  // Resolve the (small, recurring) set of show ids referenced in this batch.
  const showIds = new Set<number>();
  for (const p of body.results ?? []) {
    if (typeof p.show === "number") showIds.add(p.show);
  }
  const showMap = new Map<number, { name: string; djName?: string }>();
  for (const id of showIds) {
    const info = await kexpShowInfo(id);
    if (info) showMap.set(id, info);
  }
  const parsed = parseKexpPlays(body, showMap);
  reportReview(opts, body.results?.length ?? 0, parsed.length);
  return parsed;
};

// ---- Spinitron (history, per-station key, show + DJ) --------------------

/**
 * Pure: Spinitron v2 `/spins` items → RawSpin[]. `playlistMap` (built from the
 * `/playlists` list, expand=persona) attributes show title + DJ. Spinitron is
 * the richest source for attribution — every spin belongs to a DJ's playlist.
 */
export function parseSpinitronSpins(
  body: unknown,
  playlistMap: Map<number, { name: string; djName?: string }> = new Map(),
): RawSpin[] {
  const b = body as { items?: Array<Record<string, unknown>> };
  const out: RawSpin[] = [];
  for (const item of b.items ?? []) {
    const rawArtist = str(item.artist);
    const rawTitle = str(item.song);
    if (!rawArtist || !rawTitle) continue;
    const spin: RawSpin = { rawArtist, rawTitle };
    const id = item.id != null ? String(item.id) : undefined;
    if (id) spin.externalId = `spinitron:${id}`;
    const playedAt = toDate(item.start);
    if (playedAt) spin.playedAt = playedAt;
    const album = str(item.release);
    if (album) spin.album = album;
    const artwork = str(item.image);
    if (artwork) spin.artworkUrl = artwork;
    const isrc = str(item.isrc);
    if (isrc) spin.isrc = isrc;
    const durationSec = typeof item.duration === "number" ? item.duration : undefined;
    if (durationSec && durationSec > 0) spin.durationMs = durationSec * 1000;
    const playlistId =
      typeof item.playlist_id === "number" ? item.playlist_id : undefined;
    if (playlistId != null) {
      const show = playlistMap.get(playlistId);
       const usable = usableShowAttribution(show, { artist: rawArtist, title: rawTitle });
       if (usable) spin.show = usable;
    }
    out.push(spin);
  }
  return out;
}

/** Pure: Spinitron `/playlists` items → id -> {show title, dj}. */
export function parseSpinitronPlaylists(
  body: unknown,
): Map<number, { name: string; djName?: string }> {
  const b = body as { items?: Array<Record<string, unknown>> };
  const map = new Map<number, { name: string; djName?: string }>();
  for (const pl of b.items ?? []) {
    const id = typeof pl.id === "number" ? pl.id : undefined;
    const name = str(pl.title);
    if (id == null || !name) continue;
    const persona = pl.persona as Record<string, unknown> | undefined;
    const djName = str(pl.dj) ?? str(persona?.name);
    const entry: { name: string; djName?: string } = { name };
    if (djName) entry.djName = djName;
    map.set(id, entry);
  }
  return map;
}

const spinitron: HistoryAdapter = async (config, opts) => {
  const token = str(config.apiKey) ?? str(config.accessToken);
  if (!token) return [];
  const count = Math.min(Math.max(opts?.limit ?? 20, 1), 200);
  const auth = `access-token=${encodeURIComponent(token)}`;

  // Time-anchored mode: when `before` is provided, anchor on Spinitron's
  // `end_date` param (ISO 8601 upper bound on played_at) and reset to page 1
  // so successive cursor advances never overlap.  This is required for
  // resumable deep-history backfill — offset-only walks would drift as new
  // spins land while the cursor is mid-walk.
  const endDate = opts?.before
    ? `&end_date=${encodeURIComponent(opts.before)}`
    : "";
  const page = opts?.before ? 1 : Math.max(opts?.page ?? 0, 0) + 1;

  // Playlists first (bounded) so we can attribute show + DJ to each spin.
  let playlistMap = new Map<number, { name: string; djName?: string }>();
  try {
    const plBody = await getJson(
      `https://spinitron.com/api/playlists?${auth}&count=50&expand=persona${endDate}`,
    );
    playlistMap = parseSpinitronPlaylists(plBody);
  } catch {
    // Attribution is best-effort; spins are still logged without it.
  }
  const spinsBody = await getJson(
    `https://spinitron.com/api/spins?${auth}&count=${count}&page=${page}${endDate}`,
  );
  const parsed = parseSpinitronSpins(spinsBody, playlistMap);
  const seen = Array.isArray((spinsBody as { items?: unknown }).items)
    ? (spinsBody as { items: unknown[] }).items.length
    : 0;
  reportReview(opts, seen, parsed.length);
  return parsed;
};

// ---- BBC (history/live via segments/latest) ----------------------------

/**
 * Pure: BBC `/v2/services/{sid}/segments/latest` `data` → RawSpin[]. Only music
 * segments (artist in `titles.primary`, track in `titles.secondary`) survive.
 * The BBC latest feed carries no absolute timestamp, so `playedAt` is left for
 * the ingest path to default; the segment `id` gives idempotent dedup.
 */
export function parseBbcSegments(body: unknown): RawSpin[] {
  const b = body as {
    data?: Array<{
      id?: string;
      segment_type?: string;
      titles?: { primary?: unknown; secondary?: unknown };
    }>;
  };
  const out: RawSpin[] = [];
  for (const seg of b.data ?? []) {
    if (seg.segment_type && seg.segment_type !== "music") continue;
    const rawArtist = str(seg.titles?.primary);
    const rawTitle = str(seg.titles?.secondary);
    if (!rawArtist || !rawTitle) continue;
    const spin: RawSpin = { rawArtist, rawTitle };
    const id = str(seg.id);
    if (id) spin.externalId = `bbc:${id}`;
    out.push(spin);
  }
  return out;
}

const bbcApi: HistoryAdapter = async (config, opts) => {
  const sid = str(config.sid) ?? str(config.serviceId);
  if (!sid) return [];
  // Single fixed-size feed — no pagination. Deeper pages are empty.
  // The /segments/latest endpoint always returns the same ~25 newest segments
  // regardless of an offset parameter; returning [] here lets fetchPlaysUntilCursor
  // terminate cleanly on the short-page signal instead of re-fetching identical
  // data in a loop until MAX_CATCHUP is exhausted.
  if ((opts?.page ?? 0) > 0) return [];
  const body = await getJson(
    `https://rms.api.bbc.co.uk/v2/services/${encodeURIComponent(
      sid,
    )}/segments/latest?experience=domestic&offset=0`,
  );
  const parsed = parseBbcSegments(body);
  reportReview(opts, Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data.length : 0, parsed.length);
  return parsed;
};

// ---- SomaFM (history via recent-songs feed) -----------------------------

/**
 * Pure: SomaFM `songs/{channel}.json` → RawSpin[]. Newest-first, ~20 entries,
 * each with an epoch-seconds `date` that (with the channel) makes a stable
 * external id — SomaFM never plays two songs in the same second on one
 * channel. Station-ID/break entries (artist "SomaFM") are dropped.
 */
export function parseSomaFmSongs(body: unknown, channel: string): RawSpin[] {
  const b = (body ?? {}) as { songs?: unknown };
  const songs = Array.isArray(b.songs)
    ? (b.songs as Array<Record<string, unknown>>)
    : [];
  const out: RawSpin[] = [];
  for (const song of songs) {
    const rawArtist = str(song.artist);
    const rawTitle = str(song.title);
    if (!rawArtist || !rawTitle) continue;
    if (/somafm/i.test(rawArtist)) continue; // station IDs / breaks
    const spin: RawSpin = { rawArtist, rawTitle };
    const epoch = Number(str(song.date));
    if (Number.isFinite(epoch) && epoch > 0) {
      spin.externalId = `somafm:${channel}:${epoch}`;
      spin.playedAt = new Date(epoch * 1000);
    }
    const album = str(song.album);
    if (album) spin.album = album;
    const artwork = str(song.albumArt);
    if (artwork) spin.artworkUrl = artwork;
    out.push(spin);
  }
  return out;
}

const somaFm: HistoryAdapter = async (config, opts) => {
  const channel = str(config.channel);
  if (!channel) return [];
  // Single fixed-size feed — no pagination. Deeper pages are empty.
  if ((opts?.page ?? 0) > 0) return [];
  const body = await getJson(
    `https://somafm.com/songs/${encodeURIComponent(channel)}.json`,
  );
  const spins = parseSomaFmSongs(body, channel);
  const filtered = (() => {
    if (!opts?.before) return spins;
    const before = new Date(opts.before);
    if (Number.isNaN(before.getTime())) return [];
    return spins.filter((spin) => !!spin.playedAt && spin.playedAt < before);
  })();
  reportReview(
    opts,
    Array.isArray((body as { songs?: unknown }).songs)
      ? (body as { songs: unknown[] }).songs.length
      : 0,
    filtered.length,
  );
  return filtered;
};

// ---- KCRW (history via tracklist API, one current track) ----------------

/**
 * Pure: KCRW tracklist API body (a single current-track object) → RawSpin[].
 * `play_id` gives idempotent dedup; `program_title` + `host` give show
 * attribution. During talk programming artist/title are absent → empty batch.
 */
export function parseKcrwTrack(body: unknown, feed: string): RawSpin[] {
  const t = (body ?? {}) as Record<string, unknown>;
  const rawArtist = str(t.artist);
  const rawTitle = str(t.title);
  if (!rawArtist || !rawTitle) return [];
  const spin: RawSpin = { rawArtist, rawTitle };
  const playId = t.play_id != null ? String(t.play_id) : undefined;
  if (playId) spin.externalId = `kcrw:${feed}:${playId}`;
  const playedAt = toDate(t.datetime);
  if (playedAt) spin.playedAt = playedAt;
  const album = str(t.album);
  if (album) spin.album = album;
  const artwork = str(t.albumImageLarge) ?? str(t.albumImage);
  if (artwork) spin.artworkUrl = artwork;
  const showName = str(t.program_title);
  if (showName) {
    const show: ShowAttribution = { name: showName };
    const djName = str(t.host);
    if (djName) show.djName = djName;
    const usable = usableShowAttribution(show, { artist: rawArtist, title: rawTitle });
    if (usable) spin.show = usable;
  }
  return [spin];
}

const kcrw: HistoryAdapter = async (config, opts) => {
  const feed = str(config.feed) ?? "Music";
  // The API exposes only the current track — no history pages.
  if ((opts?.page ?? 0) > 0) return [];
  const body = await getJson(
    `https://tracklist-api.kcrw.com/${encodeURIComponent(feed)}`,
  );
  const parsed = parseKcrwTrack(body, feed);
  reportReview(opts, body && typeof body === "object" ? 1 : 0, parsed.length);
  return parsed;
};

// ---- NTS Radio (live show attribution fallback) --------------------------

/**
 * Pure: shape the NTS Live API response body into a NowPlayingRaw.
 *
 * The NTS Live endpoint (`/api/v2/live/{channel}`) exposes a `now` object
 * with `broadcast_title` (the show name) and an optional `embeds.details.name`
 * (the resident/host). Because NTS does not publish per-track data in its live
 * endpoint, the show title is mapped to `rawTitle` and the host to `rawArtist`;
 * real per-track data flows separately via the NTS archive poller.
 *
 * Returns null when the payload is missing or both fields are absent (e.g.
 * nothing is on air, a test-card slot, or the API shape changes).
 *
 * Stale-data guard: during a show handoff the NTS API can briefly serve the
 * previous show's metadata. A tell-tale sign is a `start_timestamp` that lies
 * in the future — the next show has been pre-scheduled but hasn't actually
 * started. We return null in that case so the change-detection path ignores
 * the stale payload entirely.
 */
export function parseNtsLive(
  body: unknown,
  now_ms: number = Date.now(),
): NowPlayingRaw | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const now = b.now as Record<string, unknown> | undefined;
  if (!now) return null;

  // Guard: start_timestamp in the future means a pre-scheduled slot that
  // hasn't begun yet — the API is serving stale data from the next show.
  const startTs = toDate(now.start_timestamp);
  if (startTs && startTs.getTime() > now_ms) return null;

  const broadcastTitle = str(now.broadcast_title);
  const embeds = now.embeds as Record<string, unknown> | undefined;
  const details = embeds?.details as Record<string, unknown> | undefined;
  const hostName = str(details?.name);
  const rawTitle = broadcastTitle;
  const rawArtist = hostName ?? broadcastTitle;
  if (!rawArtist || !rawTitle) return null;
  const out: import("./types.js").NowPlayingRaw = { rawArtist, rawTitle };
  if (broadcastTitle) {
    out.show = { name: broadcastTitle };
    if (hostName) out.show.djName = hostName;
    // NTS's live endpoint is show-level rather than track-level: `rawArtist`
    // is the host and `rawTitle` is the broadcast title by design, so neither
    // is evidence that the host is bad DJ metadata.
    out.show = usableShowAttribution(out.show, { showTitle: broadcastTitle }) ?? out.show;
  }
  return out;
}

/**
 * NTS Live — show-level attribution from the NTS Live API. NTS does not
 * publish per-track data in the live endpoint; the NTS ICY stream supplies
 * live tracks and the existing NTS archive poller supplies past tracklists.
 * Returns null when nothing is on air or the API is unreachable.
 *
 * Config: `{ channel: "1" }` (or "2" for NTS 2).
 */
const ntsLive: NowPlayingAdapter = async (config) => {
  try {
    const channel = str(config.channel) ?? "1";
    // The NTS API dropped the per-channel path (`/live/{channel}` now 400s);
    // `/live/` returns all channels in a `results` array keyed by channel_name.
    const body = (await getJson(
      "https://www.nts.live/api/v2/live/",
    )) as Record<string, unknown>;
    const results = Array.isArray(body?.results)
      ? (body.results as Array<Record<string, unknown>>)
      : undefined;
    if (!results) return null;
    const entry = results.find((r) => str(r.channel_name) === channel);
    if (!entry) return null;
    return parseNtsLive(entry);
  } catch {
    return null;
  }
};

/**
 * Preserve NTS's live programme attribution alongside an ICY-sourced track.
 *
 * When ICY is unavailable, returning the live result deliberately retains the
 * legacy `nts_live` behavior. When ICY succeeds, its artist/title remain the
 * track identity while the NTS API contributes only the show/DJ context.
 */
export function mergeNtsIcyTrackWithLiveShow(
  icyTrack: NowPlayingRaw | null,
  ntsLiveTrack: NowPlayingRaw | null,
): NowPlayingRaw | null {
  // The live endpoint is programme metadata, never track identity. Returning
  // it without an ICY track would persist the host/show as a musical spin.
  if (!icyTrack) return null;
  return ntsLiveTrack?.show
    ? { ...icyTrack, show: ntsLiveTrack.show }
    : icyTrack;
}

// ---- FIP (Radio France) now-playing, change-detection -------------------

/**
 * Pure: pick the active FIP step from a livemeta `steps` map at a given Unix
 * epoch (seconds). Chooses the deepest step whose [start, end] window contains
 * `nowSec`. Returns a NowPlayingRaw when a music step is active, or null
 * during talk, silence, or when no window matches.
 *
 * `steps` is the `body.steps` object from the livemeta pull endpoint — a
 * keyed map of step objects (key is irrelevant, values carry start/end/depth).
 */
export function parseFipSteps(
  steps: Record<string, Record<string, unknown>>,
  nowSec: number,
): NowPlayingRaw | null {
  let best: Record<string, unknown> | null = null;
  let bestDepth = -Infinity;
  for (const step of Object.values(steps)) {
    const start = typeof step.start === "number" ? step.start : undefined;
    const end = typeof step.end === "number" ? step.end : undefined;
    const depth = typeof step.depth === "number" ? step.depth : 0;
    if (start == null || end == null) continue;
    if (nowSec < start || nowSec > end) continue;
    if (depth > bestDepth) {
      bestDepth = depth;
      best = step;
    }
  }
  if (!best) return null;
  const rawArtist = str(best.authors) ?? str(best.performers);
  const rawTitle = str(best.title);
  if (!rawArtist || !rawTitle) return null;
  return { rawArtist, rawTitle };
}

/**
 * FIP / Radio France livemeta — find the music step currently on air by
 * depth (deepest = most specific) where start ≤ now ≤ end. Returns null
 * during talk, silence, or when the API is unreachable.
 *
 * Config: `{ stationId: "7" }` (7=FIP main, 64=Rock, 65=Jazz, 66=Groove,
 * 69=World, 71=Reggae, 74=Electro, 78=Metal).
 */
const fip: NowPlayingAdapter = async (config) => {
  const stationId = str(config.stationId) ?? "7";
  const body = (await getJson(
    `https://api.radiofrance.fr/livemeta/pull/${encodeURIComponent(stationId)}`,
  )) as Record<string, unknown>;
  const steps = body.steps as Record<string, Record<string, unknown>> | undefined;
  if (!steps) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  return parseFipSteps(steps, nowSec);
};

// ---- Radio Browser ICY (now-playing, change-detection) ------------------

import { fetchIcyMetadata, parseStreamTitle, isJunkMetadata } from "./icy.js";
import {
  db as _icyDb,
  stationsTable as _icyStationsTable,
  radioBrowserStationsTable,
} from "@workspace/db";
import { eq as _icyEq } from "drizzle-orm";

/**
 * Pure: given a raw StreamTitle string, produce a NowPlayingRaw.
 *
 * Handles three cases in priority order:
 * 1. Tilde-structured format (some station networks) — supplies a direct MB
 *    recording UUID + duration, which bypasses text search entirely.
 * 2. Standard "Artist - Title" split.
 * Title-only values are rejected. They are commonly programme names, station
 * labels, or automation placeholders and do not establish track identity.
 *
 * Returns null for junk metadata (ads, break announcements, station IDs) so
 * those slots are never submitted to the resolver or logged as spins.
 */
export function parseIcyNowPlaying(streamTitle: string): NowPlayingRaw | null {
  const parsed = parseStreamTitle(streamTitle);
  if (!parsed) return null;
  const rawTitle = parsed.rawTitle;
  const sourceArtist = parsed.rawArtist;

  if (!sourceArtist) return null;
  if (isJunkMetadata(sourceArtist, rawTitle)) return null;

  const out: NowPlayingRaw = { rawArtist: sourceArtist, rawTitle };
  if (parsed.sourceRecordingId) out.recordingId = parsed.sourceRecordingId;
  if (parsed.durationMs != null) out.durationMs = parsed.durationMs;
  return out;
}

/**
 * Deactivate a station in the canonical stations table when ICY polling
 * cannot succeed (either icy_unsupported or error). This stops the main
 * poller from counting it as a pollable station after a restart.
 */
async function deactivateIcyStation(stationId: number | null) {
  if (stationId === null) return;
  try {
    await _icyDb
      .update(_icyStationsTable)
      .set({ active: false, nowPlayingSource: null, nowPlayingConfig: null, updatedAt: new Date() })
      .where(_icyEq(_icyStationsTable.id, stationId));
  } catch {
    // Non-fatal — poller will retry on next tick and DB will converge.
  }
}

/**
 * How long to wait before re-probing a station whose icyStatus is "error".
 * Error stations are not polled on every tick (to avoid hammering a struggling
 * stream); instead, one probe attempt is allowed every ICY_ERROR_BACKOFF_MS.
 * On success the station self-heals; on continued failure the backoff resets
 * to give it another window at the next interval.
 */
const ICY_ERROR_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Tracks the wall-clock time of the most-recent re-probe attempt for each
 * "error"-status station, keyed by radio_browser_stations.id. In-memory only
 * — resets on restart (which is fine: ensureIcyHealthRows resets the status
 * on every boot, so the station gets a fresh attempt immediately anyway).
 */
const icyErrorLastProbeAt = new Map<number, number>();

/**
 * Clear the error-backoff entry for a station. Called when an admin action
 * (re-enroll endpoint) resets the station's ICY status to "active", so the
 * very next poll tick makes a live attempt rather than waiting out the backoff.
 */
export function clearIcyErrorBackoff(rbId: number): void {
  icyErrorLastProbeAt.delete(rbId);
}

/**
 * @internal Testing only — do not call in production code.
 * Directly sets a backoff entry so tests can pre-populate the map without
 * triggering a real ICY network probe.
 */
export function _testOnlySetIcyBackoff(rbId: number, timestamp = Date.now()): void {
  icyErrorLastProbeAt.set(rbId, timestamp);
}

/**
 * @internal Testing only — do not call in production code.
 * Returns true when an in-memory backoff entry exists for the given id.
 */
export function _testOnlyIcyBackoffHas(rbId: number): boolean {
  return icyErrorLastProbeAt.has(rbId);
}

/**
 * RadioBrowserAdapter — now-playing adapter for ICY/Shoutcast streams.
 *
 * Config: `{ streamUrl, radioBrowserId: <radio_browser_stations.id> }`.
 *
 * Lifecycle:
 *  - On every tick, reload the radio_browser_stations row so status changes
 *    (e.g. by another admin action) take effect immediately.
 *  - If `icyStatus` is "icy_unsupported", skip the fetch permanently (until
 *    the station is manually re-enrolled).
 *  - If `icyStatus` is "error", apply a 30-minute backoff: skip the fetch
 *    unless ICY_ERROR_BACKOFF_MS has elapsed since the last probe attempt.
 *    This lets the station self-heal once the stream recovers without hammering
 *    a struggling or temporarily-dead stream on every 30-second tick.
 *  - On transient network error, increment consecutiveErrors. After 3
 *    failures, set icyStatus → "error".
 *  - On icy_unsupported response, set icyStatus → "icy_unsupported" and
 *    deactivate the canonical station immediately.
 *  - On success, reset consecutiveErrors and icyStatus → "active", and
 *    record lastStreamTitle.
 */
const radioBrowserIcy: NowPlayingAdapter = async (config) => {
  const streamUrl = str(config.streamUrl);
  const rbId =
    typeof config.radioBrowserId === "number" ? config.radioBrowserId : null;
  // NTS exposes tracks in ICY but keeps the current programme in its live API.
  // Keeping this opt-in means ordinary ICY stations retain their existing
  // fetch, health, and suspension behavior.
  const ntsChannel =
    str(config.fallbackSource) === "nts_live" ? str(config.channel) : undefined;

  if (!streamUrl) return null;

  // --- Reload DB row so suspension decisions are always fresh ---------------
  let currentRow: { icyStatus: string; consecutiveErrors: number; stationId: number | null } | null = null;
  if (rbId !== null) {
    const [row] = await _icyDb
      .select({
        icyStatus: radioBrowserStationsTable.icyStatus,
        consecutiveErrors: radioBrowserStationsTable.consecutiveErrors,
        stationId: radioBrowserStationsTable.stationId,
      })
      .from(radioBrowserStationsTable)
      .where(_icyEq(radioBrowserStationsTable.id, rbId))
      .limit(1);
    currentRow = row ?? null;
  }

  // --- Guard: row deleted (station removed while tick was in-flight) ---------
  if (rbId !== null && currentRow === null) {
    // The radio_browser_stations row was deleted (admin DELETE); abort quietly.
    return null;
  }

  // --- Suspension gate -------------------------------------------------------
  // "icy_unsupported": permanently skip until manual re-enroll.
  if (currentRow?.icyStatus === "icy_unsupported") {
    return null;
  }
  // "error": apply a time-based backoff — probe at most once every
  // ICY_ERROR_BACKOFF_MS (30 min) so we don't hammer a struggling stream on
  // every 30-second tick while still allowing self-healing mid-session.
  if (currentRow?.icyStatus === "error" && rbId !== null) {
    const lastProbe = icyErrorLastProbeAt.get(rbId) ?? 0;
    const elapsed = Date.now() - lastProbe;
    if (elapsed < ICY_ERROR_BACKOFF_MS) {
      return null; // still within backoff window; skip this tick
    }
    // Record this attempt so subsequent ticks honour the backoff.
    icyErrorLastProbeAt.set(rbId, Date.now());
  }

  // --- Fetch ----------------------------------------------------------------
  // Start this beside the ICY request so show attribution adds no extra
  // round-trip to the track path. It is deliberately after health gates, so a
  // suspended non-NTS ICY station never makes an unnecessary live API request.
  const ntsLiveResult = ntsChannel ? ntsLive({ channel: ntsChannel }) : null;
  const result = await fetchIcyMetadata(streamUrl);

  if (!result.ok) {
    // NTS's public live API can annotate a real ICY track, but it only carries
    // programme metadata and must never stand in for track identity when the
    // stream itself is unavailable.

    if (result.kind === "icy_unsupported") {
      // Permanent: the stream does not support ICY metadata at all.
      if (rbId !== null) {
        await _icyDb
          .update(radioBrowserStationsTable)
          .set({ icyStatus: "icy_unsupported", updatedAt: new Date() })
          .where(_icyEq(radioBrowserStationsTable.id, rbId))
          .catch(() => {});
        // Deactivate the canonical station so it won't be re-polled after restart.
        await deactivateIcyStation(currentRow?.stationId ?? null);
      }
    } else {
      // Transient: network/timeout failure — increment error counter.
      if (rbId !== null) {
        const prevErrors = currentRow?.consecutiveErrors ?? 0;
        const newErrors = prevErrors + 1;
        const hitLimit = newErrors >= 3;
        await _icyDb
          .update(radioBrowserStationsTable)
          .set({
            consecutiveErrors: newErrors,
            ...(hitLimit ? { icyStatus: "error" } : {}),
            updatedAt: new Date(),
          })
          .where(_icyEq(radioBrowserStationsTable.id, rbId))
          .catch(() => {});
        if (hitLimit) {
          console.warn(`[lore] icy error threshold reached (${newErrors}): ${streamUrl} — backing off ${ICY_ERROR_BACKOFF_MS / 60000} min before next probe`);
          // Note: we do NOT deactivate the canonical station on transient errors.
          // The 30-minute backoff (icyErrorLastProbeAt) throttles re-probes, and
          // the station self-heals on the next successful attempt.
        } else {
          console.warn(`[lore] icy transient error (${newErrors}/3): ${streamUrl}${result.message ? " — " + result.message : ""}`);
        }
      }
    }
    return null;
  }

  // --- Success — reset error state ------------------------------------------
  if (rbId !== null) {
    // Clear the in-memory backoff entry so future ticks aren't throttled.
    icyErrorLastProbeAt.delete(rbId);
    await _icyDb
      .update(radioBrowserStationsTable)
      .set({
        icyStatus: "active",
        consecutiveErrors: 0,
        lastStreamTitle: result.streamTitle,
        lastSuccessAt: new Date(),
        updatedAt: new Date(),
      })
      .where(_icyEq(radioBrowserStationsTable.id, rbId))
      .catch(() => {});
  }

  if (!result.streamTitle) return null; // between tracks — no change to log
  const icyTrack = parseIcyNowPlaying(result.streamTitle);
  if (!ntsLiveResult) return icyTrack;
  return mergeNtsIcyTrackWithLiveShow(icyTrack, await ntsLiveResult);
};

// ---- Radiojar (now-playing, change-detection) ---------------------------

/**
 * Radiojar — hosted streaming platform (Radio AlHara, Lookout.FM, ...).
 * The audio stream itself hides behind per-request tokenized 302 redirects
 * that the raw-TCP ICY fetcher can't follow, but Radiojar publishes an
 * unauthenticated now-playing JSON API per stream id:
 *
 *   https://www.radiojar.com/api/stations/<streamId>/now_playing/
 *   → { artist, title, album, thumb, ... }
 *
 * Config: `{ streamId: "78cxy6wkxtzuv" }`.
 *
 * Freeform-station caveat: many Radiojar stations broadcast show-level
 * metadata (artist "Saria" / title "w/ Saria") rather than track info. That
 * flows through the normal text-resolution pipeline and may land unresolved,
 * which is expected — when real track metadata is broadcast it resolves like
 * any other station.
 *
 * Pure: shape a Radiojar now-playing JSON body into a NowPlayingRaw. Returns
 * null when the body is not an object or both artist and title are missing.
 * When only one of artist/title is present it stands in for both (same
 * degradation pattern as ICY title-only entries).
 */
export function parseRadiojarNowPlaying(body: unknown): NowPlayingRaw | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const artist = str(obj.artist);
  const title = str(obj.title);
  if (!artist && !title) return null;
  const rawTitle = title ?? artist!;
  const rawArtist = artist ?? rawTitle;
  const out: NowPlayingRaw = { rawArtist, rawTitle };
  const album = str(obj.album);
  if (album) out.album = album;
  const thumb = str(obj.thumb);
  if (thumb) out.artworkUrl = thumb;
  return out;
}

const radiojar: NowPlayingAdapter = async (config) => {
  const streamId = str(config.streamId);
  if (!streamId) return null;
  let body: unknown;
  try {
    body = await getJson(
      `https://www.radiojar.com/api/stations/${encodeURIComponent(streamId)}/now_playing/`,
    );
  } catch {
    return null;
  }
  return parseRadiojarNowPlaying(body);
};

// ---- Spinitron Web (now-playing, unauthenticated HTML scrape) ----------

/**
 * Pure: parse a Spinitron public station page HTML into a NowPlayingRaw.
 *
 * Spinitron's public station page (https://spinitron.com/{callsign}/) renders a
 * now-playing widget for the current spin. We extract artist + song title via a
 * sequence of regex patterns that cover their known HTML variants:
 *
 *  Pattern A — canonical `tr.spin-item[data-spin]` JSON record.
 *  Pattern B — structured data block (`data-artist` / `data-song` attributes).
 *  Pattern C — class-scoped `.artist` / `.song` spans.
 *  Pattern D — JSON island or OpenGraph title.
 *
 * Returns null when none of the patterns fire or either field is blank.
 * Never throws — any parse failure produces null.
 */
export function parseSpinitronWebPage(html: string): NowPlayingRaw | null {
  const decodeHtml = (value: string): string =>
    value
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  const pair = (
    rawArtist: string | undefined,
    rawTitle: string | undefined,
  ): NowPlayingRaw | null => {
    const artist = rawArtist ? decodeHtml(rawArtist).trim() : "";
    const title = rawTitle ? decodeHtml(rawTitle).trim() : "";
    return artist && title ? { rawArtist: artist, rawTitle: title } : null;
  };

  // Pattern A — current Spinitron pages put the authoritative current record
  // in the first spin-item row. `data-spin` is HTML-escaped JSON, so parsing
  // it avoids accidentally pairing artist and song spans from different rows.
  const spinRow =
    /<tr\b[^>]*\bclass=(["'])[^"']*\bspin-item\b[^"']*\1[^>]*>[\s\S]*?<\/tr>/i.exec(
      html,
    )?.[0];
  const spinRowStart = spinRow?.match(/^<tr\b[^>]*>/i)?.[0];
  const dataSpin = spinRowStart?.match(/\bdata-spin=(["'])([\s\S]*?)\1/i)?.[2];
  if (dataSpin) {
    try {
      const record = JSON.parse(decodeHtml(dataSpin)) as {
        a?: unknown;
        s?: unknown;
      };
      const parsed = pair(
        typeof record.a === "string" ? record.a : undefined,
        typeof record.s === "string" ? record.s : undefined,
      );
      if (parsed) return parsed;
    } catch {
      // A malformed row can occur while a page is being rendered. Its rendered
      // fields may still be usable, but only from this same current row.
    }
  }

  if (spinRow) {
    const rowDataArtist = /data-artist="([^"]+)"/.exec(spinRow)?.[1];
    const rowDataSong = /data-song="([^"]+)"/.exec(spinRow)?.[1];
    const rowDataPair = pair(rowDataArtist, rowDataSong);
    if (rowDataPair) return rowDataPair;

    const rowArtist = /class="artist">([^<]+)</.exec(spinRow)?.[1];
    const rowSong = /class="song">([^<]+)</.exec(spinRow)?.[1];
    const rowClassPair = pair(rowArtist, rowSong);
    if (rowClassPair) return rowClassPair;

    const rowJsonIsland =
      /"artist"\s*:\s*"([^"]+)"[^}]*"song"\s*:\s*"([^"]+)"/.exec(spinRow);
    if (rowJsonIsland) {
      const [, rawArtist, rawTitle] = rowJsonIsland;
      const parsed = pair(rawArtist, rawTitle);
      if (parsed) return parsed;
    }

    // The first canonical row is authoritative. Do not combine one of its
    // fields with historical content elsewhere on the page.
    return null;
  }

  // Pattern B — data attributes on the spin container (future-proofing)
  const dataArtist = /data-artist="([^"]+)"/.exec(html)?.[1];
  const dataSong = /data-song="([^"]+)"/.exec(html)?.[1];
  const dataPair = pair(dataArtist, dataSong);
  if (dataPair) return dataPair;

  // Pattern C — Spinitron's older public HTML structure:
  //   <span class="artist">Artist Name</span> <span class="song">Song Title</span>
  // The first occurrence in the page is the current/most-recent spin.
  const artistMatch = /class="artist">([^<]+)</.exec(html)?.[1];
  const songMatch = /class="song">([^<]+)</.exec(html)?.[1];
  const classPair = pair(artistMatch, songMatch);
  if (classPair) return classPair;

  // Pattern D — JSON island with artist/song keys (may appear in embedded data)
  const jsonIsland = /"artist"\s*:\s*"([^"]+)"[^}]*"song"\s*:\s*"([^"]+)"/.exec(html);
  if (jsonIsland) {
    const [, rawArtist, rawTitle] = jsonIsland;
    const parsed = pair(rawArtist, rawTitle);
    if (parsed) return parsed;
  }

  // Pattern D — OpenGraph / Twitter card meta tags as last resort
  const ogTitle =
    /property="og:title"\s+content="([^"]+)"/.exec(html)?.[1] ??
    /name="twitter:title"\s+content="([^"]+)"/.exec(html)?.[1];
  if (ogTitle) {
    // Spinitron og:title format: "Artist – Song on CALLSIGN" or "Artist - Song"
    const parts = ogTitle.split(/\s[–-]\s/);
    if (parts.length >= 2) {
      const rawTitle = parts[1].replace(/\s+on\s+\w+\s*$/, "").trim();
      const rawArtist = parts[0].trim();
      if (rawArtist && rawTitle) {
        return pair(rawArtist, rawTitle);
      }
    }
  }

  return null;
}

/**
 * Spinitron Web — unauthenticated now-playing adapter for any station on
 * the Spinitron platform.
 *
 * Strategy (single HTTP request, Content-Type routing):
 * 1. Fetch the station page with `Accept: application/json, text/html;q=0.9`.
 *    If Spinitron ever exposes a public JSON endpoint this activates
 *    automatically — the response Content-Type switches to `application/json`
 *    and we parse `{ artist, song|title }` directly.
 *    Note: as of 2026-07 `?format=json` still returns HTML; this attempt is
 *    forward-compatible and adds no extra round-trip.
 * 2. If the response is HTML (current behaviour), delegate to
 *    `parseSpinitronWebPage()` which covers the live class-based widget and
 *    three additional fallback patterns.
 *
 * Config: `{ callsign: "WPRB" }`.
 * Best-effort: returns null on any error, parse failure, or when nothing plays.
 */
const spinitronWeb: NowPlayingAdapter = async (config) => {
  const callsign = str(config.callsign);
  if (!callsign) return null;
  try {
    const res = await fetch(
      `https://spinitron.com/${encodeURIComponent(callsign)}/`,
      {
        headers: {
          // Prefer JSON so a future public JSON endpoint is used automatically.
          // Spinitron currently returns HTML regardless of Accept, so we fall
          // through to HTML parsing below.
          Accept: "application/json, text/html;q=0.9, application/xhtml+xml;q=0.8",
          "User-Agent": "Lore Radio/1.0 (+https://spinitron.com)",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      // Public JSON endpoint available — parse directly.
      const body = (await res.json()) as Record<string, unknown>;
      const rawArtist =
        typeof body.artist === "string" ? body.artist.trim() : null;
      const rawTitle =
        typeof body.song === "string"
          ? body.song.trim()
          : typeof body.title === "string"
            ? body.title.trim()
            : null;
      if (rawArtist && rawTitle) return { rawArtist, rawTitle };
      return null;
    }

    // HTML response (current Spinitron behaviour) — parse the page widget.
    const html = await res.text();
    return parseSpinitronWebPage(html);
  } catch {
    return null;
  }
};

// ---- The Lot Radio schedule (now-playing, change-detection) ------------

/**
 * The Lot Radio publishes no ICY/JSON now-playing endpoint — their
 * infrastructure is HLS-only (livepeer). Their Next.js homepage embeds the
 * full two-week Google Calendar schedule as JSON inside the RSC payload,
 * so we fetch that and find the event whose window contains "now".
 *
 * Returns the current show summary as `rawArtist` (the DJ / show name) and
 * "Live Session" as `rawTitle` when on-air, or null when off-air (nothing
 * scheduled at this moment).
 *
 * No config keys are required.
 */
export function parseLotRadioSchedule(
  rscText: string,
  now: Date = new Date(),
): NowPlayingRaw | null {
  const marker = '"schedule":';
  const markerIdx = rscText.indexOf(marker);
  if (markerIdx < 0) return null;

  const arrayStart = markerIdx + marker.length; // points at '['
  if (rscText[arrayStart] !== "[") return null;
  let depth = 0;
  let arrayEnd = arrayStart;
  for (let i = arrayStart; i < rscText.length; i++) {
    const c = rscText[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        arrayEnd = i + 1;
        break;
      }
    }
  }
  if (arrayEnd <= arrayStart) return null;

  let events: Array<{ summary?: string; start?: string; end?: string }>;
  try {
    events = JSON.parse(rscText.slice(arrayStart, arrayEnd)) as typeof events;
  } catch {
    return null;
  }

  const nowMs = now.getTime();
  for (const ev of events) {
    if (!ev.summary || !ev.start || !ev.end) continue;
    const startMs = Date.parse(ev.start);
    const endMs = Date.parse(ev.end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
    if (startMs <= nowMs && nowMs < endMs) {
      return { rawArtist: ev.summary.trim(), rawTitle: "Live Session" };
    }
  }
  return null;
}

const lotRadioSchedule: NowPlayingAdapter = async (_config) => {
  let text: string;
  try {
    const res = await fetch("https://www.thelotradio.com", {
      headers: { RSC: "1", Accept: "text/x-component, */*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }
  return parseLotRadioSchedule(text);
};

// ---- Registry -----------------------------------------------------------

const NOW_PLAYING_ADAPTERS: Record<string, NowPlayingAdapter> = {
  radio_paradise: radioParadise,
  station_page: stationPage,
  nts_live: ntsLive,
  fip,
  radio_browser_icy: radioBrowserIcy,
  radiojar,
  lot_radio_schedule: lotRadioSchedule,
  spinitron_web: spinitronWeb,
};

const HISTORY_ADAPTERS: Record<string, HistoryAdapter> = {
  kexp_api: kexpApi,
  spinitron,
  bbc_api: bbcApi,
  somafm: somaFm,
  kcrw,
  station_history_json: stationHistoryJson,
  wicb_history: wicbHistory,
  wxyc_history: wxycHistory,
  station_history_rss: stationHistoryRss,
  station_history_jsonld: stationHistoryJsonLd,
};

/**
 * Source keys are intentionally derived from the registries rather than
 * duplicated in tests or documentation. The metadata replay gate uses this
 * inventory to require reviewed fixtures whenever a new adapter is added.
 */
export const ADAPTER_REGISTRY_SOURCE_FAMILIES = {
  nowPlaying: Object.freeze(Object.keys(NOW_PLAYING_ADAPTERS)),
  history: Object.freeze(Object.keys(HISTORY_ADAPTERS)),
} as const;

/** Look up a now-playing (change-detection) adapter, or null. */
export function getNowPlayingAdapter(
  source: string | null | undefined,
): NowPlayingAdapter | null {
  if (!source) return null;
  return NOW_PLAYING_ADAPTERS[source] ?? null;
}

/** Look up a history (batch/cursor) adapter, or null. */
export function getHistoryAdapter(
  source: string | null | undefined,
): HistoryAdapter | null {
  if (!source) return null;
  return HISTORY_ADAPTERS[source] ?? null;
}

/** Whether any adapter (either family) handles this source. */
export function isPollable(source: string | null | undefined): boolean {
  return !!getNowPlayingAdapter(source) || !!getHistoryAdapter(source);
}

/**
 * Sources whose history API honors `FetchRecentOptions.before` (time-anchored
 * deep paging). Only these can be enrolled for the deep-history backfill job —
 * offset-only sources would skip/duplicate plays as new ones land.
 */
/** Whether this source supports resumable deep-history backfill. */
export function supportsBackfill(
  source: string | null | undefined,
  config?: Record<string, unknown> | null,
): boolean {
  if (
    source === "kexp_api" ||
    source === "spinitron" ||
    source === "somafm" ||
    source === "wxyc_history"
  ) {
    return true;
  }
  if (source === "station_history_json") {
    return config?.cursorMode === "time_anchor" && !!str(config.beforeParam);
  }
  return false;
}

/** Describe a configured history surface for the audit and admin ledger. */
export function historySourceContract(
  source: string | null | undefined,
  config: Record<string, unknown> | null | undefined = null,
): HistorySourceContract | null {
  if (!source) return null;
  const configuredFamily = str(config?.sourceFamily) as
    | HistorySourceFamily
    | undefined;
  const generic = configuredFamily ?? "official_api";
  switch (source) {
    case "kexp_api":
      return {
        source,
        family: "platform_archive",
        surface: "KEXP public playlist API",
        cursorMode: "time_anchor",
        supportsBackfill: true,
        stableIdentity: "required",
        reportedTimestamp: "required",
        archiveCitation: "dated",
        supportedDepthDays: null,
        retryPolicy: "retryable",
      };
    case "spinitron":
      return {
        source,
        family: "platform_archive",
        surface: "Spinitron public playlist API",
        cursorMode: "time_anchor",
        supportsBackfill: true,
        stableIdentity: "required",
        reportedTimestamp: "required",
        archiveCitation: "dated",
        supportedDepthDays: null,
        retryPolicy: "retryable",
      };
    case "bbc_api":
      return {
        source,
        family: "official_api",
        surface: "BBC latest segments API",
        cursorMode: "fixed_feed",
        supportsBackfill: false,
        stableIdentity: "required",
        reportedTimestamp: "optional",
        archiveCitation: "endpoint",
        supportedDepthDays: 1,
        retryPolicy: "retryable",
      };
    case "somafm":
      return {
        source,
        family: "official_api",
        surface: "SomaFM recent-songs JSON",
        cursorMode: "fixed_feed",
        supportsBackfill: false,
        stableIdentity: "derived",
        reportedTimestamp: "required",
        archiveCitation: "endpoint",
        supportedDepthDays: 1,
        retryPolicy: "retryable",
      };
    case "station_history_json":
      return {
        source,
        family: generic,
        surface: "Configured station-published JSON history",
        cursorMode:
          (str(config?.cursorMode) as HistorySourceContract["cursorMode"] | undefined) ??
          "page",
        supportsBackfill: supportsBackfill(source, config),
        stableIdentity: "required",
        reportedTimestamp: "required",
        archiveCitation: config?.archiveUrl ? "dated" : "endpoint",
        supportedDepthDays: Number.isFinite(Number(config?.supportedDepthDays))
          ? Number(config?.supportedDepthDays)
          : null,
        retryPolicy: "retryable",
      };
    case "wxyc_history":
      return {
        source,
        family: "official_api",
        surface: "WXYC official daily-playlist JSON",
        cursorMode: "time_anchor",
        supportsBackfill: true,
        stableIdentity: "required",
        reportedTimestamp: "required",
        archiveCitation: "dated",
        supportedDepthDays: null,
        retryPolicy: "retryable",
      };
    case "wicb_history":
      return {
        source,
        family: "official_api",
        surface: "WICB official Last 92 JSON",
        cursorMode: "fixed_feed",
        supportsBackfill: false,
        stableIdentity: "required",
        reportedTimestamp: "required",
        archiveCitation: "dated",
        supportedDepthDays: 1,
        retryPolicy: "retryable",
      };
    case "station_history_rss":
      return {
        source,
        family: "rss",
        surface: "Configured station-published RSS history",
        cursorMode: "fixed_feed",
        supportsBackfill: false,
        stableIdentity: "required",
        reportedTimestamp: "required",
        archiveCitation: config?.archiveUrl ? "dated" : "endpoint",
        supportedDepthDays: Number.isFinite(Number(config?.supportedDepthDays))
          ? Number(config?.supportedDepthDays)
          : null,
        retryPolicy: "retryable",
      };
    case "station_history_jsonld":
      return {
        source,
        family: "structured_data",
        surface: "Configured station-published JSON-LD history",
        cursorMode: "fixed_feed",
        supportsBackfill: false,
        stableIdentity: "required",
        reportedTimestamp: "required",
        archiveCitation: config?.archiveUrl ? "dated" : "endpoint",
        supportedDepthDays: Number.isFinite(Number(config?.supportedDepthDays))
          ? Number(config?.supportedDepthDays)
          : null,
        retryPolicy: "retryable",
      };
    default:
      return null;
  }
}

/**
 * Outbound link to a source's own public archive page for one UTC broadcast
 * day (`day` is YYYY-MM-DD). This is the station-run citation — every replayed
 * run must attribute back to where the sequence is documented. Returns null
 * for sources without a public per-day archive (the UI then omits the link;
 * it never fabricates one).
 *
 * `config` is the station's `nowPlayingConfig` — some sources (Spinitron)
 * need a station-specific handle to build the URL.
 */
export function stationArchiveUrl(
  source: string | null | undefined,
  day: string,
  config?: Record<string, unknown> | null,
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!source || !m) return null;
  const [, year, month, dayOfMonth] = m;
  switch (source) {
    // KEXP publishes a dated playlist archive; month/day are unpadded.
    case "kexp_api":
      return `https://www.kexp.org/playlist/${year}/${Number(month)}/${Number(dayOfMonth)}/`;
    // NTS publishes a dated episode/broadcast archive.
    case "nts_live":
      return `https://www.nts.live/explore?type=episode&broadcast=${year}-${month}-${dayOfMonth}`;
    // NTS live stations use ICY for track metadata but retain an nts_live
    // fallback in config. Keep their archive citation after the source switch.
    case "radio_browser_icy":
      if (config?.fallbackSource === "nts_live") {
        return `https://www.nts.live/explore?type=episode&broadcast=${year}-${month}-${dayOfMonth}`;
      }
      return null;
    // FIP (Radio France) publishes a dated programme grid.
    case "fip":
      return `https://www.radiofrance.fr/fip/grille-programmes?date=${year}-${month}-${dayOfMonth}`;
    // Spinitron publishes a per-station calendar view.
    // Authenticated adapter stores the handle in `stationHandle`; the
    // web-scrape adapter stores it in `callsign`. Both produce the same URL.
    case "spinitron": {
      const handle =
        config &&
        typeof config.stationHandle === "string" &&
        config.stationHandle.trim()
          ? config.stationHandle.trim()
          : null;
      if (!handle) return null;
      return `https://spinitron.com/${encodeURIComponent(handle)}/calendar/date/${year}-${month}-${dayOfMonth}`;
    }
    case "spinitron_web": {
      const handle =
        config &&
        typeof config.callsign === "string" &&
        config.callsign.trim()
          ? config.callsign.trim()
          : null;
      if (!handle) return null;
      return `https://spinitron.com/${encodeURIComponent(handle)}/calendar/date/${year}-${month}-${dayOfMonth}`;
    }
    case "station_history_json":
    case "wxyc_history":
    case "station_history_rss":
    case "station_history_jsonld": {
      const template = str(config?.archiveUrl);
      if (!template || !/^https:\/\//i.test(template)) return null;
      return template.replace("{date}", `${year}-${month}-${dayOfMonth}`);
    }
    default:
      return null;
  }
}
