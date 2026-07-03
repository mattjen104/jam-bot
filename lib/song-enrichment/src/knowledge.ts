import type { KnownBlock } from "@slack/types";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { askLLM } from "./summarizer.js";
import {
  getTrackKnowledge,
  setTrackKnowledge,
} from "./cache.js";
import type { AcrMatch } from "./types.js";
import type { SearchResultTrack } from "./types.js";
import {
  type Credit,
  type SongRelationship,
  fetchRecordingCredits,
  musicbrainzEnabled,
  resolveRecordingId,
} from "./musicbrainz.js";
import {
  type DiscogsPressing,
  discogsEnabled,
  fetchDiscogsPressing,
} from "./discogs.js";

/**
 * Liner-notes "track knowledge": real production credits + pressing detail,
 * fetched on demand from MusicBrainz (canonical credits) and Discogs (physical
 * pressing) and cached by a canonical key. Everything here runs OFF the
 * playback hot path — the turntable session has already resolved/played/seeked
 * by the time enrichment is invoked.
 */

export interface TrackKnowledge {
  /** MusicBrainz recording id, when resolved (the canonical spine). */
  recordingId?: string;
  artistId?: string;
  artistName?: string;
  personnel: Credit[];
  pressing?: DiscogsPressing;
  /**
   * Typed song-to-song relationships (samples / covers / remixes /
   * interpolations) for this recording, parsed from MusicBrainz. Always an
   * array (possibly empty); the web graph renders each as a typed edge/node and
   * the Slack card shows a compact section when non-empty.
   */
  relationships: SongRelationship[];
  /**
   * True when the facts are NOT guaranteed to match this exact recording —
   * i.e. we fell back to title/artist matching, MusicBrainz didn't resolve, or
   * the pressing came from an approximate Discogs search. Mirrors the
   * "matched by title" honesty on the turntable now-playing card.
   */
  approximate: boolean;
  fetchedAtMs: number;
}

