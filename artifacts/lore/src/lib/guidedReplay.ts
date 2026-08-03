import type { RecordingLink } from "@workspace/api-client-react";

export type GuidedService =
  | "bandcamp"
  | "youtube"
  | "appleMusic"
  | "youtubeMusic"
  | "tidal"
  | "amazonMusic"
  | "deezer"
  | "soundcloud"
  | "pandora";

/** Services that can render an official iframe embed. All others are external-open only. */
export const EMBED_SERVICES = new Set<GuidedService>(["bandcamp", "youtube"]);

/** All supported services in display order, with friendly labels. */
export const GUIDED_SERVICE_OPTIONS: ReadonlyArray<{ service: GuidedService; label: string }> = [
  { service: "bandcamp", label: "Bandcamp" },
  { service: "youtube", label: "YouTube" },
  { service: "appleMusic", label: "Apple Music" },
  { service: "youtubeMusic", label: "YouTube Music" },
  { service: "tidal", label: "Tidal" },
  { service: "amazonMusic", label: "Amazon Music" },
  { service: "deezer", label: "Deezer" },
  { service: "soundcloud", label: "SoundCloud" },
  { service: "pandora", label: "Pandora" },
];

export type GuidedReplaySource = {
  /**
   * The service key. Known services use a `GuidedService` value; services that
   * are mapped in `service_track_map` but not yet enumerated in `GuidedService`
   * carry a raw string so their tabs still appear without any frontend change.
   */
  service: string;
  /** The canonical page or track URL for this service. Always present. */
  url: string;
  /**
   * Set for embed services when the URL resolves to a known embeddable form.
   * Null for external-only services and for embed services whose URL is not an
   * embeddable shape (e.g. a Bandcamp public track page vs. EmbeddedPlayer).
   */
  embedUrl: string | null;
  /** True when no iframe embed is available; the UI should open url in a new tab. */
  externalOnly: boolean;
  autoAdvance: boolean;
};

export type GuidedReplayMissingReason =
  | "unresolved"
  | "unavailable"
  | "dead-link";

export type GuidedReplayMaterializedEntry = {
  position: number;
  title: string;
  artist: string;
  recordingMbid: string | null;
  source: GuidedReplaySource | null;
  missingReason: GuidedReplayMissingReason | null;
};

