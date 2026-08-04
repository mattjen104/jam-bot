// @refresh reset
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getRecording,
  getRecordingSegues,
  getRecordingPreview,
  getStationNowPlaying,
  spotifyPlay,
  spotifyPause,
  spotifyResume,
  useListStations,
  type RecordingLink,
  type SegueNext,
  type Station,
} from "@workspace/api-client-react";
import { useWpOnAir } from "../webplayer/hooks";
import { useRadioPlayer, type PlayerStatus } from "../hooks/useRadioPlayer";
import {
  useSpotifyConnect,
  type SpotifyConnectApi,
} from "./useSpotifyConnect";
import {
  type TimeOrientation,
  type PlaybackMode,
  isLiveServiceRide,
  readStoredPlaybackMode,
  writeStoredPlaybackMode,
} from "./playbackSession";
import { useSpotifyDriver } from "./useSpotifyDriver";
import { useYouTubeDriver } from "./useYouTubeDriver";
import { useAppleMusicDriver } from "./useAppleMusicDriver";
import {
  writeRadioSectionMemory,
  writeSelectorSectionMemory,
  writeLibrarySectionMemory,
  type StoredStation,
} from "./sectionMemory";
import { useAppConfig } from "../lib/meHooks";

/** How we arrived at a track in the ride — the attribution for this transition. */
export interface RideAttribution {
  stations: SegueNext["stations"];
  pickers: NonNullable<SegueNext["pickers"]>;
}

/** One track in a ride queue. `previewUrl` is undefined until resolved. */
export interface RideItem {
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  links: RecordingLink[];
  previewUrl?: string | null;
  attribution: RideAttribution | null;
}

export type RideStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "error";

/** The seed a caller hands `startRide` — the track the ride departs from. */
export interface RideSeed {
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  links: RecordingLink[];
}

/** Options for starting a trail ride. */
export interface StartRideOpts {
  /**
   * Distinguishes session shape:
   * - 'live': advance on station now-playing MBID change (requires stationSlug)
   * - 'past': ghost-radio replay, fixed queue
   * - 'curated': picker or segue trail, step-through queue
   * Defaults to 'curated' when not provided.
   */
  timeOrientation?: TimeOrientation;
  /**
   * Station slug for live orientation. When provided and the user is in
   * service-ride mode, advances are driven by the station's now-playing MBID
   * change rather than Spotify's playback-end signal.
   */
  stationSlug?: string;
}

/**
 * Live-radio Spotify casting state (no ride involved).
 * - off        : normal broadcast listening
 * - connecting : device pinned, waiting for a resolvable track
 * - casting    : the station's current track is playing on the listener's Spotify
 * - fallback   : the current track couldn't play on Spotify — broadcast carries it
 */
export type RadioCastStatus = "off" | "connecting" | "casting" | "fallback";

/** Why a live cast fell back to the broadcast — drives the honest status line. */
export type RadioCastFallbackReason =
  | "not_on_spotify"
  | "rate_limited"
  | "spotify_error";

interface RadioApi {
  status: PlayerStatus;
  station: Station | null;
  volume: number;
  error: string | null;
  /** Live casting state — non-"off" only when a Spotify device is pinned. */
  casting: RadioCastStatus;
  /** Why the cast fell back — null unless casting === "fallback". */
  castFallbackReason: RadioCastFallbackReason | null;
  /** True when casting and the listener paused via the player bar. */
  castPaused: boolean;
  /**
   * Retry the Spotify play for the current now-playing track after a
   * retryable cast fallback (rate_limited / spotify_error). Success clears
   * the fallback state; failure keeps the honest message. No-op unless a
   * cast session is active with a known current track.
   */
  castRetry: () => void;
  toggle: (station: Station) => void;
  /** Resume a persisted station without restoring historical track position. */
  resume: (station: StoredStation) => void;
  /**
   * Play a station's stream as a transient sample — audio plays but NO listen
   * event is written to the local journal or the server ledger. Use for
   * scan/browse gestures where the listener hasn't committed. Calling
   * `toggle` afterwards (on "land") clears the preview flag and resumes
   * normal ledger tracking.
   */
  preview: (station: Station) => void;
  /** True while audio is playing in preview (scan) mode — suppresses ledger. */
  scanning: boolean;
  stop: () => void;
  setVolume: (v: number) => void;
}

export interface RideApi {
  active: boolean;
  status: RideStatus;
  queue: RideItem[];
  index: number;
  current: RideItem | null;
  /** True while we're still resolving the next hop (or a preview). */
  seeking: boolean;
  /** No further attributed transition exists after the current track. */
  atTrailEnd: boolean;
  /**
   * Current playhead position in milliseconds — updated from the preview
   * audio element (via timeupdate) or the Spotify poll (via progressMs).
   * Null when not playing or when position is unknown.
   */
  progressMs: number | null;
  /**
   * Total track duration in milliseconds — populated by YouTube (via
   * infoDelivery messages) and Apple Music (via currentPlaybackDuration).
   * Null for preview/Spotify sources where duration is not exposed.
   */
  durationMs: number | null;
  /** What is sounding right now: the listener's connected service (Spotify,
   * YouTube, Apple Music) or the 30s preview element. Null before playback
   * begins. */
  source: "spotify" | "youtube" | "apple-music" | "preview" | null;
  /** "trail" follows live segues hop by hop; "replay" plays a fixed,
   * documented run in its original order (ghost radio). */
  mode: "trail" | "replay";
  /** Attribution line for a replay ("KEXP · Early · 2024-06-02"), else null. */
  replayLabel: string | null;
  /**
   * How the session relates to time: 'live' drives advances from the station's
   * now-playing; 'past' is a ghost-radio fixed queue; 'curated' steps through
   * ordered picks. All three share this playback module.
   */
  timeOrientation: TimeOrientation;
  /**
   * Whether audio goes through the broadcast (passthrough) or the listener's
   * connected service (resolve_to_service). Default is always 'passthrough'.
   * Only switches to 'resolve_to_service' when the user explicitly opts in.
   */
  playbackMode: PlaybackMode;
  /**
   * True when the current track is unavailable on the connected service and
   * playback fell back: broadcast stream (live) or 30s preview (past/curated).
   */
  fallbackUsed: boolean;
  /**
   * True when the fallback was triggered because the listener's Spotify device
   * went offline mid-session (vs. the track simply not being on Spotify).
   */
  deviceLost: boolean;
  start: (seed: RideSeed, opts?: StartRideOpts) => void;
  /** Play a documented run as it aired: a fixed queue, no lookahead. */
  startReplay: (
    seeds: RideSeed[],
    label: string,
    opts?: { timeOrientation?: TimeOrientation; startIndex?: number; context?: string },
  ) => void;
  /**
   * The ledger context tag supplied to the most-recent `startReplay` call
   * (e.g. `'library'` for a ghost-radio play opened from the library tab).
   * Null for trail rides and when no context was supplied.
   */
  listenContext: string | null;
  stop: () => void;
  next: () => void;
  prev: () => void;
  togglePause: () => void;
  /** Persist the user's mode choice and switch immediately. */
  setPlaybackMode: (mode: PlaybackMode) => void;
  /**
   * Clear the current track from the Spotify failed/device-lost sets and retry
   * the service-ride command. If Spotify succeeds the fallback indicator
   * disappears; if it fails again the message returns.
   */
  retrySpotify: () => void;
  /**
   * Seek to a position within the current track.  Only meaningful when
   * `source` is `"youtube"` or `"apple-music"` — the active driver must
   * implement the optional `seek()` method.  No-op for other sources.
   */
  seek: (ms: number) => void;
}

