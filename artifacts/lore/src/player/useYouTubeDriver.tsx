/**
 * YouTube playback driver.
 *
 * Manages a hidden <iframe> loaded with the YouTube IFrame API.  On play(),
 * resolves the YouTube video ID from the item's links, loads the embed URL
 * into the iframe, and subscribes to onStateChange via postMessage.  ENDED
 * (state 0) fires onStatusChange so PlayerProvider can advance the queue.
 *
 * `available` is always true at the driver level — per-track availability is
 * determined at play() time by checking item.links for a YouTube URL.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { PlaybackDriverHandle, DriverPlaybackStatus } from "./playbackDriver";
import type { RideItem } from "./PlayerProvider";

// ---------------------------------------------------------------------------
// YouTube URL helpers (self-contained — no import from guidedReplay)
// ---------------------------------------------------------------------------

const YOUTUBE_HOST_RE = /^(www\.|m\.)?youtube\.com$|^youtu\.be$/i;

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!YOUTUBE_HOST_RE.test(parsed.hostname)) return null;
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

function youtubeEmbedUrl(videoId: string): string {
  const params = new URLSearchParams({
    enablejsapi: "1",
    origin: typeof window !== "undefined" ? window.location.origin : "",
    autoplay: "1",
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

function findYouTubeVideoId(item: RideItem): string | null {
  for (const link of item.links) {
    const id = extractYouTubeVideoId(link.url);
    if (id) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useYouTubeDriver(): PlaybackDriverHandle {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);
  const subscribersRef = useRef<Set<(s: DriverPlaybackStatus) => void>>(new Set());
  const playingRef = useRef(false);
  const pausedRef = useRef(false);

  const notify = useCallback((status: DriverPlaybackStatus) => {
    subscribersRef.current.forEach((cb) => cb(status));
  }, []);

  const durationMsRef = useRef<number | null>(null);

  // ---- Listen for YouTube IFrame API messages ----------------------------

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.youtube.com") return;
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      if (typeof event.data !== "string") return;
      try {
        const payload = JSON.parse(event.data) as {
          event?: string;
          info?: number | {
            playerState?: number;
            currentTime?: number;
            duration?: number;
          };
        };
        if (payload?.event === "onStateChange") {
          // YT.PlayerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
          const state =
            typeof payload.info === "number"
              ? payload.info
              : typeof payload.info === "object"
              ? payload.info?.playerState
              : undefined;

          if (state === 0) {
            // ENDED — PlayerProvider should advance queue.
            playingRef.current = false;
            notify({ state: "ended", trackId: currentTrackIdRef.current });
          } else if (state === 1) {
            playingRef.current = true;
            pausedRef.current = false;
            notify({ state: "playing", trackId: currentTrackIdRef.current });
          } else if (state === 2) {
            pausedRef.current = true;
            notify({ state: "paused", trackId: currentTrackIdRef.current });
          }
        } else if (payload?.event === "infoDelivery") {
          // Periodic position + duration updates from the IFrame API.
          if (typeof payload.info === "object" && payload.info !== null) {
            const { currentTime, duration } = payload.info;
            if (typeof duration === "number" && duration > 0) {
              durationMsRef.current = Math.round(duration * 1000);
            }
            if (typeof currentTime === "number") {
              notify({
                state: playingRef.current ? "playing" : pausedRef.current ? "paused" : "loading",
                progressMs: Math.round(currentTime * 1000),
                durationMs: durationMsRef.current,
                trackId: currentTrackIdRef.current,
              });
            }
          }
        }
      } catch {
        // YouTube also sends non-JSON messages; ignore.
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [notify]);

  // ---- Subscribe to iframe onStateChange after it loads ------------------

  const subscribeToYouTube = useCallback((iframe: HTMLIFrameElement) => {
    iframe.contentWindow?.postMessage(
      JSON.stringify({
        event: "command",
        func: "addEventListener",
        args: ["onStateChange"],
      }),
      "https://www.youtube.com",
    );
  }, []);

  // ---- Stable iframe ref callback ----------------------------------------

  const setIframeRef = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  // ---- Surface (hidden iframe) -------------------------------------------

  const surface = useMemo(
    () => (
      <iframe
        ref={setIframeRef}
        title="YouTube playback (hidden)"
        allow="autoplay; encrypted-media"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onLoad={() => {
          const iframe = iframeRef.current;
          if (iframe && currentVideoIdRef.current) subscribeToYouTube(iframe);
        }}
      />
    ),
    [setIframeRef, subscribeToYouTube],
  );

  // ---- Handle ------------------------------------------------------------

  return useMemo<PlaybackDriverHandle>(
    () => ({
      id: "youtube" as const,
      available: true,
      surface,

      play: async (item: RideItem) => {
        const videoId = findYouTubeVideoId(item);
        if (!videoId) {
          throw new Error("No YouTube link for this track");
        }

        const iframe = iframeRef.current;
        if (!iframe) {
          throw new Error("YouTube iframe not mounted");
        }

        // Already playing this video — no-op.
        if (currentVideoIdRef.current === videoId && playingRef.current) return;

        currentVideoIdRef.current = videoId;
        currentTrackIdRef.current = item.mbid;
        playingRef.current = false;
        pausedRef.current = false;

        const embedUrl = youtubeEmbedUrl(videoId);
        // Setting src triggers an iframe reload; onLoad will re-subscribe.
        iframe.src = embedUrl;

        notify({ state: "loading", trackId: item.mbid });
      },

      seek: async (positionMs: number) => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;
        const seconds = positionMs / 1000;
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }),
          "https://www.youtube.com",
        );
      },

      pause: async () => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
          "https://www.youtube.com",
        );
        pausedRef.current = true;
      },

      resume: async () => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: "command", func: "playVideo", args: [] }),
          "https://www.youtube.com",
        );
        pausedRef.current = false;
      },

      stop: () => {
        const iframe = iframeRef.current;
        if (iframe) {
          iframe.src = "about:blank";
        }
        currentVideoIdRef.current = null;
        currentTrackIdRef.current = null;
        playingRef.current = false;
        pausedRef.current = false;
      },

      onStatusChange: (cb) => {
        subscribersRef.current.add(cb);
        return () => subscribersRef.current.delete(cb);
      },
    }),
    [surface, notify],
  );
}
