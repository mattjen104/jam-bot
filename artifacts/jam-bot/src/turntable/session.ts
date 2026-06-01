import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
import { config } from "../config.js";
import {
  findActiveDevice,
  playNow,
  seek,
  searchTrack,
  searchTrackByIsrc,
  type SearchResultTrack,
} from "../spotify/client.js";
import { withPlaybackLock } from "../spotify/playback-lock.js";
import type { AcrMatch } from "./acrcloud.js";

/**
 * Per-observation metadata the ingest layer knows but the fingerprint match
 * itself doesn't. Currently just the captured clip's length: ACRCloud's
 * `play_offset_ms` is the offset at the START of the clip, so the real record
 * position when we act is ~`play_offset_ms + clipDurationMs` (+ round-trip).
 */
export interface ObserveMeta {
  clipDurationMs?: number;
}

/**
 * Turntable sync engine.
 *
 * The host plays an analog source (record player, line-in, mic). A desktop
 * helper sends short clips to the ingest server, which fingerprints them via
 * ACRCloud and feeds each `AcrMatch` here through `observe()`. This engine
 * decides when the host's single Spotify account should switch tracks and
 * seek, so Spotify's native Jam cascades the same music to every guest.
 *
 * Design choices baked in for continuous recognition (see task spec):
 *   - Act only on confident matches; ignore misses entirely (a dropout never
 *     pauses or reverts the music).
 *   - Debounce track CHANGES: require N consecutive samples agreeing on a new
 *     track before switching, so a single mis-ID mid-song can't derail things.
 *   - Clock anchoring, not constant seeking: each confident match refreshes a
 *     {offset, wall-clock} anchor; the host's target position is computed from
 *     it. We HARD seek only at a confirmed track boundary and on manual
 *     resync — never micro-seek mid-track (that would stutter every guest).
 */

/** Stable identity for a recording: prefer ISRC, fall back to ACRCloud id. */
export function matchKey(m: AcrMatch): string {
  return m.isrc ? `isrc:${m.isrc}` : `acrid:${m.acrid}`;
}

export type DebounceResult =
  | { kind: "miss" } // null / low-confidence — ignored
  | { kind: "confirmed-current" } // same as the track we're already on
  | { kind: "pending" } // a different track, not yet confirmed
  | { kind: "changed"; key: string }; // a new track just crossed the threshold

/**
 * Tracks how many consecutive confident samples agree on a NEW track before
 * we believe a real track change happened. Pure + synchronous so the policy
 * is fully unit-testable. Misses (null) are ignored: they neither advance nor
 * reset the streak, so a momentary recognition dropout is a no-op.
 */
export class TrackChangeDebouncer {
  private confirmedKey: string | null = null;
  private candidateKey: string | null = null;
  private candidateCount = 0;

  constructor(private readonly threshold: number) {
    this.threshold = Math.max(1, Math.floor(threshold));
  }

  get current(): string | null {
    return this.confirmedKey;
  }

  reset(): void {
    this.confirmedKey = null;
    this.candidateKey = null;
    this.candidateCount = 0;
  }

  observe(match: AcrMatch | null): DebounceResult {
    if (!match) return { kind: "miss" };
    const key = matchKey(match);

    if (key === this.confirmedKey) {
      // Re-confirmation of the track we're already on. Drop any partial
      // streak toward a different track (the source clearly didn't change).
      this.candidateKey = null;
      this.candidateCount = 0;
      return { kind: "confirmed-current" };
    }

    if (key === this.candidateKey) {
      this.candidateCount += 1;
    } else {
      this.candidateKey = key;
      this.candidateCount = 1;
    }

    if (this.candidateCount >= this.threshold) {
      this.confirmedKey = key;
      this.candidateKey = null;
      this.candidateCount = 0;
      return { kind: "changed", key };
    }
    return { kind: "pending" };
  }
}

export interface ClockAnchor {
  /** Offset (ms) into the track at the anchor instant. */
  offsetMs: number;
  /** Wall-clock time (ms epoch) the offset was true. */
  anchoredAtMs: number;
  /** Track duration (ms) when known, used to clamp the computed target. */
  durationMs?: number;
}

/**
 * Where the track "should" be now, given an anchor: the offset plus the
 * wall-clock elapsed since the anchor. Clamped to [0, duration]. Pure.
 */
export function computeTargetPositionMs(
  anchor: ClockAnchor,
  nowMs: number,
): number {
  const raw = anchor.offsetMs + (nowMs - anchor.anchoredAtMs);
  const lo = Math.max(0, raw);
  if (anchor.durationMs && anchor.durationMs > 0) {
    return Math.min(lo, anchor.durationMs);
  }
  return lo;
}

