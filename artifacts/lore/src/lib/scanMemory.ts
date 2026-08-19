/**
 * Scan memory — the listener's local-first record of what they've already
 * scanned, in the spirit of the journal/follows layer: localStorage only, no
 * accounts, nothing leaves the browser.
 *
 * Two kinds of memory:
 *
 * 1. Live freshness (`live`): when a station scan samples a station, we
 *    remember the identity of the song that was playing. On later scans a
 *    station still on that same song is "unchanged since your last scan" —
 *    an indicator only; it never blocks scanning.
 *
 * 2. Set-scanner progress (`sets`): per station + run, which track indexes
 *    have been previewed. The scanner resumes at the first unscanned track
 *    after the furthest scanned one (forward-biased — the listener can still
 *    jump back freely), and pager buttons mark fully-scanned pages. When the
 *    station has a NEWER completed run than the remembered one, the progress
 *    is stale and the scanner starts the new set from the top.
 *
 * Bounded: oldest entries are evicted past the caps so the store never grows
 * unchecked.
 */

import { useSyncExternalStore } from "react";

const LS_KEY = "lore:scanMemory:v1";
/** Remembered live-scan identities, one per station. */
const LIVE_CAP = 100;
/** Remembered set-scanner progress, one per station. */
const SETS_CAP = 40;
/**
 * Max track indexes remembered per set. Sets are realistically a few hundred
 * tracks; this hard bound keeps localStorage growth capped no matter what the
 * API returns. Past the cap, new indexes are dropped — resume stays correct
 * for everything already recorded.
 */
const SCANNED_CAP = 1000;

export interface LiveScanEntry {
  /** Spin identity — see liveScanIdentity. */
  id: string;
  /** ISO timestamp of when the scan sampled the station. */
  at: string;
}

export interface SetScanEntry {
  /** The run this progress belongs to. A newer run invalidates the entry. */
  runId: number;
  /** Track indexes (0-based, broadcast order) whose preview was played. */
  scanned: number[];
  /** ISO timestamp of the last scanner activity. */
  at: string;
}

export interface ScanMemory {
  live: Record<string, LiveScanEntry>;
  sets: Record<string, SetScanEntry>;
}

const EMPTY: ScanMemory = { live: {}, sets: {} };

// ── store (mirrors the createStore pattern in lib/local.ts) ────────────────

let cache: ScanMemory | null = null;
const listeners = new Set<() => void>();

function read(): ScanMemory {
  if (cache !== null) return cache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ScanMemory>) : null;
    cache = {
      live: parsed?.live && typeof parsed.live === "object" ? parsed.live : {},
      sets: parsed?.sets && typeof parsed.sets === "object" ? parsed.sets : {},
    };
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: ScanMemory): void {
  cache = next;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // Storage full/blocked — keep the in-memory copy so the session works.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Cross-tab sync: another tab's write invalidates our cache.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === LS_KEY) {
      cache = null;
      listeners.forEach((l) => l());
    }
  });
}

/** Oldest-first eviction: drop entries with the oldest `at` past the cap. */
function evictOldest<T extends { at: string }>(rec: Record<string, T>, cap: number): Record<string, T> {
  const keys = Object.keys(rec);
  if (keys.length <= cap) return rec;
  const byAge = keys.sort((a, b) => rec[a]!.at.localeCompare(rec[b]!.at));
  const next = { ...rec };
  for (const k of byAge.slice(0, keys.length - cap)) delete next[k];
  return next;
}

// ── live scan freshness ────────────────────────────────────────────────────

/**
 * The identity of what a station is playing, for "same song as last scan"
 * comparisons. Prefers the recording MBID; falls back to artist+title text;
 * includes playedAt so a later REPLAY of the same song counts as fresh.
 * Null when there is nothing usable to remember.
 */
