import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppleMusicReplayMaterialization,
  AppleMusicReplayMaterializationEntry,
} from "@workspace/api-client-react";

const MUSIC_KIT_SCRIPT =
  "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

type MusicKitInstance = {
  authorize: () => Promise<string>;
  setQueue: (options: { song: string[] }) => Promise<unknown>;
  play: () => Promise<unknown>;
  pause: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  skipToNextItem: () => Promise<unknown>;
  skipToPreviousItem: () => Promise<unknown>;
  addEventListener: (event: string, handler: (event?: unknown) => void) => void;
  removeEventListener: (
    event: string,
    handler: (event?: unknown) => void,
  ) => void;
};

type MusicKitGlobal = {
  configure: (options: {
    developerToken: string;
    app: { name: string; build: string };
  }) => void;
  getInstance: () => MusicKitInstance;
};

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

export type AppleReplayStatus =
  | "idle"
  | "authorizing"
  | "loading"
  | "playing"
  | "paused"
  | "completed"
  | "error";

function eventItemId(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const value = event as {
    id?: string;
    item?: { id?: string; playParams?: { id?: string } };
    nowPlayingItem?: { id?: string; playParams?: { id?: string } };
  };
  return (
    value.id ??
    value.item?.id ??
    value.item?.playParams?.id ??
    value.nowPlayingItem?.id ??
    value.nowPlayingItem?.playParams?.id ??
    null
  );
}

function eventState(event: unknown): string {
  if (typeof event === "string") return event.toLowerCase();
  if (!event || typeof event !== "object") return "";
  const state = (event as { state?: unknown }).state;
  return typeof state === "string" ? state.toLowerCase() : "";
}

function isCancellation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /cancel|denied|abort|not authorized/i.test(text);
}

let musicKitScriptPromise: Promise<MusicKitGlobal> | null = null;

function loadMusicKit(): Promise<MusicKitGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Apple Music is only available in a browser"));
  }
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  if (musicKitScriptPromise) return musicKitScriptPromise;

  musicKitScriptPromise = new Promise<MusicKitGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${MUSIC_KIT_SCRIPT}"]`,
    );
    const script = existing ?? document.createElement("script");
    const finish = () => {
      if (window.MusicKit) resolve(window.MusicKit);
      else reject(new Error("Apple MusicKit did not initialize"));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Apple MusicKit failed to load")),
      { once: true },
    );
    if (!existing) {
      script.src = MUSIC_KIT_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
    if (window.MusicKit) finish();
  }).catch((error) => {
    musicKitScriptPromise = null;
    throw error;
  });
  return musicKitScriptPromise;
}

export interface AppleMusicReplayApi {
  status: AppleReplayStatus;
  message: string | null;
  currentPosition: number | null;
  currentEntry: AppleMusicReplayMaterializationEntry | null;
  availableCount: number;
  start: () => void;
  togglePause: () => void;
  next: () => void;
  previous: () => void;
  stop: () => void;
  retry: () => void;
}

/**
 * MusicKit is intentionally a separate replay materializer. It owns only the
 * Apple queue and never touches the shared radio/ride player, so a failed
 * authorization or subscription restriction cannot interrupt the live dial.
 */
