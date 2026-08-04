/**
 * Spotify playback driver — wraps the Spotify Connect remote-control path
 * and exposes it through the `PlaybackDriverHandle` interface.
 *
 * This is a pure extraction of the Spotify-specific refs, effects, and polling
 * logic that previously lived inline in `PlayerProvider.tsx`.  No behaviour
 * change for existing Spotify users — the same play/poll/device-check logic
 * runs; it is just organised behind the standard driver interface.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  spotifyPlay,
  spotifyPause,
  spotifyResume,
  getSpotifyPlayer,
} from "@workspace/api-client-react";
import type { SpotifyConnectApi, SpotifyDevice } from "./useSpotifyConnect";
import type { PlaybackDriverHandle, DriverPlaybackStatus } from "./playbackDriver";
import type { RideItem } from "./PlayerProvider";
import {
  processDeviceConfirmation,
  type PlaybackMode,
  type TimeOrientation,
} from "./playbackSession";

// ---------------------------------------------------------------------------
// Public extras returned alongside the handle (Spotify-specific UI needs)
// ---------------------------------------------------------------------------

export interface SpotifyDriverExtras {
  /** True when the current track fell back to broadcast/preview. */
  fallbackUsed: boolean;
  /** True when the fallback was caused by a lost device (not a missing track). */
  deviceLost: boolean;
  /**
   * True when Spotify is actively responsible for the current track.
   * PlayerProvider uses this to suppress the preview-audio path while Spotify
   * is carrying the audio.
   */
  spotifyModeForCurrent: boolean;
  /** Clear per-track failure state and retry the current track on Spotify. */
  retryCurrentTrack: () => void;
}

// ---------------------------------------------------------------------------
// Hook inputs
// ---------------------------------------------------------------------------

