/**
 * addedStations — the listener's personal station list, pinned via the
 * Station Finder. Device-local only (localStorage "lore_added_stations"),
 * same local-first design as the journal/follows stores: no account, no
 * server writes, nothing leaves the device.
 *
 * The store is a tiny module-level external store (useSyncExternalStore
 * binding lives in hooks/useAddedStations.ts) so every mounted consumer —
 * the Finder sheet, useDialData, future surfaces — shares ONE source of
 * truth and updates together.
 *
 * Personal stations are adapted into the generated `Station` shape via
 * addedStationToStation() so they flow through the same Dial/SplitHome row
 * pipeline as curated stations. They carry:
 *   - slug `rb-<radioBrowserUuid>` (never collides with curated slugs; the
 *     scan-skip preference in dialFilterState keys off slug, so skips work
 *     unchanged for personal stations)
 *   - a stable NEGATIVE numeric id derived from the uuid (never collides
 *     with server serial ids; callers must not send negative ids to
 *     server-backed per-station endpoints)
 *   - stationCategories derived from Radio Browser tags via categoryForTags
 *     ([] when nothing maps — such stations appear only when no category
 *     filter is active)
 */
import type { Station } from "@workspace/api-client-react";
import { categoryForTags } from "./dialCategories";

export const ADDED_STATIONS_LS_KEY = "lore_added_stations";
export const PERSONAL_STATION_SLUG_PREFIX = "rb-";

export interface AddedStation {
  /** Radio Browser stationuuid — the dedup identity. */
  radioBrowserUuid: string;
  name: string;
  /** Resolved stream URL (Radio Browser url_resolved, falling back to url). */
  streamUrl: string;
  /** Playback hint derived from the codec — see streamFormatForCodec. */
  streamFormat: string;
  faviconUrl: string | null;
  /** Radio Browser "state" (region/province); the API has no city field. */
  state: string | null;
  country: string | null;
  tags: string[];
  bitrate: number | null;
  codec: string | null;
  /** ISO timestamp of when the listener pinned the station. */
  addedAt: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let cache: AddedStation[] | null = null;
const listeners = new Set<() => void>();

function isValidEntry(v: unknown): v is AddedStation {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.radioBrowserUuid === "string" && s.radioBrowserUuid.length > 0 &&
    typeof s.name === "string" && s.name.length > 0 &&
    typeof s.streamUrl === "string" && s.streamUrl.length > 0 &&
    typeof s.streamFormat === "string" &&
    Array.isArray(s.tags)
  );
}

/** Current snapshot. Cached — the returned array reference is stable until
 *  the next write, which is what useSyncExternalStore requires. */
export function readAddedStations(): AddedStation[] {
  if (cache !== null) return cache;
  let next: AddedStation[] = [];
  try {
    const raw = localStorage.getItem(ADDED_STATIONS_LS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) next = parsed.filter(isValidEntry);
    }
  } catch {
    // Corrupted JSON or unavailable storage — start clean rather than crash.
    next = [];
  }
  cache = next;
  return next;
}

function writeAddedStations(next: AddedStation[]): void {
  cache = next;
  try {
    localStorage.setItem(ADDED_STATIONS_LS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode / quota) — the in-memory list
    // still updates; it just won't survive a reload.
  }
  for (const l of listeners) l();
}

/** Add a station, deduplicating by Radio Browser uuid. No-op when present. */
export function addAddedStation(station: AddedStation): AddedStation[] {
  const current = readAddedStations();
  if (current.some((s) => s.radioBrowserUuid === station.radioBrowserUuid)) {
    return current;
  }
  const next = [...current, station];
  writeAddedStations(next);
  return next;
}

/** Remove a station by Radio Browser uuid. No-op when absent. */
export function removeAddedStation(uuid: string): AddedStation[] {
  const current = readAddedStations();
  if (!current.some((s) => s.radioBrowserUuid === uuid)) return current;
  const next = current.filter((s) => s.radioBrowserUuid !== uuid);
  writeAddedStations(next);
  return next;
}

/** useSyncExternalStore subscribe: same-tab writes + cross-tab storage events. */
export function subscribeAddedStations(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== ADDED_STATIONS_LS_KEY) return;
    cache = null; // another tab wrote — re-read on next snapshot
    cb();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/** Tests only: drop the cached snapshot so the next read hits localStorage. */
export function __testOnlyResetAddedStations(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Station adaptation
// ---------------------------------------------------------------------------

export function personalStationSlug(uuid: string): string {
  return `${PERSONAL_STATION_SLUG_PREFIX}${uuid}`;
}

/** Stable negative numeric id — never collides with server serial ids. */
function personalStationNumericId(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    hash = (hash * 31 + uuid.charCodeAt(i)) | 0;
  }
  return -(Math.abs(hash) % 1_000_000_000) - 1;
}

/** Map a Radio Browser codec to the player's stream-format hint. */
export function streamFormatForCodec(codec: string | null | undefined, url: string): string {
  if (/\.m3u8(\?|#|$)/i.test(url)) return "hls";
  switch ((codec ?? "").trim().toLowerCase()) {
    case "aac":
    case "aac+":
    case "aacplus":
    case "he-aac":
    case "heaac":
      return "aac";
    case "flac":
      return "flac";
    case "ogg":
    case "opus":
    case "vorbis":
      return "ogg";
    case "mp3":
    case "mp2":
    case "mpeg":
    default:
      return "mp3";
  }
}

/** Human quality badge, e.g. "128kbps MP3"; null when nothing is known. */
export function qualityLabel(bitrate: number | null, codec: string | null): string | null {
  const parts: string[] = [];
  if (bitrate != null && bitrate > 0) parts.push(`${bitrate}kbps`);
  if (codec) parts.push(codec.toUpperCase());
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Adapt a pinned station into the generated Station shape so it can flow
 * through the same dial/scan pipeline as curated stations. Fields a personal
 * station can't honestly have (schedule counts, quality tier, discovery
 * score, relay) are null/zero — the UI degrades on those already.
 */
export function addedStationToStation(s: AddedStation): Station {
  return {
    id: personalStationNumericId(s.radioBrowserUuid),
    slug: personalStationSlug(s.radioBrowserUuid),
    name: s.name,
    org: null,
    city: null,
    region: s.state,
    country: s.country,
    streamUrl: s.streamUrl,
    streamQuality: qualityLabel(s.bitrate, s.codec),
    streamFormat: s.streamFormat,
    mode: "live",
    homepageUrl: null,
    donateUrl: null,
    logoUrl: s.faviconUrl,
    attribution: true,
    tags: s.tags.length > 0 ? [...s.tags] : null,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    discoveryScore: null,
    homepageBlurb: null,
    upcomingShowCount: 0,
    tier: null,
    qualityTier: null,
    automationClass: null,
    ianaTimezone: null,
    relayUrl: null,
    stationCategories: categoryForTags(s.tags),
  };
}
