import { useSyncExternalStore } from "react";

/**
 * Local-first persistence for the listener's own layer of Lore: the journal
 * (everything heard while listening) and follows (humans whose taste you
 * trust). Deliberately device-local — no accounts, nothing leaves the browser.
 */

/** One heard track. `mbid` null means the source never resolved it — still
 * worth remembering, honestly labeled. */
export interface JournalEntry {
  /** ISO timestamp of when it was heard (station's playedAt when known). */
  at: string;
  /** How it was heard: live radio, a segue trail, or a ghost-radio replay. */
  kind: "radio" | "trail" | "replay";
  mbid: string | null;
  /** MusicBrainz artist MBID, when resolved. Powers /artist/:mbid links. */
  artistMbid?: string | null;
  title: string;
  artist: string;
  artworkUrl: string | null;
  stationSlug?: string;
  stationName?: string;
  /** Attribution line for rides (replay label), when there's no station. */
  context?: string;
}

export interface FollowEntry {
  kind: "station" | "picker" | "dj";
  /**
   * Station slug, picker handle, or — for a DJ — `<stationSlug>::<djName>`
   * (DJs have no standalone identity yet; they're followed as "this person on
   * this station", and their feed is that station's runs filtered to them).
   */
  id: string;
  name: string;
  followedAt: string;
}

/** Compose/parse the device-local DJ follow id (`<stationSlug>::<djName>`). */
export function djFollowId(stationSlug: string, djName: string): string {
  return `${stationSlug}::${djName}`;
}

export function parseDjFollowId(
  id: string,
): { stationSlug: string; djName: string } | null {
  const sep = id.indexOf("::");
  if (sep <= 0 || sep + 2 >= id.length) return null;
  return { stationSlug: id.slice(0, sep), djName: id.slice(sep + 2) };
}

const JOURNAL_KEY = "lore:journal:v1";
const FOLLOWS_KEY = "lore:follows:v1";
const JOURNAL_CAP = 500;
/** The same track heard again within this window is one listen, not two. */
const DEDUP_WINDOW_MS = 30 * 60 * 1000;

function createStore<T>(key: string, fallback: T) {
  let cache: T | null = null;
  const listeners = new Set<() => void>();

  function read(): T {
    if (cache !== null) return cache;
    try {
      const raw = localStorage.getItem(key);
      cache = raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      cache = fallback;
    }
    return cache;
  }

  function write(next: T) {
    cache = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage full/blocked — keep the in-memory copy so the session works.
    }
    listeners.forEach((l) => l());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // Cross-tab sync: another tab's write invalidates our cache.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === key) {
        cache = null;
        listeners.forEach((l) => l());
      }
    });
  }

  return { read, write, subscribe };
}

const journalStore = createStore<JournalEntry[]>(JOURNAL_KEY, []);
const followsStore = createStore<FollowEntry[]>(FOLLOWS_KEY, []);

function sameIdentity(a: JournalEntry, b: JournalEntry): boolean {
  if (a.mbid && b.mbid) return a.mbid === b.mbid;
  return (
    a.title.toLowerCase() === b.title.toLowerCase() &&
    a.artist.toLowerCase() === b.artist.toLowerCase()
  );
}

/**
 * Append a heard track (newest first). Polling and status flaps re-report the
 * same track, so an entry matching the newest one within the dedup window is
 * the same listen and gets skipped. Hearing the song again later logs again.
 */
export function appendJournal(entry: JournalEntry): void {
  const entries = journalStore.read();
  const newest = entries[0];
  if (newest && sameIdentity(newest, entry)) {
    const gap = Math.abs(
      new Date(entry.at).getTime() - new Date(newest.at).getTime(),
    );
    if (Number.isNaN(gap) || gap < DEDUP_WINDOW_MS) return;
  }
  journalStore.write([entry, ...entries].slice(0, JOURNAL_CAP));
}

export function clearJournal(): void {
  journalStore.write([]);
}

/** Newest-first list of everything heard on this device. */
export function useJournal(): JournalEntry[] {
  return useSyncExternalStore(journalStore.subscribe, journalStore.read);
}

export function useFollows(): FollowEntry[] {
  return useSyncExternalStore(followsStore.subscribe, followsStore.read);
}

export function isFollowed(
  follows: FollowEntry[],
  kind: FollowEntry["kind"],
  id: string,
): boolean {
  return follows.some((f) => f.kind === kind && f.id === id);
}

export function toggleFollow(
  kind: FollowEntry["kind"],
  id: string,
  name: string,
): void {
  const follows = followsStore.read();
  if (isFollowed(follows, kind, id)) {
    followsStore.write(follows.filter((f) => !(f.kind === kind && f.id === id)));
  } else {
    followsStore.write([
      { kind, id, name, followedAt: new Date().toISOString() },
      ...follows,
    ]);
  }
}
