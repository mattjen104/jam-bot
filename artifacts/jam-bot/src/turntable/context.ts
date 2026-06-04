import type { KnownBlock } from "@slack/types";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { askLLM } from "../llm/openrouter.js";
import { getTrackContext, setTrackContext } from "../db.js";
import type { AcrMatch } from "./acrcloud.js";
import type { SearchResultTrack } from "../spotify/client.js";
import type { TrackKnowledge } from "./knowledge.js";
import {
  fetchArtistTags,
  fetchSimilarArtists,
  lastfmEnabled,
} from "./lastfm.js";
import { fetchArtistBio, wikipediaEnabled } from "./wikipedia.js";
import { fetchGeniusUrl, geniusEnabled } from "./genius.js";

/**
 * Track "context": genre/era/story layer on top of the liner-notes credits.
 * Genre tags + similar artists (Last.fm) and a short bio (Wikipedia) are
 * artist-level facts; a Genius lyrics link is song-level. Everything is fetched
 * on demand, cached by a canonical key, and runs OFF the playback hot path —
 * the turntable session has already resolved/played/seeked by the time this is
 * invoked. Nothing here fabricates: every field comes straight from a source.
 */

export interface TrackContext {
  /** MusicBrainz artist id, when known (the canonical artist key). */
  artistId?: string;
  artistName?: string;
  /** Genre tags (Last.fm), cleaned + capped. */
  tags: string[];
  /** A few similar artists (Last.fm). */
  similarArtists: string[];
  /** Short artist bio snippet (Wikipedia). */
  bio?: string;
  wikipediaUrl?: string;
  /** Lyrics/annotations link (Genius). */
  geniusUrl?: string;
  /**
   * True when the song-level link (Genius) was matched by title/artist rather
   * than confirmed to this exact recording — mirrors the "matched by title"
   * honesty on the now-playing and liner-notes cards. Artist-level facts
   * (tags/similar/bio) are always accurate to the artist.
   */
  approximate: boolean;
  fetchedAtMs: number;
}

/** Artist-level cache entry (tags/similar/bio share one canonical artist key). */
interface ArtistContextPayload {
  artistId?: string;
  artistName?: string;
  tags: string[];
  similarArtists: string[];
  bio?: string;
  wikipediaUrl?: string;
  fetchedAtMs: number;
}

/** Song-level cache entry (the Genius link keyed by recording/song). */
interface SongContextPayload {
  geniusUrl?: string;
  fetchedAtMs: number;
}

