import { logger } from "./logger.js";
import { findActiveDevice } from "./spotify/client.js";
import { startSlackBot, stopWrappedScheduler } from "./slack/bot.js";
import { nowPlayingWatcher } from "./now-playing.js";
import {
  startTurntableIngestServer,
  stopTurntableIngestServer,
} from "./turntable/ingest-server.js";

function dbg(msg: string) {
  process.stdout.write(`[DBG ${new Date().toISOString()}] ${msg}\n`);
}

async function main() {
  dbg("main:enter");
  logger.info("Starting Jam Bot...");
  dbg("main:after-logger");

  try {
    dbg("main:before-findActiveDevice");
    const device = await Promise.race([
      findActiveDevice(),
      new Promise((_r, rej) =>
        setTimeout(() => rej(new Error("findActiveDevice wall-clock timeout 20s")), 20_000),
      ),
    ]) as Awaited<ReturnType<typeof findActiveDevice>>;
    dbg("main:after-findActiveDevice");
    if (device) {
      logger.info(`Active Spotify device: "${device.name}"`);
    } else {
      logger.info(
        "No active Spotify device yet — open Spotify and start playing something to enable playback.",
      );
    }
  } catch (err) {
    dbg(`main:findActiveDevice-catch ${String(err)}`);
    logger.warn("Could not look up active device at startup", {
      error: String(err),
    });
  }

  dbg("main:before-startSlackBot");
  await startSlackBot();
  dbg("main:after-startSlackBot");
  nowPlayingWatcher.start();
  dbg("main:after-nowPlayingWatcher");
  startTurntableIngestServer();
  dbg("main:after-turntableIngest");

  logger.info("Jam Bot is up.");
}

function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down`);
  nowPlayingWatcher.stop();
  stopWrappedScheduler();
  stopTurntableIngestServer();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  logger.error("Fatal error during startup", { error: String(err), stack: (err as Error)?.stack });
  process.exit(1);
});
