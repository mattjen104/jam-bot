import { logger } from "./logger.js";
import { ensurePlaybackOnHost } from "./spotify/client.js";
import { startSlackBot } from "./slack/bot.js";
import { nowPlayingWatcher } from "./now-playing.js";
import { config } from "./config.js";

async function main() {
  logger.info("Starting Jam Bot...");

  try {
    const host = await ensurePlaybackOnHost();
    if (host) {
      logger.info(`Found host device "${host.name}"`);
    } else {
      logger.warn(
        `Host device "${config.SPOTIFY_DEVICE_NAME}" not visible to Spotify yet — make sure librespot is running and a Jam is active.`,
      );
    }
  } catch (err) {
    logger.warn("Could not transfer playback at startup", {
      error: String(err),
    });
  }

  await startSlackBot();
  nowPlayingWatcher.start();

  logger.info("Jam Bot is up.");
}

function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down`);
  nowPlayingWatcher.stop();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  logger.error("Fatal error during startup", { error: String(err), stack: (err as Error)?.stack });
  process.exit(1);
});
