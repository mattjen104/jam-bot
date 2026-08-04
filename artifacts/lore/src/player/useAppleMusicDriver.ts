/**
 * Apple Music playback driver.
 *
 * Wraps MusicKit JS and exposes it through the `PlaybackDriverHandle`
 * interface.  Requires a subscriber with an active Apple Music subscription
 * and a developer token (passed as `developerToken`).
 *
 * `available` is false when MusicKit is not configured, when the developer
 * token is absent, or when the user has not yet authorized.  Skips gracefully
 * when unavailable — the fallback ladder moves to the next driver.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  loadMusicKit,
  musicKitEvent,
  describeMusicKitError,
  type MusicKitInstance,
} from "../lib/appleMusicReplay";
import type { PlaybackDriverHandle, DriverPlaybackStatus } from "./playbackDriver";
import type { RideItem } from "./PlayerProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APPLE_MUSIC_HOST_RE = /^music\.apple\.com$/i;
const APPLE_MUSIC_NAME_RE = /^(apple_music|applemusic|apple music|appleMusic)$/i;

/** Extract the Apple Music song/track ID from a music.apple.com URL or links. */
function findAppleMusicId(item: RideItem): string | null {
  for (const link of item.links) {
    if (!APPLE_MUSIC_NAME_RE.test(link.name)) continue;
    // The song ID is in the `i` query parameter of the track URL.
    try {
      const parsed = new URL(link.url);
      if (APPLE_MUSIC_HOST_RE.test(parsed.hostname)) {
        const songId = parsed.searchParams.get("i");
        if (songId) return songId;
        // Some URLs use the last path segment as the ID.
        const parts = parsed.pathname.split("/").filter(Boolean);
        const last = parts[parts.length - 1];
        if (last && /^\d+$/.test(last)) return last;
      }
    } catch {
      // malformed URL — skip
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook inputs
// ---------------------------------------------------------------------------

export interface AppleMusicDriverOpts {
  /**
   * Apple Music developer token.  When null/undefined the driver is
   * unavailable and never attempts to load MusicKit.
   */
  developerToken?: string | null;
  /** App name shown in the MusicKit authorization dialog. */
  appName?: string;
  /** Apple Music storefront (e.g. "us"). */
  storefront?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAppleMusicDriver(opts: AppleMusicDriverOpts = {}): PlaybackDriverHandle {
  const { developerToken, appName = "Lore Radio", storefront } = opts;

  const musicRef = useRef<MusicKitInstance | null>(null);
  const listenersRef = useRef<Array<[string, (event: unknown) => void]>>([]);
  const currentTrackIdRef = useRef<string | null>(null);
  // Apple Music song ID for the currently queued track — needed to re-queue
  // after a silent re-authorization when the token expires mid-session.
  const currentAppleMusicIdRef = useRef<string | null>(null);
  const subscribersRef = useRef<Set<(s: DriverPlaybackStatus) => void>>(new Set());
  const pausedRef = useRef(false);
  const playingRef = useRef(false);

  // Whether the user has already authorized this session (avoid re-prompting).
  const [authorized, setAuthorized] = useState(false);

  const notify = useCallback((status: DriverPlaybackStatus) => {
    subscribersRef.current.forEach((cb) => cb(status));
  }, []);

  // Teardown: remove MusicKit event listeners and clear the instance ref.
  const teardown = useCallback(async () => {
    const music = musicRef.current;
    if (!music) return;
    for (const [event, listener] of listenersRef.current) {
      music.removeEventListener(event, listener);
    }
    listenersRef.current = [];
    try { await music.pause(); } catch { /* best-effort */ }
    musicRef.current = null;
    playingRef.current = false;
    pausedRef.current = false;
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => { void teardown(); }, [teardown]);

  // ---- Handle ------------------------------------------------------------

  const available = Boolean(developerToken);

  return useMemo<PlaybackDriverHandle>(
    () => ({
      id: "apple-music" as const,
      available,
      surface: undefined,

      play: async (item: RideItem) => {
        if (!developerToken) {
          throw new Error("Apple Music developer token not configured");
        }

        const appleMusicId = findAppleMusicId(item);
        if (!appleMusicId) {
          throw new Error("No Apple Music ID for this track");
        }

        // Already playing this track — no-op.
        if (currentTrackIdRef.current === item.mbid && playingRef.current) return;

        notify({ state: "loading", trackId: item.mbid });
        currentTrackIdRef.current = item.mbid;
        currentAppleMusicIdRef.current = appleMusicId;

        // Load MusicKit if needed.
        const global = await loadMusicKit().catch(() => {
          throw new Error("Apple Music could not be loaded");
        });

        global.configure({ developerToken, appName, storefrontId: storefront });
        const music = global.getInstance();
        if (storefront) music.storefrontId = storefront;

        // Teardown any previous instance listeners before (re)starting.
        if (musicRef.current && musicRef.current !== music) {
          await teardown();
        }
        musicRef.current = music;

        // Authorize if not yet done this session.
        if (!authorized) {
          await music.authorize();
          setAuthorized(true);
        }

        await music.setQueue({ songs: [appleMusicId] });

        // Attach playback event listeners.
        if (listenersRef.current.length === 0) {
          const onStateChange = (event: unknown) => {
            const value = event as { state?: string; playbackState?: string } | null;
            const next = String(value?.state ?? value?.playbackState ?? "").toLowerCase();
            const music = musicRef.current;
            const durationMs =
              music && typeof music.currentPlaybackDuration === "number"
                ? Math.round(music.currentPlaybackDuration * 1000)
                : null;
            if (next.includes("paused") || next === "0") {
              pausedRef.current = true;
              playingRef.current = false;
              notify({ state: "paused", durationMs, trackId: currentTrackIdRef.current });
            } else if (next.includes("playing") || next === "1") {
              playingRef.current = true;
              pausedRef.current = false;
              notify({ state: "playing", durationMs, trackId: currentTrackIdRef.current });
            } else if (next.includes("ended") || next.includes("complete") || next === "4") {
              playingRef.current = false;
              notify({ state: "ended", trackId: currentTrackIdRef.current });
            }
          };
          const onError = async (event: unknown) => {
            const detail = event instanceof Error ? event : (event as { detail?: unknown })?.detail;
            const desc = describeMusicKitError(detail ?? event);
            playingRef.current = false;

            // When the token expires mid-session, attempt a silent re-authorize
            // before cascading to the error/fallback path.
            if (desc.kind === "authorization-expired") {
              const music = musicRef.current;
              const replayId = currentAppleMusicIdRef.current;
              if (music && replayId) {
                try {
                  await music.authorize();
                  setAuthorized(true);
                  // Re-queue and resume without interrupting the ride.
                  await music.setQueue({ songs: [replayId] });
                  await music.play();
                  playingRef.current = true;
                  notify({ state: "playing", trackId: currentTrackIdRef.current });
                  return;
                } catch {
                  // Re-auth failed — fall through to the normal error path.
                }
              }
            }

            const isSubscriptionError = desc.kind === "subscription-required";
            notify({
              state: isSubscriptionError ? "unavailable" : "error",
              trackId: currentTrackIdRef.current,
            });
          };

          const events: Array<[string, (e: unknown) => void]> = [
            [musicKitEvent(music, "playbackStateDidChange"), onStateChange],
            [musicKitEvent(music, "playbackError"), onError],
          ];
          for (const [event, listener] of events) {
            music.addEventListener(event, listener);
            listenersRef.current.push([event, listener]);
          }
        }

        pausedRef.current = false;
        await music.play();
        playingRef.current = true;
        notify({ state: "playing", trackId: item.mbid });
      },

      seek: async (positionMs: number) => {
        const music = musicRef.current;
        if (!music?.seekToTime) return;
        await music.seekToTime(positionMs / 1000);
      },

      pause: async () => {
        const music = musicRef.current;
        if (!music || pausedRef.current) return;
        await music.pause();
        pausedRef.current = true;
        playingRef.current = false;
        const durationMs =
          typeof music.currentPlaybackDuration === "number"
            ? Math.round(music.currentPlaybackDuration * 1000)
            : null;
        notify({ state: "paused", durationMs, trackId: currentTrackIdRef.current });
      },

      resume: async () => {
        const music = musicRef.current;
        if (!music || !pausedRef.current) return;
        await music.play();
        pausedRef.current = false;
        playingRef.current = true;
        notify({ state: "playing", trackId: currentTrackIdRef.current });
      },

      stop: () => {
        void teardown();
        currentTrackIdRef.current = null;
      },

      onStatusChange: (cb) => {
        subscribersRef.current.add(cb);
        return () => subscribersRef.current.delete(cb);
      },
    }),
    // Re-create when the token or authorization state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, developerToken, appName, storefront, authorized, notify, teardown],
  );
}
