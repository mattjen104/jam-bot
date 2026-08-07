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
  getRecordingSupport,
  getSpotifyPlayer,
  getStationNowPlaying,
  spotifyPlay,
  spotifyPause,
  spotifyResume,
  spotifyQueueRun,
  useListStations,
  type RecordingLink,
  type SegueNext,
  type Station,
} from "@workspace/api-client-react";
import { useWpOnAir } from "../webplayer/hooks";
import interstitialToneUrl from "../assets/interstitial-tone.wav";
import { useRadioPlayer, type PlayerStatus } from "../hooks/useRadioPlayer";
import {
  useSpotifyConnect,
  type SpotifyConnectApi,
  type SpotifyDevice,
} from "./useSpotifyConnect";
import {
  type TimeOrientation,
  type PlaybackMode,
  type PlaybackTier,
  isLiveServiceRide,
  checkDeviceContinuity,
  readStoredPlaybackMode,
  writeStoredPlaybackMode,
  readLastUsedService,
  writeLastUsedService,
  createServicePrefetchTracker,
  observeMaterializationLatency,
  observeScrubCadence,
  selectPastModeTier,
  serviceOptionTier,
  tierAnnouncementText,
  type ServicePrefetchTracker,
} from "./playbackSession";
import { GUIDED_SERVICE_OPTIONS } from "../lib/guidedReplay";

// ---------------------------------------------------------------------------
// Spotify deep-link helper — pure, lives outside the component
// ---------------------------------------------------------------------------

/**
 * Extracts a `spotify:track:<id>` URI from the recording's links array.
 * Returns null when no Spotify link is present.  Falls back gracefully when
 * the URL is malformed.
 *
 * The returned URI uses colons (`spotify:track:<id>`) — the standard Spotify
 * URI scheme accepted by the Connect API and by deep-link protocol handlers
 * on all platforms.
 */
function extractSpotifyDeepLink(links: RecordingLink[]): string | null {
  for (const link of links) {
    if (!link.url.includes("spotify.com/track/")) continue;
    try {
      const parsed = new URL(link.url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const trackIdx = parts.indexOf("track");
      if (trackIdx >= 0 && trackIdx + 1 < parts.length) {
        const id = parts[trackIdx + 1];
        if (id) return `spotify:track:${id}`;
      }
    } catch {
      // malformed URL — ignore
    }
  }
  return null;
}
/**
 * Display label for the failing playback service in the past-run-failed
 * banner. Falls back to a generic phrase when the service is unknown.
 */
function serviceDisplayLabel(
  svc: "youtube" | "apple-music" | "bandcamp" | null,
): string {
  switch (svc) {
    case "youtube":
      return "YouTube";
    case "apple-music":
      return "Apple Music";
    case "bandcamp":
      return "Bandcamp";
    default:
      return "the connected service";
  }
}

import { useSpotifyDriver } from "./useSpotifyDriver";
import { useYouTubeDriver } from "./useYouTubeDriver";
import { useAppleMusicDriver } from "./useAppleMusicDriver";
import { useLocalFileDriver } from "./useLocalFileDriver";
import { useBandcampDriver } from "./useBandcampDriver";
import { ConnectionCentre } from "./ConnectionCentre";
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
  /** Spin duration in seconds, from the broadcast record. Used by Tier-4 cue sheet. */
  spinDurationSeconds?: number | null;
}

/**
 * Structured reason for a past-mode replay hard stop: which track failed and
 * which service couldn't load it. `service` is a display label ("Spotify",
 * "YouTube", …) or "the connected service" when unknown.
 */
