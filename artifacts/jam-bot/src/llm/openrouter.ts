import { config } from "../config.js";
import { logger } from "../logger.js";
import { recentPlayed } from "../db.js";
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

async function buildContext(): Promise<string> {
  const cp = await getCurrentlyPlaying().catch(() => null);
  const history = recentPlayed(config.LLM_HISTORY_WINDOW);

  const lines: string[] = [];
  if (cp?.track) {
    lines.push(
      `Currently playing: "${cp.track.title}" by ${cp.track.artist} (album: ${cp.track.album}).`,
    );
  } else {
    lines.push("Currently playing: nothing.");
  }
  if (history.length) {
    lines.push("\nRecent Jam history (most recent first):");
    for (const t of history) {
      const requester = t.requested_by_slack_user
        ? ` — requested by <@${t.requested_by_slack_user}>`
        : "";
      lines.push(`- ${t.played_at}: "${t.title}" by ${t.artist}${requester}`);
    }
  }
  return lines.join("\n");
}

export async function askLLM(question: string): Promise<string> {
  const context = await buildContext();
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
