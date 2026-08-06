/**
 * Bandcamp embed playback driver.
 *
 * When a recording has a Bandcamp album or track URL available (via the
 * item's links array), this driver mounts a sandboxed Bandcamp embed iframe
 * as a portal.
 *
 * `available` is always `true` at the service level; per-track unavailability
 * (no Bandcamp URL, or the embed fails to start) causes `play()` to throw
 * promptly so PlayerProvider cascades to YouTube.
 *
 * Playback confirmation model (safety-first):
 *   - After mounting the iframe, we wait up to PLAY_CONFIRM_TIMEOUT_MS for a
 *     postMessage event containing "play" from the embed.
 *   - If no confirmation arrives in time, `play()` throws so the cascade
 *     continues to YouTube.  This means Bandcamp only becomes "active" when
 *     it actually starts — never from a speculative timeout.
 *
 * Ended / auto-advance model:
 *   - Bandcamp's postMessage API is not officially documented and ended events
 *     are unreliable.  We therefore do NOT attempt to auto-advance from a
 *     Bandcamp track: the ride stays in "playing" state until the user skips
 *     or the session ends.
 *   - If the user skips (next), PlayerProvider calls stop() which unmounts the
 *     iframe and clears state, then play() is invoked for the next track which
 *     cascades to YouTube (Bandcamp is tried again and throws if unavailable).
 *
 * Security: the iframe is sandboxed; no Bandcamp credentials are stored.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { PlaybackDriverHandle, DriverPlaybackStatus } from "./playbackDriver";
import type { RideItem } from "./PlayerProvider";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Milliseconds to wait for a postMessage "play" confirmation from the
 * Bandcamp embed before giving up and throwing so the cascade continues to
 * YouTube.  5 seconds is generous enough for slow loads on mobile.
 */
const PLAY_CONFIRM_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Bandcamp URL helpers
// ---------------------------------------------------------------------------

const BANDCAMP_HOST_RE = /\.bandcamp\.com$/i;

/** Extract a Bandcamp track/album URL from the item's links. */
function findBandcampUrl(item: RideItem): string | null {
  for (const link of item.links) {
    try {
      const parsed = new URL(link.url);
      if (BANDCAMP_HOST_RE.test(parsed.hostname)) {
        return link.url;
      }
    } catch {
      // skip malformed URLs
    }
  }
  return null;
}

/**
 * Build a Bandcamp EmbeddedPlayer iframe src from a page URL.
 *
 * Bandcamp's EmbeddedPlayer accepts numeric album/track IDs, which are NOT
 * available from the page URL alone.  We therefore use the `bc_url` redirect
 * approach: redirect the iframe to the page URL and let Bandcamp resolve the
 * embed, which is how third-party sites commonly use the embed API without
 * scraping numeric IDs.
 *
 * If the URL doesn't look like a Bandcamp album/track page, returns null so
 * play() throws and the cascade continues to YouTube.
 */
function bandcampEmbedUrl(pageUrl: string): string | null {
  try {
    const parsed = new URL(pageUrl);
    if (!BANDCAMP_HOST_RE.test(parsed.hostname)) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    const kind = parts[0]; // "album" | "track"
    if (kind !== "album" && kind !== "track") return null;

    // Use the public EmbeddedPlayer redirect: providing `bc_url` lets the
    // Bandcamp player resolve the numeric ID server-side.
    const params = new URLSearchParams({
      bc_url: pageUrl,
      size: "small",
      bgcol: "1a1a1a",
      linkcol: "0687f5",
      transparent: "true",
      artwork: "none",
    });

    return `https://bandcamp.com/EmbeddedPlayer/?${params.toString()}`;
  } catch {
    return null;
  }
}

/** Return true if a postMessage event looks like a Bandcamp play event. */
function isPlayEvent(data: unknown): boolean {
  if (typeof data !== "object" || !data) return false;
  const evt = data as { event?: string; action?: string };
  const name = evt.event ?? evt.action ?? "";
  if (typeof name !== "string") return false;
  return (
    name.toLowerCase().includes("play") &&
    !name.toLowerCase().includes("pause") &&
    !name.toLowerCase().includes("stop")
  );
}

/** Return true if a postMessage event looks like a Bandcamp ended/stop event. */
function isEndedEvent(data: unknown): boolean {
  if (typeof data !== "object" || !data) return false;
  const evt = data as { event?: string };
  const name = evt.event ?? "";
  if (typeof name !== "string") return false;
  return name.toLowerCase().includes("end") || name.toLowerCase().includes("finish");
}

