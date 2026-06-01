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
  // Cheaper model used for off-hot-path background work (memory fact
  // extraction). Keeping this separate from OPENROUTER_MODEL means the
  // expensive reply model's cost/quality is unchanged while the
  // remembering work runs on something cheap.
  OPENROUTER_EXTRACT_MODEL: z
    .string()
    .min(1)
    .default("anthropic/claude-3.5-haiku"),

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

  // ---- Guided music tour -------------------------------------------------
  // Default number of tracks in a "give us a tour of X" set when the user
  // doesn't ask for a specific length, and the hard cap on tour length.
  JAM_TOUR_DEFAULT_TRACKS: z.coerce.number().int().positive().default(6),
  JAM_TOUR_MAX_TRACKS: z.coerce.number().int().positive().default(12),

  // ---- Active engagement (thread) mode -----------------------------------
  // Once Jam Bot is @-mentioned in a thread (or starts one), she keeps
  // answering follow-ups in THAT thread without a re-mention until dismissed
  // or until the thread goes quiet for this long. Lazily expired on the next
  // lookup and swept periodically so a forgotten session can't linger.
  JAM_ENGAGE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000),

  // ---- Ambient now-playing cards ----------------------------------------
  // The automated "Now playing" card posts to the channel ONLY while the
  // host Spotify account is in an active Jam (social listening session) —
  // whether the host started it or joined someone else's. When no Jam is
  // active, tracks still play and get logged to history; only the Slack
  // card is suppressed. This is the TTL (ms) for caching that Jam-active
  // lookup so the per-track now-playing path never hammers the relay.
  JAM_ACTIVE_CACHE_MS: z.coerce.number().int().positive().default(15000),

  // ---- Host DM surface --------------------------------------------------
  // Slack user ID (e.g. U01ABC...) of the host allowed to DM the bot
  // directly. DMs from anyone else are ignored. A command — or a guided
  // tour — started in the host's DM is answered entirely in that DM, so the
  // host can drive or privately preview the bot (tours included) without
  // anything reaching the channel. Leave unset to disable the DM surface.
  // (Historical name kept to avoid breaking existing .env files.)
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

  // ---- Turntable sync (analog source -> Spotify Jam) --------------------
  // OPTIONAL feature: a desktop helper (tools/turntable-helper) captures
  // short clips of an analog source (record player, line-in, mic), POSTs
  // them to the ingest server below, the bot identifies the track via
  // ACRCloud's audio-fingerprint API, then drives the host's single Spotify
  // account to the matched track + offset. Spotify's native Jam cascades
  // that to every guest. The audio is used ONLY for identification — it is
  // never streamed or redistributed. Leave the ACRCloud vars unset to keep
  // the whole feature dormant; the bot runs exactly as before.
  //
  // ACRCloud project credentials (console.acrcloud.com -> Audio & Video
  // Recognition project). Host looks like "identify-eu-west-1.acrcloud.com".
  ACRCLOUD_HOST: z.string().optional(),
  ACRCLOUD_ACCESS_KEY: z.string().optional(),
  ACRCLOUD_ACCESS_SECRET: z.string().optional(),

  // TCP port the turntable ingest HTTP server listens on (the desktop
  // helper POSTs clips here). Only started when the feature is configured.
  TURNTABLE_INGEST_PORT: z.coerce.number().int().positive().default(8645),
  // Shared secret the helper must send (X-Turntable-Secret header) so only
  // your capture machine can drive playback. Required for the feature to
  // arm. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  TURNTABLE_INGEST_SECRET: z.string().optional(),

  // How many consecutive confident identifications must agree on a NEW
  // track before the bot switches the host account to it. Higher = steadier
  // (ignores a single mis-ID mid-track) but slower to follow a real track
  // change. Misses / low-confidence samples never count toward this.
  TURNTABLE_TRACK_CHANGE_CONFIRMATIONS: z.coerce
    .number()
    .int()
    .positive()
    .default(2),

  // Extra latency (ms) to add when computing the seek target, on top of the
  // submitted clip's own length. ACRCloud's play_offset_ms points at the
  // START of the clip, and there's network + fingerprinting delay between a
  // clip ending and the bot acting on it, so the host account would otherwise
  // land slightly BEHIND the real record. Tune this to your round-trip if the
  // Spotify playback consistently trails the turntable. Default 0 (the clip
  // length is always compensated automatically; this is just the extra slack).
  TURNTABLE_SYNC_LATENCY_MS: z.coerce.number().int().min(0).default(0),
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