export interface TurntableStatus {
  active: boolean;
  track: { title: string; artist: string; spotifyUrl?: string } | null;
  /** Computed current position (ms) from the live anchor, when active. */
  positionMs: number | null;
}

export interface TurntableConfirmedEvent {
  track: SearchResultTrack;
  match: AcrMatch;
  /** True when the match resolved via ISRC, false for the title/artist fallback. */
  viaIsrc: boolean;
}

/**
 * Resolve an ACRCloud match to a real Spotify track: ISRC first (exact), then
 * a title+artist search. Returns null when neither finds anything so we never
 * fabricate a track. Exposed for direct testing.
 */
export async function resolveMatchToSpotify(
  match: AcrMatch,
): Promise<{ track: SearchResultTrack; viaIsrc: boolean } | null> {
  if (match.isrc) {
    try {
      const byIsrc = await searchTrackByIsrc(match.isrc);
      if (byIsrc) return { track: byIsrc, viaIsrc: true };
    } catch (err) {
      logger.warn("Turntable: ISRC lookup failed, falling back to search", {
        isrc: match.isrc,
        error: String(err),
      });
    }
  }
  const query = `${match.title} ${match.artist}`.trim();
  if (!query) return null;
  const byText = await searchTrack(query);
  return byText ? { track: byText, viaIsrc: false } : null;
}

export interface TurntableSessionEvents {
  trackConfirmed: [TurntableConfirmedEvent];
  resynced: [{ track: SearchResultTrack; positionMs: number }];
  error: [{ stage: string; error: string }];
}

/**
 * The live turntable session. A singleton (`turntableSession`) is wired into
 * the ingest server (which calls `observe`) and the Slack bot (which calls
 * `start`/`stop`/`resync` and listens for `trackConfirmed`). It owns no Slack
 * or HTTP concerns — that separation keeps it unit-testable with a mocked
 * Spotify client.
 */
export class TurntableSession extends EventEmitter {
  private active = false;
  private debouncer: TrackChangeDebouncer;
  private anchor: ClockAnchor | null = null;
  private currentTrack: SearchResultTrack | null = null;
  private deviceId: string | undefined;
  /** Serializes observe()/resync() so overlapping clips can't race the player. */
  private chain: Promise<unknown> = Promise.resolve();
  /**
   * Bumped on every start()/stop(). A long-running applyTrackChange captures
   * the generation it started under and refuses to commit playback or emit if
   * the session was stopped/restarted underneath it — so `/turntable stop`
   * can't be followed by a stray, post-stop track jump.
   */
  private generation = 0;

  /**
   * The offset the record is really at "now", accounting for the fact that the
   * clip ACRCloud matched started `clipDurationMs` ago plus a configurable
   * round-trip slack. Keeps the host account from landing behind the vinyl.
   */
  private compensatedOffsetMs(match: AcrMatch, meta?: ObserveMeta): number {
    return (
      match.playOffsetMs +
      Math.max(0, meta?.clipDurationMs ?? 0) +
      config.TURNTABLE_SYNC_LATENCY_MS
    );
  }

  constructor() {
    super();
    this.debouncer = new TrackChangeDebouncer(
      config.TURNTABLE_TRACK_CHANGE_CONFIRMATIONS,
    );
  }

