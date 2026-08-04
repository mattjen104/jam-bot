import type { RecordingLink, Station } from "@workspace/api-client-react";
import { useEffect, useState } from "react";

export const SECTION_MEMORY_STORAGE_KEY = "lore:record-peek-memory";
export const SECTION_MEMORY_VERSION = 1;
const MAX_QUEUE_LENGTH = 80;

export interface StoredRideSeed {
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  links: RecordingLink[];
}

export interface StoredStation {
  id: number;
  slug: string;
  name: string;
  streamUrl: string;
  streamFormat: string;
  logoUrl: string | null;
}

export interface RadioLastTrack {
  artworkUrl: string | null;
  title: string;
  artist: string;
  mbid: string | null;
}

export interface RadioSectionMemory {
  kind: "radio";
  station: StoredStation;
  /** The last resolved now-playing track while tuned to this station. */
  lastTrack?: RadioLastTrack | null;
}

export interface SelectorSectionMemory {
  kind: "selectors";
  label: string;
  queue: StoredRideSeed[];
  orientation: "past" | "curated";
  index: number;
}

export interface LibrarySectionMemory {
  kind: "library";
  track: StoredRideSeed;
  album: {
    mbid: string;
    title: string;
    artworkUrl: string | null;
  };
  /** MBID used by the album-tracks endpoint to reload the complete album. */
  albumLookupMbid: string;
  /** A fallback item is a kept song, not an explicit Library play. */
  fallback?: boolean;
}

export interface SectionMemory {
  version: 1;
  radio: RadioSectionMemory | null;
  selectors: SelectorSectionMemory | null;
  library: LibrarySectionMemory | null;
}

function blankMemory(): SectionMemory {
  return { version: SECTION_MEMORY_VERSION, radio: null, selectors: null, library: null };
}

function stringValue(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function seedFromUnknown(value: unknown): StoredRideSeed | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const mbid = stringValue(raw.mbid, 100);
  const title = stringValue(raw.title);
  const artist = stringValue(raw.artist);
  if (!mbid || !title || !artist) return null;
  const artworkUrl = raw.artworkUrl == null ? null : stringValue(raw.artworkUrl, 2000);
  const links = Array.isArray(raw.links) ? raw.links.filter((link): link is RecordingLink => (
    !!link && typeof link === "object" &&
    typeof (link as Record<string, unknown>).url === "string" &&
    typeof (link as Record<string, unknown>).name === "string"
  )).slice(0, 12) : [];
  return { mbid, title, artist, artworkUrl, links };
}

function readValue(raw: unknown): SectionMemory {
  if (!raw || typeof raw !== "object") return blankMemory();
  const value = raw as Record<string, unknown>;
  if (value.version !== SECTION_MEMORY_VERSION) return blankMemory();
  const memory = blankMemory();

  const radio = value.radio;
  if (radio && typeof radio === "object") {
    const station = (radio as Record<string, unknown>).station;
    if (station && typeof station === "object") {
      const s = station as Record<string, unknown>;
      const id = typeof s.id === "number" && Number.isSafeInteger(s.id) ? s.id : null;
      const slug = stringValue(s.slug, 200);
      const name = stringValue(s.name);
      const streamUrl = stringValue(s.streamUrl, 4000);
      const streamFormat = stringValue(s.streamFormat, 40);
      if (id != null && slug && name && streamUrl && streamFormat) {
        const rawLastTrack = (radio as Record<string, unknown>).lastTrack;
        let lastTrack: RadioLastTrack | null = null;
        if (rawLastTrack && typeof rawLastTrack === "object") {
          const lt = rawLastTrack as Record<string, unknown>;
          const ltTitle = stringValue(lt.title);
          const ltArtist = stringValue(lt.artist);
          if (ltTitle && ltArtist) {
            lastTrack = {
              artworkUrl: lt.artworkUrl == null ? null : stringValue(lt.artworkUrl, 4000),
              title: ltTitle,
              artist: ltArtist,
              mbid: lt.mbid == null ? null : stringValue(lt.mbid, 100),
            };
          }
        }
        memory.radio = {
          kind: "radio",
          station: {
            id, slug, name, streamUrl, streamFormat,
            logoUrl: s.logoUrl == null ? null : stringValue(s.logoUrl, 4000),
          },
          lastTrack,
        };
      }
    }
  }

  const selectors = value.selectors;
  if (selectors && typeof selectors === "object") {
    const s = selectors as Record<string, unknown>;
    const queue = Array.isArray(s.queue)
      ? s.queue.map(seedFromUnknown).filter((seed): seed is StoredRideSeed => seed != null).slice(0, MAX_QUEUE_LENGTH)
      : [];
    const index = typeof s.index === "number" && Number.isInteger(s.index) ? s.index : -1;
    const orientation = s.orientation === "past" || s.orientation === "curated" ? s.orientation : null;
    const label = stringValue(s.label);
    if (queue.length > 0 && index >= 0 && index < queue.length && orientation && label) {
      memory.selectors = { kind: "selectors", label, queue, orientation, index };
    }
  }

  const library = value.library;
  if (library && typeof library === "object") {
    const l = library as Record<string, unknown>;
    const track = seedFromUnknown(l.track);
    const album = l.album;
    const albumLookupMbid = stringValue(l.albumLookupMbid, 100);
    if (track && album && typeof album === "object" && albumLookupMbid) {
      const a = album as Record<string, unknown>;
      const mbid = stringValue(a.mbid, 100);
      const title = stringValue(a.title);
      if (mbid && title) {
        memory.library = {
          kind: "library",
          track,
          album: {
            mbid,
            title,
            artworkUrl: a.artworkUrl == null ? null : stringValue(a.artworkUrl, 4000),
          },
          albumLookupMbid,
          fallback: l.fallback === true,
        };
      }
    }
  }
  return memory;
}