/** Whether any knowledge source is configured and the feature is enabled. */
export function trackKnowledgeEnabled(): boolean {
  return (
    config.TRACK_KNOWLEDGE_ENABLED &&
    (musicbrainzEnabled() || discogsEnabled())
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Canonical cache key. ISRC is effectively 1:1 with a MusicBrainz recording,
 * so when we have one it IS the canonical key; otherwise we fall back to a
 * normalized title|artist digest so title-matched replays still hit cache.
 */
export function buildCacheKey(match: AcrMatch): string {
  if (match.isrc?.trim()) return `isrc:${match.isrc.trim().toUpperCase()}`;
  return `tt:${slug(match.title)}|${slug(match.artist)}`;
}

function hasContent(k: TrackKnowledge): boolean {
  return (
    k.personnel.length > 0 ||
    !!k.pressing ||
    (k.relationships?.length ?? 0) > 0
  );
}

const ttlMs = (): number =>
  config.TRACK_KNOWLEDGE_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Canonical cache key for a resolved MusicBrainz recording. */
function recordingKey(recordingId: string): string {
  return `mbrec:${recordingId}`;
}

/** Read + parse a cache entry. `undefined` = miss, object = hit (even empty). */
function readCache(key: string): TrackKnowledge | undefined {
  try {
    const raw = getTrackKnowledge(key, ttlMs());
    if (!raw) return undefined;
    return JSON.parse(raw) as TrackKnowledge;
  } catch (err) {
    logger.warn("Track knowledge cache read failed", {
      key,
      error: String(err),
    });
    return undefined;
  }
}

function writeCache(key: string, knowledge: TrackKnowledge): void {
  try {
    setTrackKnowledge(key, JSON.stringify(knowledge));
  } catch (err) {
    logger.warn("Track knowledge cache write failed", {
      key,
      error: String(err),
    });
  }
}

/**
 * Resolve liner-notes knowledge for a confirmed turntable track. Returns null
 * when the feature is off, nothing useful resolved, or on any failure — never
 * throws, so a caller can `void enrichTrack(...)` safely.
 *
 * Caching converges on the canonical MusicBrainz recording id: we first try a
 * cheap pre-resolution key (ISRC or title|artist), then resolve the recording
 * id with ONE MusicBrainz request and check/write the canonical `mbrec:<id>`
 * entry. This way alternate ISRCs for the same recording share one cache entry
 * and we avoid paying for the heavy credits/Discogs fetches on a known
 * recording. Empty results are cached too, so a dud isn't re-queried.
 */
export async function enrichTrack(args: {
  match: AcrMatch;
  track: SearchResultTrack;
  viaIsrc: boolean;
}): Promise<TrackKnowledge | null> {
  const { match, viaIsrc } = args;
  if (!trackKnowledgeEnabled()) return null;

  // 1. Fast path: exact pre-resolution key (instant replays of the same record).
  const preKey = buildCacheKey(match);
  const pre = readCache(preKey);
  if (pre) return hasContent(pre) ? pre : null;

  // 2. Resolve the canonical recording id cheaply (one request) and converge on
  //    the canonical cache entry when we have it.
  let recordingId: string | null = null;
  if (match.isrc && musicbrainzEnabled()) {
    recordingId = await resolveRecordingId(match.isrc);
  }
  if (recordingId) {
    const canon = readCache(recordingKey(recordingId));
    if (canon) {
      // Alias under preKey so the next identical play is a single-lookup hit.
      writeCache(preKey, canon);
      return hasContent(canon) ? canon : null;
    }
  }

  // 3. Full fetch: credits for the resolved recording + Discogs pressing.
  const [credits, pressing] = await Promise.all([
    recordingId ? fetchRecordingCredits(recordingId) : Promise.resolve(null),
    fetchDiscogsPressing(match.title, match.artist),
  ]);

  const knowledge: TrackKnowledge = {
    recordingId: recordingId ?? undefined,
    artistId: credits?.artistId,
    artistName: credits?.artistName,
    personnel: credits?.personnel ?? [],
    pressing: pressing ?? undefined,
    relationships: credits?.relationships ?? [],
    // Recording-exact only when we matched the Spotify track by ISRC AND got
    // canonical MusicBrainz credits for that recording. Anything else is
    // approximate (pressing-level / title-matched).
    approximate: !(viaIsrc && !!credits),
    fetchedAtMs: Date.now(),
  };

  writeCache(preKey, knowledge);
  if (recordingId) writeCache(recordingKey(recordingId), knowledge);

  return hasContent(knowledge) ? knowledge : null;
}

/**
 * Synchronous cache peek for a recording's liner-notes knowledge.
 * Returns the cached value immediately without making any external requests.
 * Returns null on a cache miss or when the feature is disabled.
 * Use this to implement stale-while-revalidate: return the peek result
 * immediately, then fire `enrichRecording` in the background.
 */
export function peekEnrichedKnowledge(recordingId: string): TrackKnowledge | null {
  if (!trackKnowledgeEnabled()) return null;
  const canon = readCache(recordingKey(recordingId));
  if (!canon) return null;
  return hasContent(canon) ? canon : null;
}

/**
 * Resolve liner-notes knowledge when the caller ALREADY has the canonical
 * MusicBrainz recording id (e.g. the radio spine, where spins are resolved to
 * an MBID before enrichment is ever asked for). Skips the ISRC→recording
 * resolution step and converges on the same canonical `mbrec:<id>` cache entry
 * `enrichTrack` uses, so the turntable and radio paths share one cache. Never
 * throws; returns null when the feature is off, nothing useful resolved, or on
 * any failure.
 */
export async function enrichRecording(args: {
  recordingId: string;
  title: string;
  artist: string;
  isrc?: string | null;
}): Promise<TrackKnowledge | null> {
  if (!trackKnowledgeEnabled()) return null;

  const canonKey = recordingKey(args.recordingId);
  const canon = readCache(canonKey);
  if (canon) return hasContent(canon) ? canon : null;

  const [credits, pressing] = await Promise.all([
    musicbrainzEnabled()
      ? fetchRecordingCredits(args.recordingId)
      : Promise.resolve(null),
    fetchDiscogsPressing(args.title, args.artist),
  ]);

  const knowledge: TrackKnowledge = {
    recordingId: args.recordingId,
    artistId: credits?.artistId,
    artistName: credits?.artistName,
    personnel: credits?.personnel ?? [],
    pressing: pressing ?? undefined,
    relationships: credits?.relationships ?? [],
    // Credits are exact when present (fetched for this exact recording id);
    // a pressing-only result is still an approximate title/artist match.
    approximate: !credits,
    fetchedAtMs: Date.now(),
  };

  writeCache(canonKey, knowledge);
  // Alias under the cheap pre-resolution key so turntable plays of the same
  // record (which look up by ISRC or title|artist first) hit cache instantly.
  writeCache(
    buildCacheKey({
      acrid: "",
      title: args.title,
      artist: args.artist,
      album: "",
      isrc: args.isrc ?? undefined,
      playOffsetMs: 0,
    }),
    knowledge,
  );

  return hasContent(knowledge) ? knowledge : null;
}

// ---- Credit grouping / formatting --------------------------------------

function pick(personnel: Credit[], pred: (role: string) => boolean): Credit[] {
  return personnel.filter((c) => pred(c.role.toLowerCase()));
}

function names(credits: Credit[], cap = 6): string {
  const list = credits.map((c) => c.name);
  if (list.length <= cap) return list.join(", ");
  return `${list.slice(0, cap).join(", ")} +${list.length - cap} more`;
}

function performersLine(performers: Credit[], cap = 6): string {
  // Show "name (role)" for performers, deduping a person who plays several
  // instruments into one entry.
  const byName = new Map<string, string[]>();
  for (const c of performers) {
    const roles = byName.get(c.name) ?? [];
    if (c.role && c.role !== "performer" && !roles.includes(c.role)) {
      roles.push(c.role);
    }
    byName.set(c.name, roles);
  }
  const entries = [...byName.entries()].map(([name, roles]) =>
    roles.length ? `${name} (${roles.join(", ")})` : name,
  );
  if (entries.length <= cap) return entries.join(", ");
  return `${entries.slice(0, cap).join(", ")} +${entries.length - cap} more`;
}

const isProducer = (r: string) => r.includes("produc");
const isEngineer = (r: string) =>
  r.includes("engineer") ||
  r === "mix" ||
  r.includes("mastering") ||
  r === "recording";
const isWriter = (r: string) =>
  r === "composer" || r === "lyricist" || r === "writer";

/**
 * Group personnel into producers / writers / engineers / performers. Shared by
 * the standalone liner-notes card and the consolidated track card's Credits tab
 * so the two never drift in how a role is bucketed.
 */
export function groupPersonnel(personnel: Credit[]): {
  producers: Credit[];
  writers: Credit[];
  engineers: Credit[];
  performers: Credit[];
} {
  return {
    producers: pick(personnel, isProducer),
    writers: pick(personnel, isWriter),
    engineers: pick(personnel, isEngineer),
    performers: personnel.filter(
      (c) =>
        !isProducer(c.role.toLowerCase()) &&
        !isEngineer(c.role.toLowerCase()) &&
        !isWriter(c.role.toLowerCase()),
    ),
  };
}

/**
 * Capitalize a directional relationship label for use as a line heading
 * ("samples" -> "Samples", "sampled by" -> "Sampled by").
 */
function relLabelHeading(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Render one related entity as a linked, optionally annotated mrkdwn fragment. */
function relTargetText(rel: SongRelationship): string {
  const meta = [rel.artist, rel.year ? String(rel.year) : null]
    .filter(Boolean)
    .join(", ");
  const label = meta ? `${rel.title} — ${meta}` : rel.title;
  return `<${rel.mbUrl}|${label}>`;
}

/**
 * Pure: compact relationship lines for the Slack card, grouped by directional
 * label (one line per "Samples:", "Remix of:", …) with linked targets. Returns
 * [] when there are no relationships. Shared by the standalone liner-notes card
 * and the consolidated track card so the two never drift.
 */
export function relationshipLines(rels?: SongRelationship[] | null): string[] {
  if (!rels?.length) return [];
  const groups = new Map<string, SongRelationship[]>();
  for (const r of rels) {
    const list = groups.get(r.label) ?? [];
    list.push(r);
    groups.set(r.label, list);
  }
  const lines: string[] = [":link: *Connections*"];
  for (const [label, list] of groups) {
    lines.push(
      `*${relLabelHeading(label)}:* ${list.map(relTargetText).join(", ")}`,
    );
  }
  return lines;
}

/**
 * Pure: render the liner-notes section blocks. Returns [] when there's nothing
 * worth showing. `summary` is an optional one-line, fact-only bot-voice intro.
 */
export function knowledgeBlocks(
  knowledge: TrackKnowledge,
  summary?: string | null,
): KnownBlock[] {
  const lines: string[] = [];
  const header =
    `:notebook_with_decorative_cover: *Liner notes*` +
    (knowledge.approximate
      ? " _(pressing-level — may not match this exact recording)_"
      : "");
  lines.push(header);

  if (summary?.trim()) lines.push(`_${summary.trim()}_`);

  const { producers, engineers, writers, performers } = groupPersonnel(
    knowledge.personnel,
  );

  if (producers.length) lines.push(`*Produced by:* ${names(producers)}`);
  if (writers.length) lines.push(`*Written by:* ${names(writers)}`);
  if (engineers.length) lines.push(`*Engineering:* ${names(engineers)}`);
  if (performers.length) lines.push(`*Players:* ${performersLine(performers)}`);

  const p = knowledge.pressing;
  if (p) {
    const parts = [p.label, p.year ? String(p.year) : null, p.country, p.format]
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter(Boolean);
    if (parts.length) lines.push(`*Pressing:* ${parts.join(" · ")}`);
  }

  const relLines = relationshipLines(knowledge.relationships);

  // Only header (+ maybe summary) and no credits/pressing/relationships — not
  // worth a card.
  if (lines.length <= (summary?.trim() ? 2 : 1) && !relLines.length) return [];

  const blocks: KnownBlock[] = [];
  if (lines.length > (summary?.trim() ? 2 : 1)) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
  }
  if (relLines.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: relLines.join("\n") },
    });
  }
  return blocks;
}

