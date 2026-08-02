import type {
  NowPlayingAdapter,
  NowPlayingRaw,
  HistoryAdapter,
  RawSpin,
  ShowAttribution,
} from "./types.js";
import { usableShowAttribution } from "@workspace/lore-attribution";

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

// ---- Radio Paradise (now-playing, change-detection) --------------------

/**
 * Radio Paradise — a single JSON now-playing endpoint per channel. Gives
 * artist/title/album/cover but no MBID or ISRC, so these resolve via text search.
 * Config: `{ chan: "0" }` (0=Main, 1=Mellow, 2=Rock, ...).
 */
const radioParadise: NowPlayingAdapter = async (config) => {
  const chan = str(config.chan) ?? "0";
  const body = (await getJson(
    `https://api.radioparadise.com/api/now_playing?chan=${encodeURIComponent(chan)}`,
  )) as Record<string, unknown>;
  const rawArtist = str(body.artist);
  const rawTitle = str(body.title);
  if (!rawArtist || !rawTitle) return null;
  const out: NowPlayingRaw = { rawArtist, rawTitle };
  const album = str(body.album);
  if (album) out.album = album;
  const artwork = str(body.cover);
  if (artwork) out.artworkUrl = artwork;
  return out;
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
  return parseKexpPlays(body, showMap);
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
  return parseSpinitronSpins(spinsBody, playlistMap);
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
  return parseBbcSegments(body);
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
  return parseSomaFmSongs(body, channel);
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
  return parseKcrwTrack(body, feed);
};

// ---- NTS Radio (now-playing, show-level, change-detection) --------------

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
 * publish per-track data in the live endpoint; real track data flows from
 * the existing NTS archive poller. Returns null when nothing is on air or
 * the API is unreachable.
 *
 * Config: `{ channel: "1" }` (or "2" for NTS 2).
 */
const ntsLive: NowPlayingAdapter = async (config) => {
  try {
    const channel = str(config.channel) ?? "1";
    const body = await getJson(
      `https://www.nts.live/api/v2/live/${encodeURIComponent(channel)}`,
    );
    return parseNtsLive(body);
  } catch {
    return null;
  }
};

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
 * 3. Title-only — rawArtist falls back to rawTitle for text-search resolution.
 *
 * Returns null for junk metadata (ads, break announcements, station IDs) so
 * those slots are never submitted to the resolver or logged as spins.
 */
export function parseIcyNowPlaying(streamTitle: string): NowPlayingRaw | null {
  const parsed = parseStreamTitle(streamTitle);
  if (!parsed) return null;
  const rawTitle = parsed.rawTitle;
  const sourceArtist = parsed.rawArtist;

  // Apply the junk guard. For title-only entries (no source artist) we pass an
  // empty string so the equality rule cannot fire on the synthetic fallback,
  // while all non-equality checks (ADWTAG, phrases, digits, slugs) still screen
  // the title field. When the source provides an artist the full pair is checked.
  if (isJunkMetadata(sourceArtist ?? "", rawTitle)) return null;

  const rawArtist = sourceArtist ?? rawTitle;
  const out: NowPlayingRaw = { rawArtist, rawTitle };
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
  const result = await fetchIcyMetadata(streamUrl);

  if (!result.ok) {
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
  return parseIcyNowPlaying(result.streamTitle);
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
 *  Pattern A — structured data block (`data-artist` / `data-song` attributes).
 *  Pattern B — class-scoped spans (`.spin-artist`, `.spin-song`).
 *  Pattern C — generic `.artist` / `.song` (older Spinitron page template).
 *  Pattern D — `<meta property="music:musician">` + `<title>` combo.
 *
 * Returns null when none of the patterns fire or either field is blank.
 * Never throws — any parse failure produces null.
 */
export function parseSpinitronWebPage(html: string): NowPlayingRaw | null {
  // Pattern A — data attributes on the spin container (future-proofing)
  const dataArtist = /data-artist="([^"]+)"/.exec(html)?.[1];
  const dataSong = /data-song="([^"]+)"/.exec(html)?.[1];
  if (dataArtist && dataSong) {
    return { rawArtist: dataArtist.trim(), rawTitle: dataSong.trim() };
  }

  // Pattern B — Spinitron's actual HTML structure (confirmed live):
  //   <span class="artist">Artist Name</span> <span class="song">Song Title</span>
  // The first occurrence in the page is the current/most-recent spin.
  const artistMatch = /class="artist">([^<]+)</.exec(html)?.[1];
  const songMatch = /class="song">([^<]+)</.exec(html)?.[1];
  if (artistMatch && songMatch) {
    return { rawArtist: artistMatch.trim(), rawTitle: songMatch.trim() };
  }

  // Pattern C — JSON island with artist/song keys (may appear in embedded data)
  const jsonIsland = /"artist"\s*:\s*"([^"]+)"[^}]*"song"\s*:\s*"([^"]+)"/.exec(html);
  if (jsonIsland) {
    const [, rawArtist, rawTitle] = jsonIsland;
    if (rawArtist && rawTitle) {
      return { rawArtist: rawArtist.trim(), rawTitle: rawTitle.trim() };
    }
  }

  // Pattern D — OpenGraph / Twitter card meta tags as last resort
  const ogTitle =
    /property="og:title"\s+content="([^"]+)"/.exec(html)?.[1] ??
    /name="twitter:title"\s+content="([^"]+)"/.exec(html)?.[1];
  if (ogTitle) {
    // Spinitron og:title format: "Artist – Song on CALLSIGN" or "Artist - Song"
    const parts = ogTitle.split(/\s[–\-]\s/);
    if (parts.length >= 2) {
      const rawTitle = parts[1].replace(/\s+on\s+\w+\s*$/, "").trim();
      const rawArtist = parts[0].trim();
      if (rawArtist && rawTitle) {
        return { rawArtist, rawTitle };
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
};

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
const BACKFILL_SOURCES = new Set(["kexp_api", "spinitron"]);

/** Whether this source supports resumable deep-history backfill. */
export function supportsBackfill(source: string | null | undefined): boolean {
  return !!source && BACKFILL_SOURCES.has(source);
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
    default:
      return null;
  }
}
