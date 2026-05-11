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

const SYSTEM_PROMPT = `You are the friendly DJ-host of a private Slack Spotify Jam for a small group of friends.
Answer music questions concisely (usually 2-5 sentences) and conversationally — no headings, no bullet lists unless really needed.
You have the currently playing track and recent Jam history as context. Use them naturally; don't recite metadata back at the user.
If the user asks for trivia or facts you don't know for sure, say so rather than inventing details.
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

async function callOpenRouter(
  messages: ChatMessage[],
  opts: {
    temperature?: number;
    maxTokens?: number;
    label: string;
  },
): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
  });
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

export async function askLLM(question: string): Promise<string> {
  const context = await buildContext(question);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Jam context:\n${context}` },
    { role: "user", content: question },
  ];

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
      temperature: 0.6,
      max_tokens: 500,
    }),
  });

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
  intent: "play" | "queue" | "skip" | "nowplaying" | "history" | "jam" | "question";
  query?: string;
}

const INTENT_SYSTEM = `You classify a Slack message in a Spotify Jam channel into one of:
- play: user wants to immediately start a song (e.g. "play X", "put on X")
- queue: user wants to add a song to the queue without skipping current (e.g. "queue X", "add X next")
- skip: user wants to skip the current track
- nowplaying: user is asking what's playing right now
- history: user is asking about past tracks (today, last night, last Friday, etc.)
- jam: user wants to start or open a Spotify Jam / social listening session (e.g. "start a jam", "open the jam", "let's jam", "share the jam link")
- question: any other music question or chat (facts, recommendations, comparisons, lyrics, opinions)

Respond ONLY with compact JSON: {"intent":"...","query":"..."}.
"query" is required for play/queue (the song/artist/genre/vibe to search) and omitted for others.
For "play some lo-fi hip hop" the query is "lo-fi hip hop".
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

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
  });

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
      ["play", "queue", "skip", "nowplaying", "history", "jam", "question"].includes(
        parsed.intent,
      )
    ) {
      return parsed;
    }
  } catch {
    // fallthrough
  }
  return { intent: "question" };
}
