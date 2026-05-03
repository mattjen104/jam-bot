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

const countByTitleStmt = db.prepare<[string, string], { c: number }>(
  `SELECT COUNT(*) AS c FROM played_tracks
   WHERE title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\'`,
);
export function countPlaysMatching(needle: string): number {
  const like = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  return countByTitleStmt.get(like, like)?.c ?? 0;
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

// All range queries use `played_at <= end` (inclusive) so an "as of now"
// snapshot includes plays that happened in the current second. The weekly
// scheduler fires once per day, so the boundary-double-count window is
// negligible (one second per week).
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
