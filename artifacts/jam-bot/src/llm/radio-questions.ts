import { config } from "../config.js";

export type RadioQuestion =
  | { kind: "recommend"; taste: string }
  | { kind: "taste-needed" }
  | { kind: "live" }
  | { kind: "shared" }
  | { kind: "my-library" };

const PUBLIC_TIMEOUT_MS = 7_000;

function safe(value: unknown, max = 120): string {
  return typeof value === "string"
    ? value.replace(/[\r\n\t<>|&*`]/g, " ").trim().slice(0, max)
    : "";
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function date(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null;
}

function fresh(value: unknown): value is Record<string, unknown> {
  if (!record(value) || value.freshness !== "fresh") return false;
  if (typeof value.observedAt !== "string") return false;
  const age = Date.now() - Date.parse(value.observedAt);
  return Number.isFinite(age) && age >= -5 * 60_000 && age <= 30 * 60_000;
}

async function publicJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${config.LORE_API_BASE.replace(/\/+$/, "")}${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS),
    });
    return response.ok ? await response.json() as unknown : null;
  } catch {
    return null;
  }
}

/** Select the evidence source in code, independently of the chat classifier. */
export function parseRadioQuestion(input: string): RadioQuestion | null {
  // A pasted link belongs to the link reader, never to a station name embedded
  // in the URL. Explicit music commands stay on the Jam control path.
  if (/\bhttps?:\/\/|\bwww\./i.test(input) ||
      /^(?:please\s+)?(?:play|queue|add|skip|next|start a jam)\b/i.test(input)) return null;
  const text = input.trim().replace(/[?!.]+$/, "").trim();
  const shared = /\b(?:matt['’]s|our shared|the shared)\s+(?:lore\s+)?library\b/i.test(text);
  const mine = /\bmy\s+(?:lore\s+)?library\b/i.test(text);
  const radioSubject = /\b(?:radio|stations?|on[- ]air|broadcast|crossings?|spins?)\b/i.test(text);
  const recommendation = /\b(?:recommend|suggest|good|best|which|what)\b/i.test(text) &&
    (/\b(?:radio|stations?)\b/i.test(text) ||
      /\b(?:tune in|listen to)\b/i.test(text));

  if (radioSubject && mine) return { kind: "my-library" };
  if (radioSubject && shared) return { kind: "shared" };
  if (/\b(?:radio feed|radio stations|stations? on air|on the radio|what(?:'s| is) on air)\b/i.test(text) &&
      /\b(?:what|which|who|show|anything|any)\b/i.test(text) &&
      !/\bif\b.*\blike\b/i.test(text)) return { kind: "live" };
  if (recommendation && !shared && !mine) {
    const taste = text.match(
      /\b(?:if (?:i|we|they) like|(?:someone|a person|people|listeners?) who (?:likes?|is into)|(?:i|we|they) (?:like|love|am into|are into)|based on (?:my|our) (?:taste for|love of)|for fans of|into)\s+(.+)$/i,
    )?.[1] ?? text.match(/\b(?:stations? (?:play|playing)|radio (?:for|like))\s+(.+)$/i)?.[1];
    const clean = taste?.trim().replace(/^["“'`]|["”'`]$/g, "").trim();
    if (!clean || clean.length < 2) return { kind: "taste-needed" };
    return { kind: "recommend", taste: clean.slice(0, 100) };
  }
  return null;
}

export async function answerLiveRadio(): Promise<string> {
  const [feed, directory] = await Promise.all([
    publicJson("/stations/now-playing"),
    publicJson("/stations"),
  ]);
  if (!record(feed) || !Array.isArray(feed.items) ||
      !record(directory) || !Array.isArray(directory.stations)) {
    return "I couldn't check Lore's live radio feed right now. Please try again.";
  }
  const names = new Map(
    directory.stations.filter(record).filter((s) =>
      typeof s.slug === "string" && typeof s.name === "string",
    ).map((s) => [s.slug as string, safe(s.name)]),
  );
  const current = feed.items.filter(record).flatMap((item) => {
    const np = item.nowPlaying;
    if (typeof item.slug !== "string" || !names.has(item.slug) || !fresh(np)) return [];
    const recording = record(np.recording) ? np.recording : null;
    const artist = safe(recording?.artist ?? np.rawArtist, 80);
    const title = safe(recording?.title ?? np.rawTitle, 80);
    if (!artist || !title) return [];
    return [{ station: names.get(item.slug)!, artist, title, when: date(np.observedAt)!,
      observedAt: Date.parse(np.observedAt as string) }];
  }).sort((a, b) => b.observedAt - a.observedAt).slice(0, 5);
  if (!current.length) {
    return feed.items.length
      ? "Lore lists stations, but I don't have a fresh confirmed track observation to report right now. Source: Lore live radio feed."
      : "Lore's live station feed is empty right now; I can't tell what's airing. Source: Lore live radio feed.";
  }
  return `A few stations with fresh Lore observations (not a complete live roster):\n${current.map((c) =>
    `• ${c.station}: ${c.artist} — ${c.title} (observed ${c.when})`,
  ).join("\n")}\nSource: Lore live radio feed; observations are not guaranteed track start times.`;
}

type Match = {
  name: string;
  count30: number;
  count90: number;
  when: string;
  kind: "artist" | "genre";
};

function recommendationMatches(payload: unknown, kind: "artist" | "genre"): Match[] {
  if (!record(payload) || !Array.isArray(payload.recommendations)) return [];
  return payload.recommendations.flatMap((item) => {
    if (!record(item) || !record(item.station) || !record(item.evidence) ||
        typeof item.station.name !== "string" ||
        !Number.isInteger(item.evidence.spinCount30d) ||
        !Number.isInteger(item.evidence.spinCount90d)) return [];
    const count30 = item.evidence.spinCount30d as number;
    const count90 = item.evidence.spinCount90d as number;
    const when = date(item.evidence.latestSpinAt);
    if (count30 < 0 || count90 < count30 || !when) return [];
    return [{ name: safe(item.station.name), count30, count90, when, kind }];
  });
}

export async function answerRadioRecommendation(taste: string): Promise<string> {
  const query = encodeURIComponent(taste);
  const [artist, genre] = await Promise.all([
    publicJson(`/recommendations/stations?kind=artist&q=${query}&limit=5`),
    publicJson(`/recommendations/stations?kind=genre&q=${query}&limit=5`),
  ]);
  if (!record(artist) && !record(genre)) {
    return "I couldn't check Lore's station spins for that taste right now. Please try again.";
  }
  const artistMatches = recommendationMatches(artist, "artist");
  const genreMatches = recommendationMatches(genre, "genre");
  if (artistMatches.length && genreMatches.length) {
    return `"${safe(taste)}" matches both an artist and a genre in Lore. Which did you mean?`;
  }
  const source = artistMatches.length ? artist : genre;
  const matches = (artistMatches.length ? artistMatches : genreMatches)
    .filter((item) => item.count90 >= 3 && (item.count30 >= 2 || item.count90 >= 5))
    .slice(0, 3);
  if (!matches.length) {
    return `I don't have enough observed station spins to recommend a station for "${safe(taste)}" confidently. That doesn't mean none plays it. Source: Lore station spin sample (up to 90 days).`;
  }
  const sample = record(source) && record(source.sample) ? source.sample : null;
  const horizon = sample?.capReached === true && date(sample.sampledThrough)
    ? `sampled back to ${date(sample.sampledThrough)} (50,000-spin cap)`
    : "sampled from the past 90 days";
  return `Based on your stated taste for "${safe(taste)}" (not Matt's library), try:\n${matches.map((item) =>
    `• ${item.name} — ${item.count30} sampled ${item.kind} spins within 30 days, ${item.count90} within the sampled 90-day window; latest ${item.when}`,
  ).join("\n")}\nSource: Lore's observed station spins, ${horizon}. This reflects logged broadcasts, not everything each station plays.`;
}