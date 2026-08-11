import { useSyncExternalStore } from "react";

/**
 * Sleep Radio mode — a hidden, local-first listener mode.
 *
 * Activated by tapping the Lore wordmark five times within three seconds
 * (see recordWordmarkTap). While active, the dial swaps to the sleep station
 * list (GET /api/stations?mode=sleep) and shows a subtle moon indicator that
 * deactivates the mode. Not advertised anywhere in the normal UI.
 *
 * Persistence: a single boolean in localStorage. No account sync by design.
 */
const SLEEP_MODE_KEY = "lore:sleep:enabled";

/** Five taps… */
export const SLEEP_TAP_COUNT = 5;
/** …within three seconds. */
export const SLEEP_TAP_WINDOW_MS = 3_000;

function readSleepEnabled(): boolean {
  try {
    return localStorage.getItem(SLEEP_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSleepEnabled(value: boolean): void {
  try {
    localStorage.setItem(SLEEP_MODE_KEY, value ? "true" : "false");
  } catch {
    // Storage blocked — keep in-memory value
  }
}

const listeners = new Set<() => void>();
let _cachedEnabled: boolean | null = null;

function getSleepEnabled(): boolean {
  if (_cachedEnabled === null) _cachedEnabled = readSleepEnabled();
  return _cachedEnabled;
}

export function setSleepEnabled(value: boolean): void {
  _cachedEnabled = value;
  writeSleepEnabled(value);
  listeners.forEach((l) => l());
}

function subscribeSleep(listener: () => void): () => void {
  listeners.add(listener);
  // Cross-tab sync
  const storageHandler = (e: StorageEvent) => {
    if (e.key === SLEEP_MODE_KEY) {
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
 * Sleep Radio mode toggle. Local-first: persisted only in localStorage.
 */
export function useSleepMode(): { enabled: boolean; toggle: () => void } {
  const enabled = useSyncExternalStore(subscribeSleep, getSleepEnabled);
  return {
    enabled,
    toggle: () => setSleepEnabled(!getSleepEnabled()),
  };
}

// ---------------------------------------------------------------------------
// Five-tap gesture recorder
// ---------------------------------------------------------------------------

// Timestamps of recent wordmark taps, pruned to the rolling window.
let _tapTimes: number[] = [];

/** Tests only: reset the tap recorder state. */
export function _testOnly_resetTaps(): void {
  _tapTimes = [];
  _cachedEnabled = null;
}

/**
 * Record one tap on the Lore wordmark. When SLEEP_TAP_COUNT taps land within
 * SLEEP_TAP_WINDOW_MS, sleep mode toggles and the recorder resets.
 * Returns true when this tap completed the gesture (mode was toggled).
 */
export function recordWordmarkTap(now: number = Date.now()): boolean {
  _tapTimes.push(now);
  // Keep only taps inside the rolling window ending at `now`.
  _tapTimes = _tapTimes.filter((t) => now - t <= SLEEP_TAP_WINDOW_MS);
  if (_tapTimes.length >= SLEEP_TAP_COUNT) {
    _tapTimes = [];
    setSleepEnabled(!getSleepEnabled());
    return true;
  }
  return false;
}
