import { db, recordingsTable, lyricLinesTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { ingestGeniusAnnotations } from "./genius-annotations.js";

/**
 * LRCLIB synced-lyrics pipeline.
 *
 * LRCLIB (lrclib.net) is the largest free, structurally time-coded lyrics
 * source. It returns per-line LRC timestamps that let Lore highlight the
 * current lyric during playback — the first visible "timeline" feature and
 * a prerequisite for the Genius-projection trick (mapping annotation to
 * offset_ms via the lyric anchor).
 *
 * Policy:
 *  - Fetch on demand when the song page loads (same pattern as enrichRecording).
 *  - Only store SYNCED lyrics — plain lyrics without timestamps have no value
 *    on the timeline axis.
 *  - Cache the fetch result: if rows exist for an mbid, skip the network call.
 *    Negative results (no synced lyrics) are cached via a sentinel row at
 *    offset_ms = -1 so we never hammer LRCLIB for tracks it doesn't cover.
 *  - Never store raw lyrics as prose. We store only the per-line text needed
 *    to show the currently active cue during playback.
 */

const LRCLIB_BASE = "https://lrclib.net/api";
const LRCLIB_UA = "lore-radio v1.0 (https://github.com/lore-radio)";

/** One synced lyric cue. */
export interface LyricLine {
  offsetMs: number;
  text: string;
}

/** Sentinel offset_ms for a "no synced lyrics found" cache entry. */
const MISS_SENTINEL = -1;

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
 * Fetch synced lyrics from LRCLIB for a recording. Returns null if LRCLIB
 * has no entry or has no synced version. Never throws.
 */
export async function fetchFromLrclib(
  title: string,
  artist: string,
  album: string | null,
  durationMs: number | null,
): Promise<LyricLine[] | null> {
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
      instrumental?: boolean;
    };
    if (j.instrumental) return []; // legitimate "no words" — store nothing
    if (!j.syncedLyrics) return null; // only plain lyrics — not useful on timeline
    return parseLrc(j.syncedLyrics);
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
 * Fetch synced lyrics for a recording (on-demand, idempotent).
 *
 * - If already in DB, returns rows immediately (no network).
 * - If LRCLIB returns synced lyrics, stores and returns them.
 * - If no synced lyrics, stores a miss-sentinel so future calls are cheap.
 * - Filters out the sentinel before returning to callers.
 */
export async function getLyrics(mbid: string): Promise<LyricLine[]> {
  // Fast path — already fetched
  if (await lyricsAttempted(mbid)) {
    const rows = await db
      .select({ offsetMs: lyricLinesTable.offsetMs, text: lyricLinesTable.text })
      .from(lyricLinesTable)
      .where(eq(lyricLinesTable.mbid, mbid))
      .orderBy(lyricLinesTable.offsetMs);
    return rows.filter((r) => r.offsetMs !== MISS_SENTINEL);
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

  if (!rec) return [];

  const lines = await fetchFromLrclib(rec.title, rec.artist, null, rec.durationMs);

  if (lines === null || lines.length === 0) {
    // Cache the miss so this mbid doesn't re-hit the network
    await db
      .insert(lyricLinesTable)
      .values({ mbid, offsetMs: MISS_SENTINEL, text: "" })
      .onConflictDoNothing();
    return [];
  }

  // Store the synced lines
  await db
    .insert(lyricLinesTable)
    .values(lines.map((l) => ({ mbid, offsetMs: l.offsetMs, text: l.text })))
    .onConflictDoNothing();

  console.info(`[lore] lrclib ${rec.artist} – ${rec.title}: ${lines.length} synced line(s)`);

  // Off hot path: trigger Genius annotation ingestion now that we have lyric
  // lines to project against. Fire-and-forget — never blocks the lyrics response.
  ingestGeniusAnnotations(mbid).catch((err) =>
    console.warn("[lore] genius annotation trigger failed", mbid, err),
  );

  return lines;
}
