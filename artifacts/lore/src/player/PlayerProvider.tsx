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
  getSpotifyPlayer,
  type RecordingLink,
  type SegueNext,
  type Station,
} from "@workspace/api-client-react";
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
  processDeviceConfirmation,
} from "./playbackSession";

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

interface RadioApi {
  status: PlayerStatus;
  station: Station | null;
  volume: number;
  error: string | null;
  toggle: (station: Station) => void;
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
  /** What is sounding right now: the listener's own Spotify (full track) or
   * the 30s preview element. Null before playback begins. */
  source: "spotify" | "preview" | null;
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
    opts?: { timeOrientation?: TimeOrientation; startIndex?: number },
  ) => void;
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
}

interface PlayerContextValue {
  radio: RadioApi;
  ride: RideApi;
  spotify: SpotifyConnectApi;
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

export function PlayerProvider({ children }: { children: ReactNode }) {
  const radio = useRadioPlayer();
  const spotify = useSpotifyConnect();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (audioRef.current === null && typeof Audio !== "undefined") {
    const el = new Audio();
    el.preload = "none";
    audioRef.current = el;
  }

  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<RideStatus>("idle");
  const [queue, setQueue] = useState<RideItem[]>([]);
  const [index, setIndex] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [atTrailEnd, setAtTrailEnd] = useState(false);
  const [source, setSource] = useState<"spotify" | "preview" | null>(null);
  const [mode, setMode] = useState<"trail" | "replay">("trail");
  const [replayLabel, setReplayLabel] = useState<string | null>(null);
  const [progressMs, setProgressMs] = useState<number | null>(null);
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
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => {
      if (sourceRef.current === "preview") {
        setProgressMs(Math.round(el.currentTime * 1000));
      }
    };
    el.addEventListener("timeupdate", onTimeUpdate);
    return () => el.removeEventListener("timeupdate", onTimeUpdate);
  }, []); // audioRef.current is a singleton created during render — stable

  // --- Spotify full-track path (remote-controls the listener's own app) ----
  // What the ride commanded Spotify to play, so polls can tell "our track
  // ended" from "listener is playing something else".
  const spotifyNowRef = useRef<{
    mbid: string;
    uri: string;
    sawPlaying: boolean;
    /** Consecutive polls that looked like "track over" — advance needs 2 so a
     * single blip (Spotify's own gapless transition, flaky snapshot) never
     * skips a track early. */
    endedPolls: number;
    /** Consecutive polls where the device never confirmed playing (sawPlaying
     * still false). After the threshold we treat the device as lost and fall
     * back rather than stalling in "loading" indefinitely. */
    noDevicePolls: number;
  } | null>(null);
  // MBIDs where the fallback was triggered by a lost device (not a missing
  // track) — used to show a distinct "device lost" message in the UI.
  const spotifyDeviceLostRef = useRef<Set<string>>(new Set());
  // MBID currently being commanded, so effect re-runs never double-play.
  const spotifyCommandingRef = useRef<string | null>(null);
  // Tracks that failed on Spotify this ride — they fall back to previews.
  const spotifyFailedRef = useRef<Set<string>>(new Set());
  // Bumped when a track falls back so mode recomputes (refs don't re-render).
  const [spotifyFallbackTick, setSpotifyFallbackTick] = useState(0);
  // Pause commanded by us (or observed from the Spotify app) — the poll must
  // not mistake it for track-ended.
  const spotifyPausedRef = useRef(false);
  // Mirror of `source` readable inside stable callbacks.
  const sourceRef = useRef<"spotify" | "preview" | null>(null);
  // Queue length readable inside the poll interval without re-arming it.
  const queueLenRef = useRef(0);
  queueLenRef.current = queue.length;
  // Refs for reading latest mode/orientation inside stable interval callbacks.
  const playbackModeRef = useRef<PlaybackMode>(playbackMode);
  playbackModeRef.current = playbackMode;
  const timeOrientationRef = useRef<TimeOrientation>(timeOrientation);
  timeOrientationRef.current = timeOrientation;

  const spotifyEligible = spotify.connected && spotify.premium;

  const stopRadio = radio.stop;
  const pauseRadio = (radio as unknown as { pause: () => void }).pause;
  const resumeRadio = (radio as unknown as { resume: () => void }).resume;

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
    // Leave the listener's Spotify quiet when the ride commanded it.
    if (sourceRef.current === "spotify") {
      void spotifyPause().catch(() => {});
    }
    spotifyNowRef.current = null;
    spotifyCommandingRef.current = null;
    spotifyPausedRef.current = false;
    spotifyFailedRef.current.clear();
    spotifyDeviceLostRef.current.clear();
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
    setTimeOrientation("curated");
  }, []);

  const start = useCallback(
    (seed: RideSeed, opts?: StartRideOpts) => {
      // The ride takes over audio: pause the live stream (resumable) so two
      // sources never play at once — enqueue-never-cut, but audio is exclusive.
      pauseRadio?.();
      rideRef.current += 1;
      spotifyNowRef.current = null;
      spotifyCommandingRef.current = null;
      spotifyPausedRef.current = false;
      spotifyFailedRef.current.clear();
      spotifyDeviceLostRef.current.clear();
      sourceRef.current = null;
      liveStationSlugRef.current = opts?.stationSlug ?? null;
      setSource(null);
      setActive(true);
      setStatus("loading");
      setAtTrailEnd(false);
      setSeeking(false);
      setMode("trail");
      setReplayLabel(null);
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
    [pauseRadio],
  );

  // Ghost radio / curated picker replay: play a documented run exactly as it
  // aired (or was ordered). The queue is fixed up front — no segue lookahead
  // ever runs — and the ride ends when the last documented track ends.
  const startReplay = useCallback(
    (
      seeds: RideSeed[],
      label: string,
      opts?: { timeOrientation?: TimeOrientation; startIndex?: number },
    ) => {
      if (!seeds.length) return;
      pauseRadio?.();
      rideRef.current += 1;
      previewFetchingRef.current.clear();
      playingUrlRef.current = null;
      spotifyNowRef.current = null;
      spotifyCommandingRef.current = null;
      spotifyPausedRef.current = false;
      spotifyFailedRef.current.clear();
      spotifyDeviceLostRef.current.clear();
      sourceRef.current = null;
      liveStationSlugRef.current = null;
      setSource(null);
      setActive(true);
      setStatus("loading");
      setAtTrailEnd(false);
      setSeeking(false);
      setMode("replay");
      setReplayLabel(label);
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
    },
    [pauseRadio],
  );

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 < queue.length) return i + 1;
      return i; // lookahead effect will append; if it can't, we hit trail end.
    });
    setStatus((s) => (s === "ended" ? s : s));
  }, [queue.length]);

  const prev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const togglePause = useCallback(() => {
    // Full-track path: command the listener's own Spotify, not the <audio> el.
    // The paused flag only flips after the API confirms, so a failed command
    // never leaves our idea of the player out of sync with reality.
    if (sourceRef.current === "spotify") {
      if (spotifyPausedRef.current) {
        void spotifyResume()
          .then(() => {
            spotifyPausedRef.current = false;
            setStatus("playing");
          })
          .catch(() => setStatus("error"));
      } else {
        void spotifyPause()
          .then(() => {
            spotifyPausedRef.current = true;
            setStatus("paused");
          })
          .catch(() => setStatus("error"));
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
  }, []);

  /** Persist the user's mode choice and switch immediately. */
  const setPlaybackMode = useCallback((newMode: PlaybackMode) => {
    writeStoredPlaybackMode(newMode);
    setPlaybackModeState(newMode);
    // Switching away from service-ride mid-session: clear any Spotify state
    // so the preview ladder takes over cleanly for the current track.
    if (newMode === "passthrough") {
      spotifyNowRef.current = null;
      spotifyCommandingRef.current = null;
      spotifyPausedRef.current = false;
      if (sourceRef.current === "spotify") {
        void spotifyPause().catch(() => {});
        sourceRef.current = null;
        setSource(null);
      }
    }
    // Switching to service-ride: clear failed set so tracks get a fresh attempt.
    if (newMode === "resolve_to_service") {
      spotifyFailedRef.current.clear();
      spotifyDeviceLostRef.current.clear();
      setSpotifyFallbackTick(0);
      // Ensure audio element is silenced so Spotify can take over.
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

  /**
   * Clear the current track from the Spotify failed/device-lost sets and retry
   * the service-ride command for it. Bumps spotifyFallbackTick so the derived
   * `spotifyModeForCurrent` recomputes and the command effect re-fires.
   */
  const retrySpotify = useCallback(() => {
    if (!currentMbid) return;
    spotifyFailedRef.current.delete(currentMbid);
    spotifyDeviceLostRef.current.delete(currentMbid);
    // Reset the commanding guard so the effect is allowed to re-issue the play.
    spotifyCommandingRef.current = null;
    spotifyNowRef.current = null;
    setSpotifyFallbackTick((t) => t + 1);
  }, [currentMbid]);

  // Whether THIS track rides the listener's Spotify (full track) or the
  // preview ladder. Requires an explicit opt-in (playbackMode) in addition to
  // the service being eligible. A Spotify failure marks the track and bumps
  // the tick so this recomputes and the fallback path takes over.
  const spotifyModeForCurrent =
    active &&
    playbackMode === "resolve_to_service" &&
    spotifyEligible &&
    !!currentMbid &&
    spotifyFallbackTick >= 0 &&
    !spotifyFailedRef.current.has(currentMbid);

  // Whether the current track fell back (Spotify failed, using broadcast/preview).
  const fallbackUsed =
    playbackMode === "resolve_to_service" &&
    !!currentMbid &&
    spotifyFailedRef.current.has(currentMbid);

  // Whether the fallback was triggered by a lost device (vs. track missing on Spotify).
  const deviceLost =
    playbackMode === "resolve_to_service" &&
    !!currentMbid &&
    spotifyDeviceLostRef.current.has(currentMbid);

  // For live+service-ride, advances come from the station now-playing poll, not
  // Spotify's playback-end signal. Read in the Spotify poll interval via ref.
  const isLiveSvcRide = isLiveServiceRide(playbackMode, timeOrientation);

  // Command the listener's own Spotify to play the current track (full).
  const refreshSpotify = spotify.refresh;
  useEffect(() => {
    if (!spotifyModeForCurrent || !currentMbid) return;
    if (spotifyNowRef.current?.mbid === currentMbid) return;
    if (spotifyCommandingRef.current === currentMbid) return;

    const token = rideRef.current;
    const targetMbid = currentMbid;
    spotifyCommandingRef.current = targetMbid;
    spotifyPausedRef.current = false;
    sourceRef.current = "spotify";
    setSource("spotify");
    setStatus("loading");
    // Audio is exclusive: silence both the preview element and the radio
    // broadcast while Spotify plays.
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      playingUrlRef.current = null;
    }
    // Also silence the broadcast if it was resumed as a fallback.
    pauseRadio?.();

    void spotifyPlay({ mbid: targetMbid })
      .then((res) => {
        if (token !== rideRef.current) return;
        spotifyNowRef.current = {
          mbid: targetMbid,
          uri: res.trackUri,
          sawPlaying: false,
          endedPolls: 0,
          noDevicePolls: 0,
        };
        setStatus("playing");
      })
      .catch((err: unknown) => {
        if (token !== rideRef.current) return;
        // This track can't ride Spotify (not found, no device, revoked...):
        // fall back for this track only.
        spotifyFailedRef.current.add(targetMbid);
        spotifyNowRef.current = null;
        sourceRef.current = null;
        setSource(null);
        setSpotifyFallbackTick((t) => t + 1);
        const httpStatus = (err as { status?: number }).status;
        if (httpStatus === 401 || httpStatus === 403) {
          // Connection is gone or not Premium — re-sync the status chip.
          refreshSpotify();
        }
      })
      .finally(() => {
        if (spotifyCommandingRef.current === targetMbid) {
          spotifyCommandingRef.current = null;
        }
      });
  }, [spotifyModeForCurrent, currentMbid, refreshSpotify, pauseRadio]);

  // Poll the listener's player while Spotify carries the ride: mirror pauses,
  // and advance the ride when the track runs out. If the listener starts
  // playing something else in Spotify, the ride yields (never fights them).
  // For live+service-ride, the now-playing poll (below) drives advances instead.
  useEffect(() => {
    if (!spotifyModeForCurrent || !currentMbid) return undefined;
    const token = rideRef.current;
    const id = setInterval(() => {
      const now = spotifyNowRef.current;
      if (!now || now.mbid !== currentMbid) return;
      // Note: we keep polling even while paused — the live snapshot is the
      // authority, so a resume made directly in the Spotify app is picked up.
      void getSpotifyPlayer()
        .then((st) => {
          if (token !== rideRef.current) return;
          const cur = spotifyNowRef.current;
          if (!cur || cur.mbid !== currentMbid) return;
          const ours = st.trackUri === cur.uri;

          {
            // Decide the device-confirmation outcome for this poll tick.
            // Pure helper — extracted to playbackSession.ts so the reconnect
            // and device-lost paths are unit-testable without React or timers.
            const confirmation = processDeviceConfirmation(cur, { ours, isPlaying: st.isPlaying });
            if (confirmation.type === "confirmed") {
              // Our track is sounding — also covers a resume made in the app.
              cur.sawPlaying = true;
              cur.endedPolls = 0;
              spotifyPausedRef.current = false;
              setProgressMs(st.progressMs ?? null);
              setStatus("playing");
              return;
            }
            if (confirmation.type === "device-lost") {
              // Device hasn't confirmed after ~15 s: treat as lost and fall back
              // so the ride isn't silently stuck in "loading".
              spotifyFailedRef.current.add(currentMbid);
              spotifyDeviceLostRef.current.add(currentMbid);
              spotifyNowRef.current = null;
              sourceRef.current = null;
              setSource(null);
              setSpotifyFallbackTick((t) => t + 1);
              return;
            }
            if (confirmation.type === "wait") {
              cur.noDevicePolls = confirmation.noDevicePolls;
              return;
            }
            // confirmation.type === "already-confirmed": fall through to the
            // paused / other-device / track-end branches below.
          }

          if (!ours && st.active && st.isPlaying) {
            // The listener started something else: they took the wheel — the
            // ride yields immediately and never fights their device.
            spotifyNowRef.current = null;
            spotifyPausedRef.current = false;
            setStatus("ended");
            return;
          }

          if (
            ours &&
            !st.isPlaying &&
            (spotifyPausedRef.current || (st.progressMs ?? 0) > 0)
          ) {
            // Paused — either by us (trust our command even at progress 0) or
            // from the Spotify app itself (progress retained). Mirror it.
            cur.endedPolls = 0;
            spotifyPausedRef.current = true;
            setProgressMs(st.progressMs ?? null);
            setStatus("paused");
            return;
          }

          // For live+service-ride, the now-playing poll drives advances; do not
          // advance here on track-end to avoid a double-skip.
          if (playbackModeRef.current === "resolve_to_service" &&
              timeOrientationRef.current === "live") {
            return;
          }

          // Looks like the track ran out (inactive player, or ours stopped at
          // progress 0). Require two consecutive such polls so a transient
          // blip never skips a track early.
          cur.endedPolls += 1;
          if (cur.endedPolls < 2) return;
          spotifyNowRef.current = null;
          spotifyPausedRef.current = false;
          setIndex((i) => {
            if (i + 1 < queueLenRef.current) return i + 1;
            setStatus("ended");
            return i;
          });
        })
        .catch(() => {
          // Transient poll failure — keep riding; the next tick retries.
        });
    }, 3000);
    return () => clearInterval(id);
  }, [spotifyModeForCurrent, currentMbid]);

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

    const id = setInterval(() => {
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
    }, 5000);

    return () => clearInterval(id);
  }, [active, isLiveSvcRide]);

  // Live fallback: when in live+service-ride and Spotify fails for a track,
  // resume the broadcast so the listener always hears audio. The now-playing
  // poll above drives the advance to the next track.
  useEffect(() => {
    if (!active) return;
    if (playbackMode !== "resolve_to_service") return;
    if (timeOrientation !== "live") return;
    if (spotifyModeForCurrent) return; // Spotify is carrying this track
    if (!currentMbid) return;
    if (!spotifyFailedRef.current.has(currentMbid)) return;
    // This track failed on Spotify in a live ride → resume the broadcast.
    resumeRadio?.();
  }, [
    active,
    playbackMode,
    timeOrientation,
    spotifyModeForCurrent,
    currentMbid,
    resumeRadio,
    spotifyFallbackTick,
  ]);

  // Drive playback of the current item: resolve its preview, then play it.
  useEffect(() => {
    if (!active) return undefined;
    if (spotifyModeForCurrent) return undefined; // Spotify carries this track
    // For live fallback, the broadcast carries the audio — no preview needed.
    if (
      playbackMode === "resolve_to_service" &&
      timeOrientation === "live" &&
      currentMbid &&
      spotifyFailedRef.current.has(currentMbid)
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
    spotifyModeForCurrent,
    playbackMode,
    timeOrientation,
    spotifyFallbackTick,
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

  // Starting the radio cancels any ride (audio is exclusive).
  const toggleRadio = useCallback(
    (station: Station) => {
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
        toggle: toggleRadio,
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
        source,
        mode,
        replayLabel,
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
      },
      spotify,
    }),
    [
      radio.status,
      radio.station,
      radio.volume,
      radio.error,
      radio.setVolume,
      toggleRadio,
      stopRadio,
      active,
      status,
      queue,
      index,
      seeking,
      atTrailEnd,
      progressMs,
      source,
      mode,
      replayLabel,
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
      spotify,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}