export function liveScanIdentity(track: {
  mbid?: string | null;
  artist?: string | null;
  title?: string | null;
  playedAt?: string | null;
} | null | undefined): string | null {
  if (!track) return null;
  const base = track.mbid
    ? `mbid:${track.mbid}`
    : track.artist && track.title
      ? `text:${track.artist.trim().toLowerCase()}|${track.title.trim().toLowerCase()}`
      : null;
  if (!base) return null;
  return track.playedAt ? `${base}@${track.playedAt}` : base;
}

/** Record that a station scan sampled `slug` while `identity` was playing. */
export function recordLiveScan(slug: string, identity: string | null): void {
  if (!slug || !identity) return;
  const mem = read();
  const live = evictOldest(
    { ...mem.live, [slug]: { id: identity, at: new Date().toISOString() } },
    LIVE_CAP,
  );
  write({ ...mem, live });
}

/** True when the station is still playing whatever the last scan sampled. */
export function isUnchangedSinceLastScan(
  slug: string,
  currentIdentity: string | null,
): boolean {
  if (!currentIdentity) return false;
  return read().live[slug]?.id === currentIdentity;
}

// ── set-scanner progress ───────────────────────────────────────────────────

/**
 * Record that the listener previewed track `index` of station `slug`'s run
 * `runId`. A different runId than the remembered one means the remembered set
 * is stale — the entry is replaced (progress does not carry across sets).
 */
export function recordSetScan(slug: string, runId: number, index: number): void {
  if (!slug || !Number.isInteger(runId) || !Number.isInteger(index) || index < 0) return;
  const mem = read();
  const prev = mem.sets[slug];
  const scanned = prev && prev.runId === runId ? prev.scanned : [];
  const nextScanned = scanned.includes(index)
    ? scanned
    : scanned.length >= SCANNED_CAP
      ? scanned
      : [...scanned, index].sort((a, b) => a - b);
  const sets = evictOldest(
    {
      ...mem.sets,
      [slug]: { runId, scanned: nextScanned, at: new Date().toISOString() },
    },
    SETS_CAP,
  );
  write({ ...mem, sets });
}

export interface SetScanProgress {
  /** Track indexes already previewed in this run. */
  scanned: number[];
  /**
   * Forward-biased resume point: the first unscanned track after the
   * furthest scanned one, clamped into the set. 0 when nothing was scanned.
   */
  resumeIndex: number;
}

/**
 * Progress for the CURRENT run of a station, or null when there is none or
 * the remembered progress belongs to an older (stale) set.
 */
export function getSetScanProgress(
  slug: string,
  runId: number,
  trackCount: number,
): SetScanProgress | null {
  const entry = read().sets[slug];
  if (!entry || entry.runId !== runId || trackCount <= 0) return null;
  const scanned = entry.scanned.filter((i) => i >= 0 && i < trackCount);
  if (scanned.length === 0) return { scanned, resumeIndex: 0 };
  const furthest = Math.max(...scanned);
  // Forward-biased default: the furthest/last position (clamped), refined to
  // the first unscanned track after it when one exists.
  let resumeIndex = Math.min(furthest + 1, trackCount - 1);
  for (let i = furthest + 1; i < trackCount; i++) {
    if (!scanned.includes(i)) {
      resumeIndex = i;
      break;
    }
  }
  return { scanned, resumeIndex };
}

/**
 * True when the listener has progress saved for the station but it belongs
 * to an older run than `currentRunId` — the scanner should start fresh and
 * may note the previous set was partly scanned.
 */
export function hasStaleSetScan(slug: string, currentRunId: number): boolean {
  const entry = read().sets[slug];
  return entry != null && entry.runId !== currentRunId;
}

/** All scanned indexes for a run, or null — convenience for pager marks. */
export function getScannedIndexes(slug: string, runId: number): number[] | null {
  const entry = read().sets[slug];
  return entry && entry.runId === runId ? entry.scanned : null;
}

// ── react hook ─────────────────────────────────────────────────────────────

/** The whole scan-memory state, reactive across tabs. */
export function useScanMemory(): ScanMemory {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** Test helper: wipe the store (memory + localStorage). */
export function clearScanMemory(): void {
  write({ live: {}, sets: {} });
}
