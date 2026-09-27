import { config } from "../config.js";

type Station = {
  slug: string;
  name: string;
  org?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  locationConfidence?: string | null;
  locationSource?: string | null;
  homepageUrl?: string | null;
  callsign?: string | null;
  callSign?: string | null;
};

type Track = {
  playedAt?: string;
  rawArtist?: string;
  rawTitle?: string;
  recording?: { artist?: string; title?: string } | null;
};

const DIRECTORY_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 7_000;
const NOW_PLAYING_MAX_OBSERVED_AGE_MS = 30 * 60_000;
let directoryCache: { expiresAt: number; stations: Station[] } | null = null;
let directoryInFlight: Promise<Station[] | null> | null = null;

function safeText(value: unknown, max = 160): string {
  return typeof value === "string"
    ? value.trim().replace(/[\r\n\t]+/g, " ").replace(/[<>&|]/g, " ").slice(0, max)
    : "";
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
}

function withoutUrls(value: string): string {
  return value.replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ");
}

function hasStationCue(question: string): boolean {
  const text = withoutUrls(question);
  return /\b(?:radio|station|broadcast|fm|am)\b/i.test(text) ||
    /\b[A-Z]{2,7}\b/.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${config.LORE_API_BASE}${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function loadDirectory(): Promise<Station[] | null> {
  if (directoryCache && directoryCache.expiresAt > Date.now()) {
    return directoryCache.stations;
  }
  if (directoryInFlight) return directoryInFlight;
  const request = (async () => {
    const payload = await getJson("/stations");
    if (!isRecord(payload) || !Array.isArray(payload.stations)) return null;
    const stations = payload.stations.filter((station): station is Station =>
      isRecord(station) &&
      typeof station.slug === "string" &&
      typeof station.name === "string",
    );
    if (!stations.length) return null;
    directoryCache = { stations, expiresAt: Date.now() + DIRECTORY_TTL_MS };
    return stations;
  })().finally(() => {
    directoryInFlight = null;
  });
  directoryInFlight = request;
  return request;
}

type Intent = "location" | "about" | "now-playing" | "history";

function questionIntent(question: string): Intent | null {
  if (/\bwhere\s+(?:is|are)\b/i.test(question)) return "location";
  if (/\bwhat(?:'s| is)\s+playing\s+(?:on|at)\b/i.test(question)) {
    return "now-playing";
  }
  if (/\btell\s+me\s+about\b/i.test(question) || /\bwhat\s+is\b/i.test(question)) return "about";
  if (
    (/\bwhat\s+(?:did|has)\b/i.test(question) && /\bplay(?:ed)?\b/i.test(question)) ||
    /\b(?:recent\s+spins?|spin\s+history|recent\s+history|history)\b/i.test(question)
  ) {
    return "history";
  }
  return null;
}

function aliasesFor(station: Station): string[] {
  return [station.slug, station.name, station.callsign, station.callSign]
    .filter((alias): alias is string => typeof alias === "string" && normalize(alias).length > 1);
}

function matchStations(question: string, stations: Station[]): Station[] {
  const normalizedQuestion = ` ${normalize(withoutUrls(question))} `;
  const matched = stations.flatMap((station) =>
    aliasesFor(station)
      .map((alias) => normalize(alias))
      .filter((alias) => normalizedQuestion.includes(` ${alias} `))
      .map((alias) => ({ station, aliasLength: alias.length })),
  );
  const longestMatch = Math.max(0, ...matched.map(({ aliasLength }) => aliasLength));
  return [...new Set(
    matched
      .filter(({ aliasLength }) => aliasLength === longestMatch)
      .map(({ station }) => station),
  )];
}

function attribution(source: string): string {
  return `Source: Lore ${source}.`;
}

function answerLocation(station: Station): string {
  const locality = [station.city, station.region, station.country]
    .map((value) => safeText(value, 80))
    .filter(Boolean);
  if (!locality.length) {
    return `Lore has no listed location for ${safeText(station.name)}. ${attribution("station directory")}`;
  }
  const confidence = safeText(station.locationConfidence, 50);
  const confidenceNote = confidence ? ` (location confidence: ${confidence})` : "";
  const source = safeText(station.locationSource, 60);
  const sourceNote = source ? ` (location source: ${source})` : "";
  return `${safeText(station.name)} is listed as based in ${locality.join(", ")}${confidenceNote}${sourceNote}. ${attribution("station directory")}`;
}

function answerAbout(station: Station): string {
  const details = [station.org, station.city, station.region, station.country]
    .map((value) => safeText(value, 80))
    .filter(Boolean);
  const homepage = safeHomepageUrl(station.homepageUrl);
  if (!details.length && !homepage) {
    return `Lore has no further public directory details for ${safeText(station.name)}. ${attribution("station directory")}`;
  }
  return `${safeText(station.name)}${details.length ? ` — ${details.join(" · ")}` : ""}${homepage ? ` · ${homepage}` : ""}. ${attribution("station directory")}`;
}

function safeHomepageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username || url.password ||
      !url.hostname.includes(".") ||
      /(?:^|\.)localhost$|(?:^|\.)local$|(?:^|\.)internal$/i.test(url.hostname)
    ) return null;
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const octets = hostname.split(".").map(Number);
    if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
      const [a, b, c] = octets;
      if (
        a === 0 || a === 10 || a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b! >= 16 && b! <= 31) ||
        (a === 192 && (b === 168 || (b === 0 && c! <= 2))) ||
        (a === 100 && b! >= 64 && b! <= 127) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113) ||
        a! >= 224
      ) return null;
    }
    if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:")) {
      return null;
    }
    // Keep this as an intentional Slack link and encode a path/query pipe so
    // data from the directory cannot escape the link label.
    const safeUrl = url.toString().replace(/\|/g, "%7C");
    return `<${safeUrl}|Homepage>`;
  } catch {
    return null;
  }
}

