import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  topTracksInRange,
  topArtistsInRange,
  activeUsersInRange,
  userTopTracksInRange,
  userTopArtistsInRange,
  userDiscoveriesInRange,
  hourBucketsInRange,
  isOptedOut,
  kvGet,
  kvSet,
  type TopTrackRow,
  type TopArtistRow,
} from "./db.js";

const KV_LAST_FIRE = "wrapped:last_fire_key";

export interface WrappedPerUser {
  slackUser: string;
  plays: number;
  topTrack: string | null;
  topArtist: string | null;
  discoveries: number;
  optedOut: boolean;
}

export interface WrappedStats {
  start: Date;
  end: Date;
  startStr: string;
  endStr: string;
  totalPlays: number;
  topTracks: TopTrackRow[];
  topArtists: TopArtistRow[];
  perUser: WrappedPerUser[];
  // Plays in 22:00-05:59 UTC vs 06:00-21:59 UTC. We don't try to localize —
  // a Slack channel can span time zones and rolling-up by UTC is consistent.
  lateNightPlays: number;
  daytimePlays: number;
}

/**
 * Convert a JS Date to the SQLite "YYYY-MM-DD HH:MM:SS" UTC string format
 * that `played_tracks.played_at` is stored in (it's set by SQLite's
 * `datetime('now')` which is UTC).
 */
export function toSqliteUtc(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Build a Wrapped stats snapshot for the [end - rangeDays, end) window.
 * Pure data — no Slack / LLM calls — so it's trivial to unit-test.
 */
export function buildWrappedStats(
  rangeDays: number = config.JAM_WRAPPED_LOOKBACK_DAYS,
  asOf: Date = new Date(),
): WrappedStats {
  const end = new Date(asOf);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - rangeDays);
  const startStr = toSqliteUtc(start);
  const endStr = toSqliteUtc(end);

  const topTracks = topTracksInRange(startStr, endStr, 5);
  const topArtists = topArtistsInRange(startStr, endStr, 5);
  const users = activeUsersInRange(startStr, endStr);

  const perUser: WrappedPerUser[] = users.map((u) => {
    const opted = isOptedOut(u.slack_user);
    if (opted) {
      return {
        slackUser: u.slack_user,
        plays: u.plays,
        topTrack: null,
        topArtist: null,
        discoveries: 0,
        optedOut: true,
      };
    }
    const tt = userTopTracksInRange(u.slack_user, startStr, endStr, 1);
    const ta = userTopArtistsInRange(u.slack_user, startStr, endStr, 1);
    const disc = userDiscoveriesInRange(u.slack_user, startStr, endStr).length;
    return {
      slackUser: u.slack_user,
      plays: u.plays,
      topTrack: tt[0] ? `${tt[0].title} — ${tt[0].artist}` : null,
      topArtist: ta[0]?.artist ?? null,
      discoveries: disc,
      optedOut: false,
    };
  });

  const buckets = hourBucketsInRange(startStr, endStr);
  let lateNight = 0;
  let daytime = 0;
  for (const b of buckets) {
    if (b.hour >= 22 || b.hour < 6) lateNight += b.plays;
    else daytime += b.plays;
  }

  const totalPlays =
    users.reduce((acc, u) => acc + u.plays, 0) +
    // include anonymous (no requester) plays so the headline number isn't off
    Math.max(
      0,
      topTracks.reduce((acc, t) => acc + t.plays, 0) -
        users.reduce((acc, u) => acc + u.plays, 0),
    );

  return {
    start,
    end,
    startStr,
    endStr,
    totalPlays,
    topTracks,
    topArtists,
    perUser,
    lateNightPlays: lateNight,
    daytimePlays: daytime,
  };
}

// ---- Scheduler ----------------------------------------------------------

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function parseSchedule(
  spec: string,
): { dayOfWeek: number; hour: number; minute: number } | null {
  const m = spec.trim().toLowerCase().match(
    /^(sun|mon|tue|wed|thu|fri|sat)\s+(\d{1,2}):(\d{2})$/,
  );
  if (!m) return null;
  const hour = parseInt(m[2]!, 10);
  const minute = parseInt(m[3]!, 10);
  if (hour > 23 || minute > 59) return null;
  return { dayOfWeek: DAY_NAMES.indexOf(m[1]!), hour, minute };
}

export class WrappedScheduler {
  private timer: NodeJS.Timeout | null = null;
  // Once-per-day idempotency: we persist the YYYY-MM-DD UTC key when we fire,
  // so a slow `fire()`, jittery clock, OR a process restart in the firing
  // minute can't trigger us twice in the same day. The persisted value lives
  // in the `kv` table so it survives restarts.
  private lastFireKey: string | null = null;

  constructor(private readonly fire: () => Promise<void>) {
    this.lastFireKey = kvGet(KV_LAST_FIRE);
  }

  start() {
    if (this.timer) return;
    if (!config.JAM_ENABLE_WEEKLY_WRAPPED) {
      logger.info("Weekly Wrapped disabled (JAM_ENABLE_WEEKLY_WRAPPED=false)");
      return;
    }
    const target = parseSchedule(config.JAM_WRAPPED_SCHEDULE);
    if (!target) {
      logger.warn(
        `Invalid JAM_WRAPPED_SCHEDULE "${config.JAM_WRAPPED_SCHEDULE}" ` +
          `(expected "<Day> HH:MM" UTC, e.g. "Sun 20:00") — auto-Wrapped disabled.`,
      );
      return;
    }
    const tick = () => {
      const now = new Date();
      const key = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
      if (
        now.getUTCDay() === target.dayOfWeek &&
        now.getUTCHours() === target.hour &&
        Math.abs(now.getUTCMinutes() - target.minute) <= 1 &&
        this.lastFireKey !== key
      ) {
        this.lastFireKey = key;
        kvSet(KV_LAST_FIRE, key);
        this.fire().catch((err) =>
          logger.error("Weekly Wrapped fire failed", { error: String(err) }),
        );
      }
    };
    this.timer = setInterval(tick, 30_000);
    logger.info(
      `Weekly Wrapped scheduled at "${config.JAM_WRAPPED_SCHEDULE}" UTC`,
    );
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
