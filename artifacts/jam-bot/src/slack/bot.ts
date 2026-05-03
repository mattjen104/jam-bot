import { App, LogLevel } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  searchTrack,
  addToQueue,
  playNow,
  skipToNext,
  ensurePlaybackOnHost,
  getCurrentlyPlaying,
  findHostDevice,
} from "../spotify/client.js";
import {
  recordPendingRequest,
  recentPlayed,
  expireOldPending,
} from "../db.js";
import { askLLM, classifyIntent } from "../llm/openrouter.js";
import { nowPlayingWatcher } from "../now-playing.js";
import {
  historyBlocks,
  noDeviceBlocks,
  nowPlayingBlocks,
} from "./format.js";

export const slackApp = new App({
  token: config.SLACK_BOT_TOKEN,
  appToken: config.SLACK_APP_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
  socketMode: true,
  logLevel: LogLevel.WARN,
});

async function postToChannel(blocks: KnownBlock[], text: string) {
  await slackApp.client.chat.postMessage({
    channel: config.SLACK_CHANNEL_ID,
    text,
    blocks,
  });
}

async function postPlainToChannel(text: string) {
  await slackApp.client.chat.postMessage({
    channel: config.SLACK_CHANNEL_ID,
    text,
  });
}

async function handlePlayOrQueue(args: {
  query: string;
  slackUserId: string;
  asPlay: boolean;
  respond: (text: string) => Promise<void>;
}) {
  const { query, slackUserId, asPlay, respond } = args;
  const host = await ensurePlaybackOnHost();
  if (!host) {
    await respond(
      `:warning: No active Spotify device named \`${config.SPOTIFY_DEVICE_NAME}\`. Restart the Jam from your phone first.`,
    );
    return;
  }
  const track = await searchTrack(query);
  if (!track) {
    await respond(`:mag: Couldn't find anything for "${query}".`);
    return;
  }

  if (asPlay) {
    // Use the play endpoint with explicit URI so we always start *this* track,
    // rather than queueing and hoping skipToNext lands on it.
    await playNow(track.uri, host.id);
    recordPendingRequest(track.id, slackUserId, query);
    await respond(
      `:arrow_forward: Playing *${track.title}* by ${track.artist}`,
    );
  } else {
    await addToQueue(track.uri, host.id);
    recordPendingRequest(track.id, slackUserId, query);
    await respond(
      `:heavy_plus_sign: Queued *${track.title}* by ${track.artist}`,
    );
  }
}

async function handleSkip(respond: (text: string) => Promise<void>) {
  const host = await findHostDevice();
  if (!host) {
    await respond(
      `:warning: No active Spotify device named \`${config.SPOTIFY_DEVICE_NAME}\`.`,
    );
    return;
  }
  await skipToNext(host.id);
  await respond(":fast_forward: Skipped.");
}

async function handleNowPlaying(
  respond: (text: string, blocks?: KnownBlock[]) => Promise<void>,
) {
  const cp = await getCurrentlyPlaying();
  if (!cp.track) {
    await respond(":mute: Nothing is playing right now.");
    return;
  }
  await respond(
    `Now playing: ${cp.track.title} by ${cp.track.artist}`,
    nowPlayingBlocks(cp.track, null, null),
  );
}

async function handleHistory(
  respond: (text: string, blocks?: KnownBlock[]) => Promise<void>,
) {
  const rows = recentPlayed(15);
  await respond("Recent Jam history", historyBlocks(rows));
}

// ---- Slash commands ------------------------------------------------------

/**
 * Wraps a slash command handler with:
 * - channel authorization (must be invoked from SLACK_CHANNEL_ID)
 * - top-level try/catch so unexpected errors don't bubble to Bolt
 */
function slashHandler(
  fn: (args: {
    text: string;
    userId: string;
    say: (text: string, blocks?: KnownBlock[]) => Promise<void>;
  }) => Promise<void>,
) {
  return async ({ command, ack, respond }: Parameters<Parameters<typeof slackApp.command>[1]>[0]) => {
    await ack();
    if (command.channel_id !== config.SLACK_CHANNEL_ID) {
      await respond({
        response_type: "ephemeral",
        text: `:no_entry_sign: Jam Bot only accepts commands in the configured Jam channel.`,
      });
      return;
    }
    const say = async (text: string, blocks?: KnownBlock[]) => {
      await respond({ response_type: "in_channel", text, blocks });
    };
    try {
      await fn({ text: command.text.trim(), userId: command.user_id, say });
    } catch (err) {
      logger.error(`Slash command /${command.command} failed`, {
        error: String(err),
      });
      await respond({
        response_type: "ephemeral",
        text: ":warning: Something went wrong — check the bot logs.",
      });
    }
  };
}