export function useAppleMusicReplay(
  materialization: AppleMusicReplayMaterialization | undefined,
): AppleMusicReplayApi {
  const [status, setStatus] = useState<AppleReplayStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<number | null>(null);
  const instanceRef = useRef<MusicKitInstance | null>(null);
  const entriesRef = useRef(materialization?.entries ?? []);
  const mountedRef = useRef(true);
  const handlersRef = useRef<
    Array<{ event: string; handler: (event?: unknown) => void }>
  >([]);
  entriesRef.current = materialization?.entries ?? [];

  const currentEntry =
    currentPosition == null
      ? null
      : (entriesRef.current[currentPosition] ?? null);
  const playableEntries = entriesRef.current.filter(
    (entry) => entry.status === "available" && entry.appleMusicId,
  );

  const setError = useCallback((error: unknown) => {
    if (!mountedRef.current) return;
    if (isCancellation(error)) {
      setStatus("idle");
      setMessage("Apple Music authorization was canceled.");
      return;
    }
    const text = error instanceof Error ? error.message : String(error);
    setStatus("error");
    setMessage(
      /subscription|not entitled|forbidden|premium|restricted/i.test(text)
        ? "Apple Music requires an active subscription for this track."
        : "Apple Music could not start this replay. Try again.",
    );
  }, []);

  const detach = useCallback(() => {
    const instance = instanceRef.current;
    if (instance) {
      for (const { event, handler } of handlersRef.current) {
        instance.removeEventListener(event, handler);
      }
    }
    handlersRef.current = [];
  }, []);

  const attach = useCallback(
    (instance: MusicKitInstance) => {
      detach();
      const onTrackChange = (event?: unknown) => {
        const id = eventItemId(event);
        if (!id) return;
        const position = entriesRef.current.findIndex(
          (entry) => entry.appleMusicId === id,
        );
        if (position >= 0) {
          setCurrentPosition(position);
          setStatus("playing");
        }
      };
      const onPlaybackState = (event?: unknown) => {
        const state = eventState(event);
        if (/playing/.test(state)) setStatus("playing");
        else if (/paused/.test(state)) setStatus("paused");
        else if (/ended|completed|stopped/.test(state)) {
          setStatus("completed");
        }
      };
      const onQueueEnd = () => setStatus("completed");
      const onError = (event?: unknown) => setError(event ?? "MusicKit error");
      const handlers = [
        ["nowPlayingItemDidChange", onTrackChange],
        ["playbackStateDidChange", onPlaybackState],
        ["queueEndDidChange", onQueueEnd],
        ["mediaPlaybackError", onError],
      ] as const;
      for (const [event, handler] of handlers) {
        instance.addEventListener(event, handler);
        handlersRef.current.push({ event, handler });
      }
    },
    [detach, setError],
  );

  const start = useCallback(async () => {
    if (!materialization?.configured || !materialization.developerToken) {
      setStatus("error");
      setMessage("Apple Music playback is not configured for this Lore server.");
      return;
    }
    if (!playableEntries.length) {
      setStatus("error");
      setMessage("No tracks in this reconstruction are available on Apple Music.");
      return;
    }
    setMessage(null);
    setStatus("authorizing");
    try {
      const musicKit = await loadMusicKit();
      musicKit.configure({
        developerToken: materialization.developerToken,
        app: { name: materialization.appName, build: "lore-ghost-replay" },
      });
      const instance = musicKit.getInstance();
      instanceRef.current = instance;
      attach(instance);
      await instance.authorize();
      setStatus("loading");
      await instance.setQueue({
        song: playableEntries.map((entry) => entry.appleMusicId!),
      });
      await instance.play();
      const firstPosition = entriesRef.current.findIndex(
        (entry) => entry.status === "available" && entry.appleMusicId,
      );
      setCurrentPosition(firstPosition >= 0 ? firstPosition : null);
      setStatus("playing");
    } catch (error) {
      setError(error);
    }
  }, [attach, materialization, playableEntries, setError]);

  const togglePause = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const action = status === "playing" ? instance.pause() : instance.play();
    void action
      .then(() => setStatus(status === "playing" ? "paused" : "playing"))
      .catch(setError);
  }, [setError, status]);

  const next = useCallback(() => {
    const instance = instanceRef.current;
    if (instance) void instance.skipToNextItem().catch(setError);
  }, [setError]);

  const previous = useCallback(() => {
    const instance = instanceRef.current;
    if (instance) void instance.skipToPreviousItem().catch(setError);
  }, [setError]);

  const stop = useCallback(() => {
    const instance = instanceRef.current;
    if (instance) void instance.stop().catch(() => {});
    setStatus("idle");
    setCurrentPosition(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      detach();
      const instance = instanceRef.current;
      if (instance) void instance.stop().catch(() => {});
      instanceRef.current = null;
    };
  }, [detach]);

  return {
    status,
    message,
    currentPosition,
    currentEntry,
    availableCount: playableEntries.length,
    start: () => void start(),
    togglePause: () => void togglePause(),
    next: () => void next(),
    previous: () => void previous(),
    stop,
    retry: () => void start(),
  };
}