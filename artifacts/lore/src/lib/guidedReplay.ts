import type { RecordingLink } from "@workspace/api-client-react";

export type GuidedService = "bandcamp" | "youtube";

export type GuidedReplaySource = {
  service: GuidedService;
  url: string;
  embedUrl: string;
  autoAdvance: boolean;
};

export type GuidedReplayMissingReason =
  | "unresolved"
  | "unavailable"
  | "dead-link"
  | "no-official-embed";

export type GuidedReplayMaterializedEntry = {
  position: number;
  title: string;
  artist: string;
  recordingMbid: string | null;
  source: GuidedReplaySource | null;
  missingReason: GuidedReplayMissingReason | null;
};

export type GuidedReplayMaterialization = {
  service: GuidedService;
  total: number;
  available: number;
  entries: GuidedReplayMaterializedEntry[];
  playable: GuidedReplayMaterializedEntry[];
  missing: GuidedReplayMaterializedEntry[];
};

type ReplayMappingEntry = {
  position: number;
  rawTitle: string;
  rawArtist: string;
  recording: {
    mbid: string;
    title: string;
    artist: string;
    links?: RecordingLink[] | null;
  } | null;
  guidedLinks?: Array<{
    service: string;
    externalId: string | null;
    url: string;
    deadLink: boolean;
  }>;
};

type GuidedLink = RecordingLink & { deadLink?: boolean };

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const BANDCAMP_HOST_RE = /(^|\.)bandcamp\.com$/i;

function parseYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return null;
    if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") {
      return parts[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function youtubeEmbedUrl(url: string): string | null {
  const id = parseYouTubeId(url);
  if (!id || !/^[\w-]{6,}$/.test(id)) return null;
  const params = new URLSearchParams({
    enablejsapi: "1",
    origin: typeof window === "undefined" ? "https://lore.radio" : window.location.origin,
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
}

function bandcampEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!BANDCAMP_HOST_RE.test(parsed.hostname)) return null;
    // Bandcamp's documented EmbeddedPlayer URL is the only shape that is
    // safe to place in an iframe. A public track page is an external link,
    // not an embed, and must not be treated as playable.
    if (!/\/EmbeddedPlayer\//i.test(parsed.pathname)) return null;
    if (!/(^|\/)(track|album)=/i.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sourceForLink(
  service: GuidedService,
  link: GuidedLink & { externalId?: string | null },
): GuidedReplaySource | null {
  if (link.kind !== "exact" || link.deadLink) return null;
  const embedUrl =
    service === "bandcamp"
      ? bandcampEmbedUrl(
          link.url,
        )
      : youtubeEmbedUrl(link.url || (link.externalId ? `https://youtu.be/${link.externalId}` : ""));
  if (!embedUrl) return null;
  return {
    service,
    url: link.url,
    embedUrl,
    // Bandcamp has no supported end-of-track callback. YouTube's official
    // IFrame API can report ENDED, so only it is eligible for auto advance.
    autoAdvance: service === "youtube",
  };
}

/**
 * Materialize a service guide without changing the broadcast manifest.
 *
 * The returned `entries` array is deliberately one-for-one and position
 * preserving. `playable` is only a convenience view for the player; `missing`
 * is the receipt for rows that the guide cannot play.
 */
export function materializeGuidedReplay(
  entries: ReplayMappingEntry[],
  service: GuidedService,
): GuidedReplayMaterialization {
  const materialized = entries.map((entry) => {
    if (!entry.recording) {
      return {
        position: entry.position,
        title: entry.rawTitle || "Untitled",
        artist: entry.rawArtist || "Unknown artist",
        recordingMbid: null,
        source: null,
        missingReason: "unresolved" as const,
      };
    }

    const links = (entry.recording.links ?? []) as GuidedLink[];
    const mappedLinks = (entry.guidedLinks ?? [])
      .filter((link) => link.service === service || (service === "bandcamp" && link.service === "youtube"))
      .map((link) => ({
        name: link.service,
        url: link.url,
        kind: "exact" as const,
        deadLink: link.deadLink,
        externalId: link.externalId,
      }));
    const preferredName = service === "bandcamp" ? /bandcamp/i : /youtube/i;
    const allLinks = [...mappedLinks, ...links];
    const preferredLinks = allLinks.filter(
      (link) => preferredName.test(link.name) || preferredName.test(link.url),
    );
    const fallbackLinks = service === "bandcamp"
      ? allLinks.filter((link) => /youtube/i.test(link.name) || /youtube/i.test(link.url))
      : [];
    const matching = [...preferredLinks, ...fallbackLinks];
    const dead = matching.some((link) => link.deadLink);
    const source =
      preferredLinks.map((link) => sourceForLink(service, link)).find(Boolean) ??
      fallbackLinks.map((link) => sourceForLink("youtube", link)).find(Boolean) ??
      null;
    const hasExact = matching.some((link) => link.kind === "exact");

    return {
      position: entry.position,
      title: entry.recording.title,
      artist: entry.recording.artist,
      recordingMbid: entry.recording.mbid,
      source,
      missingReason: source
        ? null
        : dead
          ? ("dead-link" as const)
          : hasExact
            ? ("no-official-embed" as const)
            : ("unavailable" as const),
    };
  });
  const playable = materialized.filter((entry) => entry.source != null) as Array<
    GuidedReplayMaterializedEntry & { source: GuidedReplaySource }
  >;
  return {
    service,
    total: materialized.length,
    available: playable.length,
    entries: materialized,
    playable,
    missing: materialized.filter((entry) => entry.source == null),
  };
}

export function guidedMissingLabel(reason: GuidedReplayMissingReason): string {
  switch (reason) {
    case "unresolved":
      return "unresolved";
    case "dead-link":
      return "dead link";
    case "no-official-embed":
      return "no official embed";
    case "unavailable":
      return "unavailable on this service";
  }
}