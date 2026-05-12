import { logger } from "./logger.js";
import { ensurePlaybackOnHost } from "./spotify/client.js";
import { startSlackBot, stopWrappedScheduler } from "./slack/bot.js";
import { nowPlayingWatcher } from "./now-playing.js";
import { config } from "./config.js";

function dbg(msg: string) {
  process.stdout.write(`[DBG ${new Date().toISOString()}] ${msg}\n`);
}

async function main() {
  dbg("main:enter");
  logger.info("Starting Jam Bot...");
  dbg("main:after-logger");

  try {
    dbg("main:before-ensurePlaybackOnHost");
    const host = await Promise.race([
      ensurePlaybackOnHost(),
      new Promise((_r, rej) =>
        setTimeout(() => rej(new Error("ensurePlaybackOnHost wall-clock timeout 20s")), 20_000),
      ),
    ]) as Awaited<ReturnType<typeof ensurePlaybackOnHost>>;
    dbg("main:after-ensurePlaybackOnHost");
    if (host) {
      logger.info(`Found host device "${host.name}"`);
    } else {
      logger.warn(
        `Host device "${config.SPOTIFY_DEVICE_NAME}" not visible to Spotify yet — make sure librespot is running and a Jam is active.`,
      );
    }
  } catch (err) {
    dbg(`main:ensurePlaybackOnHost-catch ${String(err)}`);
    logger.warn("Could not transfer playback at startup", {
      error: String(err),
    });
  }

  dbg("main:before-startSlackBot");
  await startSlackBot();
  dbg("main:after-startSlackBot");
  nowPlayingWatcher.start();
  dbg("main:after-nowPlayingWatcher");

  logger.info("Jam Bot is up.");
}

function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down`);
  nowPlayingWatcher.stop();
  stopWrappedScheduler();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  logger.error("Fatal error during startup", { error: String(err), stack: (err as Error)?.stack });
  process.exit(1);
});
