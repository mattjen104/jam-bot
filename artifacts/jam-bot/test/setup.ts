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
// Host allowed to DM the bot — enables the DM surface so origin-based
// routing (DM-started tour stays in the DM) can be exercised in tests.
process.env.JAM_QUIET_DM_USER ??= "U_HOST";
process.env.OPENROUTER_API_KEY ??= "test-openrouter-key";
process.env.DATABASE_PATH = path.join(tmp, "jam-test.db");
process.env.NOW_PLAYING_POLL_MS ??= "1000";
process.env.LOG_LEVEL ??= "error";
// Make a single-vote skip enough so intent-routing tests can exercise the
// "skipToNext was called" path without simulating multiple voters.
process.env.SKIP_VOTE_THRESHOLD ??= "1";
// Disable the auto-Wrapped scheduler in tests so it never spins up timers.
process.env.JAM_ENABLE_WEEKLY_WRAPPED ??= "false";
// Turntable sync config — enables turntableConfigured() so the /turntable
// command and its origin-based announcement routing can be exercised. The
// ingest server is only started from index.ts (not imported in tests), so
// these don't open a socket.
process.env.ACRCLOUD_HOST ??= "identify-eu-west-1.acrcloud.com";
process.env.ACRCLOUD_ACCESS_KEY ??= "test-acr-key";
process.env.ACRCLOUD_ACCESS_SECRET ??= "test-acr-secret";
process.env.TURNTABLE_INGEST_SECRET ??= "test-ingest-secret";
