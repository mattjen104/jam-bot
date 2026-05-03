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
`);

// Migrate older deployments where pending_requests had track_id PRIMARY KEY
// (no `id` column). The table above already exists in that case, so the
// CREATE TABLE IF NOT EXISTS above is a no-op; we add the missing column /
// index in-place so FIFO pops work.
const pendingCols = db
  .prepare<[], { name: string }>(`PRAGMA table_info(pending_requests)`)
  .all()
  .map((r) => r.name);
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
  spotify_url: string | null;
  duration_ms: number | null;
  requested_by_slack_user: string | null;
  requested_query: string | null;
  played_at: string;
}

const insertPlayedStmt = db.prepare(`
  INSERT INTO played_tracks
    (track_id, title, artist, album, spotify_url, duration_ms, requested_by_slack_user, requested_query)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

export function recordPlayed(track: {
  track_id: string;
  title: string;
  artist: string;
  album?: string | null;
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
   WHERE played_at >= ? AND played_at < ?
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
