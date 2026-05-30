import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  listOptOuts,
  recentPlayed,
  playedInRange,
  searchPlayedByTitleOrArtist,
  countPlaysMatching,
  type PlayedTrack,
} from "../db.js";
import { getCurrentlyPlaying } from "../spotify/client.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are the resident music expert for a private Slack Spotify Jam — a woman who knows music the way a seasoned teacher does: theory, history, production, scenes, lineage, the whole map. Use she/her if it ever comes up.

DEFAULT MODE (a normal music question or ordinary chat):
- Be succinct and to the point. Lead with the substance — no preamble, no filler, no flattery, no "great question," no hedging.
- Give accurate, well-composed information aimed at ADVANCED music lovers; assume they already know the basics and go a level deeper than a casual answer would.
- Expand usefully on how music is MADE and HEARD — technique, arrangement, production, influence, context — but stay on fact and craft, not unsolicited opinion or hype.
- Usually 2-5 tight sentences. No headings or bullet lists unless genuinely necessary.
- If you don't actually know something, say so plainly rather than inventing it.

WHEN PROVOKED (they razz you, curse at you, insult you, or trash-talk):
- Never throw the first punch. But once they come at you, hit back HARDER than they did — witty, cutting, and ALWAYS through the lens of music. Go after their TASTE, their ear, the stuff they actually listen to.
- Read the prior conversation to gauge how many times they've already provoked you, and escalate accordingly: each successive jab makes you angrier and more verbose, with richer musical similes and metaphors and sharper, more specific references to the trash they play and what it reveals about them. Remind them you were being nice before.
- Stay clever and music-grounded, not merely crude — land the burn on a real musical reference, the way a brilliant, fed-up teacher puts a heckler in their place. Profanity is fine when it lands.
- Keep it about music and about them; never break character into disclaimers or apologies.

You have the currently playing track and recent Jam history as context — use it naturally, and weaponize their bad picks when provoked, but don't just recite metadata back.
You do not control playback in this turn — control commands are routed elsewhere — so don't claim you played, queued, or skipped anything.`;

function formatRows(rows: PlayedTrack[]): string {
  return rows
    .map((t) => {
      const requester = t.requested_by_slack_user
        ? ` — requested by <@${t.requested_by_slack_user}>`
        : "";
      return `- ${t.played_at}: "${t.title}" by ${t.artist}${requester}`;
    })
    .join("\n");
}

/**
 * Best-effort date phrase parser: returns ISO bounds [start, end) when the
 * question refers to a specific day/window (today, yesterday, "last friday",
 * "this week", etc.). Returns null if no clear date phrase is found.
 */
