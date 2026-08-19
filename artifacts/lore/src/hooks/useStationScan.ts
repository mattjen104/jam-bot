/**
 * useStationScan — track-by-track scan inside one station's expansion.
 *
 * Two modes:
 * - `lastSet`: scans the station's most recent logged spins (the previous
 *   set) via GET /api/stations/spins?slug=…&limit=50.
 * - `newMusic`: scans the station's rolling 48-hour window via
 *   GET /api/stations/recent-spins?slug-filtered&hours=48, surfacing
 *   `isFirstSpin` tracks with their hour-of-day so airtime patterns emerge.
 *
 * While a scan is active the live stream is DUCKED (volume ≈ 15%), never
 * stopped — the socket stays open so landing has no reconnect cost. The
 * scan plays iTunes previews through its own side-channel audio element
 * (independent of PlayerProvider's ride/scan element).
 *
 * Duck lifecycle: `start()` ducks; `stop()`, `land()`, and unmount restore.
 * A failed preview lookup for the current track does NOT end the scan (we
 * skip ahead quickly), but if the scan ends for any reason the volume is
 * always restored exactly once (restoreDuck is idempotent).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getStationSpins,
  getStationsRecentSpins,
} from "@workspace/api-client-react";
import { getPreviewCached, prefetchPreview } from "../player/previewCache";

export type StationScanMode = "lastSet" | "newMusic";

export interface StationScanTrack {
  mbid: string | null;
  title: string;
  artist: string;
  /** Album title when known (lastSet mode joins recording metadata). */
  album: string | null;
  playedAt: string | null;
  /** UTC hour-of-day (0-23) the spin aired — newMusic mode only. */
  playedAtHour: number | null;
  djName: string | null;
  showName: string | null;
  /** First-ever archive appearance (newMusic mode). */
  isFirstSpin: boolean;
}

export const STATION_SCAN_DWELLS = [3000, 7000, 20000] as const;
/** Quick-skip delay when a track has no preview (mirrors the live scan). */
const SKIP_MS = 400;
/** Stable empty list so an unselected mode never churns referential identity. */
const EMPTY_TRACKS: StationScanTrack[] = [];

/** Format a UTC hour integer (0-23) as a compact clock label, e.g. "2 PM". */
export function fmtHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}

interface RadioDuckApi {
  duck: () => void;
  restoreDuck: () => void;
}

