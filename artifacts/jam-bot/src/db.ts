import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { config } from "./config.js";

const dbPath = path.resolve(config.DATABASE_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS played_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    album_image_url TEXT,
    spotify_url TEXT,
    duration_ms INTEGER,
    requested_by_slack_user TEXT,
    requested_query TEXT,
    played_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_played_tracks_played_at ON played_tracks (played_at DESC);
  CREATE INDEX IF NOT EXISTS idx_played_tracks_track_id ON played_tracks (track_id);

  CREATE TABLE IF NOT EXISTS pending_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL,
    requested_by_slack_user TEXT NOT NULL,
    requested_query TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pending_requests_track_id ON pending_requests (track_id);

  CREATE TABLE IF NOT EXISTS user_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slack_user TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_user_requests_user_time
    ON user_requests (slack_user, created_at);

  CREATE TABLE IF NOT EXISTS user_optouts (
    slack_user TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Speeds up the "first appearance of this track" subquery used by the
  -- discovery / wrapped queries — a covering composite index on
  -- (track_id, played_at) lets SQLite resolve the NOT EXISTS check by
  -- index lookup alone.
  CREATE INDEX IF NOT EXISTS idx_played_tracks_track_played_at
    ON played_tracks (track_id, played_at);

  -- Tiny key/value bag for state that needs to survive process restarts but
  -- doesn't deserve its own table (e.g. the WrappedScheduler's last-fire key).
  CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );

  -- Durable, per-user remembered facts (taste, preferences, personal
  -- details) accumulated over time and pulled into a reply ONLY when the
  -- personalization gate fires. Dedupe is enforced by a case-insensitive
  -- unique index on (slack_user, fact) so the same fact isn't stored twice.
  CREATE TABLE IF NOT EXISTS user_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slack_user TEXT NOT NULL,
    fact TEXT NOT NULL,
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories (slack_user);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memories_user_fact
    ON user_memories (slack_user, lower(fact));

  -- Cache of Slack display names so identity resolution doesn't hit the
  -- Slack Web API on every message. Refreshed opportunistically on miss.
  CREATE TABLE IF NOT EXISTS user_names (
    slack_user TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Active "engaged" threads: once Jam Bot is @-mentioned in a thread (or
  -- starts one) she answers follow-ups there without a re-mention until
  -- dismissed or until the thread goes quiet past the inactivity timeout.
  -- Keyed by (channel, thread_ts); last_activity_ms drives auto-exit and
  -- survives restarts so a session isn't lost on redeploy.
  CREATE TABLE IF NOT EXISTS engagement_sessions (
    channel TEXT NOT NULL,
    thread_ts TEXT NOT NULL,
    started_by TEXT,
    topic TEXT,
    last_activity_ms INTEGER NOT NULL,
    PRIMARY KEY (channel, thread_ts)
  );

  -- On-demand cache of liner-notes "track knowledge" (production credits,
  -- pressing/label detail) fetched from external music databases. Keyed by a
  -- canonical key (MusicBrainz recording id when resolved, else ISRC, else a
  -- title|artist digest). The payload column is the JSON-serialized
  -- TrackKnowledge; fetched_at_ms drives TTL expiry so replays of the same
  -- record do not re-hit the APIs. We cache rather than warehouse — entries
  -- are disposable.
  CREATE TABLE IF NOT EXISTS track_knowledge (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at_ms INTEGER NOT NULL
  );

  -- On-demand cache of "track context" (genre tags, similar artists, a short
  -- artist bio, and a Genius lyrics link) fetched from Last.fm / Wikipedia /
  -- Genius. Keyed by a canonical key: artist-level data lives under an artist
  -- key (MusicBrainz artist id when known, else a normalized artist-name
  -- digest) and the song-level Genius link under a recording/song key. payload
  -- is the JSON-serialized cache entry; fetched_at_ms drives TTL expiry so
  -- replays don't re-hit the APIs. Cache, not warehouse — entries are
  -- disposable.
  CREATE TABLE IF NOT EXISTS track_context (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at_ms INTEGER NOT NULL
  );
`);

// Migrate older deployments where pending_requests had track_id PRIMARY KEY
// (no `id` column). The table above already exists in that case, so the
// CREATE TABLE IF NOT EXISTS above is a no-op; we add the missing column /
// index in-place so FIFO pops work.
const pendingCols = db
  .prepare<[], { name: string }>(`PRAGMA table_info(pending_requests)`)
  .all()
  .map((r) => r.name);
// Migrate older deployments that don't yet have played_tracks.album_image_url.
const playedCols = db
  .prepare<[], { name: string }>(`PRAGMA table_info(played_tracks)`)
  .all()
  .map((r) => r.name);
if (!playedCols.includes("album_image_url")) {
  db.exec(`ALTER TABLE played_tracks ADD COLUMN album_image_url TEXT`);
}

if (!pendingCols.includes("id")) {
  db.exec(`
    ALTER TABLE pending_requests RENAME TO pending_requests_old;
    CREATE TABLE pending_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      requested_by_slack_user TEXT NOT NULL,
      requested_query TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO pending_requests (track_id, requested_by_slack_user, requested_query, created_at)
      SELECT track_id, requested_by_slack_user, requested_query, created_at FROM pending_requests_old;
    DROP TABLE pending_requests_old;
    CREATE INDEX IF NOT EXISTS idx_pending_requests_track_id ON pending_requests (track_id);
  `);
}

export interface PlayedTrack {
  id: number;
  track_id: string;
  title: string;
  artist: string;
  album: string | null;
  album_image_url: string | null;
  spotify_url: string | null;
  duration_ms: number | null;
  requested_by_slack_user: string | null;
  requested_query: string | null;
  played_at: string;
}

const insertPlayedStmt = db.prepare(`
  INSERT INTO played_tracks
    (track_id, title, artist, album, album_image_url, spotify_url, duration_ms, requested_by_slack_user, requested_query)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function recordPlayed(track: {
  track_id: string;
  title: string;
  artist: string;
  album?: string | null;
  album_image_url?: string | null;
  spotify_url?: string | null;
  duration_ms?: number | null;
  requested_by_slack_user?: string | null;
  requested_query?: string | null;
}) {
  insertPlayedStmt.run(
    track.track_id,
    track.title,
    track.artist,
    track.album ?? null,
    track.album_image_url ?? null,
    track.spotify_url ?? null,
    track.duration_ms ?? null,
    track.requested_by_slack_user ?? null,
    track.requested_query ?? null,
  );
}

const recentStmt = db.prepare<[number], PlayedTrack>(
  `SELECT * FROM played_tracks ORDER BY played_at DESC LIMIT ?`,
);
export function recentPlayed(limit = 25): PlayedTrack[] {
  return recentStmt.all(limit);
}

const lastPlayedStmt = db.prepare<[], PlayedTrack>(
  `SELECT * FROM played_tracks ORDER BY played_at DESC LIMIT 1`,
);
export function lastPlayed(): PlayedTrack | undefined {
  return lastPlayedStmt.get();
}

const lastPlayedByTrackIdStmt = db.prepare<[string], PlayedTrack>(
  `SELECT * FROM played_tracks
   WHERE track_id = ?
   ORDER BY played_at DESC
   LIMIT 1`,
);
/**
 * Look up the most recent play row for a given Spotify track id. Used by
 * /memory playback to surface "now queueing X" confirmation messages with
 * the canonical title/artist text we recorded the first time it played.
 */
export function lastPlayedByTrackId(trackId: string): PlayedTrack | undefined {
  return lastPlayedByTrackIdStmt.get(trackId);
}

const countTrackStmt = db.prepare<[string], { c: number }>(
  `SELECT COUNT(*) AS c FROM played_tracks WHERE track_id = ?`,
);
export function countPlaysOf(trackId: string): number {
  return countTrackStmt.get(trackId)?.c ?? 0;
}

const playedInRangeStmt = db.prepare<[string, string, number], PlayedTrack>(
  `SELECT * FROM played_tracks
   WHERE played_at >= ? AND played_at <= ?
   ORDER BY played_at ASC
   LIMIT ?`,
);
export function playedInRange(
  startIso: string,
  endIso: string,
  limit = 100,
): PlayedTrack[] {
  return playedInRangeStmt.all(startIso, endIso, limit);
}

// All plays by a single requester, newest-first. Used by /memory to honor
// "play me a set of stuff Bob queued during the outage" style requests.
const playedByRequesterStmt = db.prepare<[string, number], PlayedTrack>(
  `SELECT * FROM played_tracks
   WHERE requested_by_slack_user = ?
   ORDER BY played_at DESC
   LIMIT ?`,
);
export function playedByRequester(
  slackUser: string,
  limit = 100,
): PlayedTrack[] {
  return playedByRequesterStmt.all(slackUser, limit);
}

const searchByTitleStmt = db.prepare<[string, string, number], PlayedTrack>(
  `SELECT * FROM played_tracks
   WHERE title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\'
   ORDER BY played_at DESC
   LIMIT ?`,
);
export function searchPlayedByTitleOrArtist(
  needle: string,
  limit = 25,
): PlayedTrack[] {
  const like = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  return searchByTitleStmt.all(like, like, limit);
}

// Opt-out aware count. We exclude any play whose requester has opted out so
// the LLM can't infer "there are more plays than the rows you saw" — which
// would leak the existence of opted-out users' history. Anonymous plays
// (no recorded requester) are still counted; they don't expose anyone.
export function countPlaysMatching(needle: string): number {
  const like = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  const opted = listOptOuts();
  if (opted.length === 0) {
    return (
      db
        .prepare<[string, string], { c: number }>(
          `SELECT COUNT(*) AS c FROM played_tracks
           WHERE title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\'`,
        )
        .get(like, like)?.c ?? 0
    );
  }
  const placeholders = opted.map(() => "?").join(",");
  const sql = `SELECT COUNT(*) AS c FROM played_tracks
     WHERE (title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\')
       AND (requested_by_slack_user IS NULL
            OR requested_by_slack_user NOT IN (${placeholders}))`;
  const row = db
    .prepare<unknown[], { c: number }>(sql)
    .get(like, like, ...opted) as { c: number } | undefined;
  return row?.c ?? 0;
}

const insertPendingStmt = db.prepare(`
  INSERT INTO pending_requests (track_id, requested_by_slack_user, requested_query)
  VALUES (?, ?, ?)
`);
export function recordPendingRequest(
  trackId: string,
  slackUserId: string,
  query: string,
) {
  insertPendingStmt.run(trackId, slackUserId, query);
}

interface PendingRow {
  id: number;
  track_id: string;
  requested_by_slack_user: string;
  requested_query: string;
}
const popPendingStmt = db.prepare<[string], PendingRow>(
  `SELECT * FROM pending_requests WHERE track_id = ? ORDER BY id ASC LIMIT 1`,
);
const deletePendingStmt = db.prepare<[number]>(
  `DELETE FROM pending_requests WHERE id = ?`,
);
// FIFO pop: when several people request the same track, attribute each play
// to the requester whose request was registered first.
export function popPendingRequest(trackId: string): PendingRow | undefined {
  const row = popPendingStmt.get(trackId);
  if (row) deletePendingStmt.run(row.id);
  return row;
}

const expirePendingStmt = db.prepare(
  `DELETE FROM pending_requests WHERE created_at < datetime('now', '-1 hour')`,
);
export function expireOldPending() {
  expirePendingStmt.run();
}

const insertUserRequestStmt = db.prepare(
  `INSERT INTO user_requests (slack_user) VALUES (?)`,
);
export function recordUserRequest(slackUserId: string) {
  insertUserRequestStmt.run(slackUserId);
}

const countUserRequestsStmt = db.prepare<[string], { c: number }>(
  `SELECT COUNT(*) AS c FROM user_requests
   WHERE slack_user = ? AND created_at >= datetime('now', '-1 hour')`,
);
export function countUserRequestsLastHour(slackUserId: string): number {
  return countUserRequestsStmt.get(slackUserId)?.c ?? 0;
}

const expireUserRequestsStmt = db.prepare(
  `DELETE FROM user_requests WHERE created_at < datetime('now', '-1 day')`,
);
export function expireOldUserRequests() {
  expireUserRequestsStmt.run();
}

// ---- Jam Memory aggregations -------------------------------------------
//
// All aggregations take SQLite-formatted UTC date strings ("YYYY-MM-DD HH:MM:SS")
// to match how `played_at` is stored. Use `toSqliteUtc(date)` from `wrapped.ts`
// to build them.

export interface TopTrackRow {
  track_id: string;
  title: string;
  artist: string;
  spotify_url: string | null;
  album: string | null;
  album_image_url: string | null;
  plays: number;
}

// All range queries use `played_at <= end` (inclusive). Wrapped/dna
// callers pass `end = now` for "as of this moment" snapshots — with a
// strict `<` they'd drop rows whose played_at equals the snapshot
// instant (a real situation in tests and on busy channels). The
// scheduler fires once per day/week, so the worst-case
// boundary-double-count window is one second per period; we accept
// that in exchange for "as of now" actually meaning "as of now".
const topTracksStmt = db.prepare<[string, string, number], TopTrackRow>(`
  SELECT track_id,
         MAX(title) AS title,
         MAX(artist) AS artist,
         MAX(spotify_url) AS spotify_url,
         MAX(album) AS album,
         MAX(album_image_url) AS album_image_url,
         COUNT(*) AS plays
  FROM played_tracks
  WHERE played_at >= ? AND played_at <= ?
  GROUP BY track_id
  ORDER BY plays DESC, MAX(played_at) DESC
  LIMIT ?
`);
// Direct count of plays in a time window — used by /wrapped's headline
// "totalPlays" so we don't have to derive it from a top-N approximation.
const countPlaysInRangeStmt = db.prepare<[string, string], { c: number }>(`
  SELECT COUNT(*) AS c FROM played_tracks
  WHERE played_at >= ? AND played_at <= ?
`);
export function countPlaysInRange(startStr: string, endStr: string): number {
  return countPlaysInRangeStmt.get(startStr, endStr)?.c ?? 0;
}

export function topTracksInRange(
  startStr: string,
  endStr: string,
  limit = 5,
): TopTrackRow[] {
  return topTracksStmt.all(startStr, endStr, limit);
}

export interface TopArtistRow {
  artist: string;
  plays: number;
}

const topArtistsStmt = db.prepare<[string, string, number], TopArtistRow>(`
  SELECT artist, COUNT(*) AS plays
  FROM played_tracks
  WHERE played_at >= ? AND played_at <= ?
  GROUP BY artist
  ORDER BY plays DESC
  LIMIT ?
`);
export function topArtistsInRange(
  startStr: string,
  endStr: string,
  limit = 5,
): TopArtistRow[] {
  return topArtistsStmt.all(startStr, endStr, limit);
}

export interface UserPlaysRow {
  slack_user: string;
  plays: number;
}

const activeUsersStmt = db.prepare<[string, string], UserPlaysRow>(`
  SELECT requested_by_slack_user AS slack_user, COUNT(*) AS plays
  FROM played_tracks
  WHERE played_at >= ? AND played_at <= ?
    AND requested_by_slack_user IS NOT NULL
  GROUP BY requested_by_slack_user
  ORDER BY plays DESC
`);
export function activeUsersInRange(
  startStr: string,
  endStr: string,
): UserPlaysRow[] {
  return activeUsersStmt.all(startStr, endStr);
}

const userTopTracksStmt = db.prepare<
  [string, string, string, number],
  TopTrackRow
>(`
  SELECT track_id,
         MAX(title) AS title,
         MAX(artist) AS artist,
         MAX(spotify_url) AS spotify_url,
         MAX(album) AS album,
         MAX(album_image_url) AS album_image_url,
         COUNT(*) AS plays
  FROM played_tracks
  WHERE requested_by_slack_user = ?
    AND played_at >= ? AND played_at <= ?
  GROUP BY track_id
  ORDER BY plays DESC, MAX(played_at) DESC
  LIMIT ?
`);
export function userTopTracksInRange(
  slackUser: string,
  startStr: string,
  endStr: string,
  limit = 5,
): TopTrackRow[] {
  return userTopTracksStmt.all(slackUser, startStr, endStr, limit);
}

const userTopArtistsStmt = db.prepare<
  [string, string, string, number],
  TopArtistRow
>(`
  SELECT artist, COUNT(*) AS plays
  FROM played_tracks
  WHERE requested_by_slack_user = ?
    AND played_at >= ? AND played_at <= ?
  GROUP BY artist
  ORDER BY plays DESC
  LIMIT ?
`);
export function userTopArtistsInRange(
  slackUser: string,
  startStr: string,
  endStr: string,
  limit = 5,
): TopArtistRow[] {
  return userTopArtistsStmt.all(slackUser, startStr, endStr, limit);
}

// Tracks the user introduced to the channel (their request was the very first
// time that track_id appeared in history) within the window.
const userDiscoveriesStmt = db.prepare<[string, string, string], TopTrackRow>(`
  SELECT p.track_id, p.title, p.artist, p.spotify_url, p.album, p.album_image_url, 1 AS plays
  FROM played_tracks p
  WHERE p.requested_by_slack_user = ?
    AND p.played_at >= ? AND p.played_at <= ?
    AND NOT EXISTS (
      SELECT 1 FROM played_tracks p2
      WHERE p2.track_id = p.track_id
        AND p2.played_at < p.played_at
    )
  ORDER BY p.played_at ASC
`);
export function userDiscoveriesInRange(
  slackUser: string,
  startStr: string,
  endStr: string,
): TopTrackRow[] {
  return userDiscoveriesStmt.all(slackUser, startStr, endStr);
}

// Distinct UTC hour-of-day histogram. Useful for "late-night vs daytime".
export interface HourBucket {
  hour: number;
  plays: number;
}
const hourBucketsStmt = db.prepare<[string, string], HourBucket>(`
  SELECT CAST(strftime('%H', played_at) AS INTEGER) AS hour,
         COUNT(*) AS plays
  FROM played_tracks
  WHERE played_at >= ? AND played_at <= ?
  GROUP BY hour
  ORDER BY hour
`);
export function hourBucketsInRange(
  startStr: string,
  endStr: string,
): HourBucket[] {
  return hourBucketsStmt.all(startStr, endStr);
}

// ---- Taste DNA / compat primitives -------------------------------------

const userArtistsAllStmt = db.prepare<[string], TopArtistRow>(`
  SELECT artist, COUNT(*) AS plays
  FROM played_tracks
  WHERE requested_by_slack_user = ?
  GROUP BY artist
`);
export function userArtistVector(slackUser: string): TopArtistRow[] {
  return userArtistsAllStmt.all(slackUser);
}

const userTracksAllStmt = db.prepare<[string], { track_id: string; plays: number }>(`
  SELECT track_id, COUNT(*) AS plays
  FROM played_tracks
  WHERE requested_by_slack_user = ?
  GROUP BY track_id
`);
export function userTrackSet(slackUser: string) {
  return userTracksAllStmt.all(slackUser);
}

// Per-user UTC hour-of-day histogram across ALL their plays. Used by /compat
// for the time-of-day overlap component (do these two listen at the same
// hours of day? Bedroom-DJs vs morning-commuters score differently).
const userHourBucketsStmt = db.prepare<[string], HourBucket>(`
  SELECT CAST(strftime('%H', played_at) AS INTEGER) AS hour,
         COUNT(*) AS plays
  FROM played_tracks
  WHERE requested_by_slack_user = ?
  GROUP BY hour
`);
export function userHourBuckets(slackUser: string): HourBucket[] {
  return userHourBucketsStmt.all(slackUser);
}

// Single top track for a user (across all time) — used to render the
// signature-track block in /dna.
const userSignatureTrackStmt = db.prepare<[string], TopTrackRow>(`
  SELECT track_id,
         MAX(title) AS title,
         MAX(artist) AS artist,
         MAX(spotify_url) AS spotify_url,
         MAX(album) AS album,
         MAX(album_image_url) AS album_image_url,
         COUNT(*) AS plays
  FROM played_tracks
  WHERE requested_by_slack_user = ?
  GROUP BY track_id
  ORDER BY plays DESC, MAX(played_at) DESC
  LIMIT 1
`);
export function userSignatureTrack(slackUser: string): TopTrackRow | null {
  return userSignatureTrackStmt.get(slackUser) ?? null;
}

const totalUserPlaysStmt = db.prepare<[string], { c: number }>(
  `SELECT COUNT(*) AS c FROM played_tracks WHERE requested_by_slack_user = ?`,
);
export function userTotalPlays(slackUser: string): number {
  return totalUserPlaysStmt.get(slackUser)?.c ?? 0;
}

const userFirstsStmt = db.prepare<[string], { c: number }>(`
  SELECT COUNT(*) AS c
  FROM played_tracks p
  WHERE p.requested_by_slack_user = ?
    AND NOT EXISTS (
      SELECT 1 FROM played_tracks p2
      WHERE p2.track_id = p.track_id
        AND p2.played_at < p.played_at
    )
`);
export function userDiscoveryCount(slackUser: string): number {
  return userFirstsStmt.get(slackUser)?.c ?? 0;
}

// Tracks user `source` has played (most-played first) that user `target` has
// never played. Used by `/compat` to surface a concrete recommendation.
const recommendStmt = db.prepare<[string, string, number], TopTrackRow>(`
  SELECT track_id,
         MAX(title) AS title,
         MAX(artist) AS artist,
         MAX(spotify_url) AS spotify_url,
         MAX(album) AS album,
         MAX(album_image_url) AS album_image_url,
         COUNT(*) AS plays
  FROM played_tracks
  WHERE requested_by_slack_user = ?
    AND track_id NOT IN (
      SELECT DISTINCT track_id FROM played_tracks
      WHERE requested_by_slack_user = ?
    )
  GROUP BY track_id
  ORDER BY plays DESC, MAX(played_at) DESC
  LIMIT ?
`);
export function recommendFromTo(
  source: string,
  target: string,
  limit = 1,
): TopTrackRow[] {
  return recommendStmt.all(source, target, limit);
}

// ---- Wrapped opt-out ---------------------------------------------------

const setOptOutStmt = db.prepare(
  `INSERT OR IGNORE INTO user_optouts (slack_user) VALUES (?)`,
);
const clearOptOutStmt = db.prepare(
  `DELETE FROM user_optouts WHERE slack_user = ?`,
);
const isOptOutStmt = db.prepare<[string], { c: number }>(
  `SELECT COUNT(*) AS c FROM user_optouts WHERE slack_user = ?`,
);
export function setOptOut(slackUser: string, value: boolean) {
  if (value) setOptOutStmt.run(slackUser);
  else clearOptOutStmt.run(slackUser);
}
export function isOptedOut(slackUser: string): boolean {
  return (isOptOutStmt.get(slackUser)?.c ?? 0) > 0;
}

const listOptOutsStmt = db.prepare<[], { slack_user: string }>(
  `SELECT slack_user FROM user_optouts`,
);
export function listOptOuts(): string[] {
  return listOptOutsStmt.all().map((r) => r.slack_user);
}

// ---- Tiny key/value bag (used by the WrappedScheduler) ------------------

const kvGetStmt = db.prepare<[string], { v: string }>(
  `SELECT v FROM kv WHERE k = ?`,
);
const kvSetStmt = db.prepare(
  `INSERT INTO kv (k, v) VALUES (?, ?)
   ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
);
export function kvGet(key: string): string | null {
  return kvGetStmt.get(key)?.v ?? null;
}
export function kvSet(key: string, value: string) {
  kvSetStmt.run(key, value);
}

// ---- Track knowledge cache (liner-notes credits) -----------------------

const trackKnowledgeGetStmt = db.prepare<
  [string],
  { payload: string; fetched_at_ms: number }
>(`SELECT payload, fetched_at_ms FROM track_knowledge WHERE cache_key = ?`);
const trackKnowledgeSetStmt = db.prepare(
  `INSERT INTO track_knowledge (cache_key, payload, fetched_at_ms)
   VALUES (?, ?, ?)
   ON CONFLICT(cache_key) DO UPDATE SET
     payload = excluded.payload,
     fetched_at_ms = excluded.fetched_at_ms`,
);

/**
 * Read a cached, still-fresh track-knowledge payload (raw JSON string) for a
 * canonical cache key. Returns null on a miss or when the entry is older than
 * `ttlMs`. Callers parse the JSON into their own typed shape.
 */
export function getTrackKnowledge(
  cacheKey: string,
  ttlMs: number,
  nowMs: number = Date.now(),
): string | null {
  const row = trackKnowledgeGetStmt.get(cacheKey);
  if (!row) return null;
  if (nowMs - row.fetched_at_ms > ttlMs) return null;
  return row.payload;
}

/** Upsert a track-knowledge payload (raw JSON string) under a canonical key. */
export function setTrackKnowledge(
  cacheKey: string,
  payload: string,
  nowMs: number = Date.now(),
) {
  trackKnowledgeSetStmt.run(cacheKey, payload, nowMs);
}

// ---- Track context cache (genre/era/story) -----------------------------

const trackContextGetStmt = db.prepare<
  [string],
  { payload: string; fetched_at_ms: number }
>(`SELECT payload, fetched_at_ms FROM track_context WHERE cache_key = ?`);
const trackContextSetStmt = db.prepare(
  `INSERT INTO track_context (cache_key, payload, fetched_at_ms)
   VALUES (?, ?, ?)
   ON CONFLICT(cache_key) DO UPDATE SET
     payload = excluded.payload,
     fetched_at_ms = excluded.fetched_at_ms`,
);

/**
 * Read a cached, still-fresh track-context payload (raw JSON string) for a
 * canonical cache key. Returns null on a miss or when the entry is older than
 * `ttlMs`. Callers parse the JSON into their own typed shape.
 */
export function getTrackContext(
  cacheKey: string,
  ttlMs: number,
  nowMs: number = Date.now(),
): string | null {
  const row = trackContextGetStmt.get(cacheKey);
  if (!row) return null;
  if (nowMs - row.fetched_at_ms > ttlMs) return null;
  return row.payload;
}

/** Upsert a track-context payload (raw JSON string) under a canonical key. */
export function setTrackContext(
  cacheKey: string,
  payload: string,
  nowMs: number = Date.now(),
) {
  trackContextSetStmt.run(cacheKey, payload, nowMs);
}

// ---- Per-user remembered facts -----------------------------------------

export interface UserMemory {
  id: number;
  slack_user: string;
  fact: string;
  category: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

// INSERT OR IGNORE relies on the case-insensitive unique index
// (slack_user, lower(fact)) to drop exact/case-variant duplicates. On a
// duplicate we bump updated_at so the fact is treated as freshly reasserted.
const insertMemoryStmt = db.prepare(`
  INSERT INTO user_memories (slack_user, fact, category)
  VALUES (?, ?, ?)
  ON CONFLICT (slack_user, lower(fact))
  DO UPDATE SET updated_at = datetime('now')
`);
export function addUserMemory(
  slackUser: string,
  fact: string,
  category: string | null = null,
) {
  const trimmed = fact.trim();
  if (!trimmed) return;
  insertMemoryStmt.run(slackUser, trimmed, category);
}

// Most-relevant-first: recently used, then most recently asserted.
const getMemoriesStmt = db.prepare<[string, number], UserMemory>(`
  SELECT * FROM user_memories
  WHERE slack_user = ?
  ORDER BY COALESCE(last_used_at, updated_at) DESC, id DESC
  LIMIT ?
`);
export function getUserMemories(slackUser: string, limit = 50): UserMemory[] {
  return getMemoriesStmt.all(slackUser, limit);
}

const forgetMemoriesStmt = db.prepare<[string]>(
  `DELETE FROM user_memories WHERE slack_user = ?`,
);
export function forgetUserMemories(slackUser: string) {
  forgetMemoriesStmt.run(slackUser);
}

const touchMemoriesStmt = db.prepare<[string]>(
  `UPDATE user_memories SET last_used_at = datetime('now') WHERE slack_user = ?`,
);
export function touchUserMemories(slackUser: string) {
  touchMemoriesStmt.run(slackUser);
}

// ---- Slack display-name cache ------------------------------------------

const getNameStmt = db.prepare<[string], { display_name: string }>(
  `SELECT display_name FROM user_names WHERE slack_user = ?`,
);
export function getCachedUserName(slackUser: string): string | null {
  return getNameStmt.get(slackUser)?.display_name ?? null;
}

const setNameStmt = db.prepare(`
  INSERT INTO user_names (slack_user, display_name)
  VALUES (?, ?)
  ON CONFLICT(slack_user) DO UPDATE SET
    display_name = excluded.display_name,
    updated_at = datetime('now')
`);
export function setCachedUserName(slackUser: string, displayName: string) {
  const trimmed = displayName.trim();
  if (!trimmed) return;
  setNameStmt.run(slackUser, trimmed);
}

// ---- Active engagement sessions (thread mode) --------------------------

export interface EngagementSession {
  channel: string;
  thread_ts: string;
  started_by: string | null;
  topic: string | null;
  last_activity_ms: number;
}

// Start OR refresh: re-mentioning her in an already-engaged thread just
// bumps last_activity (the original starter/topic are kept).
const startSessionStmt = db.prepare(`
  INSERT INTO engagement_sessions (channel, thread_ts, started_by, topic, last_activity_ms)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(channel, thread_ts) DO UPDATE SET last_activity_ms = excluded.last_activity_ms
`);
export function startEngagementSession(
  channel: string,
  threadTs: string,
  startedBy: string | null,
  topic: string | null = null,
) {
  startSessionStmt.run(channel, threadTs, startedBy, topic, Date.now());
}

const refreshSessionStmt = db.prepare<[number, string, string]>(
  `UPDATE engagement_sessions SET last_activity_ms = ? WHERE channel = ? AND thread_ts = ?`,
);
export function refreshEngagementSession(channel: string, threadTs: string) {
  refreshSessionStmt.run(Date.now(), channel, threadTs);
}

const getSessionStmt = db.prepare<[string, string], EngagementSession>(
  `SELECT * FROM engagement_sessions WHERE channel = ? AND thread_ts = ?`,
);
const deleteSessionStmt = db.prepare<[string, string]>(
  `DELETE FROM engagement_sessions WHERE channel = ? AND thread_ts = ?`,
);
export function endEngagementSession(channel: string, threadTs: string) {
  deleteSessionStmt.run(channel, threadTs);
}

/**
 * Return the active session for a thread, or null. A session that hasn't
 * seen activity within `maxIdleMs` is treated as gone and deleted in place
 * (lazy auto-exit), so a stale thread never keeps her engaged.
 */
export function getEngagementSession(
  channel: string,
  threadTs: string,
  maxIdleMs: number,
): EngagementSession | null {
  const row = getSessionStmt.get(channel, threadTs);
  if (!row) return null;
  if (Date.now() - row.last_activity_ms > maxIdleMs) {
    deleteSessionStmt.run(channel, threadTs);
    return null;
  }
  return row;
}

const expireSessionsStmt = db.prepare<[number]>(
  `DELETE FROM engagement_sessions WHERE last_activity_ms < ?`,
);
export function expireEngagementSessions(maxIdleMs: number) {
  expireSessionsStmt.run(Date.now() - maxIdleMs);
}