async function answerNowPlaying(station: Station): Promise<string> {
  const payload = await getJson(`/stations/${encodeURIComponent(station.slug)}/now-playing`);
  if (!isRecord(payload) || !isRecord(payload.nowPlaying)) {
    return `Lore has no current track available for ${safeText(station.name)}. ${attribution("now-playing feed")}`;
  }
  const current = payload.nowPlaying;
  const observedAt = typeof current.observedAt === "string" ? Date.parse(current.observedAt) : NaN;
  const observationAge = Date.now() - observedAt;
  if (
    current.freshness !== "fresh" ||
    !Number.isFinite(observedAt) ||
    observationAge < -5 * 60_000 ||
    observationAge > NOW_PLAYING_MAX_OBSERVED_AGE_MS
  ) {
    return `Lore’s latest observation for ${safeText(station.name)} is stale or unconfirmed, so I can’t say what is playing now. ${attribution("now-playing feed")}`;
  }
  const recording = isRecord(current.recording) ? current.recording : null;
  const artist = safeText(recording?.artist ?? current.rawArtist);
  const title = safeText(recording?.title ?? current.rawTitle);
  if (!artist && !title) {
    return `Lore has no usable current track metadata for ${safeText(station.name)}. ${attribution("now-playing feed")}`;
  }
  return `${safeText(station.name)}: ${[artist, title].filter(Boolean).join(" — ")}. ${attribution("now-playing feed")}`;
}

async function answerHistory(station: Station, question: string): Promise<string> {
  if (/\b(?:yesterday|today|last\s+(?:week|night|hour|day|month|year)|this\s+(?:week|month|year|morning|afternoon|evening)|past\s+(?:week|month|year)|in\s+\d{4})\b/i.test(question)) {
    return `I can’t verify that time period from Lore’s latest five tracks for ${safeText(station.name)}. ${attribution("bounded spin history")}`;
  }
  const payload = await getJson(`/stations/spins?slug=${encodeURIComponent(station.slug)}&limit=5`);
  if (!isRecord(payload) || !Array.isArray(payload.tracks) || !payload.tracks.length) {
    return `Lore has no recent spin history available for ${safeText(station.name)}. ${attribution("bounded spin history")}`;
  }
  const tracks = payload.tracks.filter((item): item is Track =>
    isRecord(item) && typeof item.playedAt === "string",
  );
  if (!tracks.length) {
    return `Lore has no usable recent spin history for ${safeText(station.name)}. ${attribution("bounded spin history")}`;
  }
  const lines = tracks.slice(0, 5).map((track) => {
    const recording = track.recording;
    const artist = safeText(recording?.artist ?? track.rawArtist, 90);
    const title = safeText(recording?.title ?? track.rawTitle, 90);
    const timestamp = Date.parse(track.playedAt!);
    const when = Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "time unavailable";
    return `• ${[artist, title].filter(Boolean).join(" — ") || "Track metadata unavailable"} (${when})`;
  });
  return `Latest Lore spins for ${safeText(station.name)}:\n${lines.join("\n")}\n${attribution("bounded spin history")}`;
}

export async function answerStationQuestion(question: string): Promise<string | null> {
  if (
    (/\b(?:i|me|my|we|us|our)\b/i.test(question) &&
      /\b(?:play|played|history|jam|session)\b/i.test(question)) ||
    (/\bjam\b/i.test(question) &&
      /\b(?:play|played|history|session)\b/i.test(question))
  ) {
    return null;
  }
  if (!hasStationCue(question)) return null;
  const intent = questionIntent(question);
  if (!intent) return null;
  const stations = await loadDirectory();
  if (!stations) {
    return `Lore’s station directory is unavailable, so I can’t identify the station or verify an answer right now. ${attribution("station directory")}`;
  }
  const matches = matchStations(question, stations);
  if (!matches.length) return null;
  if (matches.length > 1) {
    return "I found more than one matching station in Lore’s directory, so I won’t guess which one you mean. Please include its exact station name or slug.";
  }
  const [station] = matches;
  if (!station) return null;
  if (intent === "location") return answerLocation(station);
  if (intent === "about") return answerAbout(station);
  if (intent === "now-playing") return answerNowPlaying(station);
  return answerHistory(station, question);
}