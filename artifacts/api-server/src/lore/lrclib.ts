import { db, recordingsTable, lyricLinesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

export type LyricsEvidenceStatus =
  | "lyrics_found"
  | "instrumental"
  | "no_result"
  | "transient_failure"
  | "not_checked";

export interface LyricsEvidence extends LyricsResult {
  status: LyricsEvidenceStatus;
  error?: string;
}

/** Sentinel offset_ms for a definitive "no lyrics found" cache entry. */
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
  const outcome = await fetchLrclibEvidence(title, artist, album, durationMs);
  if (outcome.status === "lyrics_found" || outcome.status === "instrumental") {
    return { lines: outcome.lines, synced: outcome.synced };
  }
  return null;
}

/**
 * Fetch LRCLIB and preserve the provider outcome. The legacy
 * `fetchFromLrclib` wrapper intentionally keeps its nullable return shape,
 * while this result is used by persistence and the station audit.
 */
export async function fetchLrclibEvidence(
  title: string,
  artist: string,
  album: string | null,
  durationMs: number | null,
): Promise<LyricsEvidence> {
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) params.set("album_name", album);
    if (durationMs !== null) params.set("duration", String(Math.round(durationMs / 1000)));

    const r = await fetch(`${LRCLIB_BASE}/get?${params.toString()}`, {
      headers: { "User-Agent": LRCLIB_UA },
    });
    if (r.status === 404) {
      return { status: "no_result", lines: [], synced: false };
    }
    if (!r.ok) {
      console.warn("[lore] lrclib fetch failed", r.status, title, artist);
      return {
        status: "transient_failure",
        lines: [],
        synced: false,
        error: `HTTP ${r.status}`,
      };
    }
    const j = (await r.json()) as {
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
      instrumental?: boolean;
    };
    if (j.instrumental) {
      return { status: "instrumental", lines: [], synced: false };
    }
    if (j.syncedLyrics) {
      const lines = parseLrc(j.syncedLyrics);
      if (lines.length > 0) return { status: "lyrics_found", lines, synced: true };
    }
    if (j.plainLyrics) {
      const lines = j.plainLyrics
        .split("\n")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .map((text, i) => ({ offsetMs: PLAIN_OFFSET_BASE + i, text }));
      if (lines.length > 0) {
        return { status: "lyrics_found", lines, synced: false };
      }
    }
    return { status: "no_result", lines: [], synced: false };
  } catch (err) {
    console.warn("[lore] lrclib fetch error", title, artist, err);
    return {
      status: "transient_failure",
      lines: [],
      synced: false,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
    };
  }
}

const TRANSIENT_RETRY_COOLDOWN_MS = 15 * 60_000;
const evidenceInFlight = new Map<string, Promise<LyricsEvidence>>();

export function shouldRetryLyricsEvidence(
  status: LyricsEvidenceStatus,
  checkedAt: Date | null,
  nowMs = Date.now(),
): boolean {
  if (status === "not_checked") return true;
  if (status !== "transient_failure") return false;
  return !checkedAt ||
    nowMs - checkedAt.getTime() >= TRANSIENT_RETRY_COOLDOWN_MS;
}

async function updateEvidence(
  mbid: string,
  status: LyricsEvidenceStatus,
  error: string | null = null,
): Promise<void> {
  await db
    .update(recordingsTable)
    .set({
      lyricStatus: status,
      lyricCheckedAt: new Date(),
      lyricError: error,
      updatedAt: new Date(),
    })
    .where(eq(recordingsTable.mbid, mbid));
}

