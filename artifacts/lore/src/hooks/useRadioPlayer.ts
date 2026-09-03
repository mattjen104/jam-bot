import { useCallback, useEffect, useRef, useState } from "react";
import type { Station } from "@workspace/api-client-react";
import {
  resolvePlaybackCandidates,
  resolvePrimaryPlaybackCandidate,
  type PlaybackCandidate,
} from "./radioPlaybackSources";

export {
  resolvePlaybackCandidates,
  resolvePrimaryPlaybackCandidate,
  resolvePlaybackSource,
  type PlaybackCandidate,
} from "./radioPlaybackSources";

export type PlayerStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "reconnecting"
  | "recovering"
  | "error";

interface PlayerState {
  status: PlayerStatus;
  station: Station | null;
  volume: number;
  error: string | null;
  candidateIndex: number;
  retryAttempt: number;
}

type PlaybackMetricEvent =
  | "playing"
  | "startup_failure"
  | "stall"
  | "recovered"
  | "terminal_failure";

type FailureReason =
  | "media_error"
  | "ended"
  | "startup_timeout"
  | "stall_timeout"
  | "play_rejected"
  | "hls_network"
  | "hls_media"
  | "hls_fatal";

type AttemptReason =
  | "initial"
  | "retry"
  | "alternate"
  | "lifecycle"
  | "resume";

interface HlsController {
  destroy(): void;
  loadSource(source: string): void;
  attachMedia(el: HTMLMediaElement): void;
  startLoad?: () => void;
  recoverMediaError?: () => void;
  on?: (
    event: string,
    callback: (event: string, data: {
      fatal?: boolean;
      type?: string;
    }) => void,
  ) => void;
}

const STARTUP_TIMEOUT_MS = 8_000;
const STALL_TIMEOUT_MS = 10_000;
const LIFECYCLE_RECOVERY_COOLDOWN_MS = 5_000;
const MAX_SAME_SOURCE_RETRIES = 1;
const MAX_CANDIDATES = 2;
const METRIC_SAMPLE_RATE = 0.25;
const DUCK_VOLUME = 0.15;
const WARMUP_RELEASE_GRACE_MS = 250;

interface WarmAudio {
  el: HTMLAudioElement;
  stationSlug: string;
  candidate: PlaybackCandidate;
}

/**
 * Bounded live-radio player. A listener gesture starts one primary source,
 * allows one same-source retry, then at most one sanctioned alternate.
 */
