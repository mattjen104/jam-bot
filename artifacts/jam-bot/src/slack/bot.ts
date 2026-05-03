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
  recordUserRequest,
  countUserRequestsLastHour,
  expireOldUserRequests,
} from "../db.js";
import { askLLM, classifyIntent } from "../llm/openrouter.js";
import { nowPlayingWatcher } from "../now-playing.js";
import {
  historyBlocks,
  noDeviceBlocks,
  nowPlayingBlocks,
  VOTE_SKIP_ACTION_ID,
} from "./format.js";
import type { CurrentlyPlaying } from "../spotify/client.js";

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
  respondEphemeral?: (text: string) => Promise<void>;
}) {
  const { query, slackUserId, asPlay, respond, respondEphemeral } = args;

  // Per-user rate limit: only `/play` (asPlay) counts against the budget,
  // since that's what overrides what's currently playing. Queueing is fine.
  if (asPlay) {
    const used = countUserRequestsLastHour(slackUserId);
    if (used >= config.MAX_PLAYS_PER_USER_PER_HOUR) {
      const msg =
        `:hourglass_flowing_sand: You've used ${used}/${config.MAX_PLAYS_PER_USER_PER_HOUR} ` +
        `\`/play\` requests in the last hour — give the Jam a breather and try again later. ` +
        `(You can still \`/queue\` tracks.)`;
      await (respondEphemeral ?? respond)(msg);
      return;
    }
  }

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
    recordUserRequest(slackUserId);
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

async function handleSkip(
  userId: string,
  respond: (text: string) => Promise<void>,
) {
  const result = await castSkipVote(userId);
  switch (result.kind) {
    case "no_playback":
      await respond(":mute: Nothing is playing to skip.");
      return;
    case "duplicate":
      await respond(
        `:ok_hand: You've already voted to skip this track (${result.count}/${result.threshold}).`,
      );
      return;
    case "counted":
      await respond(
        `:ballot_box_with_ballot: Skip vote registered (${result.count}/${result.threshold}). ` +
          `Need ${result.threshold - result.count} more.`,
      );
      return;
    case "skipped":
      await respond(
        `:fast_forward: Vote-skip passed (${result.count}/${result.threshold}) — skipping *${result.trackTitle}*.`,
      );
      return;
    case "skip_failed":
      await respond(
        `:warning: Vote-skip passed (${result.count}/${result.threshold}) but the skip failed: ${result.reason}.`,
      );
      return;
  }
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
    sayEphemeral: (text: string) => Promise<void>;
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
    const sayEphemeral = async (text: string) => {
      await respond({ response_type: "ephemeral", text });
    };
    try {
      await fn({ text: command.text.trim(), userId: command.user_id, say, sayEphemeral });
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
  slashHandler(async ({ text, userId, say, sayEphemeral }) => {
    if (!text) {
      await say("Usage: `/play <song or artist>`");
      return;
    }
    await handlePlayOrQueue({
      query: text,
      slackUserId: userId,
      asPlay: true,
      respond: (t) => say(t),
      respondEphemeral: (t) => sayEphemeral(t),
    });
  }),
);

slackApp.command(
  "/queue",
  slashHandler(async ({ text, userId, say, sayEphemeral }) => {
    if (!text) {
      await say("Usage: `/queue <song or artist>`");
      return;
    }
    await handlePlayOrQueue({
      query: text,
      slackUserId: userId,
      asPlay: false,
      respond: (t) => say(t),
      respondEphemeral: (t) => sayEphemeral(t),
    });
  }),
);

slackApp.command(
  "/skip",
  slashHandler(async ({ userId, say }) => {
    await handleSkip(userId, (t) => say(t));
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

  const respond = async (t: string, blocks?: KnownBlock[]) => {
    await say({ text: t, blocks, thread_ts: message.ts });
  };

  let intent;
  try {
    intent = await classifyIntent(text);
  } catch (err) {
    logger.warn("Intent classification threw", { error: String(err) });
    await respond(
      ":warning: I couldn't parse that just now — try again, or use a slash command like `/play`, `/skip`, or `/nowplaying`.",
    );
    return;
  }

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
        await handleSkip(message.user, (t) => respond(t));
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

// ---- Vote-to-skip --------------------------------------------------------

interface VoteState {
  trackId: string;
  // userId -> unix ms timestamp of the vote. Pruned to SKIP_VOTE_WINDOW_SECONDS
  // before every tally so a stale vote can't trigger a skip on its own.
  votes: Map<string, number>;
  channel: string;
  messageTs: string;
  current: NonNullable<CurrentlyPlaying["track"]>;
  requestedBy: string | null;
  requestedQuery: string | null;
  skipped: boolean;
}

function pruneVotes(state: VoteState): number {
  const cutoff = Date.now() - config.SKIP_VOTE_WINDOW_SECONDS * 1000;
  for (const [userId, ts] of state.votes) {
    if (ts < cutoff) state.votes.delete(userId);
  }
  return state.votes.size;
}

// Only one Now Playing card is "live" for voting at a time — the most recent
// one we posted. Votes from older cards are ignored (the track has moved on).
let activeVote: VoteState | null = null;

type SkipVoteResult =
  | { kind: "no_playback" }
  | { kind: "stale" }
  | { kind: "duplicate"; count: number; threshold: number }
  | { kind: "counted"; count: number; threshold: number }
  | { kind: "skipped"; count: number; threshold: number; trackTitle: string }
  | { kind: "skip_failed"; count: number; threshold: number; reason: string };

async function refreshNowPlayingCard(state: VoteState, count: number, threshold: number) {
  if (!state.messageTs || !state.channel) return;
  try {
    await slackApp.client.chat.update({
      channel: state.channel,
      ts: state.messageTs,
      text: `Now playing: ${state.current.title} by ${state.current.artist}`,
      blocks: nowPlayingBlocks(
        state.current,
        state.requestedBy,
        state.requestedQuery,
        { count, threshold },
      ),
    });
  } catch (err) {
    logger.warn("Failed to update now-playing card", { error: String(err) });
  }
}

/**
 * Cast a skip vote on behalf of `userId`. Used by both the now-playing
 * button and the `/skip` slash command (and the natural-language "skip"
 * intent), so a single user can never bypass the vote gate.
 *
 * If `expectedTrackId` is given, the vote is rejected when it doesn't match
 * the current track (covers stale button clicks on old cards).
 *
 * If no card-backed vote state exists yet for the current track (e.g. the
 * bot just started, or someone /skip'd before any trackChange fired), a
 * lazy state is created so the vote still counts toward the threshold.
 */
async function castSkipVote(
  userId: string,
  expectedTrackId?: string,
): Promise<SkipVoteResult> {
  const threshold = config.SKIP_VOTE_THRESHOLD;

  // Stale button click on an old card.
  if (expectedTrackId && activeVote && activeVote.trackId !== expectedTrackId) {
    return { kind: "stale" };
  }
  if (expectedTrackId && activeVote?.skipped) {
    return { kind: "stale" };
  }

  let state = activeVote;

  // For non-button paths (`/skip`, NL "skip"), or when state is stale,
  // reconcile with what Spotify says is actually playing right now. This
  // closes a race where the now-playing watcher hasn't yet observed the
  // track change and the user's vote would otherwise be applied to the
  // wrong (stale) track.
  const needsReconcile = !state || state.skipped || !expectedTrackId;
  if (needsReconcile) {
    const cp = await getCurrentlyPlaying().catch(() => null);
    if (!cp?.track) return { kind: "no_playback" };
    if (expectedTrackId && cp.track.id !== expectedTrackId) {
      return { kind: "stale" };
    }
    if (!state || state.skipped || state.trackId !== cp.track.id) {
      state = {
        trackId: cp.track.id,
        votes: new Map(),
        channel: "",
        messageTs: "",
        current: cp.track,
        requestedBy: null,
        requestedQuery: null,
        skipped: false,
      };
      activeVote = state;
    }
  }
  // state is non-null here.
  state = state!;

  // Drop expired votes before counting this one.
  pruneVotes(state);

  if (state.votes.has(userId)) {
    return { kind: "duplicate", count: state.votes.size, threshold };
  }
  state.votes.set(userId, Date.now());
  const count = state.votes.size;

  if (count < threshold) {
    await refreshNowPlayingCard(state, count, threshold);
    return { kind: "counted", count, threshold };
  }

  // Threshold reached — try the actual skip. Only mark `skipped` after the
  // Spotify call succeeds, so a transient failure doesn't dead-end the vote.
  const host = await findHostDevice().catch(() => null);
  if (!host) {
    return {
      kind: "skip_failed",
      count,
      threshold,
      reason: `no active device named \`${config.SPOTIFY_DEVICE_NAME}\``,
    };
  }
  try {
    await skipToNext(host.id);
  } catch (err) {
    logger.error("Vote-skip skipToNext failed", { error: String(err) });
    return {
      kind: "skip_failed",
      count,
      threshold,
      reason: "Spotify rejected the skip",
    };
  }
  state.skipped = true;
  await refreshNowPlayingCard(state, count, threshold);
  return {
    kind: "skipped",
    count,
    threshold,
    trackTitle: state.current.title,
  };
}

slackApp.action(VOTE_SKIP_ACTION_ID, async ({ ack, body, action, respond }) => {
  await ack();
  try {
    const userId = body.user?.id;
    const votedTrackId = "value" in action ? action.value : undefined;
    if (!userId || !votedTrackId) return;

    const result = await castSkipVote(userId, votedTrackId);
    switch (result.kind) {
      case "no_playback":
        await respond({
          response_type: "ephemeral",
          replace_original: false,
          text: ":mute: Nothing is playing to skip.",
        });
        return;
      case "stale":
        await respond({
          response_type: "ephemeral",
          replace_original: false,
          text: ":information_source: That track has already moved on — vote no longer applies.",
        });
        return;
      case "duplicate":
        await respond({
          response_type: "ephemeral",
          replace_original: false,
          text: `:ok_hand: You've already voted to skip this track (${result.count}/${result.threshold}).`,
        });
        return;
      case "counted":
        // Card was updated; nothing else to say.
        return;
      case "skipped":
        await postPlainToChannel(
          `:fast_forward: Vote-skip passed (${result.count}/${result.threshold}) — skipping *${result.trackTitle}*.`,
        );
        return;
      case "skip_failed":
        await postPlainToChannel(
          `:warning: Vote-skip passed (${result.count}/${result.threshold}) but the skip failed: ${result.reason}.`,
        );
        return;
    }
  } catch (err) {
    logger.error("Vote-skip action handler failed", { error: String(err) });
  }
});

// ---- Wire up now-playing watcher ---------------------------------------

nowPlayingWatcher.on("trackChange", async (event) => {
  // Reset votes — any prior card is now stale.
  activeVote = null;
  try {
    const blocks = nowPlayingBlocks(
      event.current,
      event.requestedBySlackUser,
      event.requestedQuery,
      { count: 0, threshold: config.SKIP_VOTE_THRESHOLD },
    );
    const res = await slackApp.client.chat.postMessage({
      channel: config.SLACK_CHANNEL_ID,
      text: `Now playing: ${event.current.title} by ${event.current.artist}`,
      blocks,
    });
    if (res.ts && res.channel) {
      activeVote = {
        trackId: event.current.id,
        votes: new Map(),
        channel: res.channel,
        messageTs: res.ts,
        current: event.current,
        requestedBy: event.requestedBySlackUser,
        requestedQuery: event.requestedQuery,
        skipped: false,
      };
    }
  } catch (err) {
    logger.error("Failed to post now-playing", { error: String(err) });
  }
});

nowPlayingWatcher.on("noActiveDevice", async (info?: { hostVisible?: boolean }) => {
  logger.info("No active Spotify playback detected", {
    hostVisible: info?.hostVisible ?? false,
  });
  try {
    await postToChannel(
      noDeviceBlocks(config.SPOTIFY_DEVICE_NAME, info?.hostVisible ?? false),
      "No active Spotify playback.",
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

setInterval(() => {
  expireOldPending();
  expireOldUserRequests();
}, 10 * 60 * 1000);

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
