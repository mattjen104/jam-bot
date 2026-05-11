import "dotenv/config";
import { z } from "zod";

/**
 * Parse a boolean from an env-var string. `z.coerce.boolean()` is wrong here:
 * it does JS truthy-coercion, which means the literal string "false" coerces
 * to `true` (any non-empty string is truthy). We want the obvious meaning:
 * "false"/"0"/"no"/"off" (case-insensitive) all disable the flag, "true"/"1"/
 * "yes"/"on" enable it. Unknown strings default to `true` (fail-open for
 * features that are on by default).
 */
export function parseBoolEnv(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  if (["false", "0", "no", "off", ""].includes(s)) return false;
  return true;
}

const boolFromEnv = z
  .union([z.boolean(), z.string()])
  .transform(parseBoolEnv);

const schema = z.object({
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_CLIENT_SECRET: z.string().min(1),
  SPOTIFY_REFRESH_TOKEN: z.string().min(1),
  SPOTIFY_DEVICE_NAME: z.string().min(1).default("Jam Host"),

  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_APP_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_CHANNEL_ID: z.string().min(1),

  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-sonnet-4"),

  NOW_PLAYING_POLL_MS: z.coerce.number().int().positive().default(5000),
  DATABASE_PATH: z.string().min(1).default("./data/jam.db"),
  LLM_HISTORY_WINDOW: z.coerce.number().int().positive().default(25),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Vote-to-skip: how many distinct users must press the skip button on the
  // currently-playing card before the bot calls skipToNext.
  SKIP_VOTE_THRESHOLD: z.coerce.number().int().positive().default(3),
  // Rolling window (seconds) within which the SKIP_VOTE_THRESHOLD votes
  // must arrive. Votes older than this are pruned before tallying.
  SKIP_VOTE_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  // Per-user request budget for /play. Over this many in the last hour and
  // the bot replies ephemerally instead of starting playback.
  MAX_PLAYS_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(5),

  // ---- Jam Memory (Wrapped / DNA / Compat / Memory) -----------------------
  // Whether the auto-weekly Wrapped post is enabled. /wrapped on demand
  // works regardless of this flag.
  JAM_ENABLE_WEEKLY_WRAPPED: boolFromEnv.default(true),
  // When the auto-weekly post fires. Format: "<Day> HH:MM" in UTC, where
  // Day is one of Sun/Mon/Tue/Wed/Thu/Fri/Sat. The scheduler checks every
  // 30s and only fires once per day.
  JAM_WRAPPED_SCHEDULE: z.string().min(1).default("Sun 20:00"),
  // How many days back /wrapped and the auto-Wrapped post look.
  JAM_WRAPPED_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  // Cap on tracks /memory will queue from a single "play me a set" request.
  JAM_MEMORY_MAX_QUEUE: z.coerce.number().int().positive().default(10),

  // ---- Now-playing post schedule -----------------------------------------
  // Comma-separated list of UTC day-of-week numbers (0=Sun..6=Sat) on which
  // the "Now playing" card is allowed to post. Defaults to Friday only so
  // friends only get pinged with track-change cards on Fridays. Other days,
  // tracks still play and get logged to history — they just don't post.
  // Set to "0,1,2,3,4,5,6" to post every day.
  JAM_NOWPLAYING_DAYS: z.string().default("5"),

  // ---- Quiet (test) mode -------------------------------------------------
  // Slack user ID (e.g. U01ABC...) to receive bot output as DMs while quiet
  // mode is on. When set, slash command replies and @mention answers DM
  // this user instead of posting in-channel. If unset, quiet mode falls
  // back to ephemeral messages visible only to the slash-command caller.
  JAM_QUIET_DM_USER: z.string().optional(),

  // ---- Spotify Jam (social listening) -----------------------------------
  // Optional `sp_dc` cookie value from open.spotify.com (DevTools ->
  // Application -> Cookies). Used by /jam to attempt programmatic Jam
  // start via Spotify's undocumented social-connect endpoint. If unset,
  // /jam falls back to manual "tap Start a Jam in the app" instructions.
  // The endpoint may break at any time; the fallback always works.
  //
  // NOTE: Spotify blocks the `get_access_token` endpoint from datacenter
  // IPs (DigitalOcean, AWS, etc), so SPOTIFY_SP_DC alone won't work on
  // a cloud droplet — you'll see 403 "URL Blocked". Set the relay vars
  // below instead and run tools/spotify-token-relay on a residential IP.
  SPOTIFY_SP_DC: z.string().optional(),

  // Optional URL of a spotify-token-relay instance (see
  // tools/spotify-token-relay). When set, the bot calls the relay for
  // internal Spotify tokens instead of hitting open.spotify.com directly.
  // This is the workaround for the datacenter-IP block. The relay runs
  // on your home network and holds the sp_dc cookie there — the droplet
  // only ever sees short-lived access tokens.
  SPOTIFY_TOKEN_RELAY_URL: z.string().url().optional(),

  // Shared secret matching the relay's RELAY_SECRET. Required when
  // SPOTIFY_TOKEN_RELAY_URL is set. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  SPOTIFY_TOKEN_RELAY_SECRET: z.string().optional(),
});

function loadConfig() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(
      `\nInvalid or missing environment variables:\n${issues}\n\nCopy .env.example to .env and fill in the values, then see SETUP.md.\n`,
    );
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
export type Config = typeof config;
