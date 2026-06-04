import { EventEmitter } from "node:events";
import {
  getCurrentlyPlaying,
  findActiveDevice,
  type CurrentlyPlaying,
} from "./spotify/client.js";
import { popPendingRequest, recordPlayed, lastPlayed } from "./db.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

export interface TrackChangeEvent {
  current: NonNullable<CurrentlyPlaying["track"]>;
  requestedBySlackUser: string | null;
  requestedQuery: string | null;
}

export interface PositionEvent {
  trackId: string;
  progressMs: number;
  durationMs: number;
  /**
   * Whether Spotify reports playback as actively progressing right now. A
   * paused track still has a position, but a consumer's local clock must NOT
   * keep interpolating past it — so this lets the anchor stand down on pause.
   */
  isPlaying: boolean;
}

export type NowPlayingEvents = {
  trackChange: (event: TrackChangeEvent) => void;
  /**
   * Fired every poll tick while a track is playing, carrying the live
   * playback position straight from Spotify. Lets a consumer keep a cheap
   * local clock anchor (no extra Spotify calls) for things like timed
   * insights during a normal Jam — independent of track CHANGE detection.
   */
  position: (event: PositionEvent) => void;
  noActiveDevice: () => void;
  resumed: () => void;
};

class NowPlayingWatcher extends EventEmitter {
  private lastTrackId: string | null = null;
  private wasNoDevice = false;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  start() {
    if (this.timer || this.stopped) return;
    // Seed lastTrackId from the most recent persisted row so a restart
    // doesn't double-record the currently playing track.
    const last = lastPlayed();
    if (last) this.lastTrackId = last.track_id;
    const schedule = () => {
      if (this.stopped) return;
      this.timer = setTimeout(async () => {
        await this.tick();
        schedule();
      }, config.NOW_PLAYING_POLL_MS);
    };
    void this.tick().then(schedule);
    logger.info(
      `Now-playing watcher started (every ${config.NOW_PLAYING_POLL_MS}ms)`,
    );
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const cp = await getCurrentlyPlaying();
      if (!cp.track) {
        // "nothing playing" can mean: (a) no device active anywhere, or
        // (b) a device is active but the queue ran dry. Treat (a) as
        // "needs attention" and emit the offline alert; (b) is silent.
        const device = await findActiveDevice().catch(() => null);
        const needsAttention = !device;
        if (needsAttention && !this.wasNoDevice) {
          this.wasNoDevice = true;
          this.emit("noActiveDevice");
        }
        return;
      }
      if (this.wasNoDevice) {
        this.wasNoDevice = false;
        this.emit("resumed");
      }
      // Surface the live position every tick (not just on track change) so a
      // consumer can keep a fresh local clock anchor without extra Spotify
      // calls — straight from the data this poll already fetched.
      this.emit("position", {
        trackId: cp.track.id,
        progressMs: cp.track.progressMs,
        durationMs: cp.track.durationMs,
        isPlaying: cp.isPlaying,
      });
      if (cp.track.id !== this.lastTrackId) {
        this.lastTrackId = cp.track.id;
        const pending = popPendingRequest(cp.track.id);
        recordPlayed({
          track_id: cp.track.id,
          title: cp.track.title,
          artist: cp.track.artist,
          album: cp.track.album,
          album_image_url: cp.track.albumImageUrl ?? null,
          spotify_url: cp.track.spotifyUrl,
          duration_ms: cp.track.durationMs,
          requested_by_slack_user: pending?.requested_by_slack_user ?? null,
          requested_query: pending?.requested_query ?? null,
        });
        this.emit("trackChange", {
          current: cp.track,
          requestedBySlackUser: pending?.requested_by_slack_user ?? null,
          requestedQuery: pending?.requested_query ?? null,
        });
      }
    } catch (err) {
      logger.warn("Now-playing tick failed", { error: String(err) });
    } finally {
      this.running = false;
    }
  }
}

export interface TypedWatcher extends NowPlayingWatcher {
  on<K extends keyof NowPlayingEvents>(event: K, listener: NowPlayingEvents[K]): this;
  emit<K extends keyof NowPlayingEvents>(
    event: K,
    ...args: Parameters<NowPlayingEvents[K]>
  ): boolean;
}

export const nowPlayingWatcher = new NowPlayingWatcher() as TypedWatcher;
