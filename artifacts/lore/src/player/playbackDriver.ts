/**
 * Playback driver abstraction for Ghost Radio.
 *
 * A `PlaybackDriverHandle` lets `PlayerProvider` delegate play / pause /
 * resume / status to whichever service is active (Spotify, YouTube, Apple
 * Music, local files, Bandcamp) through a single contract. The fallback
 * cascade becomes a simple preference list; no behavioral change for existing
 * Spotify users.
 *
 * Cascade order (highest → lowest priority):
 *   Local file → Spotify → Apple Music → Bandcamp embed → YouTube
 *
 * All driver hooks live alongside this file:
 *   useSpotifyDriver.ts      — wraps the Spotify Connect remote-control path
 *   useYouTubeDriver.ts      — hidden iframe + YouTube IFrame API
 *   useAppleMusicDriver.ts   — MusicKit JS
 *   useLocalFileDriver.ts    — browser File System Access API
 *   useBandcampDriver.tsx    — sandboxed Bandcamp embed iframe
 */

import type { ReactNode } from "react";
import type { RideItem } from "./PlayerProvider";

// ---------------------------------------------------------------------------
// Status reported by drivers back to PlayerProvider
// ---------------------------------------------------------------------------

export type DriverState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  /** Track finished naturally — PlayerProvider should advance the queue. */
  | "ended"
  /**
   * The ride should stop without advancing the queue (e.g. an unpinned
   * Spotify listener took over their own player).
   */
  | "ride-ended"
  /** This track is unavailable on this driver — PlayerProvider tries the next. */
  | "unavailable"
  /** Device went offline (Spotify-specific) — PlayerProvider should clear the pin and fall back. */
  | "device-lost"
  | "error";

export interface DriverPlaybackStatus {
  state: DriverState;
  /** Current playhead in ms (best-effort; omit when unknown). */
  progressMs?: number | null;
  /** Total track duration in ms (best-effort; omit when unknown). */
  durationMs?: number | null;
  /** MBID of the track this status report refers to (for staleness guards). */
  trackId?: string | null;
}

// ---------------------------------------------------------------------------
// Driver handle interface
// ---------------------------------------------------------------------------

export interface PlaybackDriverHandle {
  /** Unique identifier — becomes `RideApi.source` while this driver is active. */
  id: "spotify" | "youtube" | "apple-music" | "local-file" | "bandcamp";

  /**
   * Whether this driver is capable of playing anything right now at the
   * service level (connected, Premium, token present, files matched, etc.).
   * Per-track availability is signalled via the "unavailable" state through
   * `onStatusChange` when `play()` is called.
   */
  available: boolean;

  /**
   * Start playing `item`.  Resolves when playback starts; rejects if the
   * track cannot be played on this driver (PlayerProvider then tries next).
   * Calling `play()` while the same track is already playing is a no-op.
   */
  play(item: RideItem): Promise<void>;

  /** Pause playback. No-op when already paused or not playing. */
  pause(): Promise<void>;

  /** Resume a paused track. No-op when not paused. */
  resume(): Promise<void>;

  /**
   * Stop and reset internal state (called on ride stop or driver switch).
   * If the driver was playing it should silence itself.
   */
  stop(): void;

  /**
   * Subscribe to playback status changes (ongoing state after `play()` resolves).
   * Returns an unsubscribe function.  Stable reference — safe to call from a
   * `useEffect` dependency array.
   */
  onStatusChange(cb: (status: DriverPlaybackStatus) => void): () => void;

  /**
   * Seek to a position within the currently-playing track.  Optional — drivers
   * that cannot seek (e.g. 30-second previews) omit this method.
   * Resolves when the seek command has been sent; does not wait for playback
   * to resume from the new position.
   */
  seek?(positionMs: number): Promise<void>;

  /**
   * Optional DOM surface that must be mounted in the component tree for the
   * driver to function (e.g. the hidden YouTube IFrame).  Null / undefined
   * for purely API-based drivers (Spotify, Apple Music).
   */
  surface?: ReactNode;
}