export function useStationScan(
  mode: StationScanMode | null,
  slug: string | null,
  radio: RadioDuckApi,
) {
  // Fetch result keyed by mode+slug: deriving tracks/error/isLoading from the
  // key match means a mode/slug change resets them without any synchronous
  // setState inside the fetch effect.
  const [fetchState, setFetchState] = useState<{
    key: string | null;
    tracks: StationScanTrack[];
    error: string | null;
  }>({ key: null, tracks: [], error: null });
  const fetchKey = mode && slug ? `${mode}:${slug}` : null;
  const settled = fetchKey != null && fetchState.key === fetchKey;
  const tracks = settled ? fetchState.tracks : EMPTY_TRACKS;
  const error = settled ? fetchState.error : null;
  const isLoading = fetchKey != null && !settled;
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [idx, setIdx] = useState(0);
  const [dwellMs, setDwellMs] = useState<number>(7000);

  // Side-channel audio element for previews — independent of PlayerProvider.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic token invalidating stale async preview resolutions.
  const tokenRef = useRef(0);
  // Mirror of `active` readable in unmount cleanup.
  const activeRef = useRef(false);
  const radioRef = useRef(radio);
  const dwellRef = useRef(dwellMs);
  const pausedRef = useRef(false);
  // Latest-value mirrors, synced in effects (read only from callbacks and
  // timers, which always fire after the commit that scheduled them).
  useEffect(() => {
    radioRef.current = radio;
  }, [radio]);
  useEffect(() => {
    dwellRef.current = dwellMs;
  }, [dwellMs]);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const silence = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
  }, []);

  // ── data fetch: runs when a mode is selected ────────────────────────────
  useEffect(() => {
    if (!mode || !slug) return;
    const key = `${mode}:${slug}`;
    let cancelled = false;

    const load = async (): Promise<StationScanTrack[]> => {
      if (mode === "lastSet") {
        const page = await getStationSpins({ slug, limit: 50 });
        return page.tracks.map((t) => ({
          mbid: t.recording?.mbid ?? null,
          title: t.recording?.title ?? t.rawTitle,
          artist: t.recording?.artist ?? t.rawArtist,
          album: null,
          playedAt: t.playedAt ?? null,
          playedAtHour: null,
          djName: null,
          showName: null,
          isFirstSpin: false,
        }));
      }
      // newMusic: rolling 48h window across all stations; pick this one.
      const result = await getStationsRecentSpins({ hours: 48 });
      const entry = result.items.find((it) => it.stationSlug === slug);
      return (entry?.spins ?? []).map((sp) => ({
        mbid: sp.mbid,
        title: sp.title,
        artist: sp.artist,
        album: null,
        playedAt: sp.playedAt,
        playedAtHour: sp.playedAtHour,
        djName: sp.djName,
        showName: sp.showName,
        isFirstSpin: sp.isFirstSpin,
      }));
    };

    load().then(
      (list) => {
        if (cancelled) return;
        setFetchState({ key, tracks: list, error: null });
      },
      () => {
        if (cancelled) return;
        setFetchState({
          key,
          tracks: [],
          error: "Couldn't load this station's tracks",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mode, slug]);

  // ── playback effect: plays the current track's preview, advances ────────
  useEffect(() => {
    if (!active || tracks.length === 0) {
      clearTimer();
      return;
    }
    const track = tracks[idx % tracks.length];
    if (!track) return;
    const token = ++tokenRef.current;

    // Paused: hold on this track with no audio hop. The token bump above
    // invalidates any in-flight preview resolution so a delayed lookup can't
    // start the previous track under the newly selected row. Resume flips
    // `paused`, re-running this effect for the CURRENT idx.
    if (paused) return;

    if (!track.mbid) {
      // Unresolved track — no preview possible; quick-skip.
      timerRef.current = setTimeout(() => {
        setIdx((i) => (i + 1) % tracks.length);
      }, SKIP_MS);
      return clearTimer;
    }

    void getPreviewCached(track.mbid)
      .then((p) => {
        if (tokenRef.current !== token) return;
        if (!audioRef.current && typeof Audio !== "undefined") {
          audioRef.current = new Audio();
        }
        const el = audioRef.current;
        if (p.previewUrl && el) {
          el.src = p.previewUrl;
          el.load();
          void el.play().catch(() => {
            /* autoplay blocked — dwell still advances */
          });
        }
        // Prefetch the NEXT track's preview URL one hop ahead.
        const next = tracks[(idx + 1) % tracks.length];
        if (next?.mbid && next.mbid !== track.mbid) prefetchPreview(next.mbid);
        timerRef.current = setTimeout(() => {
          setIdx((i) => (i + 1) % tracks.length);
        }, p.previewUrl ? dwellRef.current : SKIP_MS);
      })
      .catch(() => {
        if (tokenRef.current !== token) return;
        // Failed preview lookup — skip quickly; duck stays (scan continues).
        timerRef.current = setTimeout(() => {
          setIdx((i) => (i + 1) % tracks.length);
        }, SKIP_MS);
      });

    return clearTimer;
  }, [active, idx, tracks, paused, clearTimer]);

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    setIdx(0);
    setActive(true);
    // Duck the live stream — never stop it. No reconnect cost on land.
    radioRef.current.duck();
  }, []);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    tokenRef.current += 1;
    clearTimer();
    silence();
    setActive(false);
    setPaused(false);
    pausedRef.current = false;
    radioRef.current.restoreDuck();
  }, [clearTimer, silence]);

  /** Land: commit to the live stream — stop previews, restore full volume. */
  const land = useCallback(() => {
    stop();
  }, [stop]);

  const next = useCallback(() => {
    if (!activeRef.current || tracks.length === 0) return;
    tokenRef.current += 1;
    clearTimer();
    // Silence the outgoing preview immediately so it can't keep playing (or
    // be resumed later) under the newly selected row.
    silence();
    setIdx((i) => (i + 1) % tracks.length);
  }, [tracks.length, clearTimer, silence]);

  const prev = useCallback(() => {
    if (!activeRef.current || tracks.length === 0) return;
    tokenRef.current += 1;
    clearTimer();
    silence();
    setIdx((i) => (i - 1 + tracks.length) % tracks.length);
  }, [tracks.length, clearTimer, silence]);

  const togglePause = useCallback(() => {
    if (!activeRef.current) return;
    if (pausedRef.current) {
      pausedRef.current = false;
      // Resume is state-driven: flipping `paused` re-runs the playback effect,
      // which resolves and plays the CURRENT track's preview and arms the
      // dwell timer — so a hop made while paused always lands on the right
      // audio instead of resuming the stale source.
      setPaused(false);
    } else {
      pausedRef.current = true;
      setPaused(true);
      clearTimer();
      audioRef.current?.pause();
    }
  }, [clearTimer]);

  // Restore duck + silence previews on unmount (leaving the station level).
  useEffect(
    () => () => {
      if (activeRef.current) {
        activeRef.current = false;
        clearTimer();
        const el = audioRef.current;
        if (el) {
          el.pause();
          el.removeAttribute("src");
        }
        radioRef.current.restoreDuck();
      }
    },
    [clearTimer],
  );

  const current = useMemo(
    () => (active && tracks.length > 0 ? tracks[idx % tracks.length] : null),
    [active, tracks, idx],
  );

  return {
    tracks,
    isLoading,
    error,
    active,
    paused,
    idx,
    current,
    dwellMs,
    setDwellMs,
    start,
    stop,
    land,
    next,
    prev,
    togglePause,
  };
}
