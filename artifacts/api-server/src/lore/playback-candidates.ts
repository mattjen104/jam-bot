import type { Station } from "@workspace/db";
import { isRelayAllowed, relayUrlPath } from "./stream-relay.js";

const MAX_CANDIDATES = 4;
type Format = "aac" | "mp3" | "hls" | "flac" | "unknown";

function safePublicUrl(
  value: unknown,
  opts: { allowQuery?: boolean } = {},
): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname ||
      url.username || url.password || (!opts.allowQuery && url.search) || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function formatFor(url: string, hint: unknown, fallback: string): Format {
  if (typeof hint === "string" && ["aac", "mp3", "hls", "flac"].includes(hint)) return hint as Format;
  if (/\.m3u8(?:$|\?)/i.test(url)) return "hls";
  if (/\.flac(?:$|\?)/i.test(url)) return "flac";
  if (/\.mp3(?:$|\?)/i.test(url)) return "mp3";
  return ["aac", "mp3", "hls", "flac"].includes(fallback) ? fallback as Format : "unknown";
}

/** Server-approved candidates, made solely from a station row and its mounts. */
export function playbackCandidatesForStation(station: Station) {
  const healthHint = (station.healthFailures ?? 0) > 0 ? "degraded" :
    station.lastAliveAt ? "healthy" : "unknown";
  // streamUrl is already part of the legacy public station contract, and
  // legitimate CDN streams commonly require a non-secret query string.
  const primary = safePublicUrl(station.streamUrl, { allowQuery: true });
  const relay = primary?.startsWith("http://") && isRelayAllowed(station.slug)
    ? relayUrlPath(station.slug) : null;
  // Keep signed/query-bearing legacy streamUrl values working without
  // republishing them in the new candidate list.
  if (primary && new URL(primary).search && !relay) return [];
  const candidates: Array<{
    url: string; role: "primary" | "relay" | "alternate"; transport: "https" | "http" | "relay";
    format: Format; healthHint: "healthy" | "degraded" | "unknown";
  }> = [];
  const seen = new Set<string>();
  const add = (url: string | null, role: "primary" | "relay" | "alternate", hint?: unknown) => {
    if (!url || seen.has(url) || candidates.length >= MAX_CANDIDATES) return;
    seen.add(url);
    candidates.push({
      url, role, transport: role === "relay" ? "relay" : url.startsWith("https://") ? "https" : "http",
      format: role === "relay" ? formatFor(primary ?? "", undefined, station.streamFormat) : formatFor(url, hint, station.streamFormat),
      healthHint,
    });
  };
  // A safe relay is always ordered before the mixed-content HTTP primary.
  if (relay) add(relay, "relay");
  // A raw HTTP URL cannot recover an HTTPS page after its relay fails; retain
  // it in the legacy streamUrl field, but do not advertise it as a candidate.
  if (primary?.startsWith("https://")) add(primary, "primary");
  const config = station.nowPlayingConfig;
  const rawMounts = config && typeof config === "object"
    ? (config as Record<string, unknown>)["mounts"] : undefined;
  const mounts: unknown[] = Array.isArray(rawMounts) ? rawMounts : [];
  for (const mount of mounts) {
    if (!mount || typeof mount !== "object") continue;
    const entry = mount as Record<string, unknown>;
    add(safePublicUrl(entry.url), "alternate", entry.format);
  }
  return candidates;
}