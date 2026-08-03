/**
 * Apple MusicKit JS inline replay panel.
 *
 * Loads MusicKit JS from Apple's CDN only when the user starts playback —
 * never eagerly. The developer token stays on the server; only the short-lived
 * developer JWT returned by the /apple-music endpoint is sent to the browser.
 * No audio is hosted or stitched by Lore.
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Ghost,
  Loader2,
  Music,
  Pause,
  Play,
  X,
} from "lucide-react";
import {
  useGetAppleMusicReplayMaterialization,
  type AppleMusicReplayMaterializationEntry,
} from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Minimal MusicKit v3 type declarations
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    MusicKit?: {
      configure(config: {
        developerToken: string;
        app: { name: string; build: string };
      }): MKInstance;
      getInstance(): MKInstance;
      PlaybackStates: Record<string, number>;
    };
  }
}

interface MKInstance {
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
  setQueue(descriptor: { songs: string[] }): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  skipToNextItem(): Promise<void>;
  skipToPreviousItem(): Promise<void>;
  changeToMediaAtIndex(index: number): Promise<void>;
  readonly nowPlayingItem: { id?: string } | null;
  readonly nowPlayingItemIndex: number;
  readonly playbackState: number;
  addEventListener(event: string, handler: (e?: unknown) => void): void;
  removeEventListener(event: string, handler: (e?: unknown) => void): void;
}

// MusicKit PlaybackState numeric values
const MK_STATE_PLAYING = 2;
const MK_STATE_PAUSED = 3;
const MK_STATE_ENDED = 5;
const MK_STATE_STOPPED = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function missingLabel(reason: string | null): string {
  if (reason === "dead_link" || reason === "dead") return "removed from service";
  if (reason === "unavailable") return "not on Apple Music";
  if (reason === "unresolved") return "not identified";
  return "unavailable";
}

function statusPill(entry: AppleMusicReplayMaterializationEntry) {
  if (entry.status === "available") return null;
  return (
    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
      · {missingLabel(entry.reason)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Script loader
// ---------------------------------------------------------------------------

let mkLoadPromise: Promise<void> | null = null;

function loadMusicKit(): Promise<void> {
  if (mkLoadPromise) return mkLoadPromise;
  if (window.MusicKit) return (mkLoadPromise = Promise.resolve());
  mkLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[src*="music.apple.com/musickit"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("MusicKit failed to load")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("MusicKit failed to load"));
    document.head.appendChild(script);
  });
  return mkLoadPromise;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PlayerState = "idle" | "loading" | "authorized" | "playing" | "paused" | "ended";

export function AppleMusicReplayPanel({ replayId }: { replayId: number }) {
  const { data, isLoading } = useGetAppleMusicReplayMaterialization(replayId);
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const mkRef = useRef<MKInstance | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Cleanup on unmount
  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  if (isLoading || !data) return null;
  if (!data.configured || !data.developerToken) return null;

  const available = data.entries.filter((e) => e.status === "available");
  const missing = data.entries.filter((e) => e.status !== "available");

  if (available.length === 0) {
    return (
      <section
        className="mb-6 rounded-xl border border-card-border bg-card p-4"
        data-testid="am-replay"
      >
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          <Music className="h-3.5 w-3.5" />
          Apple Music
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          None of the identified tracks in this set are available on Apple Music.
        </p>
      </section>
    );
  }

  const current = available[currentIndex] ?? null;
  const isActive = playerState === "playing" || playerState === "paused";

  async function startPlayback() {
    setPlayerState("loading");
    setAuthError(null);

    try {
      await loadMusicKit();
    } catch {
      setAuthError("MusicKit could not be loaded. Check your network connection.");
      setPlayerState("idle");
      return;
    }

    try {
      window.MusicKit!.configure({
        developerToken: data!.developerToken!,
        app: { name: data!.appName, build: "1.0.0" },
      });
    } catch {
      setAuthError("MusicKit configuration failed.");
      setPlayerState("idle");
      return;
    }

    const mk = window.MusicKit!.getInstance();
    mkRef.current = mk;

    try {
      await mk.authorize();
    } catch {
      setAuthError(
        "Apple Music authorization was cancelled or your subscription may not support playback.",
      );
      setPlayerState("idle");
      return;
    }

    const songIds = available.map((e) => e.appleMusicId!);

    try {
      await mk.setQueue({ songs: songIds });
    } catch {
      setAuthError("Could not build the Apple Music queue. Try again.");
      setPlayerState("idle");
      return;
    }

    const onStateChange = () => {
      const state = mk.playbackState;
      if (state === MK_STATE_PLAYING) setPlayerState("playing");
      else if (state === MK_STATE_PAUSED) setPlayerState("paused");
      else if (state === MK_STATE_ENDED || state === MK_STATE_STOPPED)
        setPlayerState("ended");
    };

    const onItemChange = () => {
      const idx = mk.nowPlayingItemIndex;
      if (typeof idx === "number" && idx >= 0 && idx < available.length) {
        setCurrentIndex(idx);
      }
    };

    mk.addEventListener("playbackStateDidChange", onStateChange);
    mk.addEventListener("mediaItemDidChange", onItemChange);

    cleanupRef.current = () => {
      mk.removeEventListener("playbackStateDidChange", onStateChange);
      mk.removeEventListener("mediaItemDidChange", onItemChange);
      void mk.unauthorize().catch(() => undefined);
      mkRef.current = null;
    };

    try {
      await mk.play();
      setPlayerState("playing");
    } catch {
      setAuthError(
        "Playback failed. Make sure Apple Music is available in your region.",
      );
      setPlayerState("idle");
      cleanupRef.current();
      cleanupRef.current = null;
    }
  }

  function stopPlayback() {
    mkRef.current?.pause();
    cleanupRef.current?.();
    cleanupRef.current = null;
    mkRef.current = null;
    setPlayerState("idle");
    setCurrentIndex(0);
    setAuthError(null);
  }

  async function togglePlay() {
    if (!mkRef.current) return;
    if (playerState === "playing") {
      mkRef.current.pause();
    } else {
      await mkRef.current.play();
    }
  }

  async function goToIndex(idx: number) {
    if (!mkRef.current || idx < 0 || idx >= available.length) return;
    setCurrentIndex(idx);
    await mkRef.current.changeToMediaAtIndex(idx);
    await mkRef.current.play();
    setPlayerState("playing");
  }

  return (
    <section
      className="mb-6 rounded-xl border border-primary/30 bg-primary/[0.04] p-4"
      data-testid="am-replay"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            <Ghost className="h-3.5 w-3.5" />
            Apple Music · Ghost Replay
          </div>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {isActive
              ? `Playing ${current?.artist ?? ""} — ${current?.title ?? ""}`
              : "Play the reconstruction through your Apple Music subscription. No audio is hosted by Lore."}
          </p>
        </div>

        {!isActive ? (
          <button
            type="button"
            onClick={() => void startPlayback()}
            disabled={playerState === "loading"}
            className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-4 py-2 font-mono text-xs uppercase tracking-wide text-primary-foreground disabled:opacity-40"
            data-testid="am-start"
          >
            {playerState === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Music className="h-3.5 w-3.5" />
            )}
            {playerState === "loading" ? "Connecting…" : "Play on Apple Music"}
          </button>
        ) : (
          <button
            type="button"
            onClick={stopPlayback}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            data-testid="am-stop"
          >
            <X className="h-3.5 w-3.5" />
            Stop
          </button>
        )}
      </div>

      {/* Coverage bar */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <span data-testid="am-coverage">
          {data.coverage.available} of {data.coverage.total} on Apple Music
        </span>
        {data.coverage.unavailable > 0 && (
          <span>{data.coverage.unavailable} not on service</span>
        )}
        {data.coverage.unresolved > 0 && (
          <span>{data.coverage.unresolved} not identified</span>
        )}
      </div>

      {/* Auth / load errors */}
      {authError && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
          data-testid="am-error"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {authError}
        </div>
      )}

      {/* Active player controls */}
      {isActive && current && (
        <div className="mt-4 rounded-lg border border-card-border bg-card p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-serif text-base font-semibold text-foreground">
                {current.title}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {current.artist} · position {current.position + 1}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">
                {currentIndex + 1} of {available.length}
              </span>
              {current.url && (
                <a
                  href={current.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-primary"
                  aria-label="Open on Apple Music"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void goToIndex(currentIndex - 1)}
              disabled={currentIndex === 0}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground disabled:opacity-35"
              data-testid="am-previous"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </button>

            <button
              type="button"
              onClick={() => void togglePlay()}
              className="inline-flex items-center gap-2 rounded-full border border-primary/50 px-4 py-1.5 font-mono text-[11px] text-primary"
              data-testid="am-toggle"
            >
              {playerState === "playing" ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {playerState === "playing" ? "Pause" : "Play"}
            </button>

            <button
              type="button"
              onClick={() => void goToIndex(currentIndex + 1)}
              disabled={currentIndex >= available.length - 1}
              className="inline-flex items-center gap-1 rounded-full border border-primary/50 px-3 py-1.5 font-mono text-[11px] text-primary disabled:opacity-35"
              data-testid="am-next"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Ended state */}
      {playerState === "ended" && (
        <div
          className="mt-3 rounded-lg border border-card-border bg-card px-4 py-3 text-center font-mono text-sm text-muted-foreground"
          data-testid="am-ended"
        >
          Set complete.{" "}
          <button
            type="button"
            onClick={() => void startPlayback()}
            className="text-primary hover:underline"
          >
            Play again
          </button>
        </div>
      )}

      {/* Missing entries receipt */}
      {missing.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5" data-testid="am-missing">
          {missing.map((entry) => (
            <span
              key={`${entry.position}-${entry.recordingMbid ?? "miss"}`}
              className="rounded-full border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground"
            >
              {entry.position + 1} · {entry.title}{statusPill(entry)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
