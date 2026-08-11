import { useSyncExternalStore } from "react";
import { setSleepEnabled, _registerSleepMutualExclusion } from "./sleepMode";

/**
 * Era/Genre mode — a hidden, local-first listener browse mode.
 *
 * Parallel to Sleep Radio (see lib/sleepMode.ts) but for era-themed
 * (decade/oldies/retro) and single-genre algorithmic stations. Activated by a
 * distinct gesture (a long-press on the Lore wordmark, see
 * recordWordmarkLongPress) so it never collides with sleep's five-tap gesture.
 * While active, the dial swaps to the era/genre station list
 * (GET /api/stations?mode=era-genre) and shows a subtle vinyl indicator that
 * deactivates the mode. Not advertised anywhere in the normal UI.
 *
 * Mutual exclusion: activating era/genre mode deactivates sleep mode (and the
 * sleep module deactivates era/genre — see setSleepEnabled call there). The two
 * modes never coexist.
 *
 * Persistence: a single boolean in localStorage. No account sync by design.
 */
const ERA_GENRE_MODE_KEY = "lore:eraGenre:enabled";

/** How long the wordmark must be held to toggle era/genre mode. */
export const ERA_GENRE_LONGPRESS_MS = 1_200;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ERA_GENRE_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeEnabled(value: boolean): void {
  try {
    localStorage.setItem(ERA_GENRE_MODE_KEY, value ? "true" : "false");
  } catch {
    // Storage blocked — keep in-memory value
  }
}

const listeners = new Set<() => void>();
let _cachedEnabled: boolean | null = null;

function getEnabled(): boolean {
  if (_cachedEnabled === null) _cachedEnabled = readEnabled();
  return _cachedEnabled;
}

export function setEraGenreEnabled(value: boolean): void {
  _cachedEnabled = value;
  writeEnabled(value);
  // Mutual exclusion: turning era/genre on turns sleep off.
  if (value) setSleepEnabled(false);
  listeners.forEach((l) => l());
}

/**
 * Called by the sleep module when sleep mode turns on, so the two modes stay
 * mutually exclusive. Registered synchronously at import time (below) to avoid
 * a circular static import while keeping the switch race-free.
 */
export function deactivateEraGenreForSleep(): void {
  if (getEnabled()) {
    _cachedEnabled = false;
    writeEnabled(false);
    listeners.forEach((l) => l());
  }
}

// Register the mutual-exclusion callback with the sleep module. Importing this
// module (which every consumer that reads era/genre state does) wires the link.
_registerSleepMutualExclusion(deactivateEraGenreForSleep);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const storageHandler = (e: StorageEvent) => {
    if (e.key === ERA_GENRE_MODE_KEY) {
      _cachedEnabled = null;
      listeners.forEach((l) => l());
    }
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storageHandler);
  };
}

/**
 * Era/Genre mode toggle. Local-first: persisted only in localStorage.
 */
export function useEraGenreMode(): { enabled: boolean; toggle: () => void } {
  const enabled = useSyncExternalStore(subscribe, getEnabled);
  return {
    enabled,
    toggle: () => setEraGenreEnabled(!getEnabled()),
  };
}

// ---------------------------------------------------------------------------
// Long-press gesture recorder — distinct from sleep's five-tap gesture.
// ---------------------------------------------------------------------------

let _pressStart: number | null = null;

/** Tests only: reset the gesture + cached state. */
export function _testOnly_resetEraGenre(): void {
  _pressStart = null;
  _cachedEnabled = null;
}

/** Record the start of a wordmark press. */
export function recordWordmarkPressStart(now: number = Date.now()): void {
  _pressStart = now;
}

/**
 * Record the end of a wordmark press. When the press lasted at least
 * ERA_GENRE_LONGPRESS_MS, era/genre mode toggles.
 * Returns true when this release completed the long-press (mode was toggled).
 */
export function recordWordmarkPressEnd(now: number = Date.now()): boolean {
  const start = _pressStart;
  _pressStart = null;
  if (start === null) return false;
  if (now - start >= ERA_GENRE_LONGPRESS_MS) {
    setEraGenreEnabled(!getEnabled());
    return true;
  }
  return false;
}
