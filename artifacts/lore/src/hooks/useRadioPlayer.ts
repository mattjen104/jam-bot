import { useCallback, useEffect, useRef, useState } from "react";
import type { Station } from "@workspace/api-client-react";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface PlayerState {
  status: PlayerStatus;
  station: Station | null;
  volume: number;
  error: string | null;
}

/**
 * Plays a station's sanctioned live stream URL, unmodified. Audio is never
 * proxied or re-encoded — the browser fetches the origin stream directly.
 * Falls back to hls.js only for `.m3u8` streams on browsers without native HLS.
 */
export function useRadioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<unknown>(null);
  const [state, setState] = useState<PlayerState>({
    status: "idle",
    station: null,
    volume: 0.85,
    error: null,
  });

  if (audioRef.current === null && typeof Audio !== "undefined") {
    const el = new Audio();
    el.preload = "none";
    el.crossOrigin = "anonymous";
    audioRef.current = el;
  }

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = state.volume;
    const onPlaying = () =>
      setState((s) => ({ ...s, status: "playing", error: null }));
    const onWaiting = () => setState((s) => ({ ...s, status: "loading" }));
    const onPause = () =>
      setState((s) =>
        s.status === "idle" ? s : { ...s, status: "paused" },
      );
    const onError = () =>
      setState((s) => ({
        ...s,
        status: "error",
        error: "This stream could not be reached. Try again shortly.",
      }));
    el.addEventListener("playing", onPlaying);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, [state.volume]);

  const teardownHls = useCallback(() => {
    const hls = hlsRef.current as { destroy?: () => void } | null;
    if (hls && typeof hls.destroy === "function") hls.destroy();
    hlsRef.current = null;
  }, []);

  const attachSource = useCallback(
    async (el: HTMLAudioElement, station: Station) => {
      teardownHls();
      const isHls =
        station.streamFormat === "hls" ||
        station.streamUrl.toLowerCase().includes(".m3u8");
      const canNativeHls =
        el.canPlayType("application/vnd.apple.mpegurl") !== "";

      if (isHls && !canNativeHls) {
        const Hls = (await import("hls.js")).default;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          hls.loadSource(station.streamUrl);
          hls.attachMedia(el);
          hlsRef.current = hls;
          return;
        }
      }
      el.src = station.streamUrl;
    },
    [teardownHls],
  );

  const play = useCallback(
    async (station: Station) => {
      const el = audioRef.current;
      if (!el) return;
      setState((s) => ({ ...s, status: "loading", station, error: null }));
      try {
        await attachSource(el, station);
        el.load();
        await el.play();
      } catch {
        setState((s) => ({
          ...s,
          status: "error",
          error: "Playback was blocked or the stream is offline.",
        }));
      }
    },
    [attachSource],
  );

  const toggle = useCallback(
    async (station: Station) => {
      const el = audioRef.current;
      if (!el) return;
      const isCurrent = state.station?.slug === station.slug;
      if (isCurrent && state.status === "playing") {
        el.pause();
        return;
      }
      if (isCurrent && (state.status === "paused" || state.status === "error")) {
        try {
          await el.play();
        } catch {
          await play(station);
        }
        return;
      }
      await play(station);
    },
    [play, state.station?.slug, state.status],
  );

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    teardownHls();
    setState((s) => ({ ...s, status: "idle", station: null }));
  }, [teardownHls]);

  /**
   * Pause the live stream without tearing it down — used when the ride takes
   * over audio so the listener can resume the same station afterwards.
   */
  const pause = useCallback(() => {
    const el = audioRef.current;
    if (el && !el.paused) el.pause();
  }, []);

  const setVolume = useCallback((v: number) => {
    const el = audioRef.current;
    if (el) el.volume = v;
    setState((s) => ({ ...s, volume: v }));
  }, []);

  useEffect(() => () => teardownHls(), [teardownHls]);

  return {
    status: state.status,
    station: state.station,
    volume: state.volume,
    error: state.error,
    toggle,
    stop,
    pause,
    setVolume,
  };
}