export interface PastRunFailure {
  mbid: string;
  title: string;
  artist: string;
  service: string;
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
  /** Spin duration in seconds, from the broadcast record. Used by Tier-4 cue sheet. */
  spinDurationSeconds?: number | null;
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
   * YouTube, Apple Music, local file, Bandcamp) or the 30s preview element.
   * Null before playback begins. */
  source: "spotify" | "youtube" | "apple-music" | "local-file" | "bandcamp" | "preview" | null;

  /**
   * Human-readable label for the current audio source.  Suitable for display
   * in the transparent source chip beneath the player controls.
   * Null before playback begins.
   */
  sourceLabel: string | null;
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

  /** Open the Connection Centre panel. */
  openConnectionCentre: () => void;
  /**
   * Seek to a position within the current track.  Only meaningful when
   * `source` is `"youtube"` or `"apple-music"` — the active driver must
   * implement the optional `seek()` method.  No-op for other sources.
   */
  seek: (ms: number) => void;

  // ---- Options panel fields -----------------------------------------------

  /**
   * `spotify:track/<id>` deep-link URI for the current track, derived from
   * the track's links array.  Falls back to the HTTPS Spotify URL on desktop.
   * Null when no Spotify ID is available for the current track.
   */
  spotifyDeepLink: string | null;

  /**
   * Album-level Bandcamp buy URL for the current track's release.
   * Only set when a Bandcamp embed link scoped to the release (not the track)
   * is available.  Track-level Bandcamp links are excluded.
   * Null when not available or while loading.
   */
  bandcampAlbumUrl: string | null;

  /**
   * True when Apple Music is configured server-side (a developer token
   * exists).  Used to decide whether to show the Apple Music option in the
   * panel even before the user has authorized.
   */
  appleMusicConfigured: boolean;

  /**
   * True once the user has successfully authorized Apple Music in this
   * session (Apple Music driver fired "playing" at least once).  Drives the
   * "connect" CTA in the options panel.
   */
  appleMusicConnected: boolean;

  /**
   * Explicitly selected playback service.  When set, the driver cascade
   * starts from this service, bypassing Spotify.  Null = default cascade.
   */
  preferredService: "youtube" | "apple-music" | "bandcamp" | null;

  /**
   * Explicitly select a service to drive playback.  Sets playback mode to
   * resolve_to_service and stops any currently-active driver.  Null clears
   * the preference (keeps the last playback mode).
   */
  setPreferredService: (svc: "youtube" | "apple-music" | "bandcamp" | null) => void;

  /**
   * Companion-mode live-to-past crossing detected.
   * True on the edge where the audio pipeline crosses from live broadcast
   * (station passthrough) to past replay (service-orchestrated). The
   * Lore-authored interstitial tone plays here to mark the boundary honestly.
   *
   * While armed, the preview-drive playback effect is gated — past audio does
   * not start until the interstitial tone finishes and the gate clears.
   */
  interstitialArmed: boolean;
  /** Dismiss the interstitial after the tone plays (or immediately, on demand). */
  dismissInterstitial: () => void;

  /**
   * True when a live→past crossing revealed that the listener's active Spotify
   * output differs from their pinned device. Cleared when the listener confirms
   * via dismissDeviceMismatch(), or when a new ride starts.
   *
   * The UI should surface the device picker with an explanation so the listener
   * can confirm (or change) where replay audio will play before it begins.
   */
  deviceMismatch: boolean;
  /** Called when the listener has acknowledged the device-mismatch banner (or
   *  confirmed their device in the picker). Clears the mismatch gate so the
   *  interstitial can auto-dismiss and past playback can begin. */
  dismissDeviceMismatch: () => void;

  /**
   * True when the scrub head has outrun the prefetch buffer — the current track
   * is still being resolved on the active service.
   * The UI must show "Finding this on [Service]…" rather than silence.
   */
  bufferOutrun: boolean;

  // ---- Past-mode tier orchestration ----------------------------------------

  /**
   * Playback tier selected for this past crossing run.
   *  1 = Spotify Connect (whole run queued gaplessly in one call)
   *  2 = Embed + auto-advance (e.g. YouTube IFrame ENDED)
   *  3 = Embed + manual advance (e.g. Bandcamp)
   *  4 = Cue sheet (timed "Next: {artist} — {title}" affordance)
   * Null when not in past-mode replay.
   */
  pastModeTier: PlaybackTier | null;

  /**
   * One-sentence announcement of which tier applies, shown before playback
   * starts on a past crossing. Null when not in past-mode replay.
   */
  pastModeTierAnnouncement: string | null;

  /**
   * True when the Tier-4 cue sheet "Next: {artist} — {title}" control should
   * be visible. Becomes true after `spinDurationSeconds` for the current track
   * (or immediately when `spinDurationSeconds` is null/unknown — a common case:
   * 42.3% of all-time spins have no recorded duration).
   */
  cueSheetVisible: boolean;

  /**
   * The next item in the replay queue — shown in the Tier-4 cue sheet control.
   * Null when on the last track or when not in past-mode Tier-4.
   */
  cueSheetNext: { artist: string; title: string } | null;

  /**
   * True when service resolution failed mid-run and the ride stopped.
   * Never silently downgrades to a lower tier — the dial surfaces this state
   * explicitly so the listener knows why playback stopped.
   */
  pastRunFailed: boolean;

  /**
   * Which track (and which service) stopped the replay — set alongside
   * `pastRunFailed` so the Dial can name the culprit instead of showing a
   * generic message. Null when no failure is active or when the failing
   * track could not be identified.
   */
  pastRunFailure: PastRunFailure | null;

  /**
   * After a `pastRunFailed` hard stop: retry the Tier-1 bulk Spotify
   * queue-run.  Explicit listener action — never fired automatically.
   */
  retryPastRun: () => void;

  /**
   * After a `pastRunFailed` hard stop: continue the ride without Spotify by
   * re-selecting the playback tier with Spotify ineligible (embed tier or
   * Tier-4 cue sheet).
   */
  continuePastRunWithCueSheet: () => void;
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
  const [source, setSource] = useState<"spotify" | "youtube" | "apple-music" | "local-file" | "bandcamp" | "preview" | null>(null);
  const [connectionCentreOpen, setConnectionCentreOpen] = useState(false);
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

  // Options-panel state: explicit service preference + derived async fields.
  const [preferredService, setPreferredServiceState] = useState<"youtube" | "apple-music" | "bandcamp" | null>(null);
  const [bandcampAlbumUrl, setBandcampAlbumUrl] = useState<string | null>(null);
  // True once Apple Music has successfully played a track this session.
  const [appleMusicConnected, setAppleMusicConnected] = useState(false);
  // True when every alt driver (Apple Music AND YouTube) has been exhausted
  // for the current track. Used alongside Spotify's `fallbackUsed` to gate
  // live broadcast resume when the user explicitly selected a service that
  // then failed — ensuring audio never goes silent on a live ride.
  const [altDriversAllFailed, setAltDriversAllFailed] = useState(false);

  // Past-mode tier orchestration state.
  const [pastModeTier, setPastModeTier] = useState<PlaybackTier | null>(null);
  const [pastModeTierLabel, setPastModeTierLabel] = useState<string | null>(null);
  const [cueSheetVisible, setCueSheetVisible] = useState(false);
  const [pastRunFailed, setPastRunFailed] = useState(false);
  const [pastRunFailure, setPastRunFailure] = useState<PastRunFailure | null>(
    null,
  );
  // One-shot flag: true once the Tier-1 uris-array queue call has fired for
  // the current ride. Reset in stop() and startReplay(). Stored as a ref so
  // the effect can read/write it without triggering extra re-renders.
  const tier1RunQueuedRef = useRef(false);
  // Set of MBIDs currently being link-fetched by the Tier-1 prefetch effect.
  const tier1FetchingRef = useRef<Set<string>>(new Set());
  // MBIDs whose Tier-1 link prefetch has COMPLETED (even with zero links).
  // Without this, an item whose fetch legitimately returned no links stays
  // "pending" forever (links.length === 0), re-fetching in a tight effect loop
  // whenever the queue-run has not yet fired (e.g. while the live→past
  // interstitial gate is armed).
  const tier1FetchedRef = useRef<Set<string>>(new Set());
  // True once ALL Tier-1 link-prefetch fetches for the current ride have
  // completed (resolved or errored). Resets to false on each new ride start.
  // Added to queue-run effect deps so validation only fires after all links
  // are resolved — prevents silent partial-URI queue calls.
  const [tier1LinkBatchDone, setTier1LinkBatchDone] = useState(false);
  // One-shot flag: true once the Tier-2/3 deferred service-driver activation
  // effect has run for the current ride. Reset on each new ride start.
  const tierRefinedRef = useRef(false);
  // Set of MBIDs whose links are currently being fetched by the Tier-2/3
  // independent link-hydration effect. Prevents double-fetches when the
  // current item changes before a prior fetch completes.
  const tier23LinkFetchingRef = useRef<Set<string>>(new Set());

  // Live-to-past pipeline crossing interstitial.
  // Set when the audio pipeline crosses from live broadcast to past replay.
  // While true, the preview-drive playback effect is gated (past audio waits)
  // and the Lore-authored interstitial tone plays to mark the boundary.
  const [interstitialArmed, setInterstitialArmed] = useState(false);
  // Ref mirror so stable callbacks (tryAltDriverRef etc.) can read without
  // being captured in their closure dependency arrays.
  const interstitialArmedRef = useRef(false);
  interstitialArmedRef.current = interstitialArmed;

  // True when the device-continuity check found a mismatch between the active
  // Spotify output and the pinned device. Keeps the interstitial gate held open
  // until the listener acknowledges via dismissDeviceMismatch().
  const [deviceMismatch, setDeviceMismatch] = useState(false);

  // True while the async getSpotifyDevices call is in flight at a crossing.
  // Prevents the auto-dismiss timer from firing before the check resolves.
  const [deviceCheckPending, setDeviceCheckPending] = useState(false);

  // Session flag: device continuity was checked on the first live→past crossing.
  // After the check runs once this session, no further prompts are shown.
  const deviceContinuityCheckedRef = useRef(false);

  // Dedicated interstitial-tone audio element, pre-unlocked inside the user
  // gesture that triggers the crossing (muted play()+pause()). Under the
  // strictest autoplay policy (--autoplay-policy=user-gesture-required) a
  // *fresh* Audio() created more than ~5s after the gesture is blocked
  // (transient activation expires; sticky activation is not honoured), so if
  // the device check runs long the tone would silently skip. An element that
  // has already had play() succeed inside the gesture handler keeps its
  // playback permission and still sounds after the window expires.
  const interstitialToneRef = useRef<HTMLAudioElement | null>(null);
  /** Unlock the tone element during the crossing gesture. Fail-open: any
   *  refusal here just means the playback effect falls back to a fresh
   *  Audio() (the pre-fix behaviour). */
  const unlockInterstitialTone = useCallback(() => {
    try {
      const tone = new Audio(interstitialToneUrl);
      tone.muted = true;
      const rewind = () => {
        tone.pause();
        try { tone.currentTime = 0; } catch { /* not yet seekable — fine */ }
        tone.muted = false;
      };
      const p = tone.play();
      if (p && typeof p.then === "function") {
        p.then(rewind).catch(() => { tone.muted = false; });
      } else {
        rewind();
      }
      interstitialToneRef.current = tone;
    } catch {
      interstitialToneRef.current = null;
    }
  }, []);

  // Per-service prefetch trackers (keyed by service string: "preview", "spotify", etc.)
  // Updated as materialization observations arrive; mutated via ref (no re-render needed).
  const prefetchTrackersRef = useRef<Map<string, ServicePrefetchTracker>>(new Map());

  // Timestamp (Date.now()) when the most recent track advance occurred.
  // Used to measure inter-detent cadence for the EWMA prefetch tracker.
  const lastAdvanceTimeRef = useRef<number | null>(null);

  // Stable refs to Spotify primitives the crossing handler needs inside async
  // .then() callbacks — avoids capturing a stale closure over spotify.
  const spotifyFetchDevicesRef = useRef<(() => Promise<SpotifyDevice[]>) | null>(null);
  spotifyFetchDevicesRef.current = spotify.fetchDevices;
  const spotifyPinnedDeviceIdRef = useRef<string | null | undefined>(spotify.pinnedDevice?.id);
  spotifyPinnedDeviceIdRef.current = spotify.pinnedDevice?.id;

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
  const sourceRef = useRef<"spotify" | "youtube" | "apple-music" | "local-file" | "bandcamp" | "preview" | null>(null);
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
    lastAdvanceTimeRef.current = null;
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
    // Reset options-panel state on ride end.
    setPreferredServiceState(null);
    setAppleMusicConnected(false);
    setAltDriversAllFailed(false);
    // Clear the interstitial and related device-continuity state — fired once
    // per live→past crossing; dismissed on ride end so the next crossing arms
    // cleanly.
    setInterstitialArmed(false);
    setDeviceMismatch(false);
    setDeviceCheckPending(false);
    // NOTE: deviceContinuityCheckedRef is NOT reset here — it is a session-level
    // flag (once per session, not once per ride).
    // Reset past-mode tier state.
    setPastModeTier(null);
    setPastModeTierLabel(null);
    setCueSheetVisible(false);
    setPastRunFailed(false);
    setPastRunFailure(null);
    tier1RunQueuedRef.current = false;
    tier1FetchingRef.current = new Set();
    tier1FetchedRef.current = new Set();
    setTier1LinkBatchDone(false);
    tierRefinedRef.current = false;
    tier23LinkFetchingRef.current = new Set();
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

      // Live-to-past crossing detection.
      // "live" means: an active live-orientation ride, OR plain radio playing
      // (station passthrough was carrying audio before this start call).
      const newOrientation = opts?.timeOrientation ?? "curated";
      const wasLiveAudio =
        (active && timeOrientationRef.current === "live") ||
        (!active &&
          radioRef.current.status !== "idle" &&
          radioRef.current.status !== "error");
      if (wasLiveAudio && newOrientation === "past") {
        // Companion-mode interstitial crossing.
        // Arms the gate: the preview-drive playback effect will not start audio
        // until interstitialArmed clears (see tone-playback effect below, which
        // plays the Lore-authored interstitial tone and then dismisses).
        setInterstitialArmed(true);
        // Unlock the tone element while we still hold the user gesture — if
        // the device check below runs past the transient-activation window
        // (~5s), a fresh Audio() would be blocked but this one still plays.
        unlockInterstitialTone();
        // Device continuity: on the first live→past crossing this session, fetch
        // the device list, find the currently-active output, compare it to the
        // pinned Connect device. If they differ, set deviceMismatch so the UI
        // surfaces a confirmation gate and the interstitial stays armed until
        // the listener confirms. Must complete (setDeviceCheckPending(false))
        // before the auto-dismiss effect allows playback to start.
        if (
          !deviceContinuityCheckedRef.current &&
          playbackModeRef.current === "resolve_to_service"
        ) {
          deviceContinuityCheckedRef.current = true;
          setDeviceCheckPending(true);
          // Capture the pin ID synchronously — reading the ref here gives us a
          // coherent pre-fetch snapshot.  Reading it inside .then() would be
          // racy: fetchDevices() calls setPinnedDevice(null) when the pin is
          // unreachable, but that React state update has not flushed by the time
          // .then() runs, so the ref could still hold the stale (now-cleared) ID.
          const pinnedIdAtCrossing = spotifyPinnedDeviceIdRef.current ?? null;
          // Capture the ride token so a stale response cannot gate a new ride.
          const tokenAtCheck = rideRef.current;
          void spotifyFetchDevicesRef.current?.()
            .then((devices) => {
              // Discard if the ride was replaced while the fetch was in flight.
              if (rideRef.current !== tokenAtCheck) return;
              // No pin at crossing → no device to compare against.
              if (!pinnedIdAtCrossing) return;
              // If the pinned device is not in the returned list it is unreachable.
              // fetchDevices() already cleared the pin and showed the "Pinned
              // device unreachable" toast — we must not additionally show a
              // blocking mismatch banner for a device that no longer exists.
              const pinnedReachable = (devices ?? []).some(
                (d) => d.id === pinnedIdAtCrossing,
              );
              if (!pinnedReachable) return;
              // Device is reachable.  Check if it is the currently active output.
              const activeDevice = (devices ?? []).find((d) => d.isActive);
              if (!activeDevice || activeDevice.id !== pinnedIdAtCrossing) {
                // Mismatch: keep interstitial armed until the listener confirms
                // their device via the RideBar confirmation gate.
                setDeviceMismatch(true);
              }
            })
            .catch(() => {})
            .finally(() => {
              // Always clear the pending flag so the auto-dismiss can proceed.
              setDeviceCheckPending(false);
            });
        }
      }

      setSource(null);
      setActive(true);
      setStatus("loading");
      setAtTrailEnd(false);
      setSeeking(false);
      setMode("trail");
      setReplayLabel(null);
      setRideListenContext(null);
      setInterstitialArmed((prev) => {
        // Keep armed if set by the crossing above; otherwise leave untouched.
        return prev;
      });
      // Clear past-mode tier state — trail rides do not use tier orchestration.
      setPastModeTier(null);
      setPastModeTierLabel(null);
      setCueSheetVisible(false);
      setPastRunFailed(false);
      setPastRunFailure(null);
      tier1RunQueuedRef.current = false;
      tier1FetchingRef.current = new Set();
    tier1FetchedRef.current = new Set();
      setTier1LinkBatchDone(false);
      tierRefinedRef.current = false;
      tier23LinkFetchingRef.current = new Set();
      setTimeOrientation(newOrientation);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, pauseRadio, clearScanTimer, stopScanAudio],
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
      // Live-to-past crossing detection (same logic as start()).
      const newOrientation = opts?.timeOrientation ?? "past";
      const wasLiveAudio =
        (active && timeOrientationRef.current === "live") ||
        (!active &&
          radioRef.current.status !== "idle" &&
          radioRef.current.status !== "error");
      if (wasLiveAudio && newOrientation === "past") {
        // Companion-mode interstitial crossing.
        // Arms the gate: the preview-drive playback effect will not start audio
        // until interstitialArmed clears (see tone-playback effect below, which
        // plays the Lore-authored interstitial tone and then dismisses).
        setInterstitialArmed(true);
        // Unlock the tone element while we still hold the user gesture — see
        // the identical call in start() for the autoplay-policy rationale.
        unlockInterstitialTone();
        // Device continuity: fetch devices, find the active output, compare to
        // the pinned device. If mismatch, set deviceMismatch so the UI shows a
        // confirmation gate before replay audio begins. The fetch must complete
        // (setDeviceCheckPending(false)) before the auto-dismiss can fire.
        if (
          !deviceContinuityCheckedRef.current &&
          playbackModeRef.current === "resolve_to_service"
        ) {
          deviceContinuityCheckedRef.current = true;
          setDeviceCheckPending(true);
          // Capture the pin synchronously — same rationale as in start(): reading
          // spotifyPinnedDeviceIdRef inside .then() would see a stale value after
          // fetchDevices() calls setPinnedDevice(null) for an unreachable pin.
          const pinnedIdAtCrossing = spotifyPinnedDeviceIdRef.current ?? null;
          const tokenAtCheck = rideRef.current;
          void spotifyFetchDevicesRef.current?.()
            .then((devices) => {
              if (rideRef.current !== tokenAtCheck) return;
              if (!pinnedIdAtCrossing) return;
              const pinnedReachable = (devices ?? []).some(
                (d) => d.id === pinnedIdAtCrossing,
              );
              if (!pinnedReachable) return; // fetchDevices already cleared + toasted
              const activeDevice = (devices ?? []).find((d) => d.isActive);
              if (!activeDevice || activeDevice.id !== pinnedIdAtCrossing) {
                setDeviceMismatch(true);
              }
            })
            .catch(() => {})
            .finally(() => {
              setDeviceCheckPending(false);
            });
        }
      }

      // Ghost-radio station runs are 'past'; curated picker runs are 'curated'.
      setTimeOrientation(newOrientation);
      // Reset past-mode tier state for the new ride.
      tier1RunQueuedRef.current = false;
      tier1FetchingRef.current = new Set();
    tier1FetchedRef.current = new Set();
      setTier1LinkBatchDone(false);
      tierRefinedRef.current = false;
      tier23LinkFetchingRef.current = new Set();
      setPastRunFailed(false);
      setPastRunFailure(null);
      setCueSheetVisible(false);
      // Compute playback tier for past-orientation rides from the connected services.
      if (newOrientation === "past") {
        const tier = selectPastModeTier({
          spotify: {
            connected: spotify.connected,
            premium: spotify.premium,
            hasActiveDevice: !!spotify.pinnedDevice,
          },
          guidedOptions: GUIDED_SERVICE_OPTIONS,
          lastUsedService: readLastUsedService(),
        });
        let label: string | null = null;
        if (tier === 1) {
          label = "Spotify";
        } else {
          const opt = GUIDED_SERVICE_OPTIONS.find((o) => serviceOptionTier(o) === tier);
          label = opt?.label ?? null;
        }
        setPastModeTier(tier);
        setPastModeTierLabel(label);
        // Record the chosen service so next time the listener's preference is honoured.
        if (tier === 1) {
          writeLastUsedService("spotify");
          // Tier 1 must run in resolve_to_service mode.  If the listener has
          // passthrough persisted (e.g. they have never opened Settings), the
          // queue-run effect would never fire while the audio path is already
          // suppressed, producing silence.  Switch explicitly here.
          writeStoredPlaybackMode("resolve_to_service");
          setPlaybackModeState("resolve_to_service");
        } else if (label) {
          const opt = GUIDED_SERVICE_OPTIONS.find((o) => serviceOptionTier(o) === tier);
          if (opt) writeLastUsedService(opt.service);
        }
        // Tier 2 / Tier 3: embed driver activation is deferred to the
        // `tierRefinedEffect` below.  That effect fires once the current item's
        // links resolve, tests each candidate option's `embedUrlBuilder` against
        // the real link URLs, and picks the best service (honouring
        // `lastUsedService`).  Deferred activation makes Tier 3 (Bandcamp)
        // reachable for runs that only have Bandcamp links, and hard-stops to
        // Tier 4 when no embed service can handle the run — honest, not silent.
      } else {
        setPastModeTier(null);
        setPastModeTierLabel(null);
      }
      setQueue(
        seeds.map((seed) => ({
          mbid: seed.mbid,
          title: seed.title,
          artist: seed.artist,
          artworkUrl: seed.artworkUrl,
          links: seed.links,
          attribution: null,
          spinDurationSeconds: seed.spinDurationSeconds ?? null,
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
          newOrientation === "curated" ? "curated" : "past",
          startAt >= 0 && startAt < seeds.length ? startAt : 0,
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, pauseRadio, clearScanTimer, stopScanAudio],
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
      // Clear explicit service preference when returning to broadcast.
      setPreferredServiceState(null);
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

  // Scrub-cadence tracking: record time between successive track advances so
  // the EWMA prefetch tracker can adjust depth for the listener's browse pace.
  useEffect(() => {
    if (!active) return;
    const now = Date.now();
    if (lastAdvanceTimeRef.current !== null) {
      const cadenceMs = now - lastAdvanceTimeRef.current;
      // Only record if cadence looks plausible (between 500ms and 30min).
      if (cadenceMs > 500 && cadenceMs < 30 * 60 * 1000) {
        const svc = sourceRef.current ?? "preview";
        const current =
          prefetchTrackersRef.current.get(svc) ?? createServicePrefetchTracker();
        prefetchTrackersRef.current.set(
          svc,
          observeScrubCadence(current, cadenceMs),
        );
      }
    }
    lastAdvanceTimeRef.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  // Adaptive prefetch: pre-resolve preview URLs for upcoming items in a past-
  // orientation replay up to `depth` tracks ahead of the current index.
  //
  // - Only fires in past orientation — live orientation has no fixed queue to
  //   pre-fetch, and curated rides are shorter-lived.
  // - Skips items whose preview is already resolved (previewUrl !== undefined).
  // - On direction reversal, stale in-flight forward fetches are allowed to
  //   land (they will resolve the item correctly via MBID-keyed setQueue) but
  //   no NEW forward fetches are started for the stale direction.
  // - A nearly-done in-flight job is always allowed to complete.
  useEffect(() => {
    if (!active) return;
    if (timeOrientation !== "past") return; // only prefetch in past orientation
    if (mode !== "replay") return; // trail mode uses the segue-lookahead path

    const svc = "preview";
    const tracker =
      prefetchTrackersRef.current.get(svc) ?? createServicePrefetchTracker();
    const depth = tracker.depth; // PREFETCH_DEPTH_START until EWMA converges

    const token = rideRef.current;

    for (let ahead = 1; ahead <= depth; ahead++) {
      const item = queue[index + ahead];
      if (!item) break;
      if (item.previewUrl !== undefined) continue; // already resolved
      if (previewFetchingRef.current.has(item.mbid)) continue; // in flight

      const targetMbid = item.mbid;
      const fetchStart = Date.now();
      previewFetchingRef.current.add(targetMbid);

      void getRecordingPreview(targetMbid)
        .then((p) => {
          if (token !== rideRef.current) return;
          // Record materialization latency for the EWMA tracker.
          const latencyMs = Date.now() - fetchStart;
          const cur =
            prefetchTrackersRef.current.get(svc) ?? createServicePrefetchTracker();
          prefetchTrackersRef.current.set(
            svc,
            observeMaterializationLatency(cur, latencyMs),
          );
          setQueue((q) =>
            q.map((qi) =>
              qi.mbid === targetMbid
                ? {
                    ...qi,
                    previewUrl: p.previewUrl,
                    artworkUrl: qi.artworkUrl ?? p.artworkUrl ?? null,
                  }
                : qi,
            ),
          );
        })
        .catch(() => {
          if (token === rideRef.current) {
            setQueue((q) =>
              q.map((qi) =>
                qi.mbid === targetMbid ? { ...qi, previewUrl: null } : qi,
              ),
            );
          }
        })
        .finally(() => {
          previewFetchingRef.current.delete(targetMbid);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index, queue, timeOrientation, mode]);

  // ---- Playback drivers ---------------------------------------------------
  // Three drivers are instantiated each session. PlayerProvider selects the
  // first available one (Spotify → Apple Music → YouTube) as `activeDriver`
  // and delegates play/pause/resume through the shared handle interface.
  // When the selected driver fails for a specific track, PlayerProvider tries
  // the next available driver before falling back to preview/broadcast.

  const spotifyDriver = useSpotifyDriver({
    // Interstitial gate. While interstitialArmed is true the Spotify driver
    // must not command the connected device. Passing
    // `active && !interstitialArmed` suppresses the driver's play effect for
    // the entire crossing window while the Lore interstitial tone plays.
    // ⚠️ Tier 1 past-mode gate: when the bulk uris-array queue call owns the
    // run, suppress the Spotify driver's per-track play commands entirely so
    // they do not race with the single queue-run call.
    active:
      active &&
      !interstitialArmed &&
      !(pastModeTier === 1 && timeOrientation === "past" && mode === "replay"),
    playbackMode,
    timeOrientation,
    currentItem,
    isLiveSvcRide,
    queueLenRef,
    rideRef,
    audioRef,
    pauseRadio,
    spotify,
    preferredService,
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

  // Local file driver — highest cascade priority when files are matched.
  const localFileDriver = useLocalFileDriver();

  // Bandcamp embed driver — lowest priority before YouTube.
  const bandcampDriver = useBandcampDriver();

  // Preference order: Local file → Spotify → Apple Music → YouTube.
  // (Bandcamp and local file are wired into the cascade via effects below.)
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
    localFileDriver.stop();
    bandcampDriver.stop();
  };
  // Route pause/resume/seek to whichever driver is currently sounding, not the
  // statically-preferred one — Spotify may be preferred but YouTube/Apple
  // could be carrying the audio after a per-track fallback.
  activeDriverPauseRef.current = async () => {
    const src = sourceRef.current;
    if (src === "youtube") return youtubeDriver.pause();
    if (src === "apple-music") return appleMusicDriver.pause();
    if (src === "local-file") return localFileDriver.pause();
    if (src === "bandcamp") return bandcampDriver.pause();
    return spotifyDriver.handle.pause();
  };
  activeDriverResumeRef.current = async () => {
    const src = sourceRef.current;
    if (src === "youtube") return youtubeDriver.resume();
    if (src === "apple-music") return appleMusicDriver.resume();
    if (src === "local-file") return localFileDriver.resume();
    if (src === "bandcamp") return bandcampDriver.resume();
    return spotifyDriver.handle.resume();
  };
  activeDriverSeekRef.current = (() => {
    const src = sourceRef.current;
    if (src === "youtube") return youtubeDriver.seek ?? null;
    if (src === "apple-music") return appleMusicDriver.seek ?? null;
    if (src === "local-file") return localFileDriver.seek ?? null;
    return null;
  })();

  // Convenience aliases from the Spotify driver extras.
  const { spotifyModeForCurrent, fallbackUsed, deviceLost, retryCurrentTrack } =
    spotifyDriver;

  // Service-agnostic fallback flag: Spotify failed OR all alt drivers exhausted.
  // Used wherever the old `fallbackUsed` gated live broadcast resume / preview
  // skip — so that a preferredService failure also triggers broadcast recovery.
  const effectiveFallbackUsed = fallbackUsed || altDriversAllFailed;

  /**
   * Retry the active ride service.  When the user explicitly selected an alt
   * service (YouTube/Apple Music) and all drivers failed, clears the failure
   * state and **directly calls `tryAltDriverRef.current`** for the current
   * track.  We do not rely on the preferred-service trigger effect re-firing
   * because after a failure both `altDriverActiveMbid` and `driverActive` are
   * already null/false — the effect deps would be unchanged and the effect
   * would not re-run.  Direct invocation is deterministic.
   * Falls back to the Spotify driver retry for the default (Spotify) path.
   */
  const retryService = useCallback(() => {
    if (altDriversAllFailed && currentMbid && currentItem) {
      // Clear per-track failures so the cascade can attempt each driver again.
      altDriverFailedRef.current.delete(`yt:${currentMbid}`);
      altDriverFailedRef.current.delete(`am:${currentMbid}`);
      altDriverFailedRef.current.delete(`bc:${currentMbid}`);
      altDriverFailedRef.current.delete(`lf:${currentMbid}`);
      setAltDriversAllFailed(false);
      setAltDriverActiveMbid(null);
      // Directly invoke the cascade — skipApple only when the user
      // explicitly chose YouTube; otherwise try Apple Music first.
      const skipApple = preferredService === "youtube";
      tryAltDriverRef.current(currentMbid, currentItem, skipApple);
    } else {
      retryCurrentTrack();
    }
  }, [altDriversAllFailed, currentMbid, currentItem, preferredService, retryCurrentTrack]);

  const retrySpotify = retryService;

  /**
   * Retry the Tier-1 bulk Spotify queue-run after a hard-stop failure
   * (`pastRunFailed`).  Clears the failure state and re-arms the one-shot
   * queue-run ref so the queue-run effect fires again.  Explicit listener
   * action only — never called automatically (no silent re-fire).
   */
  const retryPastRun = useCallback(() => {
    setPastRunFailed(false);
    setPastRunFailure(null);
    tier1RunQueuedRef.current = false;
    setStatus("loading");
  }, []);

  /**
   * After a Tier-1 hard-stop failure, continue the ride without Spotify:
   * re-select the playback tier with Spotify marked ineligible (best embed
   * tier if one exists, otherwise the Tier-4 cue sheet).  The queue-run ref
   * stays armed so the failed Tier-1 path can never silently resurrect.
   */
  const continuePastRunWithCueSheet = useCallback(() => {
    setPastRunFailed(false);
    setPastRunFailure(null);
    // Keep tier1RunQueuedRef.current = true — Tier 1 must not re-fire.
    const tier = selectPastModeTier({
      spotify: { connected: false, premium: false, hasActiveDevice: false },
      guidedOptions: GUIDED_SERVICE_OPTIONS,
      lastUsedService: null,
    });
    let label: string | null = null;
    if (tier !== 1) {
      const opt = GUIDED_SERVICE_OPTIONS.find((o) => serviceOptionTier(o) === tier);
      label = opt?.label ?? null;
    }
    // Allow the Tier 2/3 refinement effect to run for the new tier.
    tierRefinedRef.current = false;
    setPastModeTier(tier);
    setPastModeTierLabel(label);
    setStatus("loading");
  }, []);

  /** Dismiss the live→past interstitial after it plays (or during silence placeholder). */
  const dismissInterstitial = useCallback(() => setInterstitialArmed(false), []);

  /** Acknowledge the device-mismatch gate. Clears the mismatch flag so the
   *  auto-dismiss effect can proceed and past playback can begin. */
  const dismissDeviceMismatch = useCallback(() => setDeviceMismatch(false), []);

  // Interstitial tone playback + dismiss.
  // When the interstitial is armed and no device check is pending and no device
  // mismatch is blocking, play the Lore-authored crossing tone, then dismiss the
  // gate so past playback can begin. INTERSTITIAL_SILENCE_MS matches the bundled
  // asset's duration (1.2s) and doubles as a fallback timer in case the browser
  // refuses playback (autoplay policy, missing codec) or the `ended` event never
  // fires — the crossing must never wedge the player.
  const INTERSTITIAL_SILENCE_MS = 1200;
  useEffect(() => {
    if (!interstitialArmed || deviceCheckPending || deviceMismatch) return;
    let done = false;
    const dismiss = () => {
      if (done) return;
      done = true;
      setInterstitialArmed(false);
    };
    // Reuse the element pre-unlocked during the crossing gesture (it keeps
    // its playback permission even after the transient-activation window
    // expires); fall back to a fresh Audio() when none was unlocked.
    const unlocked = interstitialToneRef.current;
    interstitialToneRef.current = null;
    const tone = unlocked ?? new Audio(interstitialToneUrl);
    tone.muted = false;
    try { tone.currentTime = 0; } catch { /* not seekable yet — plays from 0 */ }
    tone.addEventListener("ended", dismiss);
    try {
      // Playback refused (autoplay policy, unsupported environment) — dismiss
      // immediately rather than holding the gate for a tone that never sounds.
      const p = tone.play();
      if (p && typeof p.catch === "function") p.catch(dismiss);
    } catch {
      dismiss();
    }
    // Fallback: dismiss after the asset duration (+ small margin) even if the
    // `ended` event never fires.
    const id = window.setTimeout(dismiss, INTERSTITIAL_SILENCE_MS + 300);
    return () => {
      window.clearTimeout(id);
      tone.removeEventListener("ended", dismiss);
      tone.pause();
      tone.src = "";
    };
  }, [interstitialArmed, deviceCheckPending, deviceMismatch]);

  // Apple Music configuration flag — derived from app config (server token).
  const appleMusicConfigured = Boolean(appConfig?.appleMusic?.developerToken ?? null);

  // Connection Centre open/close.
  const openConnectionCentre = useCallback(() => setConnectionCentreOpen(true), []);
  const closeConnectionCentre = useCallback(() => setConnectionCentreOpen(false), []);

  // Cascade transparency label — human-readable name for the current audio source.
  const sourceLabel = useMemo((): string | null => {
    switch (source) {
      case "local-file":  return "Local file";
      case "spotify":     return "Spotify";
      case "apple-music": return "Apple Music";
      case "bandcamp":    return "Bandcamp";
      case "youtube":     return "YouTube";
      case "preview":     return "Preview";
      default:            return null;
    }
  }, [source]);

  // Spotify deep-link for the current track — pure derivation, no API call.
  const spotifyDeepLink = useMemo(
    () => (currentItem ? extractSpotifyDeepLink(currentItem.links) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentItem?.links],
  );

  // ---- Alt-driver state (YouTube / Apple Music as Spotify fallback) --------
  // When Spotify fails for a track, PlayerProvider tries Apple Music (if
  // available), then YouTube, before dropping to broadcast/preview.
  // `altDriverActiveMbid` is set whenever an alt driver is loading OR playing
  // a track — it gates the preview effect and the live-broadcast fallback so we
  // don't resume the broadcast while an alt driver is still attempting.
  const [altDriverActiveMbid, setAltDriverActiveMbid] = useState<string | null>(null);
  // Per-driver failure keys: "am:<mbid>" for Apple Music, "yt:<mbid>" for YouTube.
  const altDriverFailedRef = useRef<Set<string>>(new Set());

  // ---- Explicit service selection ------------------------------------------

  /**
   * Let the listener pick YouTube or Apple Music from the options panel.
   * Stops any active driver and re-triggers the correct cascade so the
   * selected service takes over the current track immediately.
   */
  const setPreferredService = useCallback(
    (svc: "youtube" | "apple-music" | "bandcamp" | null) => {
      setPreferredServiceState(svc);
      if (svc) {
        // Ensure service-ride mode is active.
        writeStoredPlaybackMode("resolve_to_service");
        setPlaybackModeState("resolve_to_service");
        // Stop all drivers so the preferred service can start fresh.
        activeDriverStopRef.current();
        sourceRef.current = null;
        setSource(null);
        setAltDriverActiveMbid(null);
        altDriverFailedRef.current.clear();
        setAltDriversAllFailed(false);
        // Silence the preview audio element.
        const el = audioRef.current;
        if (el) {
          el.pause();
          el.removeAttribute("src");
          playingUrlRef.current = null;
        }
      }
    },
    [],
  );

  // On every track change: stop any alt driver still playing from the previous
  // track so audio-exclusivity is enforced across queue advances, prev/next,
  // and live now-playing advances.  Spotify handles its own continuity via its
  // internal poll + command effect; all other drivers need explicit teardown.
  useEffect(() => {
    youtubeDriver.stop();
    appleMusicDriver.stop();
    localFileDriver.stop();
    bandcampDriver.stop();
    if (
      sourceRef.current === "youtube" ||
      sourceRef.current === "apple-music" ||
      sourceRef.current === "local-file" ||
      sourceRef.current === "bandcamp"
    ) {
      sourceRef.current = null;
      setSource(null);
    }
    setAltDriverActiveMbid(null);
    altDriverFailedRef.current.clear();
    setAltDriversAllFailed(false);
    // Clear stale duration when the track changes.
    setDurationMs(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMbid]);

  // True when any driver (Spotify or alt) is actively carrying this track
  // (including while loading — prevents premature broadcast resumption).
  const driverActive = spotifyModeForCurrent || altDriverActiveMbid === currentMbid;

  // ---- Bandcamp album URL — async fetch on track change --------------------
  useEffect(() => {
    setBandcampAlbumUrl(null);
    if (!currentMbid) return;
    let cancelled = false;
    const run = async () => {
      try {
        // `await` handles a mocked/absent function returning undefined gracefully.
        const support = await getRecordingSupport(currentMbid);
        if (cancelled) return;
        // Album-scope Bandcamp links have detail "Bandcamp release".
        // Track-scope links have detail "Exact Bandcamp track" and are excluded.
        const bcLink = support?.links?.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (l: any) => l.kind === "bandcamp" && l.detail === "Bandcamp release",
        );
        setBandcampAlbumUrl(bcLink?.url ?? null);
      } catch {
        if (!cancelled) setBandcampAlbumUrl(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [currentMbid]);

  // Try the next alt driver in the cascade:
  //   Local file → Apple Music → Bandcamp → YouTube
  // Called after Spotify fails, and again when any driver fails so the next
  // one in the ladder gets a chance before we drop to preview/broadcast.
  const tryAltDriverRef = useRef<
    (mbid: string, item: RideItem, skipApple: boolean, skipBandcamp?: boolean) => void
  >(() => {});
  // Defined after the subscriptions below so the closures can call it recursively.
  // The ref indirection avoids a dependency cycle.
  useEffect(() => {
    tryAltDriverRef.current = (
      mbid: string,
      item: RideItem,
      skipApple: boolean,
      skipBandcamp = false,
    ) => {
      // Interstitial gate.
      // While the live→past interstitial is armed, no driver may command audio.
      // We read from the ref (not state) so this closure always sees the latest
      // value without requiring the ref to be in the deps array.
      if (interstitialArmedRef.current) return;

      // ── Local file: try first if a file is matched ───────────────────────
      const failedLf = altDriverFailedRef.current.has(`lf:${mbid}`);
      if (!failedLf && localFileDriver.available) {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        void localFileDriver.play(item).catch(() => {
          // No local file for this track — cascade to Apple Music.
          altDriverFailedRef.current.add(`lf:${mbid}`);
          setAltDriverActiveMbid(null);
          // Preserve both skip flags so the caller's intent carries through.
          tryAltDriverRef.current(mbid, item, skipApple, skipBandcamp);
        });
        return;
      }

      // ── Apple Music ───────────────────────────────────────────────────────
      const failedAm = altDriverFailedRef.current.has(`am:${mbid}`);
      if (!skipApple && appleMusicDriver.available && !failedAm) {
        // Enforce audio exclusivity before handing off to Apple Music.
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        void appleMusicDriver.play(item).catch(() => {
          // play() itself threw (no token, etc.) — cascade to Bandcamp.
          altDriverFailedRef.current.add(`am:${mbid}`);
          setAltDriverActiveMbid(null);
          // Preserve skipBandcamp so a Tier-2 run still reaches YouTube.
          tryAltDriverRef.current(mbid, item, true, skipBandcamp);
        });
        return;
      }

      // ── Bandcamp embed ────────────────────────────────────────────────────
      // Skipped when skipBandcamp=true (Tier 2 / YouTube preferred — go
      // directly to YouTube without stopping at Bandcamp first).
      const failedBc = altDriverFailedRef.current.has(`bc:${mbid}`);
      if (!failedBc && !skipBandcamp) {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        void bandcampDriver.play(item).catch(() => {
          altDriverFailedRef.current.add(`bc:${mbid}`);
          setAltDriverActiveMbid(null);
          tryAltDriverRef.current(mbid, item, true, false);
        });
        return;
      }

      // ── YouTube ───────────────────────────────────────────────────────────
      const failedYt = altDriverFailedRef.current.has(`yt:${mbid}`);
      if (!failedYt) {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        void youtubeDriver.play(item).catch(() => {
          altDriverFailedRef.current.add(`yt:${mbid}`);
          setAltDriverActiveMbid(null);
          // YouTube is the last driver in the cascade — every option is now
          // exhausted. Set the flag so the live fallback effect fires.
          setAltDriversAllFailed(true);
        });
        return;
      }
      // All alt drivers were already failed when tryAltDriverRef was entered
      // (e.g. a retry that found all keys still in the set). Safety net.
      setAltDriverActiveMbid(null);
      setAltDriversAllFailed(true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appleMusicDriver, youtubeDriver, localFileDriver, bandcampDriver, pauseRadio]);

  // ---- Preferred service trigger: start the user's chosen driver ----------
  // Fires when the user explicitly picks YouTube or Apple Music from the
  // options panel.  The cascade is adjusted: skipApple=true sends us straight
  // to YouTube; skipApple=false tries Apple Music first then falls to YouTube.
  // Interstitial gate: suppressed while the crossing tone is playing.
  useEffect(() => {
    if (!active || !preferredService || !currentMbid || !currentItem) return;
    if (playbackMode !== "resolve_to_service") return;
    if (interstitialArmed) return; // gate: do not start any driver while crossing
    if (altDriverActiveMbid === currentMbid) return; // already driving this track
    if (driverActive) return; // Spotify or an alt driver is already carrying audio
    // Skip Apple Music when the listener chose YouTube (Tier 2, go straight to
    // YouTube) or Bandcamp (Tier 3, land on Bandcamp, not Apple Music).
    const skipApple = preferredService === "youtube" || preferredService === "bandcamp";
    // Skip Bandcamp when YouTube was selected (Tier 2): the cascade must reach
    // YouTube directly so the IFrame ENDED auto-advance path is used.
    // Not set for Bandcamp (Tier 3) — we want to land on Bandcamp.
    const skipBandcamp = preferredService === "youtube";
    tryAltDriverRef.current(currentMbid, currentItem, skipApple, skipBandcamp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, preferredService, currentMbid, currentItem, playbackMode, interstitialArmed, altDriverActiveMbid, driverActive]);

  // Subscribe to Spotify driver status updates — mirror source/status state.
  useEffect(() => {
    return spotifyDriver.handle.onStatusChange((s) => {
      const mbid = s.trackId ?? null;
      if (mbid && mbid !== currentMbid) return; // stale
      if (s.state === "loading") {
        // Spotify is taking over — stop every other driver so audio is exclusive.
        youtubeDriver.stop();
        appleMusicDriver.stop();
        localFileDriver.stop();
        bandcampDriver.stop();
        setAltDriverActiveMbid(null);
        sourceRef.current = "spotify";
        setSource("spotify");
        setStatus("loading");
      } else if (s.state === "playing") {
        youtubeDriver.stop();
        appleMusicDriver.stop();
        localFileDriver.stop();
        bandcampDriver.stop();
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
        // YouTube is the last driver in the cascade. An asynchronous failure
        // (driver emits "unavailable" or "error" AFTER play() resolved) also
        // exhausts all options — resume the broadcast on live rides.
        setAltDriversAllFailed(true);
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
        // Mark Apple Music as authorized once playback succeeds — clears the
        // "connect" CTA in the options panel for the rest of the session.
        setAppleMusicConnected(true);
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
        // Apple Music failed — cascade to Bandcamp then YouTube.
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

  // Subscribe to local file driver status changes.
  useEffect(() => {
    return localFileDriver.onStatusChange((s) => {
      const mbid = s.trackId ?? null;
      if (mbid && mbid !== currentMbid) return;
      if (s.durationMs !== undefined) setDurationMs(s.durationMs ?? null);
      if (s.progressMs !== undefined && sourceRef.current === "local-file") {
        setProgressMs(s.progressMs ?? null);
      }
      if (s.state === "loading") {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        sourceRef.current = "local-file";
        setSource("local-file");
        setStatus("loading");
      } else if (s.state === "playing") {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        sourceRef.current = "local-file";
        setSource("local-file");
        setStatus("playing");
      } else if (s.state === "paused") {
        setStatus("paused");
      } else if (s.state === "ended") {
        setAltDriverActiveMbid(null);
        sourceRef.current = null;
        setSource(null);
        if (!isLiveSvcRide) {
          setIndex((i) => {
            if (i + 1 < queueLenRef.current) return i + 1;
            setStatus("ended");
            return i;
          });
        }
      } else if (s.state === "unavailable" || s.state === "error") {
        if (mbid) altDriverFailedRef.current.add(`lf:${mbid}`);
        setAltDriverActiveMbid(null);
        if (sourceRef.current === "local-file") { sourceRef.current = null; setSource(null); }
        if (currentItem && mbid) {
          tryAltDriverRef.current(mbid, currentItem, false);
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFileDriver, currentMbid, currentItem, isLiveSvcRide, pauseRadio]);

  // Subscribe to Bandcamp driver status changes.
  useEffect(() => {
    return bandcampDriver.onStatusChange((s) => {
      const mbid = s.trackId ?? null;
      if (mbid && mbid !== currentMbid) return;
      if (s.state === "loading") {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        sourceRef.current = "bandcamp";
        setSource("bandcamp");
        setStatus("loading");
      } else if (s.state === "playing") {
        pauseRadio?.();
        setAltDriverActiveMbid(mbid);
        sourceRef.current = "bandcamp";
        setSource("bandcamp");
        setStatus("playing");
      } else if (s.state === "paused") {
        setStatus("paused");
      } else if (s.state === "ended") {
        setAltDriverActiveMbid(null);
        sourceRef.current = null;
        setSource(null);
        if (!isLiveSvcRide) {
          setIndex((i) => {
            if (i + 1 < queueLenRef.current) return i + 1;
            setStatus("ended");
            return i;
          });
        }
      } else if (s.state === "unavailable" || s.state === "error") {
        if (mbid) altDriverFailedRef.current.add(`bc:${mbid}`);
        setAltDriverActiveMbid(null);
        if (sourceRef.current === "bandcamp") { sourceRef.current = null; setSource(null); }
        if (currentItem && mbid) {
          tryAltDriverRef.current(mbid, currentItem, true);
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandcampDriver, currentMbid, currentItem, isLiveSvcRide, pauseRadio]);

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
    // Gate on either Spotify having failed (fallbackUsed) OR all alt drivers
    // having been exhausted (altDriversAllFailed). This covers the
    // preferredService path where Spotify is never attempted.
    if (!effectiveFallbackUsed) return;
    // All drivers failed for this live track → resume the broadcast.
    resumeLiveRadio?.();
  }, [
    active,
    playbackMode,
    timeOrientation,
    driverActive,
    currentMbid,
    effectiveFallbackUsed,
    resumeLiveRadio,
    altDriverActiveMbid,
  ]);

  // Drive playback of the current item: resolve its preview, then play it.
  useEffect(() => {
    if (!active) return undefined;
    // Interstitial gate: hold off past-audio start until the live→past
    // interstitial clears (the Lore tone plays + device check resolves).
    if (interstitialArmed) {
      setStatus("loading");
      return undefined;
    }
    if (driverActive) return undefined; // a service driver carries this track
    // Tier 1 past mode: the bulk queue-run owns the entire run — no per-track
    // preview fetch or audio element use; Spotify advances autonomously.
    if (pastModeTier === 1 && mode === "replay" && timeOrientation === "past") {
      return undefined;
    }
    // For live fallback, the broadcast carries the audio — no preview needed.
    // Guard on effectiveFallbackUsed so the preferredService path (where
    // Spotify is never attempted) also skips preview after all drivers fail.
    if (
      playbackMode === "resolve_to_service" &&
      timeOrientation === "live" &&
      currentMbid &&
      effectiveFallbackUsed
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

    // Resolved but no preview available.
    if (currentPreview === null) {
      // Past-mode replay with a service tier: do NOT silently skip to the next
      // track. Instead stop and surface an explicit failure state so the listener
      // knows why playback halted. No silent downgrade to a lower tier mid-run.
      if (
        timeOrientation === "past" &&
        mode === "replay" &&
        playbackMode === "resolve_to_service" &&
        effectiveFallbackUsed
      ) {
        setPastRunFailed(true);
        const failedItem = queue.find((q) => q.mbid === targetMbid);
        setPastRunFailure(
          failedItem
            ? {
                mbid: failedItem.mbid,
                title: failedItem.title,
                artist: failedItem.artist,
                service: serviceDisplayLabel(preferredService),
              }
            : null,
        );
        setStatus("error");
        return undefined;
      }
      // For all other modes: auto-advance so the ride keeps flowing.
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
    interstitialArmed,
    index,
    currentMbid,
    currentPreview,
    currentNeedsLinks,
    hasNextHop,
    driverActive,
    playbackMode,
    timeOrientation,
    mode,
    effectiveFallbackUsed,
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

  // ---------------------------------------------------------------------------
  // Past-mode Tier 1: link prefetch — resolve all queue items' links before the
  // uris-array queue call fires.  Seeds arrive with links:[] from startReplay;
  // this effect calls getRecording for each empty-links item, patches the queue
  // by MBID, and sets tier1LinkBatchDone once all fetches complete.  The queue-
  // run effect below gates on tier1LinkBatchDone so it never fires with stale
  // empty-link items and never silently drops tracks from the URI array.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!active || pastModeTier !== 1 || mode !== "replay" || timeOrientation !== "past") return;
    if (tier1RunQueuedRef.current) return; // queue-run already fired; skip re-prefetch

    const token = rideRef.current;
    const slice = queue.slice(index);

    // Items already with links — or already in-flight — are "not pending".
    const pending = slice.filter(
      (item) =>
        item.links.length === 0 &&
        !tier1FetchingRef.current.has(item.mbid) &&
        !tier1FetchedRef.current.has(item.mbid),
    );

    if (pending.length === 0) {
      // All items already have links (or nothing is left to fetch).
      // If nothing is also in-flight, the batch is complete.
      if (tier1FetchingRef.current.size === 0) {
        setTier1LinkBatchDone(true);
      }
      // else: in-flight fetches are running — their .finally() handlers will
      // call setTier1LinkBatchDone(true) once the last one completes.
      return;
    }

    for (const item of pending) {
      const targetMbid = item.mbid;
      tier1FetchingRef.current.add(targetMbid);

      void getRecording(targetMbid)
        .catch(() => null)
        .then((node) => {
          if (token !== rideRef.current) return;
          setQueue((q) =>
            q.map((qi) =>
              qi.mbid === targetMbid
                ? { ...qi, links: qi.links.length ? qi.links : (node?.links ?? []) }
                : qi,
            ),
          );
        })
        .finally(() => {
          // Stale-request guard FIRST: if the ride was replaced while this
          // fetch was in flight, the per-ride sets now belong to the NEW ride
          // and must not be mutated by this settled request — otherwise a
          // replacement ride reusing the same MBID would see it as "already
          // fetched", skip the lookup, and hard-stop with a missing URI.
          if (token !== rideRef.current) return;
          tier1FetchingRef.current.delete(targetMbid);
          tier1FetchedRef.current.add(targetMbid);
          // Set batch done once the last in-flight fetch completes.
          if (tier1FetchingRef.current.size === 0) {
            setTier1LinkBatchDone(true);
          }
        });
    }
  }, [active, pastModeTier, mode, timeOrientation, queue, index]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Past-mode Tier 1: queue the entire run in one Spotify uris-array call.
  //
  // Gates on `tier1LinkBatchDone` — all queue items must have been through the
  // getRecording link-prefetch before this fires, preventing silent drops.
  //
  // Hard-stops if any item is still missing a Spotify URI after prefetch: no
  // silent filtering, no shorter-than-expected runs.
  //
  // Fires once per ride (tier1RunQueuedRef one-shot). The Spotify driver still
  // polls track progress — the bulk queue call front-loads all URIs so Spotify
  // advances gaplessly without per-track commands from Lore.
  // ---------------------------------------------------------------------------
  const currentItemForTier1 = queue[index];
  useEffect(() => {
    if (!active) return;
    if (mode !== "replay") return;
    if (timeOrientation !== "past") return;
    if (pastModeTier !== 1) return;
    if (playbackMode !== "resolve_to_service") return;
    if (tier1RunQueuedRef.current) return; // already queued for this ride
    // Interstitial gate: while the live→past crossing tone is playing (or the
    // device-mismatch confirmation is pending) no audio command may fire —
    // including the Tier-1 bulk queue-run, which starts playback immediately.
    if (interstitialArmed) return;
    if (!spotify.connected || !spotify.premium) return;
    // Gate: all link-prefetch fetches must have completed.
    if (!tier1LinkBatchDone) return;

    // Collect Spotify URIs from all queue items at or after the current index.
    // Hard-stop if ANY item is missing a URI — no silent filtering.
    const slice = queue.slice(index);
    const uris: string[] = [];
    for (const item of slice) {
      const uri = extractSpotifyDeepLink(item.links);
      if (!uri) {
        // A queue item has no Spotify URI even after link prefetch — hard stop.
        tier1RunQueuedRef.current = true; // prevent re-fire
        setPastRunFailed(true);
        setPastRunFailure({
          mbid: item.mbid,
          title: item.title,
          artist: item.artist,
          service: "Spotify",
        });
        setStatus("error");
        return;
      }
      uris.push(uri);
    }
    if (uris.length === 0) return;

    tier1RunQueuedRef.current = true;
    void spotifyQueueRun({
      uris,
      deviceId: spotify.pinnedDevice?.id ?? null,
    }).catch(() => {
      // Queue call failed — keep tier1RunQueuedRef.current = true so this effect
      // cannot re-fire and the per-track driver cannot silently resume.
      // Surface a hard stop: no silent downgrade to a lower tier.
      setPastRunFailed(true);
      const cur = queue[index];
      setPastRunFailure(
        cur
          ? {
              mbid: cur.mbid,
              title: cur.title,
              artist: cur.artist,
              service: "Spotify",
            }
          : null,
      );
      setStatus("error");
    });
  }, [
    active,
    mode,
    timeOrientation,
    pastModeTier,
    playbackMode,
    interstitialArmed,
    queue,
    index,
    spotify.connected,
    spotify.premium,
    spotify.pinnedDevice,
    tier1LinkBatchDone,
    // intentionally omit currentItemForTier1 — links are part of queue
  ]);

  // ---------------------------------------------------------------------------
  // Past-mode Tier 1: index synchronisation with Spotify's autonomous
  // playlist advancement.
  //
  // The bulk queue-run hands control to Spotify — Spotify advances tracks
  // without any per-track command from Lore.  This effect polls the Spotify
  // player state every 3 seconds, maps the currently-playing URI back to the
  // matching queue item, and calls setIndex() so the ride bar and cue-sheet
  // affordances stay in sync with what Spotify is actually playing.
  //
  // Runs whenever Tier 1 is active and the queue-run ref is set.  Uses a
  // functional setIndex update to avoid capturing a stale index closure while
  // still detecting advances (including mid-run joins).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!active) return undefined;
    if (mode !== "replay" || timeOrientation !== "past" || pastModeTier !== 1) return undefined;
    if (pastRunFailed) return undefined;

    const rideToken = rideRef.current;
    const id = setInterval(() => {
      // Wait until the queue-run has been dispatched before polling.
      if (!tier1RunQueuedRef.current) return;
      if (rideToken !== rideRef.current) return; // stale ride

      void getSpotifyPlayer()
        .then((st) => {
          if (rideToken !== rideRef.current) return;
          if (!st?.trackUri || !st.isPlaying) return;

          const playingUri = st.trackUri;
          setIndex((currentIdx) => {
            // Find the queue item whose Spotify URI matches what is playing.
            const matchIdx = queue.findIndex(
              (item) => extractSpotifyDeepLink(item.links) === playingUri,
            );
            // Only advance — never step backward — unless Spotify jumped ahead.
            if (matchIdx !== -1 && matchIdx !== currentIdx) return matchIdx;
            return currentIdx;
          });
        })
        .catch(() => {
          // Transient poll failure — keep riding; next tick retries.
        });
    }, 3000);

    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode, timeOrientation, pastModeTier, pastRunFailed, queue]);

  // ---------------------------------------------------------------------------
  // Past-mode Tier 2/3: independent current-item link hydration.
  //
  // Seeds arrive with links:[] from startReplay.  The preview-resolution play
  // effect calls getRecording() for the current item, but only when it also
  // fetches a preview URL — if previewUrl gets resolved through another path
  // (e.g. adaptive look-ahead when the listener advanced from the previous
  // track), getRecording() is never called and links stay [].  The
  // tierRefinedEffect gates on currentItem.links.length > 0, so it would
  // stall indefinitely.
  //
  // This effect independently hydrates the current item's links for Tier 2/3
  // regardless of preview resolution.  It is idempotent (tier23LinkFetchingRef
  // deduplicates) and fires whenever the current item has no links.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!active || mode !== "replay" || timeOrientation !== "past") return;
    if (pastModeTier !== 2 && pastModeTier !== 3) return;
    if (!currentMbid) return;
    if (currentItem && currentItem.links.length > 0) return; // already hydrated
    if (tier23LinkFetchingRef.current.has(currentMbid)) return; // in flight

    const token = rideRef.current;
    const targetMbid = currentMbid;
    tier23LinkFetchingRef.current.add(targetMbid);

    void getRecording(targetMbid)
      .catch(() => null)
      .then((node) => {
        if (token !== rideRef.current) return;
        setQueue((q) =>
          q.map((qi) =>
            qi.mbid === targetMbid
              ? { ...qi, links: qi.links.length ? qi.links : (node?.links ?? []) }
              : qi,
          ),
        );
      })
      .finally(() => {
        tier23LinkFetchingRef.current.delete(targetMbid);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode, timeOrientation, pastModeTier, currentMbid, currentItem?.links.length]);

  // ---------------------------------------------------------------------------
  // Past-mode Tier 2/3: deferred embed-driver activation.
  //
  // Seeds arrive with links:[] from startReplay (resolved lazily by the play
  // effect OR by the independent hydration effect above).  Calling
  // setPreferredService at startReplay time would lock in a service before we
  // know whether its embedUrlBuilder can actually produce an embed URL for this
  // run's links.
  //
  // This effect fires once per ride (tierRefinedRef one-shot) when the current
  // item's links resolve:
  //
  //   1. Iterates GUIDED_SERVICE_OPTIONS candidates that have an embedUrlBuilder
  //      AND are in EMBED_DRIVER_SERVICES (real PlayerProvider drivers).
  //   2. Tests each candidate's embedUrlBuilder against every resolved link.
  //   3. Picks the first candidate that produces a non-null embed URL, honouring
  //      lastUsedService preference.
  //   4. If no driver can handle the run → falls to Tier 4 (cue sheet).
  //
  // This makes Tier 3 (Bandcamp) reachable for runs that only have Bandcamp
  // links, and makes the non-driver fallback honest (Tier 4) rather than silent.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!active || mode !== "replay" || timeOrientation !== "past") return;
    if (pastModeTier !== 2 && pastModeTier !== 3) return;
    if (tierRefinedRef.current) return; // already activated for this ride
    if (!currentItem || currentItem.links.length === 0) return; // wait for links

    tierRefinedRef.current = true;

    const EMBED_DRIVER_SERVICES = new Set<string>(["youtube", "bandcamp"]);
    const lastUsed = readLastUsedService();

    // Sort options so the listener's last-used service is tried first.
    const sortedOptions = [...GUIDED_SERVICE_OPTIONS].sort((a, b) => {
      if (a.service === lastUsed) return -1;
      if (b.service === lastUsed) return 1;
      return 0;
    });

    // Find the first service option that: has a real driver AND whose
    // embedUrlBuilder returns non-null for at least one link in this run.
    const embedOpt = sortedOptions.find((o) => {
      if (!EMBED_DRIVER_SERVICES.has(o.service)) return false;
      const builder = o.embedUrlBuilder;
      if (!builder) return false;
      return currentItem.links.some((link) => builder(link.url) !== null);
    });

    if (embedOpt) {
      // Wire the driver and correct the tier if needed (e.g. manifest said Tier
      // 2 but the only matching service is Tier 3 Bandcamp).
      setPreferredService(embedOpt.service as "youtube" | "bandcamp");
      const refinedTier = embedOpt.embedAutoAdvance ? 2 : 3;
      if (refinedTier !== pastModeTier) setPastModeTier(refinedTier);
    } else {
      // No embed driver can handle this run's links → honest Tier 4 cue sheet.
      setPastModeTier(4);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode, timeOrientation, pastModeTier, currentItem]);

  // ---------------------------------------------------------------------------
  // Past-mode Tier 4: timed cue sheet "Next: {artist} — {title}" affordance.
  //
  // Appears after spinDurationSeconds for the current track.  When
  // spinDurationSeconds is null/undefined (42.3% of spins), appears immediately
  // and persistently — this is a common case, not an edge case.
  // Reset on every track change (currentMbid).
  // ---------------------------------------------------------------------------
  const currentItemSpinDur = queue[index]?.spinDurationSeconds;
  useEffect(() => {
    // Reset on track change regardless of mode.
    setCueSheetVisible(false);

    if (!active || timeOrientation !== "past" || pastModeTier !== 4) return;
    const spinDur = currentItemSpinDur;
    if (spinDur == null) {
      // Null/absent duration → show immediately and persistently.
      setCueSheetVisible(true);
      return;
    }
    const id = window.setTimeout(() => setCueSheetVisible(true), spinDur * 1000);
    return () => window.clearTimeout(id);
    // currentMbid (from queue[index].mbid) drives the reset; spinDur is a
    // derived property of the same item so including currentItemSpinDur is
    // sufficient — no need to also depend on index directly here.
  }, [active, timeOrientation, pastModeTier, queue[index]?.mbid, currentItemSpinDur]); // eslint-disable-line react-hooks/exhaustive-deps

  // Buffer-outrun: the scrub head has advanced to an item whose preview URL
  // has not yet been resolved.  The UI must show "Finding this on [Service]…"
  // rather than silence so the listener knows we are working on it.
  // True only when no service driver is already carrying the track (which
  // would mean the service is handling playback independently).
  const bufferOutrun =
    active &&
    !driverActive &&
    currentMbid != null &&
    currentPreview === undefined;

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
        fallbackUsed: effectiveFallbackUsed,
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
        sourceLabel,
        openConnectionCentre,
        spotifyDeepLink,
        bandcampAlbumUrl,
        appleMusicConfigured,
        appleMusicConnected,
        preferredService,
        setPreferredService,
        interstitialArmed,
        dismissInterstitial,
        deviceMismatch,
        dismissDeviceMismatch,
        bufferOutrun,
        pastModeTier,
        pastModeTierAnnouncement:
          pastModeTier !== null
            ? tierAnnouncementText(pastModeTier, pastModeTierLabel ?? undefined)
            : null,
        cueSheetVisible,
        cueSheetNext:
          pastModeTier === 4 && index + 1 < queue.length
            ? { artist: queue[index + 1]!.artist, title: queue[index + 1]!.title }
            : null,
        pastRunFailed,
        pastRunFailure,
        retryPastRun,
        continuePastRunWithCueSheet,
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
      effectiveFallbackUsed,
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
      sourceLabel,
      openConnectionCentre,
      spotifyDeepLink,
      bandcampAlbumUrl,
      appleMusicConfigured,
      appleMusicConnected,
      preferredService,
      setPreferredService,
      interstitialArmed,
      dismissInterstitial,
      deviceMismatch,
      dismissDeviceMismatch,
      bufferOutrun,
      pastModeTier,
      pastModeTierLabel,
      cueSheetVisible,
      pastRunFailed,
      pastRunFailure,
      retryPastRun,
      continuePastRunWithCueSheet,
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
      {/* Bandcamp embed iframe — portal-mounted when a Bandcamp track is active. */}
      {bandcampDriver.surface}
      {/* Connection Centre — modal/drawer with service cards. */}
      <ConnectionCentre
        open={connectionCentreOpen}
        onClose={closeConnectionCentre}
        spotify={spotify}
        appleMusicConfigured={appleMusicConfigured}
        appleMusicConnected={appleMusicConnected}
        onConnectAppleMusic={() => {
          // Called after ConnectionCentre successfully calls MusicKit.authorize().
          // Mark Apple Music as connected so the card flips to "Connected ✓"
          // immediately without waiting for a full play cycle.
          setAppleMusicConnected(true);
          closeConnectionCentre();
        }}
        localFiles={localFileDriver}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within a PlayerProvider");
  return ctx;
}
