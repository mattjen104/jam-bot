import "dotenv/config";
import { z } from "zod";

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
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-3.5-sonnet"),

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
  JAM_ENABLE_WEEKLY_WRAPPED: z.coerce.boolean().default(true),
  // When the auto-weekly post fires. Format: "<Day> HH:MM" in UTC, where
  // Day is one of Sun/Mon/Tue/Wed/Thu/Fri/Sat. The scheduler checks every
  // 30s and only fires once per day.
  JAM_WRAPPED_SCHEDULE: z.string().min(1).default("Sun 20:00"),
  // How many days back /wrapped and the auto-Wrapped post look.
  JAM_WRAPPED_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  // Cap on tracks /memory will queue from a single "play me a set" request.
  JAM_MEMORY_MAX_QUEUE: z.coerce.number().int().positive().default(10),
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
