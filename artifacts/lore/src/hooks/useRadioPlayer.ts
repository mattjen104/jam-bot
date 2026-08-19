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
 * Resolve the audio source for a station. Direct HTTPS streams play as-is.
 * Plain-HTTP streams are blocked as mixed content when Lore is served over
 * HTTPS, so allowlisted stations carry a server-side `relayUrl` — a same-origin
 * path that relays the upstream bytes (audio unchanged, ICY headers passed
 * through). Returns null when the station has no playable source at all.
 */
export function resolvePlaybackSource(station: Station): string | null {
  const direct = station.streamUrl;
  const relay = station.relayUrl ?? null;
  if (direct) {
    // A plain-HTTP stream can't be fetched from an HTTPS page; use the relay
    // when one exists. (When Lore itself runs over plain HTTP — local dev —
    // the relay still works, so preferring it for http:// sources is safe.)
    if (direct.startsWith("http://") && relay) return relay;
    return direct;
  }
  return relay;
}

/**
 * Plays a station's sanctioned live stream URL, unmodified. Audio is never
 * re-encoded — the browser fetches the origin stream directly, except for
 * allowlisted HTTP-only stations, which route through the same-origin HTTPS
 * relay (see resolvePlaybackSource). Falls back to hls.js only for `.m3u8`
 * streams on browsers without native HLS.
 */
export function useRadioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<unknown>(null);
  // Non-null while the live stream is ducked (see duck()/restoreDuck()); holds
  // the volume to restore. setVolume during a duck retargets this instead of
  // the live element, so the user's change survives the restore.
  const savedVolumeRef = useRef<number | null>(null);
  const [state, setState] = useState<PlayerState>({
    status: "idle",
    station: null,
    volume: 0.85,
    error: null,
  });

  // Lazily create the HTMLAudioElement outside render (effects and event
  // handlers only) so ref writes stay out of the render phase. Every playback
  // entry point calls this instead of reading audioRef directly, so a user
  // gesture that fires before the mount effect still gets a live element.
  const ensureAudio = useCallback((): HTMLAudioElement | null => {
    if (audioRef.current === null && typeof Audio !== "undefined") {
      const el = new Audio();
      el.preload = "none";
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  useEffect(() => {
    const el = ensureAudio();
    if (!el) return;
    // While ducked, the element stays at DUCK_VOLUME — state.volume is the
    // user's preferred (restore) level, applied by restoreDuck() instead.
    if (savedVolumeRef.current === null) el.volume = state.volume;
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
  }, [state.volume, ensureAudio]);

  const teardownHls = useCallback(() => {
    const hls = hlsRef.current as { destroy?: () => void } | null;
    if (hls && typeof hls.destroy === "function") hls.destroy();
    hlsRef.current = null;
  }, []);

  const attachSource = useCallback(
    async (el: HTMLAudioElement, station: Station, source: string) => {
      teardownHls();
      const isHls =
        station.streamFormat === "hls" ||
        source.toLowerCase().includes(".m3u8");
      const canNativeHls =
        el.canPlayType("application/vnd.apple.mpegurl") !== "";

      if (isHls && !canNativeHls) {
        const Hls = (await import("hls.js")).default;
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            maxBufferLength: 8,  // live edge reachable faster (default: 30s)
            backBufferLength: 0, // no back-buffer needed for live radio
          });
          hls.loadSource(source);
          hls.attachMedia(el);
          hlsRef.current = hls;
          return;
        }
      }
      el.src = source;
    },
    [teardownHls],
  );

  const play = useCallback(
    async (station: Station) => {
      const el = ensureAudio();
      if (!el) return;
      const source = resolvePlaybackSource(station);
      if (!source) {
        setState((s) => ({
          ...s,
          status: "error",
          station,
          error: "This station has no live stream configured.",
        }));
        return;
      }
      setState((s) => ({ ...s, status: "loading", station, error: null }));
      try {
        await attachSource(el, station, source);
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
    [attachSource, ensureAudio],
  );

  const toggle = useCallback(
    async (station: Station) => {
      const el = ensureAudio();
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
    [play, ensureAudio, state.station?.slug, state.status],
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

  /**
   * Resume a previously paused stream without changing the source. Used when
   * a service-ride falls back to the broadcast for one track.
   */
  const resume = useCallback(() => {
    const el = audioRef.current;
    if (el && el.paused && el.src) {
      void el.play().catch(() => {});
    }
  }, []);

  /**
   * Temporarily lower the live-stream volume to a background level so an
   * iTunes preview can play over it without stopping the stream.
   *
   * Stores the current `state.volume` in a ref so `setVolume` calls during a
   * duck still update the saved restore target (user-visible volume is
   * preserved).  The audio element itself is set to DUCK_VOLUME; `state.volume`
   * is NOT changed, so the UI volume knob shows the real value throughout.
   */
  const DUCK_VOLUME = 0.15;

  const duck = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    // Only duck once; a second call while already ducked is a no-op.
    if (savedVolumeRef.current !== null) return;
    savedVolumeRef.current = el.volume;
    el.volume = DUCK_VOLUME;
  }, []);

  /**
   * Restore the stream volume that was in effect before `duck()` was called.
   * Uses the saved ref value so intermediate `setVolume` calls during the duck
   * are honoured on restore.  No-op if duck was never called.
   */
  const restoreDuck = useCallback(() => {
    const el = audioRef.current;
    if (savedVolumeRef.current === null) return;
    // savedVolumeRef holds the restore target: the pre-duck volume, or the
    // user's newer preference if setVolume was called during the duck
    // (setVolumeWithDuck retargets the ref while ducked).
    const target = savedVolumeRef.current;
    savedVolumeRef.current = null;
    if (el) el.volume = target;
  }, []);

  // Override setVolume: when ducked, update the saved-volume target too so
  // the user's new preference is the value restored on restoreDuck.
  const setVolumeWithDuck = useCallback((v: number) => {
    const el = audioRef.current;
    if (el) {
      if (savedVolumeRef.current !== null) {
        // Currently ducked — update saved target and keep element ducked.
        savedVolumeRef.current = v;
      } else {
        el.volume = v;
      }
    }
    setState((s) => ({ ...s, volume: v }));
  }, []);

  useEffect(() => () => teardownHls(), [teardownHls]);

  return {
    status: state.status,
    station: state.station,
    volume: state.volume,
    error: state.error,
    play,
    toggle,
    stop,
    pause,
    resume,
    setVolume: setVolumeWithDuck,
    duck,
    restoreDuck,
  };
}