  override on<K extends keyof TurntableSessionEvents>(
    event: K,
    listener: (...args: TurntableSessionEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof TurntableSessionEvents>(
    event: K,
    ...args: TurntableSessionEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  isActive(): boolean {
    return this.active;
  }

  /** Arm the session. `deviceId` pins playback to a device if provided. */
  start(deviceId?: string): void {
    this.generation += 1;
    this.active = true;
    this.debouncer.reset();
    this.anchor = null;
    this.currentTrack = null;
    this.deviceId = deviceId;
    logger.info("Turntable session started", { deviceId: deviceId ?? null });
  }

  stop(): void {
    this.generation += 1;
    this.active = false;
    this.debouncer.reset();
    this.anchor = null;
    this.currentTrack = null;
    this.deviceId = undefined;
    logger.info("Turntable session stopped");
  }

  status(): TurntableStatus {
    return {
      active: this.active,
      track: this.currentTrack
        ? {
            title: this.currentTrack.title,
            artist: this.currentTrack.artist,
            spotifyUrl: `https://open.spotify.com/track/${this.currentTrack.id}`,
          }
        : null,
      positionMs: this.anchor
        ? computeTargetPositionMs(this.anchor, Date.now())
        : null,
    };
  }

  /**
   * Feed one fingerprint result into the engine. Calls are serialized so two
   * overlapping clips can't both try to switch the player at once. Returns
   * the debounce decision (handy for the ingest response + tests).
   */
  observe(match: AcrMatch | null, meta?: ObserveMeta): Promise<DebounceResult> {
    const run = this.chain.then(() => this.observeInner(match, meta));
    // Keep the chain alive even if this step rejects.
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async observeInner(
    match: AcrMatch | null,
    meta?: ObserveMeta,
  ): Promise<DebounceResult> {
    if (!this.active) return { kind: "miss" };
    const result = this.debouncer.observe(match);

    if (result.kind === "confirmed-current" && match) {
      // Same track — keep the clock honest by refreshing the anchor from the
      // fresh (latency-compensated) offset, but DON'T seek (no mid-track
      // stutter for guests).
      this.anchor = {
        offsetMs: this.compensatedOffsetMs(match, meta),
        anchoredAtMs: Date.now(),
        durationMs: this.currentTrack?.durationMs,
      };
      return result;
    }

    if (result.kind === "changed" && match) {
      await this.applyTrackChange(match, meta);
    }
    return result;
  }

  private async applyTrackChange(
    match: AcrMatch,
    meta?: ObserveMeta,
  ): Promise<void> {
    // Capture the generation we started under; if the session is stopped or
    // restarted while we're resolving/driving, we must NOT commit playback or
    // emit a confirmation for a now-defunct session.
    const gen = this.generation;
    const stale = () => !this.active || this.generation !== gen;

    let resolved;
    try {
      resolved = await resolveMatchToSpotify(match);
    } catch (err) {
      logger.error("Turntable: resolve failed", { error: String(err) });
      this.emit("error", { stage: "resolve", error: String(err) });
      return;
    }
    if (stale()) {
      logger.info("Turntable: dropping resolved match (session changed)");
      return;
    }
    if (!resolved) {
      logger.warn("Turntable: no Spotify track for match", {
        title: match.title,
        artist: match.artist,
        isrc: match.isrc,
      });
      this.emit("error", {
        stage: "resolve",
        error: `No Spotify track for "${match.title}" — ${match.artist}`,
      });
      return;
    }

    const { track, viaIsrc } = resolved;
    // Anchor from the latency-compensated offset; compute the target now so we
    // land where the record actually is (a few seconds in), not at 0:00.
    const anchor: ClockAnchor = {
      offsetMs: this.compensatedOffsetMs(match, meta),
      anchoredAtMs: Date.now(),
      durationMs: track.durationMs,
    };
    const target = computeTargetPositionMs(anchor, Date.now());

    try {
      // Route through the shared playback lock so a turntable switch can't
      // interleave with a racing /play, /memory queue loop, or skip vote.
      await withPlaybackLock(async () => {
        if (stale()) return;
        const device = await this.ensureDeviceId();
        await playNow(track.uri, device);
        // Only seek when we're meaningfully into the track; starting a fresh
        // side at ~0:00 doesn't need a seek round-trip.
        if (target > 1500) {
          await seek(target, device);
        }
      });
    } catch (err) {
      logger.error("Turntable: drive playback failed", { error: String(err) });
      this.emit("error", { stage: "playback", error: String(err) });
      return;
    }

    if (stale()) {
      logger.info("Turntable: drove playback but session changed; not anchoring");
      return;
    }

    this.anchor = anchor;
    this.currentTrack = track;
    logger.info("Turntable: switched host to matched track", {
      title: track.title,
      artist: track.artist,
      targetMs: target,
      viaIsrc,
    });
    this.emit("trackConfirmed", { track, match, viaIsrc });
  }

  /**
   * Manual resync: snap the host account to the position the clock says the
   * track should be at right now. Used by `/turntable resync` when drift
   * creeps in. No-op (returns null) when not active or no anchor yet.
   */
  resync(): Promise<{ track: SearchResultTrack; positionMs: number } | null> {
    const run = this.chain.then(() => this.resyncInner());
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async resyncInner(): Promise<{
    track: SearchResultTrack;
    positionMs: number;
  } | null> {
    if (!this.active || !this.anchor || !this.currentTrack) return null;
    const target = computeTargetPositionMs(this.anchor, Date.now());
    await withPlaybackLock(async () => {
      const device = await this.ensureDeviceId();
      await seek(target, device);
    });
    logger.info("Turntable: manual resync", { positionMs: target });
    const payload = { track: this.currentTrack, positionMs: target };
    this.emit("resynced", payload);
    return payload;
  }

  /**
   * Resolve the device to drive. We re-look it up rather than trusting a
   * cached id, since the host may have moved playback between devices; a
   * pinned `start(deviceId)` still wins when set.
   */
  private async ensureDeviceId(): Promise<string | undefined> {
    if (this.deviceId) return this.deviceId;
    const dev = await findActiveDevice();
    return dev?.id || undefined;
  }
}

export const turntableSession = new TurntableSession();