/** Whether any context source is configured and the feature is enabled. */
export function trackContextEnabled(): boolean {
  return (
    config.TRACK_CONTEXT_ENABLED &&
    (lastfmEnabled() || wikipediaEnabled() || geniusEnabled())
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

const ttlMs = (): number =>
  config.TRACK_CONTEXT_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Canonical artist key. A MusicBrainz artist id (carried over from the
 * liner-notes phase) is 1:1 with an artist, so when we have one it IS the key;
 * otherwise we fall back to a normalized artist-name digest.
 */
function artistKey(artist: string, mbid?: string): string {
  if (mbid?.trim()) return `ctx-artist:mbid:${mbid.trim()}`;
  return `ctx-artist:tt:${slug(artist)}`;
}

/**
 * Canonical song key for the Genius link: MusicBrainz recording id when known,
 * else ISRC, else a normalized title|artist digest so replays still hit cache.
 */
function songKey(match: AcrMatch, recordingId?: string): string {
  if (recordingId?.trim()) return `ctx-song:mbrec:${recordingId.trim()}`;
  if (match.isrc?.trim()) return `ctx-song:isrc:${match.isrc.trim().toUpperCase()}`;
  return `ctx-song:tt:${slug(match.title)}|${slug(match.artist)}`;
}

function readCache<T>(key: string): T | undefined {
  try {
    const raw = getTrackContext(key, ttlMs());
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn("Track context cache read failed", { key, error: String(err) });
    return undefined;
  }
}

function writeCache(key: string, payload: unknown): void {
  try {
    setTrackContext(key, JSON.stringify(payload));
  } catch (err) {
    logger.warn("Track context cache write failed", {
      key,
      error: String(err),
    });
  }
}

function hasContent(ctx: TrackContext): boolean {
  return (
    ctx.tags.length > 0 ||
    ctx.similarArtists.length > 0 ||
    !!ctx.bio ||
    !!ctx.geniusUrl
  );
}

/**
 * Resolve genre/era/story context for a confirmed turntable track. Returns
 * null when the feature is off, nothing useful resolved, or on any failure —
 * never throws, so a caller can `void enrichContext(...)` safely.
 *
 * Artist-level facts (tags/similar/bio) are cached under one canonical artist
 * key, so every track by the same artist shares them; the song-level Genius
 * link is cached under its own recording/song key. Empty results are cached too
 * so a dud isn't re-queried. When a `knowledge` object from the liner-notes
 * phase is supplied we reuse its canonical MusicBrainz artist/recording ids for
 * precise lookups and cache convergence; otherwise we fall back to names.
 */
export async function enrichContext(args: {
  match: AcrMatch;
  track: SearchResultTrack;
  viaIsrc: boolean;
  knowledge?: TrackKnowledge | null;
}): Promise<TrackContext | null> {
  const { match, viaIsrc, knowledge } = args;
  if (!trackContextEnabled()) return null;

  const artist = (knowledge?.artistName ?? match.artist ?? "").trim() ||
    match.artist;
  const mbid = knowledge?.artistId;
  const recordingId = knowledge?.recordingId;

  // ---- Artist-level: tags + similar + bio (one canonical artist key) ----
  const aKey = artistKey(artist, mbid);
  let artistPayload = readCache<ArtistContextPayload>(aKey);
  if (!artistPayload) {
    const [tags, similarArtists, bio] = await Promise.all([
      fetchArtistTags(artist, mbid),
      fetchSimilarArtists(artist, mbid),
      fetchArtistBio(artist),
    ]);
    artistPayload = {
      artistId: mbid,
      artistName: artist,
      tags,
      similarArtists,
      bio: bio?.extract,
      wikipediaUrl: bio?.url,
      fetchedAtMs: Date.now(),
    };
    writeCache(aKey, artistPayload);
  }

  // ---- Song-level: Genius lyrics link (own recording/song key) ----------
  const sKey = songKey(match, recordingId);
  let songPayload = readCache<SongContextPayload>(sKey);
  if (!songPayload) {
    const geniusUrl = await fetchGeniusUrl(match.title, match.artist);
    songPayload = { geniusUrl: geniusUrl ?? undefined, fetchedAtMs: Date.now() };
    writeCache(sKey, songPayload);
  }

  const context: TrackContext = {
    artistId: artistPayload.artistId,
    artistName: artistPayload.artistName,
    tags: artistPayload.tags,
    similarArtists: artistPayload.similarArtists,
    bio: artistPayload.bio,
    wikipediaUrl: artistPayload.wikipediaUrl,
    geniusUrl: songPayload.geniusUrl,
    // Only the song-level link can be "wrong recording"; flag it when we
    // didn't confirm the Spotify track by ISRC.
    approximate: !viaIsrc,
    fetchedAtMs: Date.now(),
  };

  return hasContent(context) ? context : null;
}

// ---- Formatting --------------------------------------------------------

/** Trim a bio to ~`max` chars at a word boundary, adding an ellipsis. */
function truncate(s: string, max = 280): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Pure: render the context section blocks. Returns [] when there's nothing
 * worth showing. `summary` is an optional one-line, fact-only bot-voice intro.
 */
export function contextBlocks(
  context: TrackContext,
  summary?: string | null,
): KnownBlock[] {
  const lines: string[] = [];
  lines.push(`:headphones: *Genre & context*`);

  if (summary?.trim()) lines.push(`_${summary.trim()}_`);

  if (context.tags.length) {
    lines.push(`*Genre:* ${context.tags.join(" · ")}`);
  }
  if (context.similarArtists.length) {
    lines.push(`*Similar artists:* ${context.similarArtists.join(", ")}`);
  }
  if (context.bio?.trim()) {
    const bio = truncate(context.bio);
    lines.push(
      context.wikipediaUrl
        ? `${bio} <${context.wikipediaUrl}|(Wikipedia)>`
        : bio,
    );
  }
  if (context.geniusUrl) {
    lines.push(
      `*Lyrics:* <${context.geniusUrl}|Genius>` +
        (context.approximate ? " _(matched by title)_" : ""),
    );
  }

  // Only header (+ maybe summary) and nothing else — not worth a card.
  if (lines.length <= (summary?.trim() ? 2 : 1)) return [];

  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    },
  ];
}

/** Compact, fact-only digest fed to the LLM for the optional one-liner. */
export function contextFactsText(
  track: SearchResultTrack,
  context: TrackContext,
): string {
  const lines = [`Track: ${track.title} by ${track.artist}`];
  if (context.artistName) lines.push(`Artist: ${context.artistName}`);
  if (context.tags.length) lines.push(`Genres/tags: ${context.tags.join(", ")}`);
  if (context.similarArtists.length) {
    lines.push(`Similar artists: ${context.similarArtists.join(", ")}`);
  }
  if (context.bio) lines.push(`Bio: ${context.bio}`);
  return lines.join("\n");
}

/**
 * Tightly-scoped allowlist of words a summary may use WITHOUT them appearing in
 * the facts: English function words, copulas/auxiliaries, generic connective
 * verbs, and subjective "vibe" adjectives. The point is that none of these are
 * *falsifiable facts* — they carry no artist, genre, place, or year claim. Any
 * word NOT on this list and NOT in the facts is treated as a potential
 * fabrication (an invented genre/scene/place/name) and rejects the summary.
 * Deliberately excludes genre-like nouns (e.g. "ambient", "krautrock") so an
 * invented genre is caught even when the model writes it in lowercase.
 */
