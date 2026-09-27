import { db } from "../db.js";
import { config } from "../config.js";

export type SongShareLinkType =
  | "spotify_track"
  | "spotify_album"
  | "apple_song"
  | "apple_album"
  | "youtube_video"
  | "musicbrainz_recording"
  | "musicbrainz_release";

export interface SongShare {
  id: number;
  channel_id: string;
  message_ts: string;
  thread_ts: string | null;
  slack_user_id: string;
  link_type: SongShareLinkType;
  canonical_id: string;
  canonical_url: string;
  context: string | null;
  created_at: string;
}

export interface SongShareMessage {
  channel: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  text?: string;
}

export interface SongShareQuery {
  slackUserId?: string;
  channelId?: string;
  linkType?: SongShareLinkType;
  canonicalId?: string;
  /** Case-insensitive substring match across canonical IDs, URLs, and context. */
  needle?: string;
  limit?: number;
}

export interface CanonicalLink {
  link_type: SongShareLinkType;
  canonical_id: string;
  canonical_url: string;
}

const MAX_CONTEXT_CHARS = 240;
const MAX_LEDGER_ROWS = 5000;
const URL_RE = /https?:\/\/[^\s<>|]+/giu;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSlackUserId(value: unknown): value is string {
  // Slack user IDs (including enterprise-grid W IDs) are opaque IDs, not
  // display names or arbitrary message text.
  return typeof value === "string" && /^[UW][A-Z0-9]{2,}$/i.test(value);
}

