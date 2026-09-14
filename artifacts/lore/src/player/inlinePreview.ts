/**
 * Inline iTunes preview playback for Library set-context covers.
 *
 * One shared <audio> element for the whole page: starting a cover stops
 * whatever was playing. Preview URLs resolve through getPreviewCached, which
 * dedupes in-flight lookups and caches both positive and negative results.
 * Clicking the playing cover stops it (toggle).
 */
import { useSyncExternalStore } from "react";
import { getPreviewCached } from "./previewCache";
import {
  claimInlinePreview,
  registerInlinePreviewStopper,
  releaseInlinePreview,
} from "./audioOwnership";

let audio: HTMLAudioElement | null = null;
let playingMbid: string | null = null;
let loadingMbid: string | null = null;
let audioOperation = 0;
let operation = 0;

const listeners = new Set<() => void>();
let snapshot: { playingMbid: string | null; loadingMbid: string | null } = {
  playingMbid,
  loadingMbid,
};

function emit(): void {
  snapshot = { playingMbid, loadingMbid };
  for (const listener of listeners) listener();
}

function clearAudioSource(el: HTMLAudioElement): void {
  el.pause();
  el.removeAttribute("src");
  // load() is required by Safari/Firefox to abort an in-flight media request.
  el.load();
}

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("ended", () => {
      if (audioOperation === 0) return;
      if (audio) clearAudioSource(audio);
      audioOperation = 0;
      playingMbid = null;
      loadingMbid = null;
      emit();
      releaseInlinePreview();
    });
    audio.addEventListener("error", () => {
      if (audioOperation === 0) return;
      if (audio) clearAudioSource(audio);
      audioOperation = 0;
      playingMbid = null;
      loadingMbid = null;
      emit();
      releaseInlinePreview();
    });
  }
  return audio;
}

function stopInlinePreviewInternal(restoreOwner: boolean): void {
  // Invalidate every pending lookup/play promise before touching the element.
  // A late promise must never resurrect a preview after another owner claimed
  // the audio surface.
  ++operation;
  audioOperation = 0;
  if (audio) clearAudioSource(audio);
  playingMbid = null;
  loadingMbid = null;
  emit();
  if (restoreOwner) releaseInlinePreview();
}

export function stopInlinePreview(): void {
  stopInlinePreviewInternal(true);
}

// Registering the stopper here keeps the bridge independent of React and of
// PlayerProvider. The registration is replaced safely if a test/module realm
// is reloaded.
registerInlinePreviewStopper(stopInlinePreview);

/**
 * Toggle the preview for a recording: play it, or stop if it's the current
 * one. Resolves to "playing" when playback started, "stopped" when toggled
 * off, and "unavailable" when no preview exists for the recording.
 */
export async function toggleInlinePreview(
  mbid: string,
  previewUrl?: string | null,
): Promise<"playing" | "stopped" | "unavailable"> {
  if (playingMbid === mbid || loadingMbid === mbid) {
    stopInlinePreviewInternal(true);
    return "stopped";
  }
  // Replacing one inline clip must not briefly resume the paused provider.
  stopInlinePreviewInternal(false);
  const currentOperation = operation;
  loadingMbid = mbid;
  emit();
  try {
    // Yield the active radio/ride/scan before resolving or playing the clip.
    // The provider may need to await a remote driver's pause command.
    await claimInlinePreview();
    if (operation !== currentOperation || loadingMbid !== mbid) {
      return "stopped";
    }
    const resolvedUrl = previewUrl ?? (await getPreviewCached(mbid)).previewUrl;
    if (!resolvedUrl) {
      releaseInlinePreview();
      return "unavailable";
    }
    // A newer toggle may have taken over while the lookup was in flight.
    if (operation !== currentOperation || loadingMbid !== mbid) return "stopped";
    const el = ensureAudio();
    audioOperation = currentOperation;
    el.src = resolvedUrl;
    await el.play();
    if (operation !== currentOperation || audioOperation !== currentOperation) {
      return "stopped";
    }
    playingMbid = mbid;
    return "playing";
  } catch {
    if (operation === currentOperation && audioOperation === currentOperation && audio) {
      audioOperation = 0;
      clearAudioSource(audio);
    }
    if (operation === currentOperation) releaseInlinePreview();
    return "unavailable";
  } finally {
    if (operation === currentOperation && loadingMbid === mbid) {
      loadingMbid = null;
      emit();
    }
  }
}

export function useInlinePreview(): {
  playingMbid: string | null;
  loadingMbid: string | null;
  toggle: typeof toggleInlinePreview;
  stop: typeof stopInlinePreview;
} {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
  return {
    playingMbid: state.playingMbid,
    loadingMbid: state.loadingMbid,
    toggle: toggleInlinePreview,
    stop: stopInlinePreview,
  };
}
