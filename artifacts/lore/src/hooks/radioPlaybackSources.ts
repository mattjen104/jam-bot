import type { Station } from "@workspace/api-client-react";

export interface PlaybackCandidate {
  url: string;
  role: "primary" | "relay" | "alternate";
  transport: "https" | "http" | "relay";
  format: string;
  healthHint: "healthy" | "degraded" | "unknown";
}

const MAX_CANDIDATES = 2;

function inferredFormat(url: string, fallback: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes(".flac")) return "flac";
  if (lower.includes(".mp3")) return "mp3";
  if (lower.includes(".aac") || lower.includes(".m4a")) return "aac";
  return ["aac", "mp3", "hls", "flac"].includes(fallback)
    ? fallback
    : "unknown";
}

function isSafePlaybackUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/api/stations/") && value.endsWith("/relay")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Return the server-approved playback order. New servers publish a bounded
 * candidate list; older servers still work through streamUrl/relayUrl.
 */
export function resolvePlaybackCandidates(
  station: Station,
): PlaybackCandidate[] {
  const published = (station as Station & {
    playbackCandidates?: Array<Partial<PlaybackCandidate>>;
  }).playbackCandidates;
  const candidates: PlaybackCandidate[] = [];
  const seen = new Set<string>();

  const add = (candidate: Partial<PlaybackCandidate>) => {
    if (!isSafePlaybackUrl(candidate.url) || seen.has(candidate.url)) return;
    seen.add(candidate.url);
    candidates.push({
      url: candidate.url,
      role:
        candidate.role === "alternate" || candidate.role === "relay"
          ? candidate.role
          : "primary",
      transport:
        candidate.transport === "relay" || candidate.transport === "http"
          ? candidate.transport
          : "https",
      format:
        candidate.format ||
        inferredFormat(candidate.url, station.streamFormat),
      healthHint:
        candidate.healthHint === "healthy" ||
        candidate.healthHint === "degraded"
          ? candidate.healthHint
          : "unknown",
    });
  };

  if (Array.isArray(published)) {
    for (const candidate of published) add(candidate);
  }

  if (candidates.length === 0) {
    const direct = station.streamUrl;
    const relay = station.relayUrl ?? null;
    if (direct?.startsWith("http://") && relay) {
      add({
        url: relay,
        role: "primary",
        transport: "relay",
        format: station.streamFormat,
      });
    } else if (direct?.startsWith("https://")) {
      add({
        url: direct,
        role: "primary",
        transport: direct.startsWith("http://") ? "http" : "https",
        format: station.streamFormat,
      });
    } else if (relay) {
      add({
        url: relay,
        role: "primary",
        transport: "relay",
        format: station.streamFormat,
      });
    }
  }

  return candidates.slice(0, MAX_CANDIDATES);
}

/** Return only the first server-sanctioned source for gesture-intent warmup. */
export function resolvePrimaryPlaybackCandidate(
  station: Station,
): PlaybackCandidate | null {
  return resolvePlaybackCandidates(station)[0] ?? null;
}

/** Backward-compatible single-source helper used by player surfaces. */
export function resolvePlaybackSource(station: Station): string | null {
  return resolvePrimaryPlaybackCandidate(station)?.url ?? null;
}