function parseSongLink(rawUrl: string): CanonicalLink | null {
  // Slack's rendered URL token may be followed by punctuation from prose.
  const cleanUrl = rawUrl.replace(/[),.!?;:'"]+$/u, "");
  let url: URL;
  try {
    url = new URL(cleanUrl);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443")
  ) {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./u, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const canonical = (
    link_type: SongShareLinkType,
    canonical_id: string,
    canonical_url: string,
  ): CanonicalLink => ({ link_type, canonical_id, canonical_url });

  if (host === "open.spotify.com") {
    const kind = parts[0]?.toLowerCase();
    const id = parts[1];
    if ((kind === "track" || kind === "album") && id && /^[A-Za-z0-9]{6,64}$/u.test(id)) {
      const link_type = kind === "track" ? "spotify_track" : "spotify_album";
      return canonical(link_type, id, `https://open.spotify.com/${kind}/${id}`);
    }
    return null;
  }

  if (host === "music.apple.com") {
    const kindIndex = parts.findIndex((part) => part === "song" || part === "album");
    const kind = parts[kindIndex];
    if (kind && kindIndex > 0) {
      // Apple links end with the stable numeric catalog ID; song links can
      // also have ?i=<track id>, which is folded into the song's identity.
      const id = parts[kindIndex + 2];
      if (id && /^\d{5,}$/u.test(id)) {
        const storefront = parts[0]?.toLowerCase();
        if (!storefront) return null;
        const songId = kind === "album" ? url.searchParams.get("i") : null;
        if (songId && /^\d{5,}$/u.test(songId)) {
          // Apple shares a specific song using an album URL plus ?i=<song>.
          // Treating it as an album would misattribute a song-level question.
          return canonical(
            "apple_song",
            `${storefront}:${songId}`,
            `https://music.apple.com/${storefront}/album/${parts[kindIndex + 1]}/${id}?i=${songId}`,
          );
        }
        const link_type = kind === "song" ? "apple_song" : "apple_album";
        return canonical(
          link_type,
          `${storefront}:${id}`,
          `https://music.apple.com/${storefront}/${kind}/${id}`,
        );
      }
    }
    return null;
  }

  if (
    host === "music.youtube.com" ||
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be"
  ) {
    let videoId: string | null = null;
    if (host === "youtu.be") {
      videoId = parts[0] ?? null;
    } else if (parts[0] === "watch") {
      videoId = url.searchParams.get("v");
    } else if (["embed", "shorts", "live"].includes(parts[0] ?? "")) {
      videoId = parts[1] ?? null;
    }
    if (videoId && /^[A-Za-z0-9_-]{11}$/u.test(videoId)) {
      return canonical(
        "youtube_video",
        videoId,
        `https://www.youtube.com/watch?v=${videoId}`,
      );
    }
    return null;
  }

  if (host === "musicbrainz.org") {
    const kind = parts[0]?.toLowerCase();
    const id = parts[1]?.toLowerCase();
    if ((kind === "recording" || kind === "release") && id && UUID_RE.test(id)) {
      const link_type =
        kind === "recording" ? "musicbrainz_recording" : "musicbrainz_release";
      return canonical(link_type, id, `https://musicbrainz.org/${kind}/${id}`);
    }
  }

  return null;
}

function extractLinks(text: string): CanonicalLink[] {
  const byIdentity = new Map<string, CanonicalLink>();
  for (const match of text.matchAll(URL_RE)) {
    const link = parseSongLink(match[0]);
    if (link) byIdentity.set(`${link.link_type}:${link.canonical_id}`, link);
  }
  return [...byIdentity.values()];
}

/** Parse supported song URLs using the same canonical identity as storage. */
export function canonicalSongLinkFromText(text: string): CanonicalLink | null {
  return extractLinks(text)[0] ?? null;
}

function sanitizeContext(text: string): string | null {
  const sanitized = text
    .slice(0, 10_000)
    .replace(URL_RE, " ")
    // Slack mentions, channel references, and command tokens are not useful
    // conversational context to retain in this deliberately tiny ledger.
    .replace(/<[@#!][^>]{1,200}>/gu, " ")
    .replace(/<[^>]{0,200}>/gu, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_CONTEXT_CHARS);
  return sanitized || null;
}

const deleteMessageStmt = db.prepare<[string, string]>(
  `DELETE FROM song_shares WHERE channel_id = ? AND message_ts = ?`,
);
const insertShareStmt = db.prepare(`
  INSERT INTO song_shares (
    channel_id, message_ts, thread_ts, slack_user_id,
    link_type, canonical_id, canonical_url, context
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(channel_id, message_ts, link_type, canonical_id) DO UPDATE SET
    thread_ts = excluded.thread_ts,
    slack_user_id = excluded.slack_user_id,
    canonical_url = excluded.canonical_url,
    context = excluded.context,
    created_at = datetime('now')
`);
const pruneOldStmt = db.prepare(
  `DELETE FROM song_shares WHERE created_at < datetime('now', '-90 days')`,
);
const pruneOverLimitStmt = db.prepare<[number]>(`
  DELETE FROM song_shares
  WHERE id NOT IN (
    SELECT id FROM song_shares
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  )
`);

// Enforce the retention policy immediately on process start as well as during
// writes, so a quiet deployment does not leave expired rows on disk.
pruneOldStmt.run();
pruneOverLimitStmt.run(MAX_LEDGER_ROWS);

const storeMessage = db.transaction(
  (event: SongShareMessage, links: CanonicalLink[], context: string | null) => {
    deleteMessageStmt.run(event.channel, event.ts);
    for (const link of links) {
      insertShareStmt.run(
        event.channel,
        event.ts,
        event.thread_ts ?? null,
        event.user,
        link.link_type,
        link.canonical_id,
        link.canonical_url,
        context,
      );
    }
    pruneOldStmt.run();
    pruneOverLimitStmt.run(MAX_LEDGER_ROWS);
  },
);

/**
 * Store supported explicit music URLs from a verified human message in the
 * configured channel. Calling this again for the same message (including an
 * edit) replaces that message's rows, making Slack event retries idempotent.
 * Returns the current supported links stored for the message.
 */
export function ingestSongShareMessage(event: SongShareMessage): number {
  if (
    event.channel !== config.SLACK_CHANNEL_ID ||
    !isSlackUserId(event.user) ||
    !/^\d{1,20}\.\d{1,10}$/u.test(event.ts) ||
    typeof event.text !== "string"
  ) {
    return 0;
  }
  const threadTs =
    event.thread_ts && /^\d{1,20}\.\d{1,10}$/u.test(event.thread_ts)
      ? event.thread_ts
      : undefined;
  const normalizedEvent = { ...event, thread_ts: threadTs };
  const links = extractLinks(event.text);
  storeMessage(normalizedEvent, links, sanitizeContext(event.text));
  return links.length;
}

/** Remove all ledger entries for a Slack message deleted in the configured channel. */
export function deleteSongShareMessage(channel: string, messageTs: string): number {
  if (
    channel !== config.SLACK_CHANNEL_ID ||
    !/^\d{1,20}\.\d{1,10}$/u.test(messageTs)
  ) {
    return 0;
  }
  return deleteMessageStmt.run(channel, messageTs).changes;
}

const selectShares = db.prepare(`
  SELECT * FROM song_shares
  WHERE created_at >= datetime('now', '-90 days')
  ORDER BY CAST(message_ts AS REAL) DESC, id DESC
  LIMIT ?
`);

function boundedLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 25;
  return Math.max(1, Math.min(Math.floor(limit as number), 100));
}

/** List the newest attributed shares, limited to the previous 90 days. */
export function recentSongShares(limit = 25): SongShare[] {
  return selectShares.all(boundedLimit(limit)) as SongShare[];
}

/** Query recent shares by speaker, channel, canonical link, or short context. */
export function querySongShares(query: SongShareQuery = {}): SongShare[] {
  const clauses = [`created_at >= datetime('now', '-90 days')`];
  const params: Array<string | number> = [];
  if (query.slackUserId) {
    clauses.push("slack_user_id = ?");
    params.push(query.slackUserId);
  }
  if (query.channelId) {
    clauses.push("channel_id = ?");
    params.push(query.channelId);
  }
  if (query.linkType) {
    clauses.push("link_type = ?");
    params.push(query.linkType);
  }
  if (query.canonicalId) {
    clauses.push("canonical_id = ?");
    params.push(query.canonicalId);
  }
  if (query.needle?.trim()) {
    const like = `%${query.needle.trim().replace(/[\\%_]/gu, "\\$&")}%`;
    clauses.push(
      "(canonical_id LIKE ? ESCAPE '\\' OR canonical_url LIKE ? ESCAPE '\\' OR context LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like);
  }
  params.push(boundedLimit(query.limit));
  const statement = db.prepare(`
    SELECT * FROM song_shares
    WHERE ${clauses.join(" AND ")}
    ORDER BY CAST(message_ts AS REAL) DESC, id DESC
    LIMIT ?
  `);
  return statement.all(...params) as SongShare[];
}