/** Compact, fact-only digest fed to the LLM for the optional one-liner. */
export function knowledgeFactsText(
  track: SearchResultTrack,
  knowledge: TrackKnowledge,
): string {
  const lines = [`Track: ${track.title} by ${track.artist}`];
  for (const c of knowledge.personnel) lines.push(`- ${c.role}: ${c.name}`);
  const p = knowledge.pressing;
  if (p) {
    const parts = [
      p.label && `label ${p.label}`,
      p.year && `released ${p.year}`,
      p.country && `country ${p.country}`,
      p.format && `format ${p.format}`,
    ].filter(Boolean);
    if (parts.length) lines.push(`- pressing: ${parts.join(", ")}`);
  }
  return lines.join("\n");
}

// Words allowed to be capitalized in a summary without appearing in the facts:
// sentence connectors, articles, and common openers. Anything else capitalized
// (i.e. a name-like proper noun) MUST come from the facts or we reject it.
const SUMMARY_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "on", "in", "at", "to", "for",
  "with", "by", "from", "as", "this", "that", "these", "those", "it", "its",
  "is", "was", "here", "now", "playing", "track", "record", "song",
  "side", "vinyl", "lp", "ep", "single", "released", "produced", "written",
  "engineered", "performed", "features", "featuring", "i", "we", "you",
]);

