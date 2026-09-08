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

let audio: HTMLAudioElement | null = null;
let playingMbid: string | null = null;
let loadingMbid: string | null = null;

const listeners = new Set<() => void>();
let snapshot: { playingMbid: string | null; loadingMbid: string | null } = {
  playingMbid,
  loadingMbid,
};

function emit(): void {
  snapshot = { playingMbid, loadingMbid };
  for (const listener of listeners) listener();
}

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("ended", () => {
      playingMbid = null;
      emit();
    });
    audio.addEventListener("error", () => {
      playingMbid = null;
      emit();
    });
  }
  return audio;
}

export function stopInlinePreview(): void {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  playingMbid = null;
  loadingMbid = null;
  emit();
}

/**
 * Toggle the preview for a recording: play it, or stop if it's the current
 * one. Resolves to "playing" when playback started, "stopped" when toggled
 * off, and "unavailable" when no preview exists for the recording.
 */
export async function toggleInlinePreview(
  mbid: string,
): Promise<"playing" | "stopped" | "unavailable"> {
  if (playingMbid === mbid || loadingMbid === mbid) {
    stopInlinePreview();
    return "stopped";
  }
  stopInlinePreview();
  loadingMbid = mbid;
  emit();
  try {
    const result = await getPreviewCached(mbid);
    if (!result.previewUrl) return "unavailable";
    // A newer toggle may have taken over while the lookup was in flight.
    if (loadingMbid !== mbid) return "stopped";
    const el = ensureAudio();
    el.src = result.previewUrl;
    await el.play();
    playingMbid = mbid;
    return "playing";
  } catch {
    return "unavailable";
  } finally {
    if (loadingMbid === mbid) loadingMbid = null;
    emit();
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