const SUMMARY_ALLOWED = new Set([
  // articles / determiners / conjunctions / prepositions
  "a", "an", "the", "and", "or", "but", "nor", "of", "on", "in", "into",
  "onto", "at", "to", "for", "with", "by", "from", "as", "than", "then",
  "so", "yet", "about", "around", "between", "across", "through", "over",
  // pronouns / pointers
  "this", "that", "these", "those", "it", "its", "their", "there", "here",
  "i", "we", "you", "they", "one",
  // copulas / auxiliaries
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
  // generic connective verbs (carry no proper-noun claim of their own)
  "blends", "blend", "blending", "draws", "draw", "drawing", "sits", "sit",
  "evokes", "evoke", "recalls", "recall", "channels", "channel", "spans",
  "span", "mixes", "mix", "mixing", "fuses", "fuse", "fusing", "bridges",
  "bridge", "nods", "nod", "leans", "lean", "rooted", "roots", "root",
  "grounded", "grounds", "sounds", "sound", "feels", "feel", "lands", "land",
  "comes", "come", "pairs", "pair", "pairing", "captures", "capture",
  "builds", "build", "carries", "carry", "sets", "set", "stands", "stand",
  "moves", "move", "plays", "play", "playing", "born", "made", "shaped",
  // subjective vibe adjectives (not falsifiable facts)
  "dreamy", "lush", "moody", "warm", "cool", "smooth", "hazy", "gentle",
  "soft", "rich", "bright", "dark", "heavy", "soulful", "raw", "tight",
  "loose", "slow", "fast", "driving", "sweeping", "intimate", "epic",
  "playful", "melancholy", "wistful", "classic", "vintage", "modern",
  "contemporary", "timeless", "iconic", "signature", "distinctive",
  // generic music / time nouns (no specific claim)
  "music", "sound", "scene", "era", "style", "genre", "genres", "band",
  "artist", "project", "group", "act", "record", "records", "song", "songs",
  "track", "tracks", "vibe", "vibes", "side", "single", "ep", "lp", "album",
  "albums", "vinyl", "playing", "now", "similar", "like", "more", "most",
  "very", "quite", "rather", "largely", "early", "late", "mid", "golden",
]);

/**
 * Grounding guard: the hard backstop behind the prompt. Returns true only if
 * EVERY content token in the summary is either present in the supplied facts or
 * on the tightly-scoped function/vibe allowlist. This rejects fabrications in
 * all classes the objective cares about:
 *   - invented artists / places / names (capitalized or not),
 *   - invented genres / scenes (even lowercase — they aren't on the allowlist),
 *   - invented years / eras / decades (any numeric token must be in the facts).
 * Conservative by design: a false reject merely drops the optional one-liner;
 * a false accept would post a fabricated fact, which the user forbids.
 */
export function contextSummaryIsGrounded(
  summary: string,
  track: SearchResultTrack,
  context: TrackContext,
): boolean {
  const factTokens = new Set<string>();
  const addTokens = (s: string | undefined) => {
    if (!s) return;
    for (const t of s.toLowerCase().split(/[^a-z0-9]+/i)) {
      if (t) factTokens.add(t);
    }
  };
  addTokens(track.title);
  addTokens(track.artist);
  addTokens(context.artistName);
  for (const tag of context.tags) addTokens(tag);
  for (const a of context.similarArtists) addTokens(a);
  addTokens(context.bio);

  for (const word of summary.split(/\s+/)) {
    // Normalize to bare alphanumerics, lowercased (drops punctuation and the
    // apostrophe in forms like "'80s" → "80s" or "don't" → "dont").
    const token = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!token) continue;
    // Numeric tokens (years, decades like "80s"/"1979") are hard factual
    // claims: they must appear verbatim in the facts, never via the allowlist.
    if (/[0-9]/.test(token)) {
      if (!factTokens.has(token)) return false;
      continue;
    }
    if (!factTokens.has(token) && !SUMMARY_ALLOWED.has(token)) return false;
  }
  return true;
}

/**
 * Optional one-line, bot-voice summary placing the track in its genre/era —
 * built STRICTLY from the supplied facts. Returns null when disabled, on
 * failure, or when the generated sentence fails the grounding guard. Never
 * throws. The prompt forbids inventing anything; `contextSummaryIsGrounded`
 * enforces it.
 */
export async function buildContextSummary(
  track: SearchResultTrack,
  context: TrackContext,
): Promise<string | null> {
  if (!config.TRACK_CONTEXT_LLM_SUMMARY) return null;
  if (!hasContent(context)) return null;
  const facts = contextFactsText(track, context);
  const question =
    `Here are verified facts about the record now playing:\n\n` +
    `${facts}\n\n` +
    `Write ONE short, natural sentence placing this music in its genre, era, ` +
    `or scene, in your voice. Use ONLY the facts above — do not add, infer, ` +
    `or embellish any artist, genre, place, or year that isn't listed. No ` +
    `emojis, no lead-in like "Context:", just the sentence.`;
  try {
    const out = await askLLM(question);
    const trimmed = out.trim().replace(/^["']|["']$/g, "");
    if (!trimmed) return null;
    if (!contextSummaryIsGrounded(trimmed, track, context)) {
      logger.warn("Track context summary rejected (ungrounded)", {
        summary: trimmed,
      });
      return null;
    }
    return trimmed;
  } catch (err) {
    logger.warn("Track context summary failed", { error: String(err) });
    return null;
  }
}
