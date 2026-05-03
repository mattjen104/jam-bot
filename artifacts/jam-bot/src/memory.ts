import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  recentPlayed,
  searchPlayedByTitleOrArtist,
  listOptOuts,
  type PlayedTrack,
} from "./db.js";

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
 * Build a candidate pool of tracks from history that the LLM can pick from
 * for a "play me a set" request. We bias toward title/artist matches when the
 * question contains an obvious search term, otherwise fall back to recents.
 */
function buildCandidates(question: string, limit: number): PlayedTrack[] {
  // Honor opt-out: drop any track whose requester has opted out so their
  // listening history can't be surfaced (or echoed to the LLM) by /memory.
  // Tracks with no recorded requester (anonymous plays) are still allowed.
  const optedOut = new Set(listOptOuts());
  const isAllowed = (row: PlayedTrack) =>
    !row.requested_by_slack_user || !optedOut.has(row.requested_by_slack_user);

  const seen = new Set<string>();
  const out: PlayedTrack[] = [];

  // Cheap keyword extraction: any 3+ char word that isn't a stopword.
  const stop = new Set([
    "play", "me", "a", "the", "of", "set", "mix", "playlist", "from",
    "songs", "song", "tracks", "track", "with", "and", "or", "for", "some",
    "us", "our", "jam", "channel", "history", "any", "all", "that", "this",
  ]);
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3 && !stop.has(w));

  for (const w of words) {
    for (const row of searchPlayedByTitleOrArtist(w, 25)) {
      if (!seen.has(row.track_id) && isAllowed(row)) {
        seen.add(row.track_id);
        out.push(row);
      }
      if (out.length >= limit) return out;
    }
  }
  for (const row of recentPlayed(50)) {
    if (!seen.has(row.track_id) && isAllowed(row)) {
      seen.add(row.track_id);
      out.push(row);
    }
    if (out.length >= limit) return out;
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
 * recent play (so we have title/artist for confirmation messaging).
 */
export function lookupHistoryTrack(trackId: string): PlayedTrack | undefined {
  const matches = searchPlayedByTitleOrArtist(trackId, 1);
  if (matches[0]?.track_id === trackId) return matches[0];
  // searchPlayedByTitleOrArtist matches by title/artist, not id, so fall back
  // to scanning recents for an exact id match.
  return recentPlayed(500).find((r) => r.track_id === trackId);
}
