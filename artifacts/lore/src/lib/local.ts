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
  /** How it was heard: live radio, a segue trail, a ghost-radio replay, or
   *  a track played directly in Spotify (synced from listening history). */
  kind: "radio" | "trail" | "replay" | "spotify";
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

const JOURNAL_KEY = "lore:journal:v1";
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
 *
 * Icecast fallback tracks are first logged as raw text (mbid: null) before
 * the async MusicBrainz resolution completes. When a resolved report for the
 * same identity arrives within the dedup window, upgrade the existing entry
 * in place (fill in mbid/artistMbid/artworkUrl) rather than skipping it,
 * otherwise the journal would keep the unresolved entry forever.
 */
export function appendJournal(entry: JournalEntry): void {
  const entries = journalStore.read();
  const newest = entries[0];
  if (newest && sameIdentity(newest, entry)) {
    const gap = Math.abs(
      new Date(entry.at).getTime() - new Date(newest.at).getTime(),
    );
    if (Number.isNaN(gap) || gap < DEDUP_WINDOW_MS) {
      if (!newest.mbid && entry.mbid) {
        journalStore.write([
          {
            ...newest,
            mbid: entry.mbid,
            artistMbid: entry.artistMbid ?? newest.artistMbid,
            artworkUrl: entry.artworkUrl ?? newest.artworkUrl,
            title: entry.title,
            artist: entry.artist,
          },
          ...entries.slice(1),
        ]);
      }
      return;
    }
  }
  journalStore.write([entry, ...entries].slice(0, JOURNAL_CAP));
}

/**
 * Check whether any entry in the full journal matches the given track identity
 * within the 30-minute dedup window centred on `at`.
 *
 * Unlike appendJournal's dedup (which only looks at entries[0]), this scans
 * the entire journal. Used by bulk ingestion paths (e.g. Spotify history sync)
 * where tracks are not necessarily written newest-first, so entries[0] may not
 * be the right comparison target.
 */
export function journalHasRecentEntry(
  title: string,
  artist: string,
  mbid: string | null,
  at: string,
): boolean {
  const atMs = new Date(at).getTime();
  if (Number.isNaN(atMs)) return false;
  const titleLc = title.toLowerCase();
  const artistLc = artist.toLowerCase();
  return journalStore.read().some((e) => {
    const gap = Math.abs(new Date(e.at).getTime() - atMs);
    if (Number.isNaN(gap) || gap >= DEDUP_WINDOW_MS) return false;
    if (mbid && e.mbid) return mbid === e.mbid;
    return (
      e.title.toLowerCase() === titleLc &&
      e.artist.toLowerCase() === artistLc
    );
  });
}

/**
 * Patch an existing journal entry by exact timestamp + text identity.
 * Used by the Spotify history sync to fill in an MBID after async resolution
 * without the risk of inserting a duplicate (which would happen if we called
 * appendJournal, since that only deduplicates against the *newest* entry).
 *
 * Scans the full journal for an entry whose `at` matches exactly and whose
 * title+artist match case-insensitively. The first match that still has
 * mbid: null is upgraded in-place. No-ops if no such entry is found.
 */
export function patchJournalEntry(
  at: string,
  title: string,
  artist: string,
  mbid: string,
  artistMbid: string | null,
  artworkUrl?: string | null,
): void {
  const entries = journalStore.read();
  const titleLc = title.toLowerCase();
  const artistLc = artist.toLowerCase();
  const idx = entries.findIndex(
    (e) =>
      e.at === at &&
      !e.mbid &&
      e.title.toLowerCase() === titleLc &&
      e.artist.toLowerCase() === artistLc,
  );
  if (idx === -1) return;
  const updated = [...entries];
  updated[idx] = {
    ...updated[idx],
    mbid,
    artistMbid: artistMbid ?? updated[idx].artistMbid ?? null,
    artworkUrl: artworkUrl ?? updated[idx].artworkUrl ?? null,
  };
  journalStore.write(updated);
}

export function clearJournal(): void {
  journalStore.write([]);
}

/** Newest-first list of everything heard on this device. */
export function useJournal(): JournalEntry[] {
  return useSyncExternalStore(journalStore.subscribe, journalStore.read);
}

// ---------------------------------------------------------------------------
// DJ follow IDs — a stable compound key for a (station, DJ name) pair stored
// in the local follows list.  Uses the double-colon separator so the DJ name
// can contain a single colon (e.g. "DJ :: Weirdo") without ambiguity.
// ---------------------------------------------------------------------------

const DJ_FOLLOW_SEP = "::";

/** Encode a (stationSlug, djName) pair into a stable string key. */
export function djFollowId(stationSlug: string, djName: string): string {
  return `${stationSlug}${DJ_FOLLOW_SEP}${djName}`;
}

/** Decode a follow-id string.  Returns null for any malformed value. */
export function parseDjFollowId(
  id: string,
): { stationSlug: string; djName: string } | null {
  const idx = id.indexOf(DJ_FOLLOW_SEP);
  if (idx <= 0) return null;                     // missing or leading separator
  const stationSlug = id.slice(0, idx);
  const djName = id.slice(idx + DJ_FOLLOW_SEP.length);
  if (!djName) return null;                       // trailing separator
  return { stationSlug, djName };
}