async function cachedEvidence(
  mbid: string,
  status: LyricsEvidenceStatus,
  checkedAt: Date | null,
): Promise<LyricsEvidence | null> {
  const rows = await db
    .select({ offsetMs: lyricLinesTable.offsetMs, text: lyricLinesTable.text })
    .from(lyricLinesTable)
    .where(eq(lyricLinesTable.mbid, mbid))
    .orderBy(lyricLinesTable.offsetMs);
  const lines = rows.filter((row) => row.offsetMs !== MISS_SENTINEL);
  if (lines.length > 0) {
    return {
      status: "lyrics_found",
      lines,
      synced: lines[0]!.offsetMs < PLAIN_OFFSET_BASE,
    };
  }
  if (status === "instrumental" || status === "no_result") {
    return { status, lines: [], synced: false };
  }
  if (
    status === "transient_failure" &&
    !shouldRetryLyricsEvidence(status, checkedAt)
  ) {
    return { status, lines: [], synced: false };
  }
  return null;
}

async function loadCachedEvidence(mbid: string): Promise<LyricsEvidence | null> {
  const [recording] = await db
    .select({
      status: recordingsTable.lyricStatus,
      checkedAt: recordingsTable.lyricCheckedAt,
    })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);
  if (!recording) return null;

  const status = (recording.status || "not_checked") as LyricsEvidenceStatus;
  const cached = await cachedEvidence(
    mbid,
    status,
    recording.checkedAt,
  );
  if (cached) return cached;

  // Rows written before lyric_status existed remain readable and are upgraded
  // from their actual shape. A miss sentinel is no_result, never instrumental.
  const rows = await db
    .select({ offsetMs: lyricLinesTable.offsetMs, text: lyricLinesTable.text })
    .from(lyricLinesTable)
    .where(eq(lyricLinesTable.mbid, mbid));
  if (rows.length === 0) return null;
  const hasLines = rows.some((row) => row.offsetMs !== MISS_SENTINEL);
  const inferred: Exclude<LyricsEvidenceStatus, "not_checked" | "transient_failure"> =
    hasLines ? "lyrics_found" : "no_result";
  await updateEvidence(mbid, inferred);
  return {
    status: inferred,
    lines: rows
      .filter((row) => row.offsetMs !== MISS_SENTINEL)
      .sort((a, b) => a.offsetMs - b.offsetMs),
    synced: hasLines && rows.find((row) => row.offsetMs !== MISS_SENTINEL)!.offsetMs < PLAIN_OFFSET_BASE,
  };
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
export async function getLyricsEvidence(mbid: string): Promise<LyricsEvidence> {
  const cached = await loadCachedEvidence(mbid);
  if (cached) return cached;
  const existing = evidenceInFlight.get(mbid);
  if (existing) return existing;

  const work = (async (): Promise<LyricsEvidence> => {
    const [rec] = await db
      .select({
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        durationMs: recordingsTable.durationMs,
      })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, mbid))
      .limit(1);

    if (!rec) return { status: "not_checked", lines: [], synced: false };

    const result = await fetchLrclibEvidence(rec.title, rec.artist, null, rec.durationMs);
    await updateEvidence(mbid, result.status, result.error ?? null);

    if (result.status === "no_result") {
      await db
        .insert(lyricLinesTable)
        .values({ mbid, offsetMs: MISS_SENTINEL, text: "" })
        .onConflictDoNothing();
    } else if (result.status === "lyrics_found") {
      await db
        .insert(lyricLinesTable)
        .values(result.lines.map((line) => ({ mbid, offsetMs: line.offsetMs, text: line.text })))
        .onConflictDoNothing();
      console.info(
        `[lore] lrclib ${rec.artist} – ${rec.title}: ${result.lines.length} ` +
        `${result.synced ? "synced" : "plain"} line(s)`,
      );
      if (result.synced) {
        ingestGeniusAnnotations(mbid).catch((err) =>
          console.warn("[lore] genius annotation trigger failed", mbid, err),
        );
      }
    }
    return result;
  })();
  evidenceInFlight.set(mbid, work);
  try {
    return await work;
  } finally {
    evidenceInFlight.delete(mbid);
  }
}

export async function getLyrics(mbid: string): Promise<LyricsResult> {
  const { lines, synced } = await getLyricsEvidence(mbid);
  return { lines, synced };
}
