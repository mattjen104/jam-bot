import { useSyncExternalStore } from "react";

const SOCIAL_MODE_KEY = "lore:social:enabled";

function readSocialEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SOCIAL_MODE_KEY);
    // Default true — social mode is on unless the listener explicitly disabled it.
    return raw === null || raw === "true";
  } catch {
    return true;
  }
}

function writeSocialEnabled(value: boolean): void {
  try {
    localStorage.setItem(SOCIAL_MODE_KEY, value ? "true" : "false");
  } catch {
    // Storage blocked — keep in-memory value
  }
}

const listeners = new Set<() => void>();
let _cachedEnabled: boolean | null = null;

function getSocialEnabled(): boolean {
  if (_cachedEnabled === null) _cachedEnabled = readSocialEnabled();
  return _cachedEnabled;
}

function setSocialEnabled(value: boolean): void {
  _cachedEnabled = value;
  writeSocialEnabled(value);
  listeners.forEach((l) => l());
}

function subscribeSocial(listener: () => void): () => void {
  listeners.add(listener);
  // Cross-tab sync
  const storageHandler = (e: StorageEvent) => {
    if (e.key === SOCIAL_MODE_KEY) {
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
 * Social (bottle) mode toggle.
 * When disabled: bottle icon is hidden, notes are not published.
 * Stored in localStorage, default: enabled.
 */
export function useSocialMode(): { enabled: boolean; toggle: () => void } {
  const enabled = useSyncExternalStore(subscribeSocial, getSocialEnabled);
  return {
    enabled,
    toggle: () => setSocialEnabled(!getSocialEnabled()),
  };
}

/**
 * Imperatively set social mode — use inside event handlers where the hook
 * toggle is too coarse (e.g. segment buttons that each set a specific state).
 */
export { setSocialEnabled };

// Avatar persistence — single device avatar stored separately from social mode.
const AVATAR_KEY = "lore:social:avatar";

export function getStoredAvatar(): string | null {
  try {
    return localStorage.getItem(AVATAR_KEY);
  } catch {
    return null;
  }
}

export function storeAvatar(emoji: string): void {
  try {
    localStorage.setItem(AVATAR_KEY, emoji);
  } catch { /* noop */ }
}