slackApp.command(
  "/play",
  slashHandler(async ({ text, userId, say }) => {
    if (!text) {
      await say("Usage: `/play <song or artist>`");
      return;
    }
    await handlePlayOrQueue({
      query: text,
      slackUserId: userId,
      asPlay: true,
      respond: (t) => say(t),
    });
  }),
);

slackApp.command(
  "/queue",
  slashHandler(async ({ text, userId, say }) => {
    if (!text) {
      await say("Usage: `/queue <song or artist>`");
      return;
    }
    await handlePlayOrQueue({
      query: text,
      slackUserId: userId,
      asPlay: false,
      respond: (t) => say(t),
    });
  }),
);

slackApp.command(
  "/skip",
  slashHandler(async ({ say }) => {
    await handleSkip((t) => say(t));
  }),
);

slackApp.command(
  "/nowplaying",
  slashHandler(async ({ say }) => {
    await handleNowPlaying(say);
  }),
);

slackApp.command(
  "/history",
  slashHandler(async ({ say }) => {
    await handleHistory(say);
  }),
);

// ---- Channel message listener -------------------------------------------

let cachedBotUserId: string | null = null;

slackApp.message(async ({ message, say }) => {
  if (message.subtype) return;
  if (!("user" in message) || !message.user) return;
  if (!("channel" in message) || message.channel !== config.SLACK_CHANNEL_ID)
    return;
  if (!("text" in message) || !message.text) return;

  if (cachedBotUserId && message.user === cachedBotUserId) return;

  const text = message.text.trim();
  if (!text) return;

  let intent;
  try {
    intent = await classifyIntent(text);
  } catch (err) {
    logger.warn("Intent classification threw", { error: String(err) });
    return;
  }

  const respond = async (t: string, blocks?: KnownBlock[]) => {
    await say({ text: t, blocks, thread_ts: message.ts });
  };

  try {
    switch (intent.intent) {
      case "play":
        if (intent.query) {
          await handlePlayOrQueue({
            query: intent.query,
            slackUserId: message.user,
            asPlay: true,
            respond: (t) => respond(t),
          });
        } else {
          await respond(
            ":thinking_face: I caught that you want to play something but couldn't tell what. Try `play <song or artist>`.",
          );
        }
        return;
      case "queue":
        if (intent.query) {
          await handlePlayOrQueue({
            query: intent.query,
            slackUserId: message.user,
            asPlay: false,
            respond: (t) => respond(t),
          });
        } else {
          await respond(
            ":thinking_face: I caught that you want to queue something but couldn't tell what. Try `queue <song or artist>`.",
          );
        }
        return;
      case "skip":
        await handleSkip((t) => respond(t));
        return;
      case "nowplaying":
        await handleNowPlaying(respond);
        return;
      case "history":
        await handleHistory(respond);
        return;
      case "question": {
        const answer = await askLLM(text);
        await respond(answer);
        return;
      }
    }
  } catch (err) {
    logger.error("Message handler failed", { error: String(err) });
    await respond(
      ":warning: Something went wrong handling that — check the bot logs.",
    );
  }
});

// ---- Wire up now-playing watcher ---------------------------------------

nowPlayingWatcher.on("trackChange", async (event) => {
  try {
    await postToChannel(
      nowPlayingBlocks(
        event.current,
        event.requestedBySlackUser,
        event.requestedQuery,
      ),
      `Now playing: ${event.current.title} by ${event.current.artist}`,
    );
  } catch (err) {
    logger.error("Failed to post now-playing", { error: String(err) });
  }
});

nowPlayingWatcher.on("noActiveDevice", async () => {
  logger.info("No active Spotify device detected");
  try {
    await postToChannel(
      noDeviceBlocks(config.SPOTIFY_DEVICE_NAME),
      "No active Spotify device.",
    );
  } catch (err) {
    logger.error("Failed to post no-device notice", { error: String(err) });
  }
});

nowPlayingWatcher.on("resumed", async () => {
  logger.info("Playback resumed");
  try {
    await postPlainToChannel(":white_check_mark: Jam is back online.");
  } catch (err) {
    logger.error("Failed to post resumed notice", { error: String(err) });
  }
});

setInterval(() => expireOldPending(), 10 * 60 * 1000);

export async function startSlackBot() {
  await slackApp.start();
  try {
    const auth = await slackApp.client.auth.test();
    cachedBotUserId = auth.user_id ?? null;
  } catch (err) {
    logger.warn("Could not cache bot user id at startup", {
      error: String(err),
    });
  }
  logger.info(`Slack bot connected (channel ${config.SLACK_CHANNEL_ID})`);
}
