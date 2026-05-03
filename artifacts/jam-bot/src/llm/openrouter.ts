import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  recentPlayed,
  playedInRange,
  searchPlayedByTitleOrArtist,
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
function parseDateRange(question: string): { start: Date; end: Date } | null {
  const q = question.toLowerCase();
  const now = new Date();
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const addDays = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };

  if (/\btoday\b/.test(q)) {
    const start = startOfDay(now);
    return { start, end: addDays(start, 1) };
  }
  if (/\byesterday\b/.test(q)) {
    const start = addDays(startOfDay(now), -1);
    return { start, end: addDays(start, 1) };
  }
  if (/\blast night\b/.test(q)) {
    const start = addDays(startOfDay(now), -1);
    start.setHours(18, 0, 0, 0);
    const end = startOfDay(now);
    end.setHours(6, 0, 0, 0);
    return { start, end };
  }
  if (/\bthis week\b/.test(q)) {
    const start = startOfDay(now);
    start.setDate(start.getDate() - start.getDay());
    return { start, end: addDays(start, 7) };
  }
  if (/\blast week\b/.test(q)) {
    const thisWeekStart = startOfDay(now);
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
    const start = addDays(thisWeekStart, -7);
    return { start, end: thisWeekStart };
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
  const dayMatch = q.match(/\blast (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (dayMatch) {
    const target = days.indexOf(dayMatch[1]!);
    const today = startOfDay(now);
    let diff = today.getDay() - target;
    if (diff <= 0) diff += 7;
    const start = addDays(today, -diff);
    return { start, end: addDays(start, 1) };
  }
  return null;
}

const TITLE_QUESTION_RE =
  /(have we (?:ever )?played|did we play|when did we play|how many times .* play|played .* before)\s+(?:the song |the track |"|')?([^"'?]+?)["'?]?$/i;

function extractTitleQuery(question: string): string | null {
  const m = question.match(TITLE_QUESTION_RE);
  if (!m || !m[2]) return null;
  return m[2].trim();
}

async function buildContext(question: string): Promise<string> {
  const cp = await getCurrentlyPlaying().catch(() => null);
  const recent = recentPlayed(config.LLM_HISTORY_WINDOW);

  const lines: string[] = [];
  if (cp?.track) {
    lines.push(
      `Currently playing: "${cp.track.title}" by ${cp.track.artist} (album: ${cp.track.album}).`,
    );
  } else {
    lines.push("Currently playing: nothing.");
  }
  if (recent.length) {
    lines.push("\nRecent Jam history (most recent first):");
    lines.push(formatRows(recent));
  }

  const range = parseDateRange(question);
  if (range) {
    const startIso = range.start.toISOString().replace("T", " ").slice(0, 19);
    const endIso = range.end.toISOString().replace("T", " ").slice(0, 19);
    const rangeRows = playedInRange(startIso, endIso, 200);
    lines.push(
      `\nTracks played in the matching time range (${startIso} to ${endIso}, ${rangeRows.length} tracks):`,
    );
    lines.push(rangeRows.length ? formatRows(rangeRows) : "(none)");
  }

  const titleQuery = extractTitleQuery(question);
  if (titleQuery) {
    const matches = searchPlayedByTitleOrArtist(titleQuery, 20);
    lines.push(
      `\nMatches in full Jam history for "${titleQuery}" (${matches.length}):`,
    );
    lines.push(matches.length ? formatRows(matches) : "(none)");
  }

  return lines.join("\n");
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
  intent: "play" | "queue" | "skip" | "nowplaying" | "history" | "question";
  query?: string;
}

const INTENT_SYSTEM = `You classify a Slack message in a Spotify Jam channel into one of:
- play: user wants to immediately start a song (e.g. "play X", "put on X")
- queue: user wants to add a song to the queue without skipping current (e.g. "queue X", "add X next")
- skip: user wants to skip the current track
- nowplaying: user is asking what's playing right now
- history: user is asking about past tracks (today, last night, last Friday, etc.)
- question: any other music question or chat (facts, recommendations, comparisons, lyrics, opinions)

Respond ONLY with compact JSON: {"intent":"...","query":"..."}.
"query" is required for play/queue (the song/artist/genre/vibe to search) and omitted for others.
For "play some lo-fi hip hop" the query is "lo-fi hip hop".
If you're unsure, prefer "question".`;

export async function classifyIntent(message: string): Promise<IntentClassification> {
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
      ["play", "queue", "skip", "nowplaying", "history", "question"].includes(
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
