import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  recentPlayed,
  searchPlayedByTitleOrArtist,
  playedInRange,
  playedByRequester,
  lastPlayedByTrackId,
  listOptOuts,
  type PlayedTrack,
} from "./db.js";
import { parseDateRange, toSqliteLocalString } from "./llm/openrouter.js";

export interface MemorySetResult {
  summary: string;
  trackIds: string[]; // Spotify track IDs from history
}

const SET_SYSTEM = `You curate a short Spotify playlist from a friend group's Jam history.
You will be given (a) the user's request and (b) a numbered candidate list of tracks the group has actually played.
Pick UP TO {{MAX}} tracks that best satisfy the request, in the order you'd play them.
Return ONLY compact JSON: {"summary":"<one short sentence>","track_ids":["<spotify_track_id>", ...]}.
Use only track_ids from the candidate list. Never invent ids. Never include the same id twice.`;

function formatCandidates(rows: PlayedTrack[]): string {
  return rows
    .map((r, i) => {
      const requester = r.requested_by_slack_user
        ? ` — first requested by <@${r.requested_by_slack_user}>`
        : "";
      return `${i + 1}. ${r.track_id} :: "${r.title}" by ${r.artist} (played ${r.played_at}${requester})`;
    })
    .join("\n");
}

/**
 * Detects "play me a set/playlist/mix" style requests where the user wants
 * the bot to actually queue tracks, not just answer in prose.
 */
export function isMemoryPlaybackRequest(question: string): boolean {
  return /\b(play|queue|put on|spin|throw on)\b.*\b(set|playlist|mix|songs?|tracks?)\b/i.test(
    question,
  ) || /\bplay me\b/i.test(question);
}

/**
 * Pull Slack user mentions (`<@U12345>`) out of a question. Used so /memory
 * can scope a set to "stuff <@U123> played" — same retrieval primitive as
 * the askLLM Q&A path.
 */
export function extractRequesterMentions(question: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Slack renders mentions as either <@U123> or <@U123|displayname> — handle
  // both, and dedup so the same user mentioned twice only adds once to the
  // candidate pool.
  const re = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g;
  let m;
  while ((m = re.exec(question)) !== null) {
    const id = m[1]!;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Detect named months ("august", "december") so the LLM can ask for a set
 * "from August jam sessions" and get a real date-window candidate pool
 * back, even though parseDateRange doesn't handle bare month names.
 */
function parseMonthName(question: string): { start: Date; end: Date } | null {
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const m = question.toLowerCase().match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/,
  );
  if (!m) return null;
  const monthIdx = months.indexOf(m[1]!);
  // Resolve the *most recent* occurrence of that month: this year if it's
  // already happened, otherwise last year. So in May 2026 "august" -> Aug 2025.
  const now = new Date();
  let year = now.getUTCFullYear();
  if (monthIdx > now.getUTCMonth()) year -= 1;
  const start = new Date(Date.UTC(year, monthIdx, 1));
  const end = new Date(Date.UTC(year, monthIdx + 1, 1));
  return { start, end };
}

/**
 * Build a candidate pool of tracks from history that the LLM can pick from
 * for a "play me a set" request. We layer multiple retrieval primitives so
 * temporal ("from last weekend"), entity ("stuff <@U123> queued"), and
 * keyword ("dub techno set") prompts all ground in real history rather than
 * just the most recent 50 plays:
 *
 *   1. Date window  — parseDateRange / parseMonthName -> playedInRange.
 *   2. Requester(s) — Slack `<@U…>` mentions -> playedByRequester.
 *   3. Title/artist keywords -> searchPlayedByTitleOrArtist.
 *   4. Recents fallback so we never return an empty pool.
 *
 * Opt-out is honored at every layer: opted-out users' rows never enter the
 * candidate pool.
 */
function buildCandidates(question: string, limit: number): PlayedTrack[] {
  const optedOut = new Set(listOptOuts());
  const isAllowed = (row: PlayedTrack) =>
    !row.requested_by_slack_user || !optedOut.has(row.requested_by_slack_user);

  const seen = new Set<string>();
  const out: PlayedTrack[] = [];
  const push = (rows: PlayedTrack[]) => {
    for (const row of rows) {
      if (out.length >= limit) return;
      if (!seen.has(row.track_id) && isAllowed(row)) {
        seen.add(row.track_id);
        out.push(row);
      }
    }
  };

  // 1. Date window: "last weekend", "august", "yesterday", "last friday", etc.
  const range = parseDateRange(question) ?? parseMonthName(question);
  if (range) {
    push(
      playedInRange(
        toSqliteLocalString(range.start),
        toSqliteLocalString(range.end),
        200,
      ),
    );
  }

  // 2. Requester scope: "stuff Bob queued during the outage" (with @mention).
  for (const u of extractRequesterMentions(question)) {
    if (out.length >= limit) break;
    push(playedByRequester(u, 100));
  }

  // 3. Title/artist keywords. Cheap stop-list extraction.
  const stop = new Set([
    "play", "me", "a", "the", "of", "set", "mix", "playlist", "from",
    "songs", "song", "tracks", "track", "with", "and", "or", "for", "some",
    "us", "our", "jam", "channel", "history", "any", "all", "that", "this",
    "weekend", "night", "morning", "evening", "today", "yesterday", "week",
    "month", "year", "session", "sessions", "vibe", "vibes", "during",
  ]);
  const words = question
    .toLowerCase()
    .replace(/<@[uw][a-z0-9]+(?:\|[^>]+)?>/gi, " ") // strip Slack mentions (incl. |displayname form) before tokenizing
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3 && !stop.has(w));
  for (const w of words) {
    if (out.length >= limit) break;
    push(searchPlayedByTitleOrArtist(w, 25));
  }

  // 4. Fallback so we never hand the LLM an empty pool when the prompt is
  // vague ("play me a set"). Only fires when nothing above hit.
  if (out.length === 0) {
    push(recentPlayed(50));
  }
  return out;
}