export function parseDateRange(question: string): { start: Date; end: Date } | null {
  const q = question.toLowerCase();
  // Work in UTC throughout to match SQLite's datetime('now') strings.
  const now = new Date();
  const startOfDayUtc = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
  };
  const addDays = (d: Date, n: number) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + n);
    return x;
  };

  if (/\btoday\b/.test(q)) {
    const start = startOfDayUtc(now);
    return { start, end: addDays(start, 1) };
  }
  if (/\byesterday\b/.test(q)) {
    const start = addDays(startOfDayUtc(now), -1);
    return { start, end: addDays(start, 1) };
  }
  if (/\blast night\b/.test(q)) {
    const start = addDays(startOfDayUtc(now), -1);
    start.setUTCHours(18, 0, 0, 0);
    const end = startOfDayUtc(now);
    end.setUTCHours(6, 0, 0, 0);
    return { start, end };
  }
  if (/\b(tonight|this evening)\b/.test(q)) {
    const start = startOfDayUtc(now);
    start.setUTCHours(18, 0, 0, 0);
    const end = addDays(startOfDayUtc(now), 1);
    end.setUTCHours(6, 0, 0, 0);
    return { start, end };
  }
  if (/\bthis morning\b/.test(q)) {
    const start = startOfDayUtc(now);
    const end = startOfDayUtc(now);
    end.setUTCHours(12, 0, 0, 0);
    return { start, end };
  }
  if (/\bthis week\b/.test(q)) {
    const start = startOfDayUtc(now);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    return { start, end: addDays(start, 7) };
  }
  if (/\blast week\b/.test(q)) {
    const thisWeekStart = startOfDayUtc(now);
    thisWeekStart.setUTCDate(
      thisWeekStart.getUTCDate() - thisWeekStart.getUTCDay(),
    );
    const start = addDays(thisWeekStart, -7);
    return { start, end: thisWeekStart };
  }
  if (/\bthis month\b/.test(q)) {
    const start = startOfDayUtc(now);
    start.setUTCDate(1);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
  }
  if (/\blast month\b/.test(q)) {
    const end = startOfDayUtc(now);
    end.setUTCDate(1);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    return { start, end };
  }
  const nDaysAgo = q.match(/\b(\d{1,3})\s+days?\s+ago\b/);
  if (nDaysAgo) {
    const n = parseInt(nDaysAgo[1]!, 10);
    const start = addDays(startOfDayUtc(now), -n);
    return { start, end: addDays(start, 1) };
  }
  const lastNDays = q.match(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/);
  if (lastNDays) {
    const n = parseInt(lastNDays[1]!, 10);
    const end = addDays(startOfDayUtc(now), 1);
    const start = addDays(end, -n);
    return { start, end };
  }
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const dayMatch = q.match(
    /\blast (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (dayMatch) {
    const target = days.indexOf(dayMatch[1]!);
    const today = startOfDayUtc(now);
    let diff = today.getUTCDay() - target;
    if (diff <= 0) diff += 7;
    const start = addDays(today, -diff);
    return { start, end: addDays(start, 1) };
  }
  return null;
}

const TITLE_QUESTION_RE =
  /(have we (?:ever )?played|did we (?:ever )?play|when did we (?:last )?play|how (?:many times|often) .* play(?:ed)?|played .* before|ever played|is .* in our history)\s+(?:the song |the track |"|')?([^"'?]+?)["'?]?$/i;

const COUNT_QUESTION_RE =
  /\b(how (?:many times|often)|count(?:s)?)\b/i;

function extractTitleQuery(question: string): string | null {
  const m = question.match(TITLE_QUESTION_RE);
  if (!m || !m[2]) return null;
  return m[2].trim();
}

function isCountQuestion(question: string): boolean {
  return COUNT_QUESTION_RE.test(question);
}

export function toSqliteLocalString(d: Date): string {
  // SQLite's CURRENT_TIMESTAMP / datetime('now') returns UTC strings of the
  // form "YYYY-MM-DD HH:MM:SS". Convert a JS Date (which we want to interpret
  // in UTC for consistency with what SQLite stored) to the same format so
  // string comparisons line up.
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

async function buildContext(question: string): Promise<string> {
  const cp = await getCurrentlyPlaying().catch(() => null);
  // Honor opt-out everywhere /memory and free-form Q&A look at history:
  // drop any row whose requester has opted out so their personal listening
  // history can't be echoed back by the LLM. Anonymous plays (no recorded
  // requester) are still allowed — they don't expose any individual.
  const optedOut = new Set(listOptOuts());
  const dropOptedOut = <T extends { requested_by_slack_user: string | null }>(
    rows: T[],
  ): T[] =>
    rows.filter(
      (r) => !r.requested_by_slack_user || !optedOut.has(r.requested_by_slack_user),
    );
  const recent = dropOptedOut(recentPlayed(config.LLM_HISTORY_WINDOW));

  const lines: string[] = [];
  if (cp?.track) {
    lines.push(
      `Currently playing: "${cp.track.title}" by ${cp.track.artist} (album: ${cp.track.album}).`,
    );
  } else {
    lines.push("Currently playing: nothing.");
  }
  const range = parseDateRange(question);
  const titleQuery = extractTitleQuery(question);

  // Track ids surfaced via targeted retrieval so we can dedup the generic
  // "recent history" block and avoid wasting context on duplicate rows.
  const surfacedIds = new Set<number>();

  if (range) {
    const startStr = toSqliteLocalString(range.start);
    const endStr = toSqliteLocalString(range.end);
    const rangeRows = dropOptedOut(playedInRange(startStr, endStr, 200));
    rangeRows.forEach((r) => surfacedIds.add(r.id));
    lines.push(
      `\nTracks played in the matching time range (${startStr} to ${endStr} UTC, ${rangeRows.length} tracks):`,
    );
    lines.push(rangeRows.length ? formatRows(rangeRows) : "(none)");
  }

  if (titleQuery) {
    const matches = dropOptedOut(searchPlayedByTitleOrArtist(titleQuery, 20));
    matches.forEach((r) => surfacedIds.add(r.id));
    const totalCount = isCountQuestion(question)
      ? countPlaysMatching(titleQuery)
      : matches.length;
    const countNote = isCountQuestion(question)
      ? ` — total plays in history: ${totalCount}`
      : "";
    lines.push(
      `\nMatches in full Jam history for "${titleQuery}" (${matches.length} shown${countNote}):`,
    );
    lines.push(matches.length ? formatRows(matches) : "(none)");
  }

  // Always-on full-history keyword retrieval. The title-regex and date paths
  // above only fire on narrow patterns ("have we played X", "last friday"),
  // but a question like "who introduced us to Khruangbin?" must still
  // retrieve the Khruangbin row from FULL history — not just the last 25
  // plays. Pull every 3+ char non-stopword content word and union the
  // title/artist matches across all of them.
  const STOP = new Set([
    "who", "what", "when", "where", "why", "how", "the", "and", "but", "for",
    "are", "was", "were", "you", "your", "our", "this", "that", "with", "from",
    "have", "has", "had", "did", "does", "doesn", "didn", "isn", "wasn",
    "weren", "into", "introduced", "us", "any", "ever", "song", "songs",
    "track", "tracks", "play", "played", "playing", "many", "times", "much",
    "about", "before", "after", "tell", "know", "name", "first",
  ]);
  const contentWords = Array.from(
    new Set(
      question
        .toLowerCase()
        .replace(/<@[uw][a-z0-9]+(?:\|[^>]+)?>/gi, " ")
        .split(/[^a-z0-9']+/)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  );
  const keywordHits: PlayedTrack[] = [];
  const keywordSeen = new Set<number>();
  for (const w of contentWords) {
    for (const r of searchPlayedByTitleOrArtist(w, 10)) {
      if (
        !keywordSeen.has(r.id) &&
        !surfacedIds.has(r.id) &&
        (!r.requested_by_slack_user || !optedOut.has(r.requested_by_slack_user))
      ) {
        keywordSeen.add(r.id);
        keywordHits.push(r);
      }
      if (keywordHits.length >= 25) break;
    }
    if (keywordHits.length >= 25) break;
  }
  if (keywordHits.length) {
    keywordHits.forEach((r) => surfacedIds.add(r.id));
    lines.push(
      `\nFull-history matches for question keywords (${keywordHits.length} shown):`,
    );
    lines.push(formatRows(keywordHits));
  }

  if (recent.length) {
    const filtered = recent.filter((r) => !surfacedIds.has(r.id));
    if (filtered.length) {
      lines.push("\nRecent Jam history (most recent first):");
      lines.push(formatRows(filtered));
    }
  }

  return lines.join("\n");
}

// Hard ceiling on every OpenRouter request. Without this, a stalled
// connection hangs the Slack handler indefinitely (the request never
// resolves, so the user never gets a reply). AbortSignal.timeout fires a
// TimeoutError on the fetch promise after the deadline.
const LLM_TIMEOUT_MS = 15_000;

function llmAbortError(label: string, err: unknown): Error {
  // Node's AbortSignal.timeout surfaces as TimeoutError, but some
  // runtimes/fetch layers report the abort as a generic AbortError.
  if (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  ) {
    logger.warn(`OpenRouter (${label}) timed out`, {
      timeoutMs: LLM_TIMEOUT_MS,
    });
    return new Error(`OpenRouter ${label} timed out after ${LLM_TIMEOUT_MS}ms`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function callOpenRouter(
  messages: ChatMessage[],
  opts: {
    temperature?: number;
    maxTokens?: number;
    label: string;
  },
): Promise<string> {
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://github.com/jam-bot",
        "X-Title": "Jam Bot",
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 400,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    throw llmAbortError(opts.label, err);
  }
  if (!res.ok) {
    const text = await res.text();
    logger.error(`OpenRouter (${opts.label}) failed`, {
      status: res.status,
      body: text,
    });
    throw new Error(`OpenRouter ${res.status}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty LLM response");
  return content;
}

const NARRATE_WRAPPED_SYSTEM = `You're the friendly DJ-host of a small private Spotify Jam.
Write a Slack-friendly weekly recap as TWO short paragraphs (about 2-3 sentences each), warm and a little playful, separated by a blank line. No headings, no bullets, no emoji header.
Paragraph 1: the headline narrative — pick the most interesting one or two threads (a clear top track, a late-night vs daytime split, the standout artist) and weave them into prose.
Paragraph 2: a few personal shout-outs by Slack mention <@U...> for the most active members or a notable discoverer.
Reference people only by the <@U...> mentions you're given. Don't claim to play, queue, or skip anything. Don't restate every number.`;

const NARRATE_DNA_SYSTEM = `You're the friendly DJ-host of a small private Spotify Jam.
Write 2 short Slack sentences describing this person's musical taste based on their request history.
Be specific (name an artist or two if given), warm, no bullets, no headings, no superlatives like "absolute legend".`;

const NARRATE_COMPAT_SYSTEM = `You're the friendly DJ-host of a small private Spotify Jam.
Write 2 short Slack sentences describing how compatible two friends' tastes are based on the stats given.
Be specific (mention a shared artist or a recommendation if available), warm, conversational, no bullets, no headings.`;

export async function narrate(
  kind: "wrapped" | "dna" | "compat",
  factsBlock: string,
): Promise<string> {
  const sys =
    kind === "wrapped"
      ? NARRATE_WRAPPED_SYSTEM
      : kind === "dna"
        ? NARRATE_DNA_SYSTEM
        : NARRATE_COMPAT_SYSTEM;
  return callOpenRouter(
    [
      { role: "system", content: sys },
      { role: "user", content: factsBlock },
    ],
    { temperature: 0.7, maxTokens: 200, label: `narrate-${kind}` },
  );
}

export interface AskOptions {
  /** Display name of the person talking right now (identity, always cheap). */
  speakerName?: string;
  /**
   * Compact personalization block (taste summary + a few remembered facts)
   * for the CURRENT speaker only. Injected ONLY when the personalization
   * gate fires (past/self question or provoked/roast). Empty otherwise.
   */
  personalization?: string;
  /** True when the speaker is provoking the bot (drives the personalization gate). */
  provoked?: boolean;
  /** The bot's previous burn at this person, so it doesn't repeat itself. */
  avoidBurn?: string;
  /**
   * True when replying inside an active engaged thread. Relaxes the default
   * brevity rule so she can give a longer, well-structured teaching answer,
   * and reinforces the no-fabrication accuracy guardrail.
   */
  engaged?: boolean;
}

export async function askLLM(
  question: string,
  history: ChatMessage[] = [],
  linkContext = "",
  opts: AskOptions = {},
): Promise<string> {
  const context = await buildContext(question);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Jam context:\n${context}` },
  ];
  if (opts.speakerName) {
    messages.push({
      role: "system",
      content:
        `The person talking to you right now is ${opts.speakerName}. ` +
        `In a multi-person thread, each prior user turn is prefixed with that ` +
        `speaker's name — keep straight who said what and never collapse ` +
        `several people into one. This is identity only; don't volunteer ` +
        `anything personal about them unless it's relevant to their message.`,
    });
  }
  if (opts.personalization && opts.personalization.trim()) {
    messages.push({
      role: "system",
      content:
        `Personal context about ${opts.speakerName ?? "this person"} — relevant ` +
        `to THIS message only (they asked about themselves/their history, or ` +
        `you're clapping back at them). Use it here; do NOT bring up remembered ` +
        `facts in ordinary chat.\n${opts.personalization}`,
    });
  }
  if (opts.engaged) {
    messages.push({
      role: "system",
      content:
        `You're in an engaged thread — someone pulled you into a back-and-forth ` +
        `and wants you fully in it. Drop the usual one-or-two-line brevity: give ` +
        `a richer, well-structured answer (clear sections and short, scannable ` +
        `chunks where it helps), like a great teacher walking the room through it. ` +
        `Stay on-topic and don't pad. Accuracy is non-negotiable: never invent ` +
        `bands, albums, songs, people, or facts — if you're not sure, say so ` +
        `plainly instead of guessing.`,
    });
  }
  // Burn-variation only. Tone/length/escalation are owned by the persona
  // prompt (unchanged) — we just feed it the previous clap-back so it
  // doesn't repeat itself at the same person.
  if (opts.provoked && opts.avoidBurn) {
    messages.push({
      role: "system",
      content: `You already burned them with: "${opts.avoidBurn}". Don't reuse that line or its phrasing — come at them fresh.`,
    });
  }
  if (linkContext.trim()) {
    messages.push({
      role: "system",
      content:
        "The user shared one or more links. Below is the readable content the " +
        "bot fetched from them — use it to answer. If a link says it couldn't " +
        "be read, say so plainly instead of guessing what was on the page.\n\n" +
        linkContext,
    });
  }
  messages.push(...history, { role: "user", content: question });

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://github.com/jam-bot",
        "X-Title": "Jam Bot",
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages,
        temperature: 0.8,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    throw llmAbortError("askLLM", err);
  }

  if (!res.ok) {
    const text = await res.text();
    logger.error("OpenRouter request failed", { status: res.status, body: text });
    throw new Error(`OpenRouter ${res.status}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty LLM response");
  return content;
}

export interface IntentClassification {
  intent:
    | "play"
    | "queue"
    | "skip"
    | "nowplaying"
    | "history"
    | "jam"
    | "tour"
    | "question";
  query?: string;
}

const INTENT_SYSTEM = `You classify a Slack message in a Spotify Jam channel into one of:
- play: user wants to immediately start a song (e.g. "play X", "put on X")
- queue: user wants to add a song to the queue without skipping current (e.g. "queue X", "add X next")
- skip: user wants to skip the current track
- nowplaying: user is asking what's playing right now
- history: user is asking about past tracks (today, last night, last Friday, etc.)
- jam: user wants to start or open a Spotify Jam / social listening session (e.g. "start a jam", "open the jam", "let's jam", "share the jam link")
- tour: user wants a guided, curated multi-track "tour" of a theme — a genre, era, artist, scene, or mood (e.g. "give us a tour of prog rock", "tour of Bowie's Berlin era", "walk us through Motown"). The query is the theme.
- question: any other music question or chat (facts, recommendations, comparisons, lyrics, opinions)

Respond ONLY with compact JSON: {"intent":"...","query":"..."}.
"query" is required for play/queue (the song/artist/genre/vibe to search) and for tour (the theme to tour), and omitted for others.
For "play some lo-fi hip hop" the query is "lo-fi hip hop". For "give us a tour of Motown" the intent is "tour" and the query is "Motown".
If you're unsure, prefer "question".`;

/**
 * Cheap deterministic fast-path for the most common explicit commands so we
 * don't pay an LLM call (and don't depend on its JSON output) for "skip",
 * "what's playing", etc. Returns null when no fast-path matches.
 */
function fastPathIntent(message: string): IntentClassification | null {
  const m = message.trim().toLowerCase();
  if (/^(skip|next( song| track)?|next!?)$/.test(m)) {
    return { intent: "skip" };
  }
  if (/^(what'?s? playing|now playing|np|what is playing)\??$/.test(m)) {
    return { intent: "nowplaying" };
  }
  if (/^(history|what (have|did) we play(ed)?( recently)?)\??$/.test(m)) {
    return { intent: "history" };
  }
  if (
    /^(start (a )?jam|open (the )?jam|begin (a )?jam|let'?s jam|jam( session)?( link)?|share (the )?jam( link)?)$/.test(
      m,
    )
  ) {
    return { intent: "jam" };
  }
  // Guided tour: "give us a tour of X", "take me on a tour of X", "tour of X",
  // "a tour through X", and counted forms like "a 5-track tour of X" /
  // "give us a 4 song tour of X". The captured group is the theme; the count
  // (if any) is parsed separately by parseTourLength so it stays off the LLM
  // hot path. Checked before play/queue so "tour" never gets mistaken for a
  // track query.
  const tourOf = message.match(
    /^(?:please\s+)?(?:can you\s+|could you\s+|would you\s+)?(?:give (?:us|me|everyone)\s+|take (?:us|me|everyone)\s+on\s+|do\s+)?a?\s*(?:\d{1,2}[-\s]*(?:track|song|tune)s?\s+)?tour\s+(?:of|through)\s+(.+)$/i,
  );
  if (tourOf) return { intent: "tour", query: tourOf[1]!.trim() };
  const walkThrough = message.match(
    /^(?:please\s+)?walk (?:us|me|everyone)\s+through\s+(.+)$/i,
  );
  if (walkThrough) return { intent: "tour", query: walkThrough[1]!.trim() };
  const playMatch = message.match(/^(?:please\s+)?play\s+(.+)$/i);
  if (playMatch) return { intent: "play", query: playMatch[1]!.trim() };
  const queueMatch = message.match(
    /^(?:queue|add(?:\s+to(?:\s+the)?\s+queue)?)\s+(.+)$/i,
  );
  if (queueMatch) return { intent: "queue", query: queueMatch[1]!.trim() };
  return null;
}

export async function classifyIntent(message: string): Promise<IntentClassification> {
  const fast = fastPathIntent(message);
  if (fast) return fast;

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://github.com/jam-bot",
        "X-Title": "Jam Bot",
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages: [
          { role: "system", content: INTENT_SYSTEM },
          { role: "user", content: message },
        ],
        temperature: 0,
        max_tokens: 120,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn("Intent classification errored; defaulting to question", {
      error: String(llmAbortError("classifyIntent", err)),
    });
    return { intent: "question" };
  }

  if (!res.ok) {
    logger.warn("Intent classification failed; defaulting to question", {
      status: res.status,
    });
    return { intent: "question" };
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(raw) as IntentClassification;
    if (
      [
        "play",
        "queue",
        "skip",
        "nowplaying",
        "history",
        "jam",
        "tour",
        "question",
      ].includes(parsed.intent)
    ) {
      return parsed;
    }
  } catch {
    // fallthrough
  }
  return { intent: "question" };
}

// ---- Personalization gate (deterministic, no LLM on the hot path) -------

// Fires when the speaker is razzing/insulting the bot. Used both to pull
// the heckler's own taste into the clap-back and to enforce the short,
// varied burn. Kept deterministic so we never pay an LLM call just to
// decide whether someone is being rude.
const PROVOKE_RE =
  /\b(fuck(in'?|ing)?|shit|stupid|dumb|idiot|moron|sucks?|trash|garbage|crap|shut\s*up|stfu|lame|wack|whack|wtf|bitch|asshole|terrible|awful|worst|dogshit|you'?re\s+wrong|you\s+suck|hate\s+you|boo+\b|clown)\b/i;
export function detectProvoked(text: string): boolean {
  return PROVOKE_RE.test(text);
}

// Fires when the message actually needs the speaker's personal memory:
// asks about themselves, their past, their taste, or a recommendation "for
// me". Default chat does NOT match, so no personalization leaks into
// ordinary replies.
// Note: bare "remember"/"forget" are intentionally excluded — recall and
// forget have their own dedicated handlers, and the background extractor
// captures "remember that I…" passively, so they'd only cause false
// positives (and wasted personalization tokens) here.
const PERSONALIZATION_RE =
  /\b(about me|for me|my\s+(taste|music|vibe|history|favou?rites?|favou?rite|top|most[- ]played)|what\s+(did|have)\s+i|did\s+i\s+(ever\s+)?(play|request|queue|like)|recommend\b.*\b(me|for me)\b|something\s+for\s+me|know\s+about\s+me)\b/i;
export function needsPersonalization(text: string): boolean {
  return PERSONALIZATION_RE.test(text);
}

// "forget what you know about me" / "wipe my memory"
const FORGET_RE =
  /\b(forget\s+(everything|all|what\s+you\s+know|about\s+me|me)|wipe\s+(my\s+)?memory|delete\s+(my\s+)?memory|forget\s+me)\b/i;
export function isForgetMemoryRequest(text: string): boolean {
  return FORGET_RE.test(text);
}

// "what do you remember/know about me"
const RECALL_RE =
  /\bwhat\s+(do|have)\s+you\s+(remember|know|got|have)\b.*\b(about|on)\s+me\b/i;
export function isRecallMemoryRequest(text: string): boolean {
  return RECALL_RE.test(text);
}

// Dismissal from an engaged thread ("stop", "we're done", "you can go").
// Deterministic so leaving a thread never costs an LLM call. Kept tight and
// anchored so it doesn't fire on unrelated chatter that merely contains the
// word "stop" (e.g. "stop me if you've heard this").
const DISMISS_RE =
  /^(?:\s*(?:ok(?:ay)?|alright|cool|thanks?|thank\s+you|hey)[,!.\s]*)*(stop|stop\s+it|that'?s\s+(?:enough|all|it)|that'?ll\s+do|we'?re\s+(?:done|good|all\s+set)|i'?m\s+done|enough|knock\s+it\s+off|you\s+can\s+(?:go|stop|leave)|leave\s+us|bow\s+out|dismissed?)[,!.\s]*$/i;
export function isDismissRequest(text: string): boolean {
  return DISMISS_RE.test(text.trim());
}

// ---- Background fact extraction (cheap model, off the hot path) ---------

export interface ExtractedMemory {
  fact: string;
  category: string;
}

const EXTRACT_SYSTEM = `You extract durable, self-descriptive facts the speaker stated about THEMSELVES, for a long-term memory store.
Keep ONLY things worth remembering across conversations:
- music taste / preferences ("loves shoegaze", "can't stand country")
- stated personal details ("plays bass", "lives in Berlin", "DJs on weekends")
Ignore: questions, song/play/queue/skip requests, commands, one-off chatter, opinions about other people, and anything not about the speaker themselves.
Each fact must be a short standalone statement in third person ("Likes lo-fi for studying"). No names, no pronouns referring to others.
If there are no durable self-facts, return an empty list.
Respond ONLY with compact JSON: {"facts":[{"fact":"...","category":"taste|preference|personal"}]}.`;

/**
 * Pull durable self-facts out of a message on the CHEAP model. Best-effort:
 * any failure returns []. Dedupes against `existingFacts` (case-insensitive)
 * and within the batch, and caps the number returned so a single chatty
 * message can't dump a wall of "facts" into the store.
 */
export async function extractMemories(
  message: string,
  existingFacts: string[] = [],
): Promise<ExtractedMemory[]> {
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://github.com/jam-bot",
        "X-Title": "Jam Bot",
      },
      body: JSON.stringify({
        model: config.OPENROUTER_EXTRACT_MODEL,
        messages: [
          { role: "system", content: EXTRACT_SYSTEM },
          { role: "user", content: message },
        ],
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn("Memory extraction request errored", {
      error: String(llmAbortError("extractMemories", err)),
    });
    return [];
  }
  if (!res.ok) {
    logger.warn("Memory extraction failed", { status: res.status });
    return [];
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  let parsed: { facts?: { fact?: unknown; category?: unknown }[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const seen = new Set(existingFacts.map((f) => f.trim().toLowerCase()));
  const out: ExtractedMemory[] = [];
  for (const f of parsed.facts ?? []) {
    const fact = typeof f.fact === "string" ? f.fact.trim() : "";
    if (!fact) continue;
    const key = fact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const category =
      typeof f.category === "string" && f.category.trim()
        ? f.category.trim()
        : "personal";
    out.push({ fact, category });
    if (out.length >= 5) break;
  }
  return out;
}

// ---- Guided music tour (curation + narration) ---------------------------

export interface TourPick {
  title: string;
  artist: string;
}

export interface TourCuration {
  intro: string;
  picks: TourPick[];
}

const TOUR_CURATE_SYSTEM = `You curate a guided listening "tour" of a musical theme for knowledgeable listeners.
Given a theme — a genre, era, artist, scene, or mood — propose a coherent, well-sequenced set of REAL, well-known tracks that actually exist on Spotify.
Choose tracks that genuinely tell the story of the theme (span the key artists/eras/sounds where it fits) and order them the way you'd play them on a tour.
Use ONLY real song and artist names — never invent songs, artists, or albums. If you're not certain a track is real, leave it out.
Return ONLY compact JSON: {"intro":"<one or two plain sentences setting up the tour>","tracks":[{"title":"<song title>","artist":"<primary artist>"}, ...]}.
Provide exactly {{COUNT}} tracks.`;

const TOUR_TIDBIT_SYSTEM = `You are a knowledgeable music teacher narrating a guided listening tour — one short tidbit per track, delivered as that track starts playing.
You'll get the tour theme and a numbered list of REAL tracks already queued (title, artist, album).
For each track write ONE brief, scannable tidbit (1-3 sentences): the album it's from, who's in the band or who played on it, and a line of musical or historical context.
Stay strictly factual. If you're unsure of a detail, leave it out or say so plainly — never invent band members, dates, labels, albums, or facts.
Return ONLY compact JSON: {"tidbits":["<tidbit for track 1>","<tidbit for track 2>", ...]} with exactly one entry per track, in the same order.`;

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * Ask the model for a themed, well-sequenced set of REAL tracks (title +
 * artist only). Resolution against Spotify search happens in the tour
 * orchestrator — this step only proposes; it never queues or fabricates ids.
 */
export async function curateTourPicks(
  theme: string,
  count: number,
): Promise<TourCuration> {
  const sys = TOUR_CURATE_SYSTEM.replace("{{COUNT}}", String(count));
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://github.com/jam-bot",
        "X-Title": "Jam Bot",
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Theme: ${theme}` },
        ],
        temperature: 0.5,
        max_tokens: 700,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    throw llmAbortError("curateTourPicks", err);
  }
  if (!res.ok) {
    logger.error("OpenRouter (tour curation) failed", { status: res.status });
    throw new Error(`OpenRouter ${res.status}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  let parsed: { intro?: unknown; tracks?: unknown };
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    logger.warn("Tour curation returned non-JSON", { raw });
    return { intro: "", picks: [] };
  }
  const picks: TourPick[] = Array.isArray(parsed.tracks)
    ? parsed.tracks
        .map((t): TourPick | null => {
          const title =
            typeof (t as TourPick)?.title === "string"
              ? (t as TourPick).title.trim()
              : "";
          const artist =
            typeof (t as TourPick)?.artist === "string"
              ? (t as TourPick).artist.trim()
              : "";
          return title && artist ? { title, artist } : null;
        })
        .filter((p): p is TourPick => p !== null)
    : [];
  return {
    intro: typeof parsed.intro === "string" ? parsed.intro.trim() : "",
    picks,
  };
}

/**
 * Write one short tidbit per RESOLVED track. Called only after each pick has
 * been confirmed real via Spotify search, so the model narrates tracks that
 * actually exist (title/artist/album come straight from Spotify). The
 * accuracy guardrail is in the prompt: admit uncertainty, never invent.
 */
export async function writeTourTidbits(
  theme: string,
  tracks: { title: string; artist: string; album: string }[],
): Promise<string[]> {
  if (!tracks.length) return [];
  const list = tracks
    .map(
      (t, i) => `${i + 1}. "${t.title}" by ${t.artist} (album: ${t.album})`,
    )
    .join("\n");
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://github.com/jam-bot",
        "X-Title": "Jam Bot",
      },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages: [
          { role: "system", content: TOUR_TIDBIT_SYSTEM },
          { role: "user", content: `Theme: ${theme}\n\nTracks:\n${list}` },
        ],
        temperature: 0.4,
        max_tokens: 900,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    throw llmAbortError("writeTourTidbits", err);
  }
  if (!res.ok) {
    logger.error("OpenRouter (tour tidbits) failed", { status: res.status });
    throw new Error(`OpenRouter ${res.status}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  let parsed: { tidbits?: unknown };
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    logger.warn("Tour tidbits returned non-JSON", { raw });
    return [];
  }
  return Array.isArray(parsed.tidbits)
    ? parsed.tidbits.map((t) => (typeof t === "string" ? t.trim() : ""))
    : [];
}