export interface SpotifyDriverOpts {
  active: boolean;
  playbackMode: PlaybackMode;
  timeOrientation: TimeOrientation;
  currentItem: RideItem | null;
  /** True when live+service-ride: station now-playing drives advances, not Spotify end. */
  isLiveSvcRide: boolean;
  queueLenRef: MutableRefObject<number>;
  rideRef: MutableRefObject<number>;
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  pauseRadio?: () => void;
  spotify: SpotifyConnectApi;
  /**
   * Explicit service the listener selected from the options panel.
   * When set to "youtube" or "apple-music", the Spotify driver is skipped so
   * the chosen alt driver takes over immediately.  Spotify Connect itself is
   * intentionally excluded from the user-facing options panel.
   */
  preferredService?: "youtube" | "apple-music" | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSpotifyDriver(opts: SpotifyDriverOpts): {
  handle: PlaybackDriverHandle;
} & SpotifyDriverExtras {
  const {
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
  } = opts;

  const currentMbid = currentItem?.mbid ?? null;

  // ---- Spotify-specific refs -----------------------------------------------

  // What the ride last commanded Spotify to play.
  const spotifyNowRef = useRef<{
    mbid: string;
    uri: string;
    sawPlaying: boolean;
    endedPolls: number;
    noDevicePolls: number;
  } | null>(null);

  // MBIDs where a device-lost fallback was triggered.
  const spotifyDeviceLostRef = useRef<Set<string>>(new Set());

  // MBID currently being commanded (prevents double-play).
  const spotifyCommandingRef = useRef<string | null>(null);

  // Tracks that failed on Spotify this ride.
  const spotifyFailedRef = useRef<Set<string>>(new Set());

  // Pause commanded by us / observed from the Spotify app.
  const spotifyPausedRef = useRef(false);

  // Bumped when a track falls back so derived values recompute.
  const [spotifyFallbackTick, setSpotifyFallbackTick] = useState(0);

  // Stable refs for pinned-device access inside interval callbacks.
  const pinnedDeviceIdRef = useRef<string | null>(null);
  pinnedDeviceIdRef.current = spotify.pinnedDevice?.id ?? null;

  const unpinDeviceRef = useRef(spotify.unpinDevice);
  unpinDeviceRef.current = spotify.unpinDevice;

  const showNoticeRef = useRef(spotify.showNotice);
  showNoticeRef.current = spotify.showNotice;

  const fetchDevicesRef = useRef(spotify.fetchDevices);
  fetchDevicesRef.current = spotify.fetchDevices;

  const spotifyEligible = spotify.connected && spotify.premium;
  const refreshSpotify = spotify.refresh;
  const { preferredService } = opts;

  // ---- Status-change subscribers -------------------------------------------

  const subscribersRef = useRef<Set<(s: DriverPlaybackStatus) => void>>(new Set());

  const notify = useCallback((status: DriverPlaybackStatus) => {
    subscribersRef.current.forEach((cb) => cb(status));
  }, []);

  // ---- Derived visibility flags --------------------------------------------

  const spotifyModeForCurrent =
    active &&
    playbackMode === "resolve_to_service" &&
    spotifyEligible &&
    !!currentMbid &&
    // Skip when the listener explicitly selected an alt service from the
    // options panel — Spotify Connect is developer-only, not user-facing.
    !preferredService &&
    spotifyFallbackTick >= 0 &&
    !spotifyFailedRef.current.has(currentMbid);

  const fallbackUsed =
    playbackMode === "resolve_to_service" &&
    !!currentMbid &&
    spotifyFailedRef.current.has(currentMbid);

  const deviceLost =
    playbackMode === "resolve_to_service" &&
    !!currentMbid &&
    spotifyDeviceLostRef.current.has(currentMbid);

  // ---- Effect: command Spotify to play the current track -------------------

  useEffect(() => {
    if (!spotifyModeForCurrent || !currentMbid) return;
    if (spotifyNowRef.current?.mbid === currentMbid) return;
    if (spotifyCommandingRef.current === currentMbid) return;

    const token = rideRef.current;
    const targetMbid = currentMbid;
    spotifyCommandingRef.current = targetMbid;
    spotifyPausedRef.current = false;

    notify({ state: "loading", trackId: targetMbid });

    // Silence preview audio and live broadcast while Spotify takes over.
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
    pauseRadio?.();

    void spotifyPlay({
      mbid: targetMbid,
      deviceId: pinnedDeviceIdRef.current ?? undefined,
    })
      .then((res) => {
        if (token !== rideRef.current) return;
        spotifyNowRef.current = {
          mbid: targetMbid,
          uri: res.trackUri,
          sawPlaying: false,
          endedPolls: 0,
          noDevicePolls: 0,
        };
        notify({ state: "playing", trackId: targetMbid });
      })
      .catch((err: unknown) => {
        if (token !== rideRef.current) return;
        spotifyFailedRef.current.add(targetMbid);
        spotifyNowRef.current = null;
        setSpotifyFallbackTick((t) => t + 1);
        const httpStatus = (err as { status?: number }).status;
        if (httpStatus === 401 || httpStatus === 403) {
          refreshSpotify();
        }
        // Signal PlayerProvider to try the next driver.
        notify({ state: "unavailable", trackId: targetMbid });
      })
      .finally(() => {
        if (spotifyCommandingRef.current === targetMbid) {
          spotifyCommandingRef.current = null;
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotifyModeForCurrent, currentMbid, notify, refreshSpotify, pauseRadio]);

  // ---- Effect: poll Spotify player state -----------------------------------

  useEffect(() => {
    if (!spotifyModeForCurrent || !currentMbid) return undefined;
    const token = rideRef.current;
    const id = setInterval(() => {
      const now = spotifyNowRef.current;
      if (!now || now.mbid !== currentMbid) return;

      void getSpotifyPlayer()
        .then((st) => {
          if (token !== rideRef.current) return;
          const cur = spotifyNowRef.current;
          if (!cur || cur.mbid !== currentMbid) return;
          const ours = st.trackUri === cur.uri;

          const confirmation = processDeviceConfirmation(cur, {
            ours,
            isPlaying: st.isPlaying,
          });

          if (confirmation.type === "confirmed") {
            cur.sawPlaying = true;
            cur.endedPolls = 0;
            spotifyPausedRef.current = false;
            notify({ state: "playing", progressMs: st.progressMs, trackId: currentMbid });
            return;
          }
          if (confirmation.type === "device-lost") {
            spotifyFailedRef.current.add(currentMbid);
            spotifyDeviceLostRef.current.add(currentMbid);
            spotifyNowRef.current = null;
            setSpotifyFallbackTick((t) => t + 1);
            unpinDeviceRef.current();
            notify({ state: "device-lost", trackId: currentMbid });
            return;
          }
          if (confirmation.type === "wait") {
            cur.noDevicePolls = confirmation.noDevicePolls;
            return;
          }
          // confirmation.type === "already-confirmed": fall through.

          if (!ours && st.active && st.isPlaying) {
            spotifyNowRef.current = null;
            spotifyPausedRef.current = false;
            if (pinnedDeviceIdRef.current) {
              // Pinned device: listener skipped in Spotify — advance the queue.
              notify({ state: "ended", trackId: currentMbid });
            } else {
              // Unpinned: listener took the wheel manually — end the ride
              // without fighting their device or advancing the queue.
              notify({ state: "ride-ended", trackId: currentMbid });
            }
            return;
          }

          if (
            ours &&
            !st.isPlaying &&
            (spotifyPausedRef.current || (st.progressMs ?? 0) > 0)
          ) {
            cur.endedPolls = 0;
            spotifyPausedRef.current = true;
            notify({ state: "paused", progressMs: st.progressMs, trackId: currentMbid });
            return;
          }

          // For live+service-ride the now-playing poll drives advances — skip.
          if (isLiveSvcRide) return;

          // Require two consecutive "looks like ended" polls before advancing.
          cur.endedPolls += 1;
          if (cur.endedPolls < 2) return;
          spotifyNowRef.current = null;
          spotifyPausedRef.current = false;
          notify({ state: "ended", trackId: currentMbid });
        })
        .catch(() => {
          // Transient poll failure — keep riding; next tick retries.
        });
    }, 3000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotifyModeForCurrent, currentMbid, isLiveSvcRide, notify]);

  // ---- Effect: periodic device availability check -------------------------

  const hasPinnedDevice = !!spotify.pinnedDevice;
  useEffect(() => {
    if (!active) return undefined;
    if (playbackMode !== "resolve_to_service") return undefined;
    if (!hasPinnedDevice) return undefined;

    const id = setInterval(() => {
      if (spotifyCommandingRef.current !== null) return;
      const pinnedId = pinnedDeviceIdRef.current;
      if (!pinnedId) return;

      void fetchDevicesRef.current()
        .then((devices) => {
          if (spotifyCommandingRef.current !== null) return;
          if (pinnedDeviceIdRef.current !== pinnedId) return;
          const stillPresent = devices.some((d: SpotifyDevice) => d.id === pinnedId);
          if (!stillPresent) {
            unpinDeviceRef.current();
            showNoticeRef.current("Device no longer reachable");
          }
        })
        .catch(() => {});
    }, 60_000);

    return () => clearInterval(id);
  }, [active, playbackMode, hasPinnedDevice]);

  // ---- Retry handler -------------------------------------------------------

  const retryCurrentTrack = useCallback(() => {
    if (!currentMbid) return;
    spotifyFailedRef.current.delete(currentMbid);
    spotifyDeviceLostRef.current.delete(currentMbid);
    spotifyCommandingRef.current = null;
    spotifyNowRef.current = null;
    setSpotifyFallbackTick((t) => t + 1);
  }, [currentMbid]);

  // ---- Handle --------------------------------------------------------------

  const handle = useMemo<PlaybackDriverHandle>(
    () => ({
      id: "spotify" as const,
      available: spotifyEligible,
      surface: undefined as ReactNode,

      /**
       * play() for Spotify is intentionally lightweight: the reactive effect
       * above is the real trigger (it watches `spotifyModeForCurrent`).  This
       * method exists for interface conformance and to support explicit retries
       * from PlayerProvider when switching drivers.
       */
      play: async (_item: RideItem) => {
        if (!spotifyEligible) {
          throw new Error("Spotify driver not available");
        }
        // The effect handles the actual play command.  If the track already
        // failed, throw so PlayerProvider can try the next driver.
        if (_item.mbid && spotifyFailedRef.current.has(_item.mbid)) {
          throw new Error("Track unavailable on Spotify");
        }
        // Otherwise the effect will pick it up on the next render cycle.
      },

      pause: async () => {
        if (spotifyPausedRef.current) return;
        await spotifyPause();
        spotifyPausedRef.current = true;
        notify({ state: "paused", trackId: currentMbid });
      },

      resume: async () => {
        if (!spotifyPausedRef.current) return;
        await spotifyResume();
        spotifyPausedRef.current = false;
        notify({ state: "playing", trackId: currentMbid });
      },

      stop: () => {
        // Silence Spotify if it was playing.
        if (spotifyNowRef.current) {
          void spotifyPause().catch(() => {});
        }
        spotifyNowRef.current = null;
        spotifyCommandingRef.current = null;
        spotifyPausedRef.current = false;
        spotifyFailedRef.current.clear();
        spotifyDeviceLostRef.current.clear();
      },

      onStatusChange: (cb) => {
        subscribersRef.current.add(cb);
        return () => subscribersRef.current.delete(cb);
      },
    }),
    // Re-create only when the eligibility flag changes (stable for the life of
    // the session once Spotify is connected).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spotifyEligible, notify, currentMbid],
  );

  return { handle, fallbackUsed, deviceLost, spotifyModeForCurrent, retryCurrentTrack };
}