export async function askLLMForSet(
  question: string,
  maxTracks: number = config.JAM_MEMORY_MAX_QUEUE,
): Promise<MemorySetResult> {
  const candidates = buildCandidates(question, 60);
  if (candidates.length === 0) {
    return { summary: "No matching tracks in the Jam history yet.", trackIds: [] };
  }

  const sys = SET_SYSTEM.replace("{{MAX}}", String(maxTracks));
  const userMsg = `Request: ${question}\n\nCandidates:\n${formatCandidates(candidates)}`;

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
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      temperature: 0.4,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error("OpenRouter (memory set) request failed", {
      status: res.status,
      body: text,
    });
    throw new Error(`OpenRouter ${res.status}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  // Strip ```json ... ``` (or bare ``` ... ```) fences in case the model
  // ignores response_format and wraps its JSON in a markdown block.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: { summary?: string; track_ids?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger.warn("Memory set returned non-JSON", { raw });
    return {
      summary: "Couldn't build a clean set this time — try rephrasing.",
      trackIds: [],
    };
  }

  const allowed = new Set(candidates.map((c) => c.track_id));
  const trackIds = Array.isArray(parsed.track_ids)
    ? parsed.track_ids
        .filter((x): x is string => typeof x === "string" && allowed.has(x))
        .slice(0, maxTracks)
    : [];
  // Dedup while preserving order.
  const seen = new Set<string>();
  const unique = trackIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return {
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : `Built a ${unique.length}-track set from the Jam history.`,
    trackIds: unique,
  };
}

/**
 * Look up a track row from history by Spotify track id, returning the most
 * recent play (so we have title/artist for confirmation messaging). Backed
 * by a real indexed `WHERE track_id = ?` query — not the title/artist text
 * search the previous implementation accidentally used.
 */
export function lookupHistoryTrack(trackId: string): PlayedTrack | undefined {
  return lastPlayedByTrackId(trackId);
}

// Re-export for tests / external callers.
export { buildCandidates as _buildCandidatesForTest };