export function useRadioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<HlsController | null>(null);
  const savedVolumeRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const intentRef = useRef<"playing" | "paused" | "stopped">("stopped");
  const stationRef = useRef<Station | null>(null);
  const candidatesRef = useRef<PlaybackCandidate[]>([]);
  const candidateIndexRef = useRef(0);
  const retryCountRef = useRef(0);
  const hasPlayedRef = useRef(false);
  const warmupUsedRef = useRef(false);
  const sampledRef = useRef(false);
  const intentStartedAtRef = useRef<number | null>(null);
  const startupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmupReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmAudioRef = useRef<WarmAudio | null>(null);
  const preparedWarmAudioRef = useRef<WarmAudio | null>(null);
  const lastLifecycleRecoveryRef = useRef(0);
  const stallStartedAtRef = useRef<number | null>(null);
  const failureHandlingRef = useRef(false);
  const stateRef = useRef<PlayerState>({
    status: "idle",
    station: null,
    volume: 0.85,
    error: null,
    candidateIndex: 0,
    retryAttempt: 0,
  });
  const attemptRef = useRef<
    (station: Station, candidateIndex: number, reason: AttemptReason) => void
  >(() => {});
  const failureRef = useRef<(reason: FailureReason) => void>(() => {});

  const [state, setStateRaw] = useState<PlayerState>(() => ({
    status: "idle",
    station: null,
    volume: 0.85,
    error: null,
    candidateIndex: 0,
    retryAttempt: 0,
  }));
  const setState = useCallback(
    (updater: (current: PlayerState) => PlayerState) => {
      setStateRaw((current) => {
        const next = updater(current);
        stateRef.current = next;
        return next;
      });
    },
    [],
  );

  const clearTimers = useCallback(() => {
    if (startupTimerRef.current) clearTimeout(startupTimerRef.current);
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    startupTimerRef.current = null;
    stallTimerRef.current = null;
    retryTimerRef.current = null;
  }, []);

  const teardownHls = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const closeWarmAudio = useCallback(() => {
    if (warmupReleaseTimerRef.current) {
      clearTimeout(warmupReleaseTimerRef.current);
      warmupReleaseTimerRef.current = null;
    }
    const warm = warmAudioRef.current;
    warmAudioRef.current = null;
    if (!warm) return;
    if (!warm.el.paused) warm.el.pause();
    warm.el.removeAttribute("src");
    warm.el.load();
  }, []);

  /**
   * Open only the selected station's first sanctioned source. This intentionally
   * has no event listeners and never calls play(), so it cannot bypass a user
   * gesture or affect the active player element.
   */
  const warmup = useCallback(
    (station: Station) => {
      const candidate = resolvePrimaryPlaybackCandidate(station);
      if (
        !candidate ||
        typeof Audio === "undefined" ||
        stationRef.current?.slug === station.slug
      ) {
        closeWarmAudio();
        return;
      }

      const existing = warmAudioRef.current;
      if (
        existing?.stationSlug === station.slug &&
        existing.candidate.url === candidate.url
      ) {
        if (warmupReleaseTimerRef.current) {
          clearTimeout(warmupReleaseTimerRef.current);
          warmupReleaseTimerRef.current = null;
        }
        return;
      }

      closeWarmAudio();
      const el = new Audio();
      el.preload = "auto";
      warmAudioRef.current = { el, stationSlug: station.slug, candidate };
      el.src = candidate.url;
      el.load();
    },
    [closeWarmAudio],
  );

  /** Release after the pointer sequence has had a chance to dispatch click. */
  const releaseWarmup = useCallback(() => {
    if (!warmAudioRef.current) return;
    if (warmupReleaseTimerRef.current) clearTimeout(warmupReleaseTimerRef.current);
    warmupReleaseTimerRef.current = setTimeout(() => {
      warmupReleaseTimerRef.current = null;
      closeWarmAudio();
    }, WARMUP_RELEASE_GRACE_MS);
  }, [closeWarmAudio]);

  /** Cancel immediately when the pointer sequence is abandoned. */
  const cancelWarmup = useCallback(() => {
    closeWarmAudio();
  }, [closeWarmAudio]);

  const emitMetric = useCallback(
    (
      event: PlaybackMetricEvent,
      candidate: PlaybackCandidate | undefined,
      startupMs?: number,
      stallMs?: number,
    ) => {
      const station = stationRef.current;
      if (
        !sampledRef.current ||
        !station ||
        !candidate ||
        typeof fetch !== "function"
      ) {
        return;
      }
      const body = {
        event,
        transport: candidate.transport,
        format: candidate.format,
        ...(typeof startupMs === "number"
          ? { startupMs: Math.max(0, Math.round(startupMs)) }
          : {}),
        ...(typeof stallMs === "number"
          ? { stallMs: Math.max(0, Math.round(stallMs)) }
          : {}),
        warmed: warmupUsedRef.current,
      };
      void fetch(
        `/api/stations/${encodeURIComponent(station.slug)}/playback-events`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          keepalive: true,
        },
      ).catch(() => undefined);
    },
    [],
  );

  const removeCurrentSource = useCallback(
    (el: HTMLAudioElement) => {
      teardownHls();
      if (!el.paused) el.pause();
      el.removeAttribute("src");
      el.load();
    },
    [teardownHls],
  );

  const armStartupDeadline = useCallback(
    (generation: number) => {
      if (startupTimerRef.current) clearTimeout(startupTimerRef.current);
      startupTimerRef.current = setTimeout(() => {
        if (generationRef.current !== generation || intentRef.current !== "playing") {
          return;
        }
        failureRef.current("startup_timeout");
      }, STARTUP_TIMEOUT_MS);
    },
    [],
  );

  const markStall = useCallback(
    (candidate: PlaybackCandidate, generation: number) => {
      if (stallStartedAtRef.current === null) {
        stallStartedAtRef.current = performance.now();
        emitMetric("stall", candidate);
      }
      setState((current) => ({
        ...current,
        status: "reconnecting",
        error: null,
      }));
      if (stallTimerRef.current) return;
      stallTimerRef.current = setTimeout(() => {
        stallTimerRef.current = null;
        if (
          generationRef.current === generation &&
          intentRef.current === "playing"
        ) {
          failureRef.current("stall_timeout");
        }
      }, STALL_TIMEOUT_MS);
    },
    [emitMetric, setState],
  );

  const attachSource = useCallback(
    async (
      el: HTMLAudioElement,
      candidate: PlaybackCandidate,
      generation: number,
    ) => {
      teardownHls();
      const isHls =
        candidate.format === "hls" ||
        candidate.url.toLowerCase().includes(".m3u8");
      const canNativeHls =
        el.canPlayType("application/vnd.apple.mpegurl") !== "";

      if (isHls && !canNativeHls) {
        const Hls = (await import("hls.js")).default;
        if (generationRef.current !== generation) return;
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            liveSyncDurationCount: 2,
            liveMaxLatencyDurationCount: 5,
            maxBufferLength: 6,
            maxMaxBufferLength: 10,
            backBufferLength: 0,
            maxBufferHole: 0.5,
          }) as HlsController;
          let networkRecoveries = 0;
          let mediaRecoveries = 0;
          const errorEvent = Hls.Events?.ERROR ?? "hlsError";
          hls.on?.(errorEvent, (_event, data) => {
            if (
              !data.fatal ||
              generationRef.current !== generation ||
              intentRef.current !== "playing"
            ) {
              return;
            }
            const type = String(data.type ?? "");
            if (/network/i.test(type) && networkRecoveries < 1 && hls.startLoad) {
              networkRecoveries++;
              if (hasPlayedRef.current) {
                markStall(candidate, generation);
              } else {
                setState((current) => ({
                  ...current,
                  status: "reconnecting",
                  error: null,
                }));
              }
              hls.startLoad();
              if (!hasPlayedRef.current) armStartupDeadline(generation);
              return;
            }
            if (/media/i.test(type) && mediaRecoveries < 1 && hls.recoverMediaError) {
              mediaRecoveries++;
              if (hasPlayedRef.current) {
                markStall(candidate, generation);
              } else {
                setState((current) => ({
                  ...current,
                  status: "reconnecting",
                  error: null,
                }));
              }
              hls.recoverMediaError();
              if (!hasPlayedRef.current) armStartupDeadline(generation);
              return;
            }
            failureRef.current("hls_fatal");
          });
          hls.loadSource(candidate.url);
          hls.attachMedia(el);
          hlsRef.current = hls;
          return;
        }
      }
      el.src = candidate.url;
    },
    [armStartupDeadline, markStall, setState, teardownHls],
  );

  const beginAttempt = useCallback(
    (
      station: Station,
      candidateIndex: number,
      reason: AttemptReason,
    ) => {
      const candidate = candidatesRef.current[candidateIndex];
      if (
        typeof Audio === "undefined" ||
        !candidate ||
        intentRef.current !== "playing"
      ) {
        return;
      }

      const generation = ++generationRef.current;
      failureHandlingRef.current = false;
      clearTimers();
      const previous = audioRef.current;
      const prepared = preparedWarmAudioRef.current;
      preparedWarmAudioRef.current = null;
      const preparedMatches = prepared?.candidate.url === candidate.url;
      const preparedElement = preparedMatches ? prepared.el : null;
      if (previous && previous !== preparedElement) removeCurrentSource(previous);
      if (prepared && !preparedMatches) {
        if (!prepared.el.paused) prepared.el.pause();
        prepared.el.removeAttribute("src");
        prepared.el.load();
      }
      const el = preparedElement ?? new Audio();
      if (!preparedElement) el.preload = "none";
      el.volume =
        savedVolumeRef.current === null ? stateRef.current.volume : DUCK_VOLUME;
      audioRef.current = el;
      candidateIndexRef.current = candidateIndex;
      const status: PlayerStatus =
        reason === "initial"
          ? "loading"
          : reason === "alternate"
            ? "recovering"
            : "reconnecting";
      setState((current) => ({
        ...current,
        status,
        station,
        error: null,
        candidateIndex,
        retryAttempt: retryCountRef.current,
      }));

      const isCurrentAttempt = () =>
        generationRef.current === generation &&
        audioRef.current === el &&
        intentRef.current === "playing";
      const onPlaying = () => {
        if (!isCurrentAttempt()) return;
        clearTimers();
        failureHandlingRef.current = false;
        const wasRecovering =
          stateRef.current.status === "reconnecting" ||
          stateRef.current.status === "recovering";
        const hadPlayed = hasPlayedRef.current;
        hasPlayedRef.current = true;
        setState((current) => ({
          ...current,
          status: "playing",
          error: null,
          retryAttempt: 0,
        }));
        const startedAt = intentStartedAtRef.current;
        if (!hadPlayed) {
          emitMetric(
            "playing",
            candidate,
            startedAt === null ? undefined : performance.now() - startedAt,
          );
        } else if (wasRecovering && reason !== "resume") {
          const stalledAt = stallStartedAtRef.current;
          emitMetric(
            "recovered",
            candidate,
            undefined,
            stalledAt === null ? undefined : performance.now() - stalledAt,
          );
        }
        stallStartedAtRef.current = null;
        intentStartedAtRef.current = null;
      };
      const onWaiting = () => {
        if (!isCurrentAttempt() || !hasPlayedRef.current) return;
        markStall(candidate, generation);
      };
      const onError = () => {
        if (isCurrentAttempt()) failureRef.current("media_error");
      };
      const onEnded = () => {
        if (isCurrentAttempt()) failureRef.current("ended");
      };
      el.addEventListener("playing", onPlaying);
      el.addEventListener("waiting", onWaiting);
      el.addEventListener("stalled", onWaiting);
      el.addEventListener("error", onError);
      el.addEventListener("ended", onEnded);

      armStartupDeadline(generation);
      void attachSource(el, candidate, generation)
        .then(() => {
          if (
            generationRef.current !== generation ||
            intentRef.current !== "playing"
          ) {
            return;
          }
          el.load();
          return el.play();
        })
        .catch(() => {
          if (generationRef.current === generation) {
            failureRef.current("play_rejected");
          }
        });
    },
    [
      armStartupDeadline,
      attachSource,
      clearTimers,
      emitMetric,
      markStall,
      removeCurrentSource,
      setState,
    ],
  );
  useEffect(() => {
    attemptRef.current = beginAttempt;
  }, [beginAttempt]);

  const handleFailure = useCallback(
    (_reason: FailureReason) => {
      if (
        intentRef.current !== "playing" ||
        failureHandlingRef.current
      ) {
        return;
      }
      const station = stationRef.current;
      const candidate = candidatesRef.current[candidateIndexRef.current];
      if (!station || !candidate) return;
      failureHandlingRef.current = true;

      ++generationRef.current;
      clearTimers();
      const el = audioRef.current;
      if (el) removeCurrentSource(el);
      if (!hasPlayedRef.current) {
        emitMetric("startup_failure", candidate);
      } else if (stallStartedAtRef.current === null) {
        stallStartedAtRef.current = performance.now();
        emitMetric("stall", candidate);
      }

      if (retryCountRef.current < MAX_SAME_SOURCE_RETRIES) {
        retryCountRef.current++;
        setState((current) => ({
          ...current,
          status: "reconnecting",
          error: null,
          retryAttempt: retryCountRef.current,
        }));
        const delay = 250 + Math.floor(Math.random() * 500);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          attemptRef.current(station, candidateIndexRef.current, "retry");
        }, delay);
        return;
      }

      const nextIndex = candidateIndexRef.current + 1;
      if (
        nextIndex < candidatesRef.current.length &&
        nextIndex < MAX_CANDIDATES
      ) {
        retryCountRef.current = 0;
        setState((current) => ({
          ...current,
          status: "recovering",
          error: null,
          candidateIndex: nextIndex,
          retryAttempt: 0,
        }));
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          attemptRef.current(station, nextIndex, "alternate");
        }, 150);
        return;
      }

      setState((current) => ({
        ...current,
        status: "error",
        error:
          "This stream is unavailable. Retry here or listen on the station site.",
      }));
      emitMetric("terminal_failure", candidate);
    },
    [clearTimers, emitMetric, removeCurrentSource, setState],
  );
  useEffect(() => {
    failureRef.current = handleFailure;
  }, [handleFailure]);

  const play = useCallback(
    async (station: Station) => {
      ++generationRef.current;
      clearTimers();
      const previous = audioRef.current;
      if (previous) removeCurrentSource(previous);
      audioRef.current = null;
      const candidates = resolvePlaybackCandidates(station);
      stationRef.current = station;
      candidatesRef.current = candidates;
      candidateIndexRef.current = 0;
      retryCountRef.current = 0;
      hasPlayedRef.current = false;
      stallStartedAtRef.current = null;
      const warm = warmAudioRef.current;
      if (
        warm &&
        warm.stationSlug === station.slug &&
        warm.candidate.url === candidates[0]?.url
      ) {
        if (warmupReleaseTimerRef.current) {
          clearTimeout(warmupReleaseTimerRef.current);
          warmupReleaseTimerRef.current = null;
        }
        warmAudioRef.current = null;
        preparedWarmAudioRef.current = warm;
        warmupUsedRef.current = true;
      } else {
        closeWarmAudio();
        preparedWarmAudioRef.current = null;
        warmupUsedRef.current = false;
      }
      sampledRef.current = Math.random() < METRIC_SAMPLE_RATE;
      intentStartedAtRef.current = performance.now();
      intentRef.current = "playing";

      if (candidates.length === 0) {
        setState((current) => ({
          ...current,
          status: "error",
          station,
          error: "This station has no live stream configured.",
        }));
        return;
      }
      attemptRef.current(station, 0, "initial");
    },
    [clearTimers, closeWarmAudio, removeCurrentSource, setState],
  );

  const pause = useCallback(() => {
    intentRef.current = "paused";
    ++generationRef.current;
    clearTimers();
    const el = audioRef.current;
    if (el && !el.paused) el.pause();
    stallStartedAtRef.current = null;
    setState((current) =>
      current.status === "idle"
        ? current
        : { ...current, status: "paused", error: null },
    );
  }, [clearTimers, setState]);

  const retry = useCallback(() => {
    const station = stationRef.current;
    if (!station) return;
    intentRef.current = "playing";
    sampledRef.current = Math.random() < METRIC_SAMPLE_RATE;
    intentStartedAtRef.current = performance.now();
    hasPlayedRef.current = false;
    stallStartedAtRef.current = null;
    retryCountRef.current = 0;
    candidateIndexRef.current = 0;
    warmupUsedRef.current = false;
    attemptRef.current(station, 0, "initial");
  }, []);

  const resume = useCallback(() => {
    const station = stationRef.current;
    if (!station) return;
    intentRef.current = "playing";
    intentStartedAtRef.current = null;
    retryCountRef.current = 0;
    attemptRef.current(station, candidateIndexRef.current, "resume");
  }, []);

  const toggle = useCallback(
    async (station: Station) => {
      const isCurrent = stationRef.current?.slug === station.slug;
      const status = stateRef.current.status;
      if (
        isCurrent &&
        (status === "playing" ||
          status === "loading" ||
          status === "reconnecting" ||
          status === "recovering")
      ) {
        pause();
        return;
      }
      if (isCurrent && status === "paused") {
        resume();
        return;
      }
      if (isCurrent && status === "error") {
        retry();
        return;
      }
      await play(station);
    },
    [pause, play, resume, retry],
  );

  const stop = useCallback(() => {
    intentRef.current = "stopped";
    stationRef.current = null;
    candidatesRef.current = [];
    ++generationRef.current;
    clearTimers();
    const el = audioRef.current;
    if (el) removeCurrentSource(el);
    setState((current) => ({
      ...current,
      status: "idle",
      station: null,
      error: null,
      candidateIndex: 0,
      retryAttempt: 0,
    }));
  }, [clearTimers, removeCurrentSource, setState]);

  useEffect(() => {
    const recoverIfNeeded = () => {
      if (
        intentRef.current !== "playing" ||
        !stationRef.current ||
        !hasPlayedRef.current
      ) {
        return;
      }
      const now = Date.now();
      if (
        now - lastLifecycleRecoveryRef.current <
        LIFECYCLE_RECOVERY_COOLDOWN_MS
      ) {
        return;
      }
      const el = audioRef.current;
      if (
        stateRef.current.status === "playing" &&
        el &&
        !el.paused &&
        !el.error
      ) {
        return;
      }
      lastLifecycleRecoveryRef.current = now;
      retryCountRef.current = 0;
      attemptRef.current(
        stationRef.current,
        candidateIndexRef.current,
        "lifecycle",
      );
    };
    const onOnline = () => recoverIfNeeded();
    const onPageShow = () => recoverIfNeeded();
    const onVisibility = () => {
      if (document.visibilityState === "visible") recoverIfNeeded();
    };
    const onOffline = () => {
      if (intentRef.current !== "playing") return;
      ++generationRef.current;
      clearTimers();
      const candidate = candidatesRef.current[candidateIndexRef.current];
      if (
        candidate &&
        hasPlayedRef.current &&
        stallStartedAtRef.current === null
      ) {
        stallStartedAtRef.current = performance.now();
        emitMetric("stall", candidate);
      }
      setState((current) => ({
        ...current,
        status: "reconnecting",
        error: null,
      }));
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clearTimers, emitMetric, setState]);

  const duck = useCallback(() => {
    const el = audioRef.current;
    if (!el || savedVolumeRef.current !== null) return;
    savedVolumeRef.current = el.volume;
    el.volume = DUCK_VOLUME;
  }, []);

  const restoreDuck = useCallback(() => {
    const el = audioRef.current;
    if (savedVolumeRef.current === null) return;
    const target = savedVolumeRef.current;
    savedVolumeRef.current = null;
    if (el) el.volume = target;
  }, []);

  const setVolumeWithDuck = useCallback(
    (volume: number) => {
      const el = audioRef.current;
      if (el) {
        if (savedVolumeRef.current !== null) {
          savedVolumeRef.current = volume;
        } else {
          el.volume = volume;
        }
      }
      setState((current) => ({ ...current, volume }));
    },
    [setState],
  );

  useEffect(
    () => () => {
      intentRef.current = "stopped";
      ++generationRef.current;
      clearTimers();
      closeWarmAudio();
      const prepared = preparedWarmAudioRef.current;
      preparedWarmAudioRef.current = null;
      if (prepared) {
        if (!prepared.el.paused) prepared.el.pause();
        prepared.el.removeAttribute("src");
        prepared.el.load();
      }
      const el = audioRef.current;
      if (el) removeCurrentSource(el);
    },
    [clearTimers, closeWarmAudio, removeCurrentSource],
  );

  return {
    status: state.status,
    station: state.station,
    volume: state.volume,
    error: state.error,
    candidateIndex: state.candidateIndex,
    retryAttempt: state.retryAttempt,
    play,
    toggle,
    retry,
    stop,
    pause,
    resume,
    setVolume: setVolumeWithDuck,
    duck,
    restoreDuck,
    warmup,
    releaseWarmup,
    cancelWarmup,
  };
}