import type { ReplayManifest } from "./replay.js";

export type GuidedQueueTargetKind = "native" | "web";

export type GuidedQueueMissingReason =
  | "not_mapped"
  | "dead_mapping"
  | "not_exact"
  | "unusable_mapping";

export interface GuidedQueueTarget {
  kind: GuidedQueueTargetKind;
  url: string;
  externalId: string | null;
  /** Canonical HTTPS target retained for devices without the native app. */
  fallbackUrl?: string;
}

export interface GuidedQueueEntry {
  position: number;
  spinId: number;
  playedAt: string;
  recordingMbid: string | null;
  title: string;
  artist: string;
  provenance: {
    source: string | null;
    citation: string | null;
  };
  target: GuidedQueueTarget | null;
  missingReason: GuidedQueueMissingReason | null;
}

export interface GuidedQueueService {
  service: string;
  label: string;
  available: number;
  total: number;
}

export interface GuidedReplayQueue {
  replayId: number;
  service: string;
  serviceLabel: string;
  services: GuidedQueueService[];
  coverage: {
    total: number;
    available: number;
    missing: number;
  };
  entries: GuidedQueueEntry[];
}

const SERVICE_LABELS: Record<string, string> = {
  spotify: "Spotify",
  apple_music: "Apple Music",
  youtube: "YouTube",
  youtube_music: "YouTube Music",
  tidal: "Tidal",
  amazon_music: "Amazon Music",
  deezer: "Deezer",
  soundcloud: "SoundCloud",
  pandora: "Pandora",
};

const SERVICE_HOSTS: Record<string, RegExp> = {
  spotify: /(^|\.)open\.spotify\.com$/i,
  apple_music: /(^|\.)music\.apple\.com$/i,
  youtube: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i,
  youtube_music: /(^|\.)music\.youtube\.com$/i,
  tidal: /(^|\.)tidal\.com$/i,
  amazon_music: /(^|\.)music\.amazon\.(com|co\.uk|de|fr|ca|jp)$/i,
  deezer: /(^|\.)deezer\.com$/i,
  soundcloud: /(^|\.)soundcloud\.com$/i,
  pandora: /(^|\.)pandora\.com$/i,
};

function labelFor(service: string): string {
  return SERVICE_LABELS[service] ?? service.replace(/_/g, " ");
}

function safeWebUrl(service: string, rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" || !SERVICE_HOSTS[service]?.test(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function spotifyNativeUrl(service: string, externalId: string | null): string | null {
  if (service !== "spotify" || !externalId || !/^[A-Za-z0-9]{22}$/.test(externalId)) {
    return null;
  }
  return `spotify:track:${externalId}`;
}

type ServiceMap = {
  recordingMbid: string;
  service: string;
  externalId: string | null;
  url: string;
  confidence: string;
  deadLink: boolean;
};

type MaterializerEntry = {
  position: number;
  spinId: number;
  playedAt: string;
  source: string | null;
  citation: string | null;
  rawArtist: string;
  rawTitle: string;
  recording: {
    mbid: string;
    title: string;
    artist: string;
    links?: unknown;
  } | null;
};

/**
 * Pure queue materializer. The manifest remains the source of order and
 * provenance; maps only decide whether an entry gets a safe link-out target.
 */
export function materializeGuidedReplayQueue(input: {
  manifest: Pick<ReplayManifest, "replayId" | "entries">;
  service: string;
  maps: ServiceMap[];
}): GuidedReplayQueue {
  const entries = input.manifest.entries.map((entry: MaterializerEntry) => {
    const map = entry.recording
      ? input.maps.find(
          (candidate) =>
            candidate.recordingMbid === entry.recording?.mbid &&
            candidate.service === input.service,
        )
      : undefined;
    let target: GuidedQueueTarget | null = null;
    let missingReason: GuidedQueueMissingReason | null = null;

    if (!entry.recording) {
      missingReason = "not_mapped";
    } else if (!map) {
      missingReason = "not_mapped";
    } else if (map.deadLink) {
      missingReason = "dead_mapping";
    } else if (map.confidence !== "exact") {
      missingReason = "not_exact";
    } else {
      const nativeUrl = spotifyNativeUrl(input.service, map.externalId);
      const webUrl = safeWebUrl(input.service, map.url);
      if (nativeUrl) {
        target = {
          kind: "native",
          url: nativeUrl,
          externalId: map.externalId,
          ...(webUrl ? { fallbackUrl: webUrl } : {}),
        };
      } else if (webUrl) {
        target = { kind: "web", url: webUrl, externalId: map.externalId };
      } else {
        missingReason = "unusable_mapping";
      }
    }

    return {
      position: entry.position,
      spinId: entry.spinId,
      playedAt: entry.playedAt,
      recordingMbid: entry.recording?.mbid ?? null,
      title: entry.recording?.title ?? entry.rawTitle,
      artist: entry.recording?.artist ?? entry.rawArtist,
      provenance: { source: entry.source, citation: entry.citation },
      target,
      missingReason,
    };
  });

  const available = entries.filter((entry) => entry.target != null).length;
  return {
    replayId: input.manifest.replayId,
    service: input.service,
    serviceLabel: labelFor(input.service),
    services: [],
    coverage: {
      total: entries.length,
      available,
      missing: entries.length - available,
    },
    entries,
  };
}

export function guidedServiceLabel(service: string): string {
  return labelFor(service);
}