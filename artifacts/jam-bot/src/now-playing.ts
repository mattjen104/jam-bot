import { EventEmitter } from "node:events";
import {
  getCurrentlyPlaying,
  findHostDevice,
  type CurrentlyPlaying,
} from "./spotify/client.js";
import { popPendingRequest, recordPlayed } from "./db.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

export interface TrackChangeEvent {
  current: NonNullable<CurrentlyPlaying["track"]>;
  requestedBySlackUser: string | null;
  requestedQuery: string | null;
}

export type NowPlayingEvents = {
  trackChange: (event: TrackChangeEvent) => void;
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
        // "nothing playing" can mean: (a) host offline, (b) host visible but
        // inactive (nobody has hit play yet / was kicked off), or (c) host
        // online and active but the queue ran dry. Treat (a) and (b) as
        // "needs attention" and emit the offline alert; (c) is silent.
        const host = await findHostDevice().catch(() => null);
        const needsAttention = !host || !host.isActive;
        if (needsAttention && !this.wasNoDevice) {
          this.wasNoDevice = true;
          this.emit("noActiveDevice", { hostVisible: !!host });
        }
        return;
      }
      if (this.wasNoDevice) {
        this.wasNoDevice = false;
        this.emit("resumed");
      }
      if (cp.track.id !== this.lastTrackId) {
        this.lastTrackId = cp.track.id;
        const pending = popPendingRequest(cp.track.id);
        recordPlayed({
          track_id: cp.track.id,
          title: cp.track.title,
          artist: cp.track.artist,
          album: cp.track.album,
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