/** Return true if a postMessage event looks like a Bandcamp pause event. */
function isPauseEvent(data: unknown): boolean {
  if (typeof data !== "object" || !data) return false;
  const evt = data as { event?: string; action?: string };
  const name = evt.event ?? evt.action ?? "";
  if (typeof name !== "string") return false;
  return name.toLowerCase().includes("pause") || name.toLowerCase().includes("stop");
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBandcampDriver(): PlaybackDriverHandle {
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);
  const subscribersRef = useRef<Set<(s: DriverPlaybackStatus) => void>>(new Set());
  const playingRef = useRef(false);

  // Resolvers for the play-confirmation promise.  Set inside play() and called
  // by the postMessage listener when a "play" message arrives.
  const playConfirmResolveRef = useRef<(() => void) | null>(null);
  const playConfirmRejectRef = useRef<((err: Error) => void) | null>(null);

  const notify = useCallback((status: DriverPlaybackStatus) => {
    subscribersRef.current.forEach((cb) => cb(status));
  }, []);

  // Listen for Bandcamp embed player messages.
  useEffect(() => {
    if (!iframeSrc) return;
    const onMessage = (event: MessageEvent) => {
      // Only trust messages that look like they came from a Bandcamp embed.
      // We cannot verify origin precisely (the embed origin is bandcamp.com
      // but message origin may differ), so we rely on message shape.
      try {
        if (isPlayEvent(event.data)) {
          // Resolve the play-confirmation promise if it is still pending.
          playConfirmResolveRef.current?.();
          playConfirmResolveRef.current = null;
          playConfirmRejectRef.current = null;
          if (!playingRef.current) {
            playingRef.current = true;
            notify({ state: "playing", trackId: currentTrackIdRef.current });
          }
        } else if (isPauseEvent(event.data)) {
          playingRef.current = false;
          notify({ state: "paused", trackId: currentTrackIdRef.current });
        } else if (isEndedEvent(event.data)) {
          // Confirmed ended — signal it (may not fire reliably; driver does
          // not set a synthetic timer as that could cause false auto-advance).
          playingRef.current = false;
          notify({ state: "ended", trackId: currentTrackIdRef.current });
        }
      } catch {
        // ignore parse errors
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [iframeSrc, notify]);

  // The surface: a portal-mounted iframe, visible when active.
  const surface = useMemo(() => {
    if (!iframeSrc || typeof document === "undefined") return undefined;
    return createPortal(
      <iframe
        ref={(el) => { iframeRef.current = el; }}
        src={iframeSrc}
        title="Bandcamp playback"
        sandbox="allow-scripts allow-same-origin"
        allow="autoplay"
        style={{
          position: "fixed",
          bottom: 160,
          right: 16,
          width: 340,
          height: 42,
          border: "none",
          borderRadius: 8,
          zIndex: 50,
          boxShadow: "0 2px 8px rgba(0, 0, 0,0.2)",
        }}
      />,
      document.body,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeSrc]);

  return useMemo<PlaybackDriverHandle>(
    () => ({
      id: "bandcamp" as const,
      // Always available at the service level; per-track checked in play().
      available: true,
      surface,

      play: async (item: RideItem) => {
        // ── 1. Resolve Bandcamp URL ─────────────────────────────────────────
        const bcUrl = findBandcampUrl(item);
        if (!bcUrl) {
          throw new Error("No Bandcamp link for this track — cascade to YouTube");
        }

        const embedUrl = bandcampEmbedUrl(bcUrl);
        if (!embedUrl) {
          throw new Error("Could not construct Bandcamp embed URL — cascade to YouTube");
        }

        // ── 2. Reject any pending confirmation from a previous play() call ──
        playConfirmRejectRef.current?.(new Error("superseded"));
        playConfirmResolveRef.current = null;
        playConfirmRejectRef.current = null;

        // Already playing this track — no-op.
        if (currentTrackIdRef.current === item.mbid && playingRef.current) return;

        currentTrackIdRef.current = item.mbid;
        playingRef.current = false;
        notify({ state: "loading", trackId: item.mbid });

        // ── 3. Mount iframe ─────────────────────────────────────────────────
        setIframeSrc(embedUrl);

        // ── 4. Wait for play confirmation via postMessage ───────────────────
        // If the embed does not fire a "play" message within the timeout,
        // throw so the cascade continues to YouTube.
        await new Promise<void>((resolve, reject) => {
          playConfirmResolveRef.current = resolve;
          playConfirmRejectRef.current = reject;

          const timer = setTimeout(() => {
            // Only reject if this promise is still pending (resolve/reject
            // refs still point to these functions).
            if (playConfirmRejectRef.current === reject) {
              playConfirmRejectRef.current = null;
              playConfirmResolveRef.current = null;
              reject(new Error(
                "Bandcamp embed did not confirm playback within timeout — cascade to YouTube",
              ));
            }
          }, PLAY_CONFIRM_TIMEOUT_MS);

          // Clear the timer if the promise resolves before the timeout.
          Promise.resolve().then(() => {
            const origResolve = resolve;
            playConfirmResolveRef.current = () => {
              clearTimeout(timer);
              origResolve();
            };
          }).catch(() => {/* no-op */});
        }).catch((err: Error) => {
          // Any failure (timeout, superseded) → unmount iframe, re-throw so
          // the cascade proceeds to YouTube.
          setIframeSrc(null);
          currentTrackIdRef.current = null;
          playingRef.current = false;
          throw err;
        });

        // play() resolves when playConfirmResolveRef was called (via
        // the message listener), meaning the embed confirmed playback.
        // The "playing" state has already been notified by the listener.
      },

      pause: async () => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;
        try {
          iframe.contentWindow.postMessage({ action: "pause" }, "*");
        } catch { /* best-effort */ }
        playingRef.current = false;
        notify({ state: "paused", trackId: currentTrackIdRef.current });
      },

      resume: async () => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;
        try {
          iframe.contentWindow.postMessage({ action: "play" }, "*");
        } catch { /* best-effort */ }
        playingRef.current = true;
        notify({ state: "playing", trackId: currentTrackIdRef.current });
      },

      stop: () => {
        // Cancel any pending play-confirmation so it does not call back
        // after stop() is called.
        playConfirmRejectRef.current?.(new Error("stopped"));
        playConfirmResolveRef.current = null;
        playConfirmRejectRef.current = null;
        setIframeSrc(null);
        currentTrackIdRef.current = null;
        playingRef.current = false;
      },

      onStatusChange: (cb) => {
        subscribersRef.current.add(cb);
        return () => subscribersRef.current.delete(cb);
      },
    }),
    [surface, notify],
  );
}
