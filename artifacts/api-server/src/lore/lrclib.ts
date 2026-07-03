import { db, recordingsTable, lyricLinesTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { ingestGeniusAnnotations } from "./genius-annotations.js";

/**
 * LRCLIB lyrics pipeline.
 *
 * LRCLIB (lrclib.net) is the largest free, structurally time-coded lyrics
 * source. It returns per-line LRC timestamps that let Lore highlight the
 * current lyric during playback — the first visible "timeline" feature and
 * a prerequisite for the Genius-projection trick (mapping annotation to
 * offset_ms via the lyric anchor).
 *
 * Policy:
 *  - Fetch on demand when the song page loads (same pattern as enrichRecording).
 *  - Prefer SYNCED lyrics (time-coded). Fall back to PLAIN lyrics (static).
 *  - Cache the fetch result: if rows exist for an mbid, skip the network call.
 *    Negative results (no lyrics at all) are cached via a sentinel row at
 *    offset_ms = -1 so we never hammer LRCLIB for tracks it doesn't cover.
 *  - Plain lyrics are stored with a high-base offset (PLAIN_OFFSET_BASE + line
 *    index) so the unique (mbid, offsetMs) index is satisfied while keeping
 *    them clearly distinguishable from real timestamps.
 */

const LRCLIB_BASE = "https://lrclib.net/api";
const LRCLIB_UA = "lore-radio v1.0 (https://github.com/lore-radio)";

/** One lyric cue. offsetMs is meaningful only when the track is synced. */
export interface LyricLine {
  offsetMs: number;
  text: string;
}

/** Result from getLyrics — includes whether the lines carry real timestamps. */
export interface LyricsResult {
  lines: LyricLine[];
  synced: boolean;
}

/** Sentinel offset_ms for a "no lyrics found" cache entry. */
const MISS_SENTINEL = -1;

/**
 * Plain lyrics (no timestamps) are stored with offsetMs = PLAIN_OFFSET_BASE + lineIndex.
 * This keeps the unique (mbid, offsetMs) index satisfied and makes synced vs. plain
 * detectable without a schema change. 10_000_000 ms = ~167 min — beyond any real song.
 */
const PLAIN_OFFSET_BASE = 10_000_000;

/**
 * Parse an LRC-format string into timestamped lines.
 * Handles both `[MM:SS.xx]` and `[MM:SS.xxx]` (centiseconds vs milliseconds).
 * Strips music-note and instrumental markers; skips blank lines.
 * Pure — never throws.
 */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d{1,2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (!m) continue;
    const min = parseInt(m[1]!, 10);
    const sec = parseInt(m[2]!, 10);
    const frac = m[3]!;
    // Normalise centiseconds (2 digits) and milliseconds (3 digits) to ms
    const fracMs = frac.length === 2 ? parseInt(frac, 10) * 10 : parseInt(frac, 10);
    const offsetMs = (min * 60 + sec) * 1000 + fracMs;
    const text = m[4]!.trim().replace(/^[♪♫]\s*/, "").trim();
    if (!text || text === "♪" || text === "♫") continue;
    lines.push({ offsetMs, text });
  }
  return lines.sort((a, b) => a.offsetMs - b.offsetMs);
}

/**
 * Fetch lyrics from LRCLIB for a recording. Prefers synced (time-coded) lyrics;
 * falls back to plain (static) lyrics when no synced version exists.
 * Returns null only when LRCLIB has no entry at all. Never throws.
 */
export async function fetchFromLrclib(
  title: string,
  artist: string,
  album: string | null,
  durationMs: number | null,
): Promise<LyricsResult | null> {
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) params.set("album_name", album);
    if (durationMs !== null) params.set("duration", String(Math.round(durationMs / 1000)));

    const r = await fetch(`${LRCLIB_BASE}/get?${params.toString()}`, {
      headers: { "User-Agent": LRCLIB_UA },
    });
    if (r.status === 404) return null;
    if (!r.ok) {
      console.warn("[lore] lrclib fetch failed", r.status, title, artist);
      return null;
    }
    const j = (await r.json()) as {
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
      instrumental?: boolean;
    };
    if (j.instrumental) return { lines: [], synced: false }; // no words — cache as miss
    if (j.syncedLyrics) {
      const lines = parseLrc(j.syncedLyrics);
      return { lines, synced: true };
    }
    if (j.plainLyrics) {
      const lines = j.plainLyrics
        .split("\n")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .map((text, i) => ({ offsetMs: PLAIN_OFFSET_BASE + i, text }));
      return { lines, synced: false };
    }
    return null;
  } catch (err) {
    console.warn("[lore] lrclib fetch error", title, artist, err);
    return null;
  }
}

/**
 * True when we've already attempted (and stored or cached-missed) lyrics
 * for this mbid. Checks for any row — including the miss sentinel.
 */
async function lyricsAttempted(mbid: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(lyricLinesTable)
    .where(eq(lyricLinesTable.mbid, mbid));
  return (row?.n ?? 0) > 0;
}

/**
 * Fetch lyrics for a recording (on-demand, idempotent).
 *
 * - If already in DB, returns rows immediately (no network).
 * - Prefers synced (time-coded) lyrics; falls back to plain (static) lyrics.
 * - If no lyrics at all, stores a miss-sentinel so future calls are cheap.
 * - Filters out the sentinel before returning to callers.
 * - Returns { lines, synced } so callers know whether timestamps are real.
 */
export async function getLyrics(mbid: string): Promise<LyricsResult> {
  // Fast path — already fetched
  if (await lyricsAttempted(mbid)) {
    const rows = await db
      .select({ offsetMs: lyricLinesTable.offsetMs, text: lyricLinesTable.text })
      .from(lyricLinesTable)
      .where(eq(lyricLinesTable.mbid, mbid))
      .orderBy(lyricLinesTable.offsetMs);
    const lines = rows.filter((r) => r.offsetMs !== MISS_SENTINEL);
    const synced = lines.length > 0 && lines[0]!.offsetMs < PLAIN_OFFSET_BASE;
    return { lines, synced };
  }

  // Slow path — look up recording metadata and call LRCLIB
  const [rec] = await db
    .select({
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      durationMs: recordingsTable.durationMs,
    })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);

  if (!rec) return { lines: [], synced: false };

  const result = await fetchFromLrclib(rec.title, rec.artist, null, rec.durationMs);

  if (result === null || result.lines.length === 0) {
    // Cache the miss so this mbid doesn't re-hit the network
    await db
      .insert(lyricLinesTable)
      .values({ mbid, offsetMs: MISS_SENTINEL, text: "" })
      .onConflictDoNothing();
    return { lines: [], synced: false };
  }

  // Store the lines (synced or plain)
  await db
    .insert(lyricLinesTable)
    .values(result.lines.map((l) => ({ mbid, offsetMs: l.offsetMs, text: l.text })))
    .onConflictDoNothing();

  const kind = result.synced ? "synced" : "plain";
  console.info(`[lore] lrclib ${rec.artist} – ${rec.title}: ${result.lines.length} ${kind} line(s)`);

  // Off hot path: trigger Genius annotation ingestion now that we have lyric
  // lines to project against. Only useful for synced lyrics. Fire-and-forget.
  if (result.synced) {
    ingestGeniusAnnotations(mbid).catch((err) =>
      console.warn("[lore] genius annotation trigger failed", mbid, err),
    );
  }

  return result;
}