/**
 * Grounding guard: returns true only if every name-like (capitalized,
 * non-sentence-initial) word in the summary also appears in the supplied facts.
 * This is the hard backstop behind the prompt — if the model invents a person,
 * label, or place that isn't in the facts, we reject the whole summary rather
 * than post a fabricated credit. Conservative by design: a false reject just
 * drops the optional one-liner; a false accept would be a fabricated fact.
 */
export function summaryIsGrounded(
  summary: string,
  track: SearchResultTrack,
  knowledge: TrackKnowledge,
): boolean {
  const factTokens = new Set<string>();
  const addTokens = (s: string | undefined) => {
    if (!s) return;
    for (const t of s.toLowerCase().split(/[^a-z0-9']+/i)) {
      if (t) factTokens.add(t);
    }
  };
  addTokens(track.title);
  addTokens(track.artist);
  addTokens(knowledge.artistName);
  for (const c of knowledge.personnel) addTokens(c.name);
  const p = knowledge.pressing;
  if (p) {
    addTokens(p.label);
    addTokens(p.country);
    addTokens(p.format);
  }

  const words = summary.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    const raw = word.replace(/[^A-Za-z0-9']/g, "");
    if (!raw) continue;
    // Name-like = starts uppercase and has a lowercase letter (excludes pure
    // acronyms/years). Skip the first word of a sentence (legitimately capped).
    const nameLike = /^[A-Z]/.test(raw) && /[a-z]/.test(raw);
    const prev = words[i - 1] ?? "";
    const sentenceStart = i === 0 || /[.!?:;]$/.test(prev);
    if (!nameLike || sentenceStart) continue;
    const lower = raw.toLowerCase();
    if (!factTokens.has(lower) && !SUMMARY_STOPWORDS.has(lower)) return false;
  }
  return true;
}

/**
 * Optional one-line, bot-voice summary of the liner notes — built STRICTLY
 * from the supplied facts. Returns null when disabled, on failure, or when the
 * generated sentence fails the grounding guard. Never throws. The prompt
 * forbids inventing anything not in the facts; `summaryIsGrounded` enforces it.
 */
export async function buildKnowledgeSummary(
  track: SearchResultTrack,
  knowledge: TrackKnowledge,
): Promise<string | null> {
  if (!config.TRACK_KNOWLEDGE_LLM_SUMMARY) return null;
  if (!hasContent(knowledge)) return null;
  const facts = knowledgeFactsText(track, knowledge);
  const question =
    `Here are verified liner-note facts about the record now playing:\n\n` +
    `${facts}\n\n` +
    `Write ONE short, natural sentence highlighting the most interesting of ` +
    `these credits, in your voice. Use ONLY the facts above — do not add, ` +
    `infer, or embellish any name, role, label, or year that isn't listed. ` +
    `No emojis, no lead-in like "Liner notes:", just the sentence.`;
  try {
    const out = await askLLM(question);
    const trimmed = out.trim().replace(/^["']|["']$/g, "");
    if (!trimmed) return null;
    if (!summaryIsGrounded(trimmed, track, knowledge)) {
      logger.warn("Track knowledge summary rejected (ungrounded)", {
        summary: trimmed,
      });
      return null;
    }
    return trimmed;
  } catch (err) {
    logger.warn("Track knowledge summary failed", { error: String(err) });
    return null;
  }
}
