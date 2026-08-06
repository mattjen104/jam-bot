import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Pause, Play, RotateCcw, Square } from "lucide-react";
import type { AppleMusicReplayMaterialization } from "@workspace/api-client-react";
import {
  buildAppleMusicQueue,
  canPlayAppleMusic,
  describeMusicKitError,
  eventTrackId,
  loadMusicKit,
  musicKitEvent,
  type MusicKitInstance,
  type MusicKitPlaybackState,
} from "../lib/appleMusicReplay";

type Props = { materialization: AppleMusicReplayMaterialization };

function entryLabel(entry: AppleMusicReplayMaterialization["entries"][number]): string {
  return `${entry.artist} — ${entry.title}`;
}

export function AppleMusicReplayPanel({ materialization }: Props) {
  const queue = useMemo(() => buildAppleMusicQueue(materialization), [materialization]);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<MusicKitPlaybackState>("idle");
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const musicRef = useRef<MusicKitInstance | null>(null);
  const listenersRef = useRef<Array<[string, (event: unknown) => void]>>([]);
  const sessionRef = useRef(0);

  const cleanup = async (clearQueue = true) => {
    sessionRef.current += 1;
    const music = musicRef.current;
    if (!music) {
      setActive(false);
      setState("idle");
      return;
    }
    for (const [event, listener] of listenersRef.current) {
      music.removeEventListener(event, listener);
    }
    listenersRef.current = [];
    try {
      await music.pause();
      if (clearQueue) await music.setQueue({ songs: [] });
    } catch {
      // Teardown is best-effort; leaving replay must never affect Lore's player.
    }
    musicRef.current = null;
    setActive(false);
    setState("idle");
  };

  useEffect(() => () => {
    void cleanup();
  }, []);

  const start = async () => {
    if (!canPlayAppleMusic(materialization) || !queue.ids.length) return;
    const session = ++sessionRef.current;
    setActive(true);
    setState("loading");
    setError(null);
    try {
      const global = await loadMusicKit();
      if (session !== sessionRef.current) return;
      global.configure({
        developerToken: materialization.developerToken!,
        appName: materialization.appName,
        storefrontId: materialization.storefront,
      });
      const music = global.getInstance();
      music.storefrontId = materialization.storefront;
      musicRef.current = music;
      setState("authorizing");
      await music.authorize();
      if (session !== sessionRef.current) return;
      await music.setQueue({ songs: queue.ids });
      if (session !== sessionRef.current) return;

      const onItemChange = (event: unknown) => {
        const id = eventTrackId(event);
        if (id) {
          const index = queue.ids.indexOf(id);
          if (index >= 0) setCurrentQueueIndex(index);
        }
        setState("playing");
      };
      const onStateChange = (event: unknown) => {
        const value = event as { state?: string; playbackState?: string } | null;
        const next = String(value?.state ?? value?.playbackState ?? "").toLowerCase();
        if (next.includes("paused") || next === "0") setState("paused");
        else if (next.includes("playing") || next === "1") setState("playing");
        else if (next.includes("ended") || next === "4") {
          setCurrentQueueIndex((index) => {
            if (index >= queue.ids.length - 1) setState("complete");
            return Math.min(index + 1, queue.ids.length - 1);
          });
        }
      };
      const onError = (event: unknown) => {
        const detail = event instanceof Error ? event : (event as { detail?: unknown })?.detail;
        setState("error");
        setError(describeMusicKitError(detail ?? event));
      };
      const events = [
        [musicKitEvent(music, "mediaItemDidChange"), onItemChange],
        [musicKitEvent(music, "playbackStateDidChange"), onStateChange],
        [musicKitEvent(music, "authorizationStatusDidChange"), onStateChange],
        [musicKitEvent(music, "playbackError"), onError],
      ] as Array<[string, (event: unknown) => void]>;
      for (const [event, listener] of events) {
        music.addEventListener(event, listener);
        listenersRef.current.push([event, listener]);
      }
      await music.play();
      if (session === sessionRef.current) setState("playing");
    } catch (cause) {
      if (session !== sessionRef.current) return;
      const detail = describeMusicKitError(cause);
      setState("error");
      setError(detail);
    }
  };

  const retry = async () => {
    await cleanup();
    await start();
  };

  const togglePause = async () => {
    const music = musicRef.current;
    if (!music) return;
    try {
      if (state === "playing") {
        await music.pause();
        setState("paused");
      } else {
        await music.play();
        setState("playing");
      }
    } catch (cause) {
      setState("error");
      setError(describeMusicKitError(cause));
    }
  };

  const skip = async (direction: "next" | "previous") => {
    const music = musicRef.current;
    if (!music) return;
    try {
      if (direction === "next") await music.skipToNextItem?.();
      else await music.skipToPreviousItem?.();
    } catch (cause) {
      setState("error");
      setError(describeMusicKitError(cause));
    }
  };

  const statusText = state === "authorizing"
    ? "Authorize Apple Music in the browser…"
    : state === "loading"
      ? "Loading Apple MusicKit…"
      : state === "complete"
        ? "Replay complete"
        : state === "paused"
          ? "Paused"
          : state === "playing"
            ? "Playing in Apple Music"
            : "Ready for Apple Music";

  return (
    <section
      className="mb-6 rounded-xl border border-primary/30 bg-primary/[0.04] p-4"
      data-testid="apple-music-replay"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[13px] uppercase tracking-[0.2em] text-primary">
            Apple Music playback
          </p>
          <p className="mt-1 max-w-xl text-base leading-relaxed text-muted-foreground">
            Play the exact Apple Music matches in broadcast order. Lore never hosts
            or proxies the audio.
          </p>
        </div>
        {!active ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canPlayAppleMusic(materialization)}
            className="inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-4 py-2 font-mono text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-40"
            data-testid="apple-music-start"
          >
            <Play className="h-3.5 w-3.5" />
            Play in Apple Music
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void cleanup()}
            className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 font-mono text-[13px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            data-testid="apple-music-close"
          >
            <Square className="h-3.5 w-3.5" />
            Leave Apple Music
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[12px] uppercase tracking-wide text-muted-foreground">
        <span data-testid="apple-music-status">{statusText}</span>
        <span>·</span>
        <span data-testid="apple-music-coverage">
          {materialization.coverage.available} of {materialization.coverage.total} exact matches
        </span>
      </div>

      {!materialization.configured ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground" data-testid="apple-music-unconfigured">
          Inline Apple Music playback is not configured here. The guided Apple Music link remains available below.
        </p>
      ) : null}
      {materialization.configured && !queue.ids.length ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          No exact Apple Music tracks are available for this replay. The guided link remains available below.
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-destructive-border bg-destructive/10 p-3 text-sm text-destructive-foreground" data-testid="apple-music-error">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error.message}</span>
          <button type="button" onClick={() => void retry()} className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-mono text-[12px] uppercase">
            <RotateCcw className="h-3 w-3" /> Retry
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-1.5" data-testid="apple-music-receipt">
        {materialization.entries.map((entry) => (
          <span
            key={`${entry.position}-${entry.spinId}`}
            className={`rounded-full border px-2 py-1 font-mono text-[12px] ${
              entry.status === "available" ? "border-primary/40 text-primary" : "border-border text-muted-foreground"
            }`}
            data-testid={`apple-music-entry-${entry.position}`}
          >
            {entry.position + 1} · {entry.status === "available" ? "available" : entry.status}
          </span>
        ))}
      </div>

      {active && queue.entries[currentQueueIndex] ? (
        <div className="mt-4 rounded-lg border border-card-border bg-card p-3">
          <p className="truncate font-serif text-lg font-normal text-foreground">
            {entryLabel(queue.entries[currentQueueIndex])}
          </p>
          <p className="mt-1 font-mono text-[13px] text-muted-foreground">
            manifest position {queue.entries[currentQueueIndex].position + 1} · {currentQueueIndex + 1} of {queue.entries.length} exact matches
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button type="button" onClick={() => void skip("previous")} className="rounded-full border border-border p-2 text-muted-foreground" aria-label="Previous Apple Music track">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => void togglePause()} className="rounded-full border border-primary/50 p-2 text-primary" aria-label={state === "playing" ? "Pause Apple Music" : "Play Apple Music"}>
              {state === "playing" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => void skip("next")} className="rounded-full border border-border p-2 text-muted-foreground" aria-label="Next Apple Music track">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
      {(state === "loading" || state === "authorizing") ? (
        <div className="mt-4 flex items-center gap-2 font-mono text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {statusText}
        </div>
      ) : null}
    </section>
  );
}

export function AppleMusicReplayUnavailable({ materialization }: Props) {
  return (
    <AppleMusicReplayPanel materialization={materialization} />
  );
}