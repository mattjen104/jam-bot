import type { AppleMusicReplayMaterialization, AppleMusicReplayMaterializationEntry } from "@workspace/api-client-react";

export type AppleMusicQueueEntry = AppleMusicReplayMaterializationEntry & {
  appleMusicId: string;
};

export type AppleMusicQueue = {
  ids: string[];
  entries: AppleMusicQueueEntry[];
};

export type MusicKitPlaybackState =
  | "idle"
  | "loading"
  | "authorizing"
  | "ready"
  | "playing"
  | "paused"
  | "complete"
  | "error";

export type MusicKitErrorKind =
  | "authorization-cancelled"
  | "subscription-required"
  | "configuration"
  | "provider"
  | "unknown";

export type MusicKitError = {
  kind: MusicKitErrorKind;
  message: string;
};

export type MusicKitInstance = {
  authorize: () => Promise<unknown>;
  setQueue: (options: { songs: string[] }) => Promise<unknown>;
  play: () => Promise<unknown> | unknown;
  pause: () => Promise<unknown> | unknown;
  stop?: () => Promise<unknown> | unknown;
  skipToNextItem?: () => Promise<unknown> | unknown;
  skipToPreviousItem?: () => Promise<unknown> | unknown;
  /** Seek to a position in the current track. Time is in seconds. */
  seekToTime?: (timeInSeconds: number) => Promise<void>;
  /** Current playhead position in seconds. */
  currentPlaybackTime?: number;
  /** Total duration of the current track in seconds. */
  currentPlaybackDuration?: number;
  addEventListener: (event: string, listener: (event: unknown) => void) => void;
  removeEventListener: (event: string, listener: (event: unknown) => void) => void;
  storefrontId?: string;
};

export type MusicKitGlobal = {
  configure: (options: {
    developerToken: string;
    appName: string;
    storefrontId?: string;
  }) => void;
  getInstance: () => MusicKitInstance;
  Events?: Record<string, string>;
};

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

const MUSICKIT_SCRIPT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
let musicKitScriptPromise: Promise<MusicKitGlobal> | null = null;

export function buildAppleMusicQueue(
  materialization: Pick<AppleMusicReplayMaterialization, "entries">,
): AppleMusicQueue {
  const entries = materialization.entries.filter(
    (entry): entry is AppleMusicQueueEntry =>
      entry.status === "available" &&
      typeof entry.appleMusicId === "string" &&
      entry.appleMusicId.trim().length > 0,
  );
  return { ids: entries.map((entry) => entry.appleMusicId), entries };
}

export function canPlayAppleMusic(
  materialization: Pick<
    AppleMusicReplayMaterialization,
    "configured" | "developerToken" | "coverage" | "entries"
  > | null | undefined,
): boolean {
  return Boolean(
    materialization?.configured &&
      materialization.developerToken &&
      materialization.coverage.available > 0 &&
      materialization.entries.some(
        (entry) => entry.status === "available" && entry.appleMusicId,
      ),
  );
}

export function musicKitEvent(
  music: MusicKitInstance,
  name: string,
): string {
  return musicKitGlobal()?.Events?.[name] ?? name;
}

export function musicKitGlobal(): MusicKitGlobal | null {
  return typeof window !== "undefined" ? window.MusicKit ?? null : null;
}

export function loadMusicKit(): Promise<MusicKitGlobal> {
  if (musicKitGlobal()) return Promise.resolve(musicKitGlobal()!);
  if (typeof document === "undefined") {
    return Promise.reject(new Error("MusicKit is only available in a browser"));
  }
  if (musicKitScriptPromise) return musicKitScriptPromise;

  musicKitScriptPromise = new Promise<MusicKitGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${MUSICKIT_SCRIPT_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");
    let settled = false;
    const finish = () => {
      const global = musicKitGlobal();
      if (global) {
        settled = true;
        resolve(global);
      } else if (!settled) {
        settled = true;
        reject(new Error("Apple MusicKit loaded without its browser API"));
      }
    };
    const onLoaded = () => finish();
    script.addEventListener("load", onLoaded, { once: true });
    // MusicKit dispatches this event after its runtime has initialized. The
    // script's load event can precede window.MusicKit on some browsers.
    document.addEventListener("musickitloaded", onLoaded, { once: true });
    script.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        document.removeEventListener("musickitloaded", onLoaded);
        reject(new Error("Apple MusicKit could not be loaded"));
      }
    }, { once: true });
    if (!existing) {
      script.src = MUSICKIT_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    } else if (musicKitGlobal()) {
      finish();
    }
  }).catch((error) => {
    musicKitScriptPromise = null;
    throw error;
  });
  return musicKitScriptPromise;
}

export function describeMusicKitError(error: unknown): MusicKitError {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.toLowerCase();
  if (
    normalized.includes("cancel") ||
    normalized.includes("denied") ||
    normalized.includes("not authorized")
  ) {
    return {
      kind: "authorization-cancelled",
      message: "Apple Music authorization was cancelled. You can try again.",
    };
  }
  if (
    normalized.includes("subscription") ||
    normalized.includes("not entitled") ||
    normalized.includes("403")
  ) {
    return {
      kind: "subscription-required",
      message: "An Apple Music subscription is required to play this track.",
    };
  }
  if (normalized.includes("token") || normalized.includes("configure")) {
    return {
      kind: "configuration",
      message: "Apple Music playback is not configured for this site.",
    };
  }
  if (raw) return { kind: "provider", message: `Apple Music could not play this replay: ${raw}` };
  return { kind: "unknown", message: "Apple Music could not play this replay." };
}

export function eventTrackId(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const value = event as Record<string, unknown>;
  const item =
    value.item && typeof value.item === "object"
      ? (value.item as Record<string, unknown>)
      : value;
  for (const candidate of [item.id, item.songId, item.contentId]) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}