export type GuidedReplayMaterialization = {
  /** Same string passed to `materializeGuidedReplay` — a `GuidedService` for known services, a raw key for new ones. */
  service: string;
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

type GuidedLink = RecordingLink & { deadLink?: boolean; externalId?: string | null };

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
    // not an embed, and must not be treated as playable via iframe.
    if (!/\/EmbeddedPlayer\//i.test(parsed.pathname)) return null;
    if (!/(^|\/)(track|album)=/i.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Approved HTTPS host patterns for each service's external links.
 *
 * Any stored URL that does not match its service's pattern is rejected before
 * it can become a clickable `<a href>` in the replay UI. This mirrors the
 * server-side safeWebUrl guard used in the guided-replay-queue route.
 */
const SERVICE_HOST_RE: Record<GuidedService, RegExp> = {
  bandcamp:     /(^|\.)bandcamp\.com$/i,
  youtube:      /^(www\.|m\.)?youtube\.com$|^youtu\.be$/i,
  appleMusic:   /^music\.apple\.com$/i,
  youtubeMusic: /^music\.youtube\.com$/i,
  tidal:        /(^|\.)tidal\.com$/i,
  amazonMusic:  /(^|\.)(amazon\.(com|co\.uk|de|co\.jp|fr|it|es|ca|com\.au|com\.mx)|music\.amazon\.(com|co\.uk|de|co\.jp|fr|it|es|ca|com\.au|com\.mx))$/i,
  deezer:       /(^|\.)deezer\.com$/i,
  soundcloud:   /(^|\.)soundcloud\.com$/i,
  pandora:      /(^|\.)pandora\.com$/i,
};

/**
 * Returns the URL unchanged if it is HTTPS and (for known services) its
 * hostname is on the approved list; otherwise returns null so the entry is
 * marked unavailable instead of surfacing a dangerous or off-service link.
 *
 * Unknown services — those not yet in `GuidedService` — pass through with an
 * HTTPS-only check. Their URLs come from the server-side `service_track_map`
 * which already applies a `safeWebUrl` guard before storage.
 */
function safeServiceUrl(service: string, url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const pattern = SERVICE_HOST_RE[service as GuidedService];
    if (pattern && !pattern.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Case-insensitive matchers for each service.
 *
 * Three name shapes must all match:
 *  1. DB snake_case key from serviceTrackMapTable (e.g. "apple_music") — used
 *     in guidedLinks emitted by the manifest endpoint.
 *  2. Odesli camelCase key (e.g. "appleMusic") — legacy recording.links entries.
 *  3. Friendly label (e.g. "Apple Music") — recording.links from the enrichment
 *     pipeline.
 *
 * "youtube" is matched exactly so it never captures "youtube_music" /
 * "youtubeMusic" entries.
 */
const SERVICE_FILTERS: Record<GuidedService, (name: string) => boolean> = {
  bandcamp:     (n) => /^bandcamp$/i.test(n),
  youtube:      (n) => /^youtube$/i.test(n),
  appleMusic:   (n) => /^(apple_music|applemusic|apple music)$/i.test(n),
  youtubeMusic: (n) => /^(youtube_music|youtubemusic|youtube music)$/i.test(n),
  tidal:        (n) => /^tidal$/i.test(n),
  amazonMusic:  (n) => /^(amazon_music|amazonmusic|amazon music)$/i.test(n),
  deezer:       (n) => /^deezer$/i.test(n),
  soundcloud:   (n) => /^soundcloud$/i.test(n),
  pandora:      (n) => /^pandora$/i.test(n),
};

function sourceForLink(
  service: string,
  link: GuidedLink,
): GuidedReplaySource | null {
  if (link.kind !== "exact" || link.deadLink) return null;
  if (!link.url) return null;

  if (service === "youtube") {
    const resolvedUrl = link.url || (link.externalId ? `https://youtu.be/${link.externalId}` : "");
    const embedUrl = youtubeEmbedUrl(resolvedUrl);
    if (embedUrl !== null) {
      return {
        service,
        url: link.url || resolvedUrl,
        embedUrl,
        // YouTube's IFrame API can report ENDED, enabling auto-advance only when embedded.
        autoAdvance: true,
        externalOnly: false,
      };
    }
    // Embed URL could not be built — validate the raw URL before allowing external open.
    const safeUrl = safeServiceUrl(service, resolvedUrl);
    if (!safeUrl) return null;
    return { service, url: safeUrl, embedUrl: null, autoAdvance: false, externalOnly: true };
  }

  if (service === "bandcamp") {
    const embedUrl = bandcampEmbedUrl(link.url);
    if (embedUrl !== null) {
      return { service, url: link.url, embedUrl, autoAdvance: false, externalOnly: false };
    }
    // Not an EmbeddedPlayer URL — validate before allowing external open.
    const safeUrl = safeServiceUrl(service, link.url);
    if (!safeUrl) return null;
    return { service, url: safeUrl, embedUrl: null, autoAdvance: false, externalOnly: true };
  }

  // All other services: external link only — must pass host+HTTPS validation.
  const safeUrl = safeServiceUrl(service, link.url);
  if (!safeUrl) return null;
  return { service, url: safeUrl, embedUrl: null, autoAdvance: false, externalOnly: true };
}

/**
 * Materialize a service guide without changing the broadcast manifest.
 *
 * The returned `entries` array is deliberately one-for-one and position
 * preserving. `playable` is only a convenience view for the player; `missing`
 * is the receipt for rows that the guide cannot surface on this service.
 *
 * Each service is resolved independently with no cross-service fallback:
 * the user can compare coverage across services and pick the one that works
 * best for the archive in question.
 */
export function materializeGuidedReplay(
  entries: ReplayMappingEntry[],
  service: string,
): GuidedReplayMaterialization {
  // Known services use their precise multi-shape filter; unknown services
  // (not yet in GuidedService) fall back to a case-insensitive exact match
  // on the raw service key from service_track_map.
  const matchService: (name: string) => boolean =
    SERVICE_FILTERS[service as GuidedService] ??
    ((n) => n.toLowerCase() === service.toLowerCase());

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

    // guidedLinks come from serviceTrackMapTable (keyed by Odesli platform key).
    // recording.links come from the enrichment pipeline (keyed by friendly name).
    // Merge them into a uniform shape; guidedLinks take priority since they carry
    // a deadLink flag while recording.links do not.
    const allLinks: GuidedLink[] = [
      ...(entry.guidedLinks ?? []).map((link) => ({
        name: link.service,
        url: link.url,
        kind: "exact" as const,
        deadLink: link.deadLink,
        externalId: link.externalId,
      })),
      ...((entry.recording.links ?? []) as GuidedLink[]),
    ];

    const matching = allLinks.filter((link) => matchService(link.name));
    const dead = matching.some((link) => link.deadLink);
    const source = matching.map((link) => sourceForLink(service, link)).find(Boolean) ?? null;

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

/**
 * Derives which service tabs should appear for a replay manifest.
 *
 * All known services (`GUIDED_SERVICE_OPTIONS`) always appear as tabs so
 * listeners can switch freely; a service with zero coverage simply disables
 * the "Enter guided mode" button. This matches `materializeGuidedReplay`
 * behaviour — coverage is computed per-service, not used to gate visibility.
 *
 * Additionally, any service key present in `guidedLinks` that does not match
 * any known service is appended alphabetically with a title-cased label
 * (e.g. "tidal_hifi" → "Tidal Hifi"). This is the auto-appear path: a new
 * service added to `service_track_map` gains a tab on replays that have
 * coverage without any frontend code change.
 */
export function computeAvailableServices(
  entries: ReadonlyArray<{
    guidedLinks?: ReadonlyArray<{ service: string; deadLink: boolean }> | null;
  }>,
): Array<{ service: string; label: string }> {
  // All known services always appear.
  const result: Array<{ service: string; label: string }> = [...GUIDED_SERVICE_OPTIONS];

  // Collect live unknown service keys from guidedLinks only (recording.links
  // only carry known service names in their friendly-label form, so adding
  // them here would produce duplicate or mislabelled tabs for known services).
  const liveUnknown = new Set<string>();
  for (const entry of entries) {
    for (const link of entry.guidedLinks ?? []) {
      if (link.deadLink) continue;
      const matchesKnown = GUIDED_SERVICE_OPTIONS.some(({ service }) =>
        SERVICE_FILTERS[service](link.service),
      );
      if (!matchesKnown) liveUnknown.add(link.service);
    }
  }

  for (const svc of [...liveUnknown].sort()) {
    const label = svc.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    result.push({ service: svc, label });
  }

  return result;
}

export function guidedMissingLabel(reason: GuidedReplayMissingReason): string {
  switch (reason) {
    case "unresolved":
      return "unresolved";
    case "dead-link":
      return "dead link";
    case "unavailable":
      return "unavailable on this service";
  }
}