/** One scan hop — the preview currently sounding during a preview-mode scan. */
export interface ScanHop {
  title: string;
  artist: string;
  mbid: string;
  stationName: string;
  stationSlug: string;
}

export interface ScanApi {
  active: boolean;
  toggle: () => void;
  /** Non-null while scan is active and a preview hop is playing or loading. */
  current: ScanHop | null;
  /** 1 = forward (→), -1 = backward (←). */
  dir: 1 | -1;
  /** Flip scan direction without stopping. */
  toggleDir: () => void;
}

interface PlayerContextValue {
  radio: RadioApi;
  ride: RideApi;
  spotify: SpotifyConnectApi;
  scan: ScanApi;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/** Map a segue candidate into a ride item (preview resolved later, on demand). */
function segueToItem(n: SegueNext): RideItem {
  return {
    mbid: n.mbid,
    title: n.title,
    artist: n.artist,
    artworkUrl: n.artworkUrl ?? null,
    links: [],
    attribution: {
      stations: n.stations ?? [],
      pickers: n.pickers ?? [],
    },
  };
}

/** Preview-mode scan: 10 s per hop, no broadcast buffering. */
const SCAN_INTERVAL_MS = 10_000;
/** Quick-skip interval when a station has no preview URL. */
const SCAN_SKIP_MS = 400;

export function PlayerProvider({ children }: { children: ReactNode }) {
  const radio = useRadioPlayer();
  const spotify = useSpotifyConnect();

  // --- Scan state (shared so WebPlayer and PlayerDock both see it) ---
  const { data: stationsData } = useListStations();
  const stations: Station[] = stationsData?.stations ?? [];
  // On-air data supplies the resolved MBID + track info per station.
  const { data: onAirData } = useWpOnAir();

  // Stations that currently have a resolved now-playing MBID — the only ones
  // scannable via iTunes preview. Re-derived whenever on-air data refreshes.
  const scannableStations = useMemo(() => {
    if (!onAirData) return [];
    return onAirData.items
      .filter((item) => item.now.resolved && item.now.mbid != null)
      .map((item) => ({
        station: item.station,
        mbid: item.now.mbid!,
        title: item.now.title,
        artist: item.now.artist,
      }));
  }, [onAirData]);

  const [scanActive, setScanActive] = useState(false);
  const [scanIdx, setScanIdx] = useState(0);
  const [scanCurrent, setScanCurrent] = useState<ScanHop | null>(null);
  const [scanDir, setScanDir] = useState<1 | -1>(1);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every toggle so stale async preview fetches are discarded.
  const scanTokenRef = useRef(0);
  const radioRef = useRef(radio);
  radioRef.current = radio;

  const clearScanTimer = useCallback(() => {
    if (scanTimerRef.current != null) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, []);

  const stopScanAudio = useCallback((el: HTMLAudioElement | null) => {
    if (!el) return;
    el.pause();
    el.removeAttribute("src");
    el.load();
  }, []);

  // Audio element — singleton created during render, shared by rides and preview scan.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (audioRef.current === null && typeof Audio !== "undefined") {
    const el = new Audio();
    el.preload = "none";
    audioRef.current = el;
  }

  const toggleScan = useCallback(() => {
    setScanActive((prev) => {
      if (prev) {
        clearScanTimer();
        scanTokenRef.current += 1;
        setScanCurrent(null);
        // Silence the preview audio element used by the scan.
        stopScanAudio(audioRef.current);
        return false;
      }
      // Don't start a preview scan while a ride is active — they share the
      // same audio element and would fight each other.
      if (rideActiveRef.current) return false;
      scanTokenRef.current += 1;
      setScanIdx(0);
      return true;
    });
  }, [clearScanTimer, stopScanAudio]);

  useEffect(() => {
    if (!scanActive || scannableStations.length === 0) {
      clearScanTimer();
      return;
    }
    const entry = scannableStations[scanIdx % scannableStations.length];
    if (!entry) return;

    const el = audioRef.current;
    const token = scanTokenRef.current;

    // Stop any live broadcast — scan uses the preview audio element exclusively.
    radioRef.current.stop();

    // Expose display info immediately so the UI doesn't flicker blank.
    setScanCurrent({
      title: entry.title,
      artist: entry.artist,
      mbid: entry.mbid,
      stationName: entry.station.name,
      stationSlug: entry.station.slug,
    });

    // Fetch the 30 s iTunes preview and play it.
    void getRecordingPreview(entry.mbid)
      .then((p) => {
        if (scanTokenRef.current !== token) return;
        if (p.previewUrl && el) {
          el.src = p.previewUrl;
          el.load();
          void el.play().catch(() => {/* autoplay blocked — advance anyway */});
        }
        // Schedule next hop: quick-skip when no preview is available.
        scanTimerRef.current = setTimeout(() => {
          setScanIdx((i) => {
            const n = scannableStations.length;
            return ((i + scanDir) % n + n) % n;
          });
        }, p.previewUrl ? SCAN_INTERVAL_MS : SCAN_SKIP_MS);
      })
      .catch(() => {
        if (scanTokenRef.current !== token) return;
        // Error fetching preview — skip to next station quickly.
        scanTimerRef.current = setTimeout(() => {
          setScanIdx((i) => {
            const n = scannableStations.length;
            return ((i + scanDir) % n + n) % n;
          });
        }, SCAN_SKIP_MS);
      });

    return clearScanTimer;
  }, [scanActive, scanIdx, scanDir, scannableStations, clearScanTimer]);

  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<RideStatus>("idle");
  const [queue, setQueue] = useState<RideItem[]>([]);
  const [index, setIndex] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [atTrailEnd, setAtTrailEnd] = useState(false);
  const [source, setSource] = useState<"spotify" | "youtube" | "apple-music" | "preview" | null>(null);
  const [mode, setMode] = useState<"trail" | "replay">("trail");
  const [replayLabel, setReplayLabel] = useState<string | null>(null);
  const [rideListenContext, setRideListenContext] = useState<string | null>(null);
  const [progressMs, setProgressMs] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [timeOrientation, setTimeOrientation] =
    useState<TimeOrientation>("curated");
  // Read from localStorage once on mount; default to 'passthrough' (safe).
  const [playbackMode, setPlaybackModeState] = useState<PlaybackMode>(
    readStoredPlaybackMode,
  );

  // Guards so async resolves don't stack up or race a stopped ride.
  const rideRef = useRef(0); // bumped on every start/stop to invalidate stale async work
  const fetchingNextRef = useRef(false);
  // The preview URL currently loaded into the audio element, so queue mutations
  // (lookahead appends) don't restart the clip that's already playing.
  const playingUrlRef = useRef<string | null>(null);
  // MBIDs whose preview is being fetched, so we never double-fetch one.
  const previewFetchingRef = useRef<Set<string>>(new Set());
  // Station slug for live-orientation rides — drives the now-playing subscription.
  const liveStationSlugRef = useRef<string | null>(null);

  // Track preview playhead for lyric sync (fires ~4×/s from the audio element).
  // Also capture the clip duration so the progress bar has a total to fill against.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      if (sourceRef.current === "preview") {
        setProgressMs(Math.round(el.currentTime * 1000));
      }
    };
    const onDurationChange = () => {
      if (sourceRef.current === "preview") {
        const d = el.duration;
        setDurationMs(Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null);
      }
    };
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("loadedmetadata", onDurationChange);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("loadedmetadata", onDurationChange);
    };
  }, []); // audioRef.current is a singleton created during render — stable

  // Mirror of `source` readable inside stable callbacks.
  const sourceRef = useRef<"spotify" | "youtube" | "apple-music" | "preview" | null>(null);
  // Queue length readable inside the poll interval without re-arming it.
  const queueLenRef = useRef(0);
  queueLenRef.current = queue.length;
  // Refs for reading latest mode/orientation inside stable interval callbacks.
  const playbackModeRef = useRef<PlaybackMode>(playbackMode);
  playbackModeRef.current = playbackMode;
  const timeOrientationRef = useRef<TimeOrientation>(timeOrientation);
  timeOrientationRef.current = timeOrientation;

  const stopRadio = radio.stop;
  const pauseRadio = (radio as unknown as { pause: () => void }).pause;
  const resumeLiveRadio = (radio as unknown as { resume: () => void }).resume;

  // Stable refs so stop()/togglePause()/seek() can call driver methods even
  // though the driver hooks are instantiated later in the component body.
  const activeDriverStopRef = useRef<() => void>(() => {});
  const activeDriverPauseRef = useRef<() => Promise<void>>(async () => {});
  const activeDriverResumeRef = useRef<() => Promise<void>>(async () => {});
  const activeDriverSeekRef = useRef<((ms: number) => Promise<void>) | null>(null);

  const stop = useCallback(() => {
    rideRef.current += 1;
    previewFetchingRef.current.clear();
    playingUrlRef.current = null;
    liveStationSlugRef.current = null;
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
    // Stop whichever driver was active — each driver silences itself.
    activeDriverStopRef.current();
    sourceRef.current = null;
    setSource(null);
    setActive(false);
    setStatus("idle");
    setQueue([]);
    setIndex(0);
    setSeeking(false);
    setAtTrailEnd(false);
    setMode("trail");
    setReplayLabel(null);
    setRideListenContext(null);
    setTimeOrientation("curated");
    setDurationMs(null);
  }, []);

  const start = useCallback(
    (seed: RideSeed, opts?: StartRideOpts) => {
      // Stop any active preview scan — it shares the ride's audio element.
      clearScanTimer();
      scanTokenRef.current += 1;
      setScanActive(false);
      setScanCurrent(null);
      stopScanAudio(audioRef.current);
      // The ride takes over audio: pause the live stream (resumable) so two
      // sources never play at once — enqueue-never-cut, but audio is exclusive.
      pauseRadio?.();
      rideRef.current += 1;
      activeDriverStopRef.current();
      sourceRef.current = null;
      liveStationSlugRef.current = opts?.stationSlug ?? null;
      setSource(null);
      setActive(true);
      setStatus("loading");
      setAtTrailEnd(false);
      setSeeking(false);
      setMode("trail");
      setReplayLabel(null);
      setRideListenContext(null);
      setTimeOrientation(opts?.timeOrientation ?? "curated");
      setQueue([
        {
          mbid: seed.mbid,
          title: seed.title,
          artist: seed.artist,
          artworkUrl: seed.artworkUrl,
          links: seed.links,
          attribution: null,
        },
      ]);
      setIndex(0);
    },
    [pauseRadio, clearScanTimer, stopScanAudio],
  );

  // Ghost radio / curated picker replay: play a documented run exactly as it
  // aired (or was ordered). The queue is fixed up front — no segue lookahead
  // ever runs — and the ride ends when the last documented track ends.
  const startReplay = useCallback(
    (
      seeds: RideSeed[],
      label: string,
      opts?: { timeOrientation?: TimeOrientation; startIndex?: number; context?: string },
    ) => {
      if (!seeds.length) return;
      // Stop any active preview scan — it shares the ride's audio element.
      clearScanTimer();
      scanTokenRef.current += 1;
      setScanActive(false);
      setScanCurrent(null);
      stopScanAudio(audioRef.current);
      pauseRadio?.();
      rideRef.current += 1;
      previewFetchingRef.current.clear();
      playingUrlRef.current = null;
      activeDriverStopRef.current();
      sourceRef.current = null;
      liveStationSlugRef.current = null;
      setSource(null);
      setActive(true);
      setStatus("loading");
      setAtTrailEnd(false);
      setSeeking(false);
      setMode("replay");
      setReplayLabel(label);
      setRideListenContext(opts?.context ?? null);
      if (opts?.context === "library") {
        const remembered = seeds[Math.max(0, Math.min(opts.startIndex ?? 0, seeds.length - 1))]!;
        writeLibrarySectionMemory(
          remembered,
          {
            mbid: remembered.mbid,
            title: label,
            artworkUrl: remembered.artworkUrl,
          },
          remembered.mbid,
        );
      }
      // Ghost-radio station runs are 'past'; curated picker runs are 'curated'.
      setTimeOrientation(opts?.timeOrientation ?? "past");
      setQueue(
        seeds.map((seed) => ({
          mbid: seed.mbid,
          title: seed.title,
          artist: seed.artist,
          artworkUrl: seed.artworkUrl,
          links: seed.links,
          attribution: null,
        })),
      );
      // "Hear it in context": start mid-run when asked (clamped to the queue),
      // with the earlier tracks still reachable via prev.
      const startAt = opts?.startIndex ?? 0;
      setIndex(
        Number.isInteger(startAt) && startAt > 0 && startAt < seeds.length
          ? startAt
          : 0,
      );
      if ((opts?.context ?? null) !== "library") {
        writeSelectorSectionMemory(
          seeds.map((seed) => ({
            mbid: seed.mbid,
            title: seed.title,
            artist: seed.artist,
            artworkUrl: seed.artworkUrl,
            links: seed.links,
          })),
          label,
          opts?.timeOrientation === "curated" ? "curated" : "past",
          startAt >= 0 && startAt < seeds.length ? startAt : 0,
        );
      }
    },
    [pauseRadio, clearScanTimer, stopScanAudio],
  );

  // Safety net: if a ride becomes active while a preview scan is running
  // (e.g. via an external start call), stop the scan immediately so the two
  // modes never fight over the shared audio element.
  useEffect(() => {
    if (!active) return;
    clearScanTimer();
    scanTokenRef.current += 1;
    setScanActive(false);
    setScanCurrent(null);
    stopScanAudio(audioRef.current);
  }, [active, clearScanTimer, stopScanAudio]);

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 < queue.length) return i + 1;
      return i; // lookahead effect will append; if it can't, we hit trail end.
    });
    setStatus((s) => (s === "ended" ? s : s));
  }, [queue.length]);

  // Keep the selector resume point useful when the listener moves through a
  // documented queue. Library rides are tracked separately by LibraryRow.
  useEffect(() => {
    if (!active || mode !== "replay" || rideListenContext === "library" || !replayLabel) return;
    writeSelectorSectionMemory(
      queue.map((item) => ({
        mbid: item.mbid,
        title: item.title,
        artist: item.artist,
        artworkUrl: item.artworkUrl,
        links: item.links,
      })),
      replayLabel,
      timeOrientation === "past" ? "past" : "curated",
      index,
    );
  }, [active, mode, rideListenContext, replayLabel, queue, index, timeOrientation]);

  const prev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const togglePause = useCallback(() => {
    // Full-track path: delegate to whichever driver is carrying the audio.
    // Each driver tracks its own paused state, so pause()/resume() are always
    // idempotent — a failed command never de-syncs us.
    if (sourceRef.current !== null && sourceRef.current !== "preview") {
      if (status === "paused") {
        void activeDriverResumeRef.current().catch(() => setStatus("error"));
      } else {
        void activeDriverPauseRef.current().catch(() => setStatus("error"));
      }
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setStatus("error"));
    } else {
      el.pause();
    }
  }, [status]);

  /** Seek to `ms` within the current track (YouTube / Apple Music only). */
  const seek = useCallback((ms: number) => {
    const fn = activeDriverSeekRef.current;
    if (!fn) return;
    void fn(ms).catch(() => {/* best-effort — a seek failure is non-fatal */});
  }, []);

  /** Persist the user's mode choice and switch immediately. */
  const setPlaybackMode = useCallback((newMode: PlaybackMode) => {
    writeStoredPlaybackMode(newMode);
    setPlaybackModeState(newMode);
    // Switching away from service-ride mid-session: stop all drivers so the
    // preview ladder takes over cleanly for the current track.
    if (newMode === "passthrough") {
      if (sourceRef.current !== null && sourceRef.current !== "preview") {
        void activeDriverPauseRef.current().catch(() => {});
        activeDriverStopRef.current();
        sourceRef.current = null;
        setSource(null);
      }
    }
    // Switching to service-ride: silence the preview element so a driver can
    // take over.
    if (newMode === "resolve_to_service") {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
        playingUrlRef.current = null;
      }
    }
  }, []);

  // Lookahead: keep at least one attributed hop staged after the current track.
  // Replays never look ahead — the documented queue IS the ride.
  useEffect(() => {
    if (!active) return;
    if (mode === "replay") return;
    if (index < queue.length - 1) return; // already have a next hop
    if (fetchingNextRef.current) return;
    const from = queue[index];
    if (!from) return;

    const token = rideRef.current;
    fetchingNextRef.current = true;
    setSeeking(true);
    const visited = new Set(queue.map((q) => q.mbid));

    void getRecordingSegues(from.mbid)
      .then((res) => {
        if (token !== rideRef.current) return;
        const candidate = res.next.find((n) => !visited.has(n.mbid));
        if (candidate) {
          setQueue((q) => [...q, segueToItem(candidate)]);
          setAtTrailEnd(false);
        } else {
          setAtTrailEnd(true);
        }
      })
      .catch(() => {
        if (token === rideRef.current) setAtTrailEnd(true);
      })
      .finally(() => {
        if (token === rideRef.current) {
          fetchingNextRef.current = false;
          setSeeking(false);
        } else {
          fetchingNextRef.current = false;
        }
      });
  }, [active, index, queue]);

  // Derived identity of the current track. Depending on these (not the whole
  // queue) keeps lookahead appends from restarting the playing clip.
  const currentItem = queue[index] ?? null;
  const currentMbid = currentItem?.mbid;
  const currentPreview = currentItem?.previewUrl; // string | null | undefined
  const currentNeedsLinks = !!currentItem && currentItem.links.length === 0;
  const hasNextHop = index + 1 < queue.length;

  // For live+service-ride, advances come from the station now-playing poll, not
  // driver end-of-track events.
  const isLiveSvcRide = isLiveServiceRide(playbackMode, timeOrientation);

  // ---- Playback drivers ---------------------------------------------------
  // Three drivers are instantiated each session. PlayerProvider selects the
  // first available one (Spotify → Apple Music → YouTube) as `activeDriver`
  // and delegates play/pause/resume through the shared handle interface.
  // When the selected driver fails for a specific track, PlayerProvider tries
  // the next available driver before falling back to preview/broadcast.

  const spotifyDriver = useSpotifyDriver({
    active,
    playbackMode,
    timeOrientation,
    currentItem,
    isLiveSvcRide,
    queueLenRef,
    rideRef,
    audioRef,
    pauseRadio,
    spotify,
  });

  // Apple Music developer token — fetched from /api/config (no auth required).
  // When unconfigured or the fetch fails, `developerToken` stays null/undefined
  // and the driver stays `available: false` so the fallback ladder skips it.
  const { data: appConfig } = useAppConfig();
  const appleMusicDriver = useAppleMusicDriver({
    developerToken: appConfig?.appleMusic?.developerToken ?? null,
    appName: appConfig?.appleMusic?.appName,
    storefront: appConfig?.appleMusic?.storefront,
  });
  const youtubeDriver = useYouTubeDriver();

  // Preference order: Spotify → Apple Music → YouTube.
  // `activeDriver` is the first service-level driver with `available === true`.
  const activeDriver =
    spotifyDriver.handle.available
      ? spotifyDriver.handle
      : appleMusicDriver.available
        ? appleMusicDriver
        : youtubeDriver;

  // Keep the driver control refs in sync so stop()/togglePause() can call them
  // without capturing the driver instances in their stable callbacks.
  activeDriverStopRef.current = () => {
    spotifyDriver.handle.stop();
    youtubeDriver.stop();
    appleMusicDriver.stop();
  };
  // Route pause/resume/seek to whichever driver is currently sounding, not the
  // statically-preferred one — Spotify may be preferred but YouTube/Apple
  // could be carrying the audio after a per-track fallback.
  activeDriverPauseRef.current = async () => {
    const src = sourceRef.current;
    if (src === "youtube") return youtubeDriver.pause();
    if (src === "apple-music") return appleMusicDriver.pause();
    return spotifyDriver.handle.pause();
  };
  activeDriverResumeRef.current = async () => {
    const src = sourceRef.current;
    if (src === "youtube") return youtubeDriver.resume();
    if (src === "apple-music") return appleMusicDriver.resume();
    return spotifyDriver.handle.resume();
  };
  activeDriverSeekRef.current = (() => {
    const src = sourceRef.current;
    if (src === "youtube") return youtubeDriver.seek ?? null;
    if (src === "apple-music") return appleMusicDriver.seek ?? null;
    return null;
  })();

  // Convenience aliases from the Spotify driver extras.
  const { spotifyModeForCurrent, fallbackUsed, deviceLost, retryCurrentTrack } =
    spotifyDriver;
  const retrySpotify = retryCurrentTrack;

  // ---- Alt-driver state (YouTube / Apple Music as Spotify fallback) --------
  // When Spotify fails for a track, PlayerProvider tries Apple Music (if
  // available), then YouTube, before dropping to broadcast/preview.
  // `altDriverActiveMbid` is set whenever an alt driver is loading OR playing
  // a track — it gates the preview effect and the live-broadcast fallback so we
  // don't resume the broadcast while an alt driver is still attempting.
  const [altDriverActiveMbid, setAltDriverActiveMbid] = useState<string | null>(null);
  // Per-driver failure keys: "am:<mbid>" for Apple Music, "yt:<mbid>" for YouTube.
  const altDriverFailedRef = useRef<Set<string>>(new Set());

  // On every track change: stop any alt driver still playing from the previous
  // track so audio-exclusivity is enforced across queue advances, prev/next,
  // and live now-playing advances.  Spotify handles its own continuity via its
  // internal poll + command effect; only YouTube and Apple Music need explicit
  // teardown here.
  useEffect(() => {
    youtubeDriver.stop();
    appleMusicDriver.stop();
    if (sourceRef.current === "youtube" || sourceRef.current === "apple-music") {
      sourceRef.current = null;
      setSource(null);
    }
    setAltDriverActiveMbid(null);
    altDriverFailedRef.current.clear();
    // Clear stale duration when the track changes.
    setDurationMs(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMbid]);

  // True when any driver (Spotify or alt) is actively carrying this track
  // (including while loading — prevents premature broadcast resumption).
  const driverActive = spotifyModeForCurrent || altDriverActiveMbid === currentMbid;

  // Try the next alt driver in the cascade (Apple Music → YouTube).  Called
  // after Spotify fails, and again when Apple Music fails so YouTube gets a
  // chance before we drop to preview/broadcast.
  const tryAltDriverRef = useRef<(mbid: string, item: RideItem, skipApple: boolean) => void>(
    () => {},
  );
  // Defined after the subscriptions below so the closures can call it recursively.
  // The ref indirection avoids a dependency cycle.
  useEffect(() => {
    tryAltDriverRef.current = (mbid: string, item: RideItem, skipApple: boolean) => {
      const failedAm = altDriverFailedRef.current.has(`am:${mbid}`);
      if (!skipApple && appleMusicDriver.available && !failedAm) {
        // Enforce audio exclusivity before handing off to Apple Music.
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        void appleMusicDriver.play(item).catch(() => {
          // play() itself threw (no token, etc.) — cascade to YouTube.
          altDriverFailedRef.current.add(`am:${mbid}`);
          tryAltDriverRef.current(mbid, item, true);
        });
        return;
      }
      const failedYt = altDriverFailedRef.current.has(`yt:${mbid}`);
      if (!failedYt) {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        void youtubeDriver.play(item).catch(() => {
          altDriverFailedRef.current.add(`yt:${mbid}`);
          setAltDriverActiveMbid(null);
        });
        return;
      }
      // All alt drivers exhausted — clear the active marker so the live fallback
      // and preview effects know no driver is attempting any more.
      setAltDriverActiveMbid(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appleMusicDriver, youtubeDriver, pauseRadio]);

  // Subscribe to Spotify driver status updates — mirror source/status state.
  useEffect(() => {
    return spotifyDriver.handle.onStatusChange((s) => {
      const mbid = s.trackId ?? null;
      if (mbid && mbid !== currentMbid) return; // stale
      if (s.state === "loading") {
        // Spotify is taking over — stop any alt driver that might still be
        // running for this track (e.g. a YouTube fallback that started while
        // Spotify was connecting).
        youtubeDriver.stop();
        appleMusicDriver.stop();
        setAltDriverActiveMbid(null);
        sourceRef.current = "spotify";
        setSource("spotify");
        setStatus("loading");
      } else if (s.state === "playing") {
        youtubeDriver.stop();
        appleMusicDriver.stop();
        setAltDriverActiveMbid(null);
        sourceRef.current = "spotify";
        setSource("spotify");
        setStatus("playing");
        if (s.progressMs !== undefined) setProgressMs(s.progressMs ?? null);
      } else if (s.state === "paused") {
        setStatus("paused");
        if (s.progressMs !== undefined) setProgressMs(s.progressMs ?? null);
      } else if (s.state === "ended" && !isLiveSvcRide) {
        setIndex((i) => {
          if (i + 1 < queueLenRef.current) return i + 1;
          setStatus("ended");
          return i;
        });
      } else if (s.state === "ride-ended") {
        // Unpinned listener took the wheel in Spotify — end the ride without
        // advancing the queue (restores the pre-driver-abstraction behaviour).
        setStatus("ended");
      } else if (s.state === "unavailable" || s.state === "device-lost") {
        // Spotify failed — cascade through alt drivers (Apple → YouTube).
        sourceRef.current = null;
        setSource(null);
        if (currentItem && mbid) {
          tryAltDriverRef.current(mbid, currentItem, false);
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotifyDriver.handle, currentMbid, currentItem, isLiveSvcRide]);

  // Subscribe to YouTube driver status changes.
  useEffect(() => {
    return youtubeDriver.onStatusChange((s) => {
      const mbid = s.trackId ?? null;
      if (mbid && mbid !== currentMbid) return;
      if (s.durationMs !== undefined) setDurationMs(s.durationMs ?? null);
      if (s.progressMs !== undefined && sourceRef.current === "youtube") {
        setProgressMs(s.progressMs ?? null);
      }
      if (s.state === "loading") {
        // Audio exclusivity: silence the broadcast while YouTube loads.
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        sourceRef.current = "youtube";
        setSource("youtube");
        setStatus("loading");
      } else if (s.state === "playing") {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        sourceRef.current = "youtube";
        setSource("youtube");
        setStatus("playing");
      } else if (s.state === "paused") {
        setStatus("paused");
      } else if (s.state === "ended") {
        setAltDriverActiveMbid(null);
        sourceRef.current = null;
        setSource(null);
        // Live+service-ride: station now-playing poll drives advances — skip.
        if (!isLiveSvcRide) {
          setIndex((i) => {
            if (i + 1 < queueLenRef.current) return i + 1;
            setStatus("ended");
            return i;
          });
        }
      } else if (s.state === "unavailable" || s.state === "error") {
        if (mbid) altDriverFailedRef.current.add(`yt:${mbid}`);
        setAltDriverActiveMbid(null);
        if (sourceRef.current === "youtube") { sourceRef.current = null; setSource(null); }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeDriver, currentMbid, isLiveSvcRide, pauseRadio]);

  // Subscribe to Apple Music driver status changes.
  useEffect(() => {
    return appleMusicDriver.onStatusChange((s) => {
      const mbid = s.trackId ?? null;
      if (mbid && mbid !== currentMbid) return;
      if (s.durationMs !== undefined) setDurationMs(s.durationMs ?? null);
      if (s.progressMs !== undefined && sourceRef.current === "apple-music") {
        setProgressMs(s.progressMs ?? null);
      }
      if (s.state === "loading") {
        // Audio exclusivity: silence the broadcast while Apple Music loads.
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        sourceRef.current = "apple-music";
        setSource("apple-music");
        setStatus("loading");
      } else if (s.state === "playing") {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        sourceRef.current = "apple-music";
        setSource("apple-music");
        setStatus("playing");
      } else if (s.state === "paused") {
        setStatus("paused");
      } else if (s.state === "ended") {
        setAltDriverActiveMbid(null);
        sourceRef.current = null;
        setSource(null);
        // Live+service-ride: station now-playing poll drives advances — skip.
        if (!isLiveSvcRide) {
          setIndex((i) => {
            if (i + 1 < queueLenRef.current) return i + 1;
            setStatus("ended");
            return i;
          });
        }
      } else if (s.state === "unavailable" || s.state === "error") {
        // Apple Music failed — cascade to YouTube.
        if (mbid) altDriverFailedRef.current.add(`am:${mbid}`);
        setAltDriverActiveMbid(null);
        if (sourceRef.current === "apple-music") { sourceRef.current = null; setSource(null); }
        if (currentItem && mbid) {
          tryAltDriverRef.current(mbid, currentItem, true); // skipApple=true
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appleMusicDriver, currentMbid, currentItem, isLiveSvcRide, pauseRadio]);

  // Push-channel trigger hooks: the SSE effect below calls these to fire an
  // immediate now-playing re-check when the server pushes a spin change for
  // the matching station. Each polling effect installs its own tick closure
  // (capturing its local state) and clears it on teardown; the 5s intervals
  // stay as fallback when SSE is unavailable.
  const ridePollTriggerRef = useRef<{ slug: string; tick: () => void } | null>(
    null,
  );
  const castPollTriggerRef = useRef<{ slug: string; tick: () => void } | null>(
    null,
  );

  // Now-playing subscription for live+service-ride: advance the queue when
  // the station moves to a new MBID, rather than polling Spotify for track-end.
  // This keeps the ride in sync with the actual broadcast clock without needing
  // fingerprinting or audio analysis.
  useEffect(() => {
    if (!active) return undefined;
    if (!isLiveSvcRide) return undefined;
    const slug = liveStationSlugRef.current;
    if (!slug) return undefined;

    const token = rideRef.current;
    let lastSeenMbid: string | null = null;
    let initialized = false;

    const tick = () => {
      void getStationNowPlaying(slug)
        .then((np) => {
          if (token !== rideRef.current) return;
          const mbid = np.nowPlaying?.recording?.mbid ?? null;
          if (!mbid) return;

          if (!initialized) {
            // First successful poll — set baseline; the current MBID is what
            // we're already playing, so don't advance.
            lastSeenMbid = mbid;
            initialized = true;
            return;
          }

          if (mbid === lastSeenMbid) return; // same track still on air
          lastSeenMbid = mbid;

          // Station moved to a new track — advance the ride.
          // If the radio was used as fallback for the previous track, the
          // Spotify command effect will pause it when it takes over the new one.
          setIndex((i) => {
            if (i + 1 < queueLenRef.current) return i + 1;
            setStatus("ended");
            return i;
          });
        })
        .catch(() => {
          // Best-effort — a poll failure just skips this tick.
        });
    };

    const id = setInterval(tick, 5000);
    // Expose the tick to the SSE push channel so a spin-changed event
    // triggers an immediate re-check instead of waiting up to 5s.
    ridePollTriggerRef.current = { slug, tick };

    return () => {
      clearInterval(id);
      ridePollTriggerRef.current = null;
    };
  }, [active, isLiveSvcRide]);

  // --- Live radio casting (no ride): resolve the broadcast to Spotify -----
  // When the listener is NOT in a ride, is tuned to a live station, and has a
  // Spotify Connect device pinned, the station's now-playing track plays on
  // that device instead of the browser stream. The station drives what plays:
  // the current resolved track is cast immediately, and each now-playing MBID
  // change sends the next one. Unresolvable tracks fall back to the broadcast
  // honestly — audio is exclusive, never doubled.
  const [castStatus, setCastStatus] = useState<RadioCastStatus>("off");
  const [castFallbackReason, setCastFallbackReason] =
    useState<RadioCastFallbackReason | null>(null);
  const [castPaused, setCastPaused] = useState(false);
  const castRef = useRef<{
    lastMbid: string | null;
    /** True once we've successfully commanded Spotify this cast session. */
    commanded: boolean;
    inFlight: boolean;
    /** Timestamp (Date.now()) after which rate-limit back-off has expired. */
    rateLimitedUntil: number;
  }>({ lastMbid: null, commanded: false, inFlight: false, rateLimitedUntil: 0 });
  // Mirror of `active` readable inside the cast cleanup (refs assigned during
  // render are current by the time cleanups run in the commit phase).
  const rideActiveRef = useRef(active);
  rideActiveRef.current = active;
  // Mirror of castPaused readable inside the poll without re-arming it.
  const castPausedRef = useRef(castPaused);
  castPausedRef.current = castPaused;
  // Retry hook set by the live-cast effect (null when no cast session is
  // active) — lets UI re-issue the Spotify play for the current track after
  // a retryable fallback without waiting for the station to change songs.
  const castRetryRef = useRef<(() => void) | null>(null);

  const radioSlug = radio.station?.slug ?? null;
  const radioIdle = radio.status === "idle" || radio.status === "error";
  const castEligible =
    !active &&
    spotify.connected &&
    spotify.premium &&
    !!spotify.pinnedDevice &&
    !!radioSlug &&
    !radioIdle;

  useEffect(() => {
    if (!castEligible || !radioSlug) return undefined;

    let cancelled = false;
    castRef.current = { lastMbid: null, commanded: false, inFlight: false, rateLimitedUntil: 0 };
    setCastStatus("connecting");
    setCastFallbackReason(null);
    setCastPaused(false);

    // Collect auto-retry timers so they can be cancelled on effect teardown.
    const retryTimers: ReturnType<typeof setTimeout>[] = [];

    const playMbid = (mbid: string) => {
      if (castRef.current.inFlight) return;
      castRef.current.inFlight = true;
      void spotifyPlay({
        mbid,
        deviceId: spotify.pinnedDevice?.id ?? undefined,
      })
        .then(() => {
          if (cancelled) return;
          castRef.current.commanded = true;
          castRef.current.rateLimitedUntil = 0; // clear any stale back-off on success
          setCastPaused(false);
          setCastStatus("casting");
          setCastFallbackReason(null);
          // Spotify carries the audio now — silence the browser stream.
          pauseRadio?.();
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // The broadcast covers this track — but be honest about WHY:
          // a 404 means the track truly isn't on Spotify; anything else
          // (rate limit, upstream failure) is Spotify being unavailable.
          const httpStatus = (err as { status?: number }).status;
          const message =
            err instanceof Error ? err.message.toLowerCase() : "";

          if (httpStatus === 429 || message.includes("rate-limit")) {
            // Read the Retry-After seconds from the response body if available.
            const retryAfterSecs: number =
              (err as { data?: { retryAfter?: number } }).data?.retryAfter ?? 30;
            castRef.current.rateLimitedUntil = Date.now() + retryAfterSecs * 1000;
            setCastStatus("fallback");
            setCastFallbackReason("rate_limited");
            resumeLiveRadio?.();
            // Auto-retry after the back-off — no manual Retry click needed.
            const timer = setTimeout(() => {
              if (cancelled) return;
              castRef.current.rateLimitedUntil = 0;
              const nextMbid = castRef.current.lastMbid;
              if (nextMbid && !castPausedRef.current) playMbid(nextMbid);
            }, retryAfterSecs * 1000);
            retryTimers.push(timer);
            return;
          }

          setCastStatus("fallback");
          setCastFallbackReason(
            httpStatus === 404
              ? "not_on_spotify"
              : "spotify_error",
          );
          resumeLiveRadio?.();
          if (httpStatus === 401 || httpStatus === 403) spotify.refresh();
        })
        .finally(() => {
          castRef.current.inFlight = false;
        });
    };

    const tick = () => {
      void getStationNowPlaying(radioSlug)
        .then((np) => {
          if (cancelled) return;
          const mbid = np.nowPlaying?.recording?.mbid ?? null;
          if (!mbid) return; // unresolved — whatever is sounding keeps sounding
          if (mbid === castRef.current.lastMbid) return;
          castRef.current.lastMbid = mbid;
          // Listener paused the cast: track the station's movement but don't
          // interrupt their silence with a new play command.
          if (castPausedRef.current) return;
          // Still within the Spotify rate-limit back-off window: track the
          // new mbid (the auto-retry timer will pick it up) but skip play now.
          if (Date.now() < castRef.current.rateLimitedUntil) return;
          playMbid(mbid);
        })
        .catch(() => {
          // Best-effort — a poll failure just skips this tick.
        });
    };

    tick(); // cast the currently-airing track right away
    const id = setInterval(tick, 5000);
    // Expose the tick to the SSE push channel for instant track changes.
    castPollTriggerRef.current = { slug: radioSlug, tick };

    // Expose a retry for the current track: re-issue the Spotify play after
    // a retryable fallback. Clears the rate-limit back-off so manual retries
    // are always honoured immediately.
    castRetryRef.current = () => {
      const mbid = castRef.current.lastMbid;
      if (!mbid || castPausedRef.current) return;
      castRef.current.rateLimitedUntil = 0;
      playMbid(mbid);
    };

    return () => {
      cancelled = true;
      clearInterval(id);
      retryTimers.forEach(clearTimeout);
      castRetryRef.current = null;
      castPollTriggerRef.current = null;
      setCastStatus("off");
      setCastFallbackReason(null);
      setCastPaused(false);
      if (castRef.current.commanded) {
        // Leave the listener's Spotify quiet when the cast commanded it.
        void spotifyPause().catch(() => {});
        // Give audio back to the broadcast unless a ride took over or the
        // station was stopped (resume is a no-op once the source is cleared).
        if (!rideActiveRef.current) resumeLiveRadio?.();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castEligible, radioSlug, spotify.pinnedDevice?.id]);

  // --- SSE push channel: instant now-playing updates ---------------------
  // One EventSource against the server's spin-changed stream, open only while
  // something is actually consuming now-playing data (a live-service ride or
  // an active cast). Each event names the station whose spin changed; when it
  // matches a subscribed effect's station we fire that effect's tick
  // immediately instead of waiting for its 5s fallback interval.
  const wantsSse = (active && isLiveSvcRide) || castEligible;
  useEffect(() => {
    if (!wantsSse) return undefined;
    if (typeof EventSource === "undefined") return undefined;

    const es = new EventSource("/api/stations/now-playing/stream");
    es.onmessage = (msg) => {
      let slug: string | null = null;
      try {
        const data = JSON.parse(msg.data) as { stationSlug?: string };
        slug = data.stationSlug ?? null;
      } catch {
        return;
      }
      if (!slug) return;
      const ride = ridePollTriggerRef.current;
      if (ride && ride.slug === slug) ride.tick();
      const cast = castPollTriggerRef.current;
      if (cast && cast.slug === slug) cast.tick();
    };
    // No onerror handling needed: EventSource auto-reconnects, and the 5s
    // polling intervals remain the correctness backstop throughout.

    return () => es.close();
  }, [wantsSse]);

  /** Pause/resume the cast on the listener's Spotify (player-bar toggle). */
  const castTogglePause = useCallback(() => {
    if (castPausedRef.current) {
      void spotifyResume()
        .then(() => setCastPaused(false))
        .catch(() => {});
    } else {
      void spotifyPause()
        .then(() => setCastPaused(true))
        .catch(() => {});
    }
  }, []);

  /** Retry the Spotify play for the current cast track (Retry button). */
  const castRetry = useCallback(() => {
    castRetryRef.current?.();
  }, []);

  // Live fallback: when in live+service-ride and all drivers fail for a track,
  // resume the broadcast so the listener always hears audio. The now-playing
  // poll above drives the advance to the next track.
  useEffect(() => {
    if (!active) return;
    if (playbackMode !== "resolve_to_service") return;
    if (timeOrientation !== "live") return;
    if (driverActive) return; // a driver is carrying or loading this track
    if (!currentMbid) return;
    if (!fallbackUsed) return; // Spotify hasn't tried or hasn't failed yet
    // All drivers failed for this live track → resume the broadcast.
    resumeLiveRadio?.();
  }, [
    active,
    playbackMode,
    timeOrientation,
    driverActive,
    currentMbid,
    fallbackUsed,
    resumeLiveRadio,
    altDriverActiveMbid,
  ]);

  // Drive playback of the current item: resolve its preview, then play it.
  useEffect(() => {
    if (!active) return undefined;
    if (driverActive) return undefined; // a service driver carries this track
    // For live fallback, the broadcast carries the audio — no preview needed.
    if (
      playbackMode === "resolve_to_service" &&
      timeOrientation === "live" &&
      currentMbid &&
      fallbackUsed
    ) {
      return undefined;
    }
    const el = audioRef.current;
    if (!el) return undefined;
    if (!currentMbid) return undefined;

    const token = rideRef.current;
    const targetMbid = currentMbid;

    // Preview not resolved yet — fetch it (once), then this effect re-runs.
    // We patch the queue item BY MBID, never by captured index, so a response
    // that lands after the listener advanced can't attach to the wrong track.
    if (currentPreview === undefined) {
      setStatus("loading");
      if (previewFetchingRef.current.has(targetMbid)) return undefined;
      previewFetchingRef.current.add(targetMbid);
      // Hydrate link-outs for segued items (seed items already carry links) so
      // a no-preview track still degrades to an external link in the ride bar.
      void Promise.all([
        getRecordingPreview(targetMbid),
        currentNeedsLinks
          ? getRecording(targetMbid).catch(() => null)
          : Promise.resolve(null),
      ])
        .then(([p, node]) => {
          if (token !== rideRef.current) return;
          setQueue((q) =>
            q.map((item) =>
              item.mbid === targetMbid
                ? {
                    ...item,
                    previewUrl: p.previewUrl,
                    artworkUrl: item.artworkUrl ?? p.artworkUrl ?? null,
                    links: item.links.length ? item.links : (node?.links ?? []),
                  }
                : item,
            ),
          );
        })
        .catch(() => {
          if (token === rideRef.current) {
            setQueue((q) =>
              q.map((item) =>
                item.mbid === targetMbid ? { ...item, previewUrl: null } : item,
              ),
            );
          }
        })
        .finally(() => {
          previewFetchingRef.current.delete(targetMbid);
        });
      return undefined;
    }

    // Resolved but no preview available — auto-advance so the ride keeps
    // flowing; the track stays visible in the queue with its link-outs.
    if (currentPreview === null) {
      if (hasNextHop) {
        const t = setTimeout(() => {
          if (token === rideRef.current) setIndex((i) => i + 1);
        }, 2500);
        return () => clearTimeout(t);
      }
      // Nothing after it and nothing to play: the trail has run dry.
      setStatus("ended");
      return undefined;
    }

    // We have a playable preview. Only (re)load when the URL actually changes,
    // so re-runs triggered by unrelated state never restart the current clip.
    if (playingUrlRef.current !== currentPreview) {
      playingUrlRef.current = currentPreview;
      sourceRef.current = "preview";
      setSource("preview");
      el.src = currentPreview;
      el.load();
      void el.play().catch(() => {
        if (token === rideRef.current) setStatus("error");
      });
    }
    return undefined;
  }, [
    active,
    index,
    currentMbid,
    currentPreview,
    currentNeedsLinks,
    hasNextHop,
    driverActive,
    playbackMode,
    timeOrientation,
    fallbackUsed,
  ]);

  // Audio element lifecycle — status wiring + auto-advance on clip end.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlaying = () => setStatus("playing");
    const onWaiting = () => setStatus("loading");
    const onPause = () =>
      setStatus((s) => (s === "playing" ? "paused" : s));
    const onEnded = () => {
      // Advance to the next staged hop; if none, the ride is over.
      setIndex((i) => {
        if (i + 1 < queue.length) return i + 1;
        setStatus("ended");
        return i;
      });
    };
    const onError = () => setStatus("error");
    el.addEventListener("playing", onPlaying);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [queue.length]);

  useEffect(() => () => stop(), [stop]);

  // --- Scan-preview flag: set when playing a station as a browse sample ------
  // When true, ListeningLogger skips all journal + ledger writes. Cleared when
  // the listener commits ("lands") via a normal toggle call.
  const [isScanPreview, setIsScanPreview] = useState(false);

  // Starting the radio cancels any ride (audio is exclusive).
  // While casting, the toggle controls the listener's Spotify — the browser
  // stream is intentionally paused, so resuming it would double the audio.
  const toggleRadio = useCallback(
    (station: Station) => {
      // Committing to a station clears the scan-preview flag so the ledger
      // resumes normal tracking from this point forward.
      setIsScanPreview(false);
      writeRadioSectionMemory(station);
      if (active) stop();
      if (castStatus === "casting" && radio.station?.slug === station.slug) {
        castTogglePause();
        return;
      }
      radio.toggle(station);
    },
    [active, radio, stop, castStatus, castTogglePause],
  );

  const resumeRadio = useCallback(
    (station: StoredStation) => {
      toggleRadio(station as Station);
    },
    [toggleRadio],
  );

  /**
   * Play a station as a transient scan sample — audio starts but no listen
   * event is written to the journal or the server ledger. Calling `toggle`
   * afterwards ("landing") clears the preview flag and resumes normal tracking.
   */
  const previewRadio = useCallback(
    (station: Station) => {
      setIsScanPreview(true);
      if (active) stop();
      radio.toggle(station);
    },
    [active, radio, stop],
  );

  const value = useMemo<PlayerContextValue>(
    () => ({
      radio: {
        status: radio.status,
        station: radio.station,
        volume: radio.volume,
        error: radio.error,
        casting: castStatus,
        castFallbackReason,
        castPaused,
        castRetry,
        toggle: toggleRadio,
        resume: resumeRadio,
        preview: previewRadio,
        scanning: isScanPreview,
        stop: stopRadio,
        setVolume: radio.setVolume,
      },
      ride: {
        active,
        status,
        queue,
        index,
        current: queue[index] ?? null,
        seeking,
        atTrailEnd:
          mode === "replay"
            ? index === queue.length - 1
            : atTrailEnd && index === queue.length - 1,
        progressMs,
        durationMs,
        source,
        mode,
        replayLabel,
        listenContext: rideListenContext,
        timeOrientation,
        playbackMode,
        fallbackUsed,
        deviceLost,
        start,
        startReplay,
        stop,
        next,
        prev,
        togglePause,
        setPlaybackMode,
        retrySpotify,
        seek,
      },
      spotify,
      scan: {
        active: scanActive,
        toggle: toggleScan,
        current: scanCurrent,
        dir: scanDir,
        toggleDir: () => setScanDir((d) => (d === 1 ? -1 : 1)),
      },
    }),
    [
      radio.status,
      radio.station,
      radio.volume,
      radio.error,
      radio.setVolume,
      castStatus,
      castFallbackReason,
      castPaused,
      castRetry,
      toggleRadio,
      resumeRadio,
      previewRadio,
      isScanPreview,
      stopRadio,
      active,
      status,
      queue,
      index,
      seeking,
      atTrailEnd,
      progressMs,
      durationMs,
      source,
      mode,
      replayLabel,
      rideListenContext,
      timeOrientation,
      playbackMode,
      fallbackUsed,
      deviceLost,
      start,
      startReplay,
      stop,
      next,
      prev,
      togglePause,
      setPlaybackMode,
      retrySpotify,
      seek,
      spotify,
      scanActive,
      toggleScan,
      scanCurrent,
      scanDir,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {/* Hidden iframe the YouTube driver uses — must be in the DOM at all
          times so the driver can postMessage into it. */}
      {youtubeDriver.surface}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}