export function readSectionMemory(): SectionMemory {
  try {
    if (typeof localStorage === "undefined") return blankMemory();
    const raw = localStorage.getItem(SECTION_MEMORY_STORAGE_KEY);
    return raw ? readValue(JSON.parse(raw)) : blankMemory();
  } catch {
    return blankMemory();
  }
}

function writeMemory(memory: SectionMemory): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SECTION_MEMORY_STORAGE_KEY, JSON.stringify(memory));
      window.dispatchEvent(new CustomEvent("lore:section-memory"));
    }
  } catch {
    // Local-only memory is disposable when storage is unavailable.
  }
}

export function writeRadioSectionMemory(station: Station): void {
  const memory = readSectionMemory();
  memory.radio = {
    kind: "radio",
    station: {
      id: station.id,
      slug: station.slug,
      name: station.name,
      streamUrl: station.streamUrl,
      streamFormat: station.streamFormat,
      logoUrl: station.logoUrl ?? null,
    },
    // Preserve any lastTrack already recorded for this station.
    lastTrack: memory.radio?.station.slug === station.slug
      ? (memory.radio?.lastTrack ?? null)
      : null,
  };
  writeMemory(memory);
}

/** Update the last resolved now-playing track for the current radio session. */
export function writeRadioLastTrack(track: RadioLastTrack): void {
  const memory = readSectionMemory();
  if (!memory.radio) return; // only meaningful while a station is stored
  memory.radio = { ...memory.radio, lastTrack: track };
  writeMemory(memory);
}

export function writeSelectorSectionMemory(
  queue: StoredRideSeed[],
  label: string,
  orientation: "past" | "curated",
  index: number,
): void {
  if (!queue.length || !label || index < 0 || index >= queue.length) return;
  const memory = readSectionMemory();
  memory.selectors = {
    kind: "selectors",
    queue: queue.slice(0, MAX_QUEUE_LENGTH),
    label,
    orientation,
    index: Math.min(index, Math.max(0, Math.min(queue.length, MAX_QUEUE_LENGTH) - 1)),
  };
  writeMemory(memory);
}

export function writeLibrarySectionMemory(
  track: StoredRideSeed,
  album: LibrarySectionMemory["album"],
  albumLookupMbid: string,
  fallback = false,
): void {
  if (!track.mbid || !albumLookupMbid) return;
  const memory = readSectionMemory();
  memory.library = { kind: "library", track, album, albumLookupMbid, fallback };
  writeMemory(memory);
}

export function writeLibraryFallbackIfAbsent(
  track: StoredRideSeed,
  album: LibrarySectionMemory["album"],
  albumLookupMbid: string,
): void {
  const current = readSectionMemory().library;
  if (current && !current.fallback) return;
  writeLibrarySectionMemory(track, album, albumLookupMbid, true);
}

export function useSectionMemory(): SectionMemory {
  // This hook intentionally uses a tiny external-event bridge rather than
  // putting resume state in the player: each section remains independently
  // persisted and anonymous.
  const [memory, setMemory] = useState<SectionMemory>(readSectionMemory);
  useEffect(() => {
    const refresh = () => setMemory(readSectionMemory());
    window.addEventListener("lore:section-memory", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("lore:section-memory", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return memory;
}