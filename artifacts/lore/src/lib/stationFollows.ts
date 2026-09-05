/**
 * Listener follows are deliberately separate from editorial favorites and the
 * music Library. They live only on this device.
 */
export const STATION_FOLLOWS_LS_KEY = "lore:stationFollows";
const LEGACY_PINS_LS_KEY = "lore:dialPins";
const ADDED_STATIONS_LS_KEY = "lore_added_stations";

export interface StationFollowRecord {
  version: 1;
  slugs: string[];
}

let cache: Set<string> | null = null;
const listeners = new Set<() => void>();

export function stationFollowIdentity(slug: string): string | null {
  const value = slug.trim().toLowerCase();
  return value ? value : null;
}

function parse(raw: string | null, allowLegacyArray = false): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    const slugs = allowLegacyArray && Array.isArray(value)
      ? value
      : value
        && typeof value === "object"
        && (value as StationFollowRecord).version === 1
        && Array.isArray((value as StationFollowRecord).slugs)
        ? (value as StationFollowRecord).slugs
        : [];
    return new Set(slugs.filter((slug): slug is string => typeof slug === "string")
      .map(stationFollowIdentity).filter((slug): slug is string => Boolean(slug)));
  } catch {
    return new Set();
  }
}

function readLegacyAddedStationFollows(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ADDED_STATIONS_LS_KEY) ?? "[]");
    if (!Array.isArray(value)) return new Set();
    return new Set(value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const uuid = (entry as { radioBrowserUuid?: unknown }).radioBrowserUuid;
      return typeof uuid === "string" && uuid.trim()
        ? [`rb-${uuid.trim().toLowerCase()}`]
        : [];
    }));
  } catch {
    return new Set();
  }
}

export function readStationFollows(): Set<string> {
  if (cache) return cache;
  try {
    const current = localStorage.getItem(STATION_FOLLOWS_LS_KEY);
    if (current !== null) {
      cache = parse(current);
    } else {
      // Adopt both former dial pins and existing personal stations so returning
      // listeners do not lose their previously expressed station intent.
      cache = parse(localStorage.getItem(LEGACY_PINS_LS_KEY), true);
      for (const slug of readLegacyAddedStationFollows()) cache.add(slug);
      if (cache.size > 0) {
        const record: StationFollowRecord = { version: 1, slugs: [...cache] };
        localStorage.setItem(STATION_FOLLOWS_LS_KEY, JSON.stringify(record));
      }
    }
  } catch {
    cache = new Set();
  }
  return cache;
}

function write(next: Set<string>): void {
  cache = next;
  const record: StationFollowRecord = { version: 1, slugs: [...next] };
  try {
    localStorage.setItem(STATION_FOLLOWS_LS_KEY, JSON.stringify(record));
  } catch {
    // The in-memory state remains usable when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function followStation(slug: string): void {
  const identity = stationFollowIdentity(slug);
  if (!identity || readStationFollows().has(identity)) return;
  write(new Set([...readStationFollows(), identity]));
}

export function unfollowStation(slug: string): void {
  const identity = stationFollowIdentity(slug);
  if (!identity || !readStationFollows().has(identity)) return;
  const next = new Set(readStationFollows());
  next.delete(identity);
  write(next);
}

export function toggleStationFollow(slug: string): void {
  if (readStationFollows().has(stationFollowIdentity(slug) ?? "")) unfollowStation(slug);
  else followStation(slug);
}

export function subscribeStationFollows(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== null
      && event.key !== STATION_FOLLOWS_LS_KEY
      && event.key !== LEGACY_PINS_LS_KEY
      && event.key !== ADDED_STATIONS_LS_KEY
    ) return;
    cache = null;
    callback();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function __testOnlyResetStationFollows(): void {
  cache = null;
}