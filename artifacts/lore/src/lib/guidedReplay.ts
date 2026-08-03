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

export type OfficialEmbedFact = {
  provider: "bandcamp" | "youtube";
  role: "provenance" | "control";
  rung: number;
  outcome: "embedded" | "link_out" | "no_link" | "expired" | "transient_failure";
  confidence: "exact" | "gated" | "none";
  sourceUrl: string | null;
  embedUrl: string | null;
  albumEmbedUrl: string | null;
  releaseMbid: string | null;
  providerReleaseId: string | null;
  providerTrackId: string | null;
};

export type OfficialReplaySource = {
  provider: OfficialEmbedFact["provider"];
  role: OfficialEmbedFact["role"];
  rung: number;
  outcome: OfficialEmbedFact["outcome"];
  url: string;
  embedUrl: string | null;
  autoAdvance: boolean;
};

export type OfficialReplayDoors = {
  current: OfficialReplaySource | null;
  album: OfficialReplaySource | null;
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
  embedFacts?: OfficialEmbedFact[] | null;
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

export type GuidedServiceOption = {
  service: GuidedService;
  label: string;
  /**
   * Builds an iframe-safe embed URL from a canonical track URL, or returns
   * null if the URL is not in an embeddable shape for this service.
   * Absent means this service is external-open only.
   */
  embedUrlBuilder?: (url: string) => string | null;
  /**
   * True when the embedded player can report playback end, enabling
   * auto-advance to the next track. Only meaningful when embedUrlBuilder
   * is present.
   */
  embedAutoAdvance?: boolean;
};

/** All supported services in display order, with friendly labels. */
export const GUIDED_SERVICE_OPTIONS: ReadonlyArray<GuidedServiceOption> = [
  { service: "bandcamp",     label: "Bandcamp",       embedUrlBuilder: bandcampEmbedUrl },
  { service: "youtube",      label: "YouTube",         embedUrlBuilder: youtubeEmbedUrl, embedAutoAdvance: true },
  { service: "appleMusic",   label: "Apple Music" },
  { service: "youtubeMusic", label: "YouTube Music" },
  { service: "tidal",        label: "Tidal" },
  { service: "amazonMusic",  label: "Amazon Music" },
  { service: "deezer",       label: "Deezer" },
  { service: "soundcloud",   label: "SoundCloud" },
  { service: "pandora",      label: "Pandora" },
];

/**
 * Returns true when `service` is a known service that supports official iframe
 * embeds (i.e. has an `embedUrlBuilder` on its `GUIDED_SERVICE_OPTIONS` entry).
 * Unknown services — those not in `GuidedService` — are never embed-capable.
 */
export function serviceSupportsEmbed(service: string): boolean {
  return GUIDED_SERVICE_OPTIONS.some((o) => o.service === service && !!o.embedUrlBuilder);
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

function safeOfficialUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (
      !/(^|\.)bandcamp\.com$/i.test(parsed.hostname) &&
      !/(^|\.)youtube\.com$/i.test(parsed.hostname) &&
      !/(^|\.)youtu\.be$/i.test(parsed.hostname)
    ) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function officialSource(
  fact: OfficialEmbedFact,
  url: string | null,
  embedUrl: string | null,
): OfficialReplaySource | null {
  const safeUrl = safeOfficialUrl(url);
  const safeEmbedUrl = safeOfficialUrl(embedUrl);
  if (!safeUrl && !safeEmbedUrl) return null;
  return {
    provider: fact.provider,
    role: fact.role,
    rung: fact.rung,
    outcome: fact.outcome,
    url: safeUrl ?? safeEmbedUrl!,
    embedUrl: fact.outcome === "embedded" ? safeEmbedUrl : null,
    autoAdvance: fact.provider === "youtube" && fact.outcome === "embedded",
  };
}

/**
 * Selects only persisted, role-aware provider facts. General service links are
 * deliberately not consulted here: a provenance link must never be promoted
 * into a control-capable player by the client.
 */
export function getOfficialReplayDoors(
  entry: Pick<ReplayMappingEntry, "embedFacts"> | null | undefined,
): OfficialReplayDoors {
  const facts = entry?.embedFacts ?? [];
  const embedded = facts.filter(
    (fact) => fact.outcome === "embedded" && fact.rung <= 4,
  );
  const bandcampTrack = embedded.find(
    (fact) => fact.provider === "bandcamp" && fact.role === "provenance" && fact.embedUrl,
  );
  const controlEmbed = embedded.find(
    (fact) => fact.role === "control" && fact.embedUrl,
  );
  const currentFact =
    (bandcampTrack ? officialSource(bandcampTrack, bandcampTrack.sourceUrl, bandcampTrack.embedUrl) : null) ??
    (controlEmbed ? officialSource(controlEmbed, controlEmbed.sourceUrl, controlEmbed.embedUrl) : null) ??
    facts
      .filter((fact) => fact.outcome === "link_out" && fact.rung === 5)
      .map((fact) => officialSource(fact, fact.sourceUrl, null))
      .find(Boolean) ??
    null;

  const albumFact = facts.find(
    (fact) =>
      fact.provider === "bandcamp" &&
      fact.role === "provenance" &&
      !!fact.releaseMbid &&
      (fact.outcome === "embedded" || fact.outcome === "link_out") &&
      (fact.albumEmbedUrl || fact.sourceUrl),
  );
  const album = albumFact
    ? officialSource(albumFact, albumFact.sourceUrl, albumFact.albumEmbedUrl)
    : null;

  return { current: currentFact, album };
}

export function officialEmbedStatus(
  facts: OfficialEmbedFact[] | null | undefined,
): string {
  if (!facts?.length) return "No official embed result yet.";
  if (facts.some((fact) => fact.outcome === "embedded" && fact.embedUrl)) {
    return "Official embed available.";
  }
  if (facts.some((fact) => fact.outcome === "link_out" && fact.sourceUrl)) {
    return "Link-out only.";
  }
  if (facts.some((fact) => fact.outcome === "expired")) return "Official link expired.";
  if (facts.some((fact) => fact.outcome === "transient_failure")) {
    return "Official embed temporarily unavailable.";
  }
  return "No linkable release found.";
}

function sourceForLink(
  service: string,
  link: GuidedLink,
): GuidedReplaySource | null {
  if (link.kind !== "exact" || link.deadLink) return null;
  if (!link.url) return null;

  const option = GUIDED_SERVICE_OPTIONS.find((o) => o.service === service);

  if (option?.embedUrlBuilder) {
    // For youtube, the link may carry an externalId we can fall back to.
    const resolvedUrl =
      service === "youtube" && !link.url && link.externalId
        ? `https://youtu.be/${link.externalId}`
        : link.url;

    const embedUrl = option.embedUrlBuilder(resolvedUrl);
    if (embedUrl !== null) {
      return {
        service,
        url: link.url || resolvedUrl,
        embedUrl,
        autoAdvance: option.embedAutoAdvance ?? false,
        externalOnly: false,
      };
    }
    // Embed URL could not be built — validate the raw URL before allowing external open.
    const safeUrl = safeServiceUrl(service, resolvedUrl);
    if (!safeUrl) return null;
    return { service, url: safeUrl, embedUrl: null, autoAdvance: false, externalOnly: true };
  }

  // All other services (no embedUrlBuilder): external link only.
  const safeUrl = safeServiceUrl(service, link.url);
  if (!safeUrl) return null;
  return { service, url: safeUrl, embedUrl: null, autoAdvance: false, externalOnly: true };
}

function sourceForOfficialFact(
  service: string,
  fact: OfficialEmbedFact,
): GuidedReplaySource | null {
  if (service !== fact.provider || fact.outcome === "expired" || fact.outcome === "transient_failure") {
    return null;
  }
  const url = safeOfficialUrl(fact.sourceUrl) ?? safeOfficialUrl(fact.embedUrl);
  if (!url) return null;
  const embedUrl =
    fact.outcome === "embedded" ? safeOfficialUrl(fact.embedUrl) : null;
  return {
    service,
    url,
    embedUrl,
    autoAdvance: service === "youtube" && embedUrl != null && fact.role === "control",
    externalOnly: embedUrl == null,
  };
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
    const official = (entry.embedFacts ?? [])
      .filter((fact) => fact.provider === service)
      .sort((a, b) => a.rung - b.rung)
      .map((fact) => sourceForOfficialFact(service, fact))
      .find(Boolean) ?? null;
    const source = official ?? matching.map((link) => sourceForLink(service, link)).find(Boolean) ?? null;

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
  const result: Array<{ service: string; label: string }> = GUIDED_SERVICE_OPTIONS.map(
    ({ service, label }) => ({ service, label }),
  );

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
