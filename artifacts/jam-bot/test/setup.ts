import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "jam-bot-test-"));

process.env.SPOTIFY_CLIENT_ID ??= "test-client-id";
process.env.SPOTIFY_CLIENT_SECRET ??= "test-client-secret";
process.env.SPOTIFY_REFRESH_TOKEN ??= "test-refresh-token";
process.env.SPOTIFY_DEVICE_NAME ??= "Jam Host";
process.env.SLACK_BOT_TOKEN ??= "xoxb-test";
process.env.SLACK_APP_TOKEN ??= "xapp-test";
process.env.SLACK_SIGNING_SECRET ??= "test-signing-secret";
process.env.SLACK_CHANNEL_ID ??= "C_TEST_CHANNEL";
process.env.OPENROUTER_API_KEY ??= "test-openrouter-key";
process.env.DATABASE_PATH = path.join(tmp, "jam-test.db");
process.env.NOW_PLAYING_POLL_MS ??= "1000";
process.env.LOG_LEVEL ??= "error";
