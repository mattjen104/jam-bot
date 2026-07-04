import type {
  NowPlayingAdapter,
  NowPlayingRaw,
  HistoryAdapter,
  RawSpin,
  ShowAttribution,
} from "./types.js";

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
      if (show) spin.show = show;
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
      if (show) spin.show = show;
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
  const page = Math.max(opts?.page ?? 0, 0) + 1; // Spinitron pages are 1-based.
  const auth = `access-token=${encodeURIComponent(token)}`;
  // Playlists first (bounded) so we can attribute show + DJ to each spin.
  let playlistMap = new Map<number, { name: string; djName?: string }>();
  try {
    const plBody = await getJson(
      `https://spinitron.com/api/playlists?${auth}&count=50&expand=persona`,
    );
    playlistMap = parseSpinitronPlaylists(plBody);
  } catch {
    // Attribution is best-effort; spins are still logged without it.
  }
  const spinsBody = await getJson(
    `https://spinitron.com/api/spins?${auth}&count=${count}&page=${page}`,
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

const bbcApi: HistoryAdapter = async (config) => {
  const sid = str(config.sid) ?? str(config.serviceId);
  if (!sid) return [];
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
    spin.show = show;
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

// ---- Registry -----------------------------------------------------------

const NOW_PLAYING_ADAPTERS: Record<string, NowPlayingAdapter> = {
  radio_paradise: radioParadise,
  station_page: stationPage,
  nts_live: ntsLive,
  fip,
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
const BACKFILL_SOURCES = new Set(["kexp_api"]);

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
 */
export function stationArchiveUrl(
  source: string | null | undefined,
  day: string,
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
    default:
      return null;
  }
}
