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
  setOptOut,
  isOptedOut,
} from "../db.js";
import { askLLM, classifyIntent, narrate } from "../llm/openrouter.js";
import { nowPlayingWatcher } from "../now-playing.js";
import {
  historyBlocks,
  noDeviceBlocks,
  nowPlayingBlocks,
  wrappedBlocks,
  dnaBlocks,
  compatBlocks,
  VOTE_SKIP_ACTION_ID,
} from "./format.js";
import { buildWrappedStats, WrappedScheduler, type WrappedStats } from "../wrapped.js";
import { buildDnaStats, buildCompatStats } from "../dna.js";
import { askLLMForSet, isMemoryPlaybackRequest } from "../memory.js";
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

// ---- Jam Memory slash commands ------------------------------------------

export function statsAsFacts(stats: WrappedStats): string {
  const lines: string[] = [];
  lines.push(`Window: ${stats.startStr} -> ${stats.endStr} UTC`);
  lines.push(`Total plays: ${stats.totalPlays}`);
  lines.push(
    `Late-night (22-06 UTC) plays: ${stats.lateNightPlays}, daytime: ${stats.daytimePlays}`,
  );
  if (stats.topTracks.length) {
    lines.push("Top tracks:");
    stats.topTracks.forEach((t, i) =>
      lines.push(`  ${i + 1}. "${t.title}" by ${t.artist} (${t.plays} plays)`),
    );
  }
  if (stats.topArtists.length) {
    lines.push(
      `Top artists: ${stats.topArtists.map((a) => `${a.artist} (${a.plays})`).join(", ")}`,
    );
  }
  // Strict opt-out: filter opted-out users out completely BEFORE we hand the
  // facts block to the LLM. Anything we put here can end up in the public
  // narration the bot posts to the channel, so we can't even include
  // "opted out of stats" placeholders — that itself leaks identity.
  const visiblePerUser = stats.perUser.filter((u) => !u.optedOut);
  if (visiblePerUser.length) {
    lines.push("Per person:");
    visiblePerUser.forEach((u) => {
      const bits = [
        `${u.plays} plays`,
        u.topArtist ? `top artist ${u.topArtist}` : null,
        u.topTrack ? `top track "${u.topTrack}"` : null,
        u.discoveries > 0 ? `${u.discoveries} discoveries` : null,
      ].filter(Boolean);
      lines.push(`  <@${u.slackUser}>: ${bits.join(", ")}`);
    });
  }
  return lines.join("\n");
}

async function postWrappedToChannel() {
  const stats = buildWrappedStats();
  if (stats.totalPlays === 0) {
    await postPlainToChannel(
      `:notes: Jam Wrapped: nothing played in the last ${config.JAM_WRAPPED_LOOKBACK_DAYS} days. Queue something up!`,
    );
    return;
  }
  let narration: string;
  try {
    narration = await narrate("wrapped", statsAsFacts(stats));
  } catch (err) {
    logger.warn("Wrapped narration failed; falling back to plain", {
      error: String(err),
    });
    narration = "Here's how the Jam went this week.";
  }
  await postToChannel(wrappedBlocks(stats, narration), "Jam Wrapped");
}

slackApp.command(
  "/wrapped",
  slashHandler(async ({ say }) => {
    const stats = buildWrappedStats();
    if (stats.totalPlays === 0) {
      await say(
        `:notes: Nothing has played in the last ${config.JAM_WRAPPED_LOOKBACK_DAYS} days yet — queue something up!`,
      );
      return;
    }
    let narration: string;
    try {
      narration = await narrate("wrapped", statsAsFacts(stats));
    } catch {
      narration = "Here's how the Jam went this week.";
    }
    await say("Jam Wrapped", wrappedBlocks(stats, narration));
  }),
);

// Slack passes user mentions as "<@U123|name>" in command.text.
function parseUserMention(text: string): string | null {
  const m = text.trim().match(/^<@([A-Z0-9]+)(?:\|[^>]*)?>$/);
  return m ? m[1]! : null;
}
function parseTwoUserMentions(text: string): [string, string] | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const a = parseUserMention(parts[0]!);
  const b = parseUserMention(parts[1]!);
  return a && b ? [a, b] : null;
}

slackApp.command(
  "/dna",
  slashHandler(async ({ text, userId, say }) => {
    const target = text ? parseUserMention(text) : userId;
    if (text && !target) {
      await say("Usage: `/dna` (yourself) or `/dna @user`");
      return;
    }
    const subject = target!;
    // Strict opt-out: even self-view is suppressed. Otherwise an opted-out
    // user could still produce LLM narration about themselves and have a
    // teammate read it over their shoulder, which defeats the point.
    if (isOptedOut(subject)) {
      const who =
        subject === userId
          ? "You've opted out of personal stats. Use `/jamoptout off` to re-enable."
          : `<@${subject}> has opted out of personal stats.`;
      await say(`:lock: ${who}`);
      return;
    }
    const stats = buildDnaStats(subject);
    let narration: string;
    try {
      const facts =
        `User: <@${subject}>\nTotal plays: ${stats.totalPlays}\n` +
        `Discovery rate: ${Math.round(stats.discoveryRate * 100)}% (${stats.discoveryCount} introduced)\n` +
        `Top artists: ${stats.topArtists.map((a) => `${a.artist} (${a.plays})`).join(", ") || "none"}`;
      narration = await narrate("dna", facts);
    } catch {
      narration = "Solid taste, hard to summarize in one line.";
    }
    await say("Taste DNA", dnaBlocks(stats, narration));
  }),
);

slackApp.command(
  "/compat",
  slashHandler(async ({ text, say }) => {
    const pair = parseTwoUserMentions(text);
    if (!pair) {
      await say("Usage: `/compat @userA @userB`");
      return;
    }
    const [a, b] = pair;
    if (a === b) {
      await say(":upside_down_face: A user is 100% compatible with themselves.");
      return;
    }
    if (isOptedOut(a) || isOptedOut(b)) {
      await say(":lock: One of those users has opted out of personal stats.");
      return;
    }
    const stats = buildCompatStats(a, b);
    let narration: string;
    try {
      const facts =
        `Users: <@${a}> vs <@${b}>\nScore: ${stats.score}/100\n` +
        `Shared artists: ${stats.sharedArtists.join(", ") || "none"}\n` +
        `Shared tracks: ${stats.sharedTracks}\n` +
        `Total plays — A: ${stats.totalA}, B: ${stats.totalB}\n` +
        (stats.recommendForA[0]
          ? `Reco for <@${a}>: ${stats.recommendForA[0].title} by ${stats.recommendForA[0].artist}\n`
          : "") +
        (stats.recommendForB[0]
          ? `Reco for <@${b}>: ${stats.recommendForB[0].title} by ${stats.recommendForB[0].artist}\n`
          : "");
      narration = await narrate("compat", facts);
    } catch {
      narration = "Two distinct musical worlds — there's room for crossover.";
    }
    await say("Taste compatibility", compatBlocks(stats, narration));
  }),
);

slackApp.command(
  "/memory",
  slashHandler(async ({ text, userId, say }) => {
    if (!text) {
      await say(
        "Usage: `/memory <question>` — e.g. `/memory who introduced us to Khruangbin?` or `/memory play me a 5-track set from last weekend`",
      );
      return;
    }
    if (isMemoryPlaybackRequest(text)) {
      // Per-user rate limit applies here too — this can queue many tracks.
      const used = countUserRequestsLastHour(userId);
      if (used >= config.MAX_PLAYS_PER_USER_PER_HOUR) {
        await say(
          `:hourglass_flowing_sand: You've hit your hourly play budget (${used}/${config.MAX_PLAYS_PER_USER_PER_HOUR}). Try again later.`,
        );
        return;
      }
      const host = await ensurePlaybackOnHost();
      if (!host) {
        await say(
          `:warning: No active Spotify device named \`${config.SPOTIFY_DEVICE_NAME}\`. Restart the Jam from your phone first.`,
        );
        return;
      }
      const set = await askLLMForSet(text);
      if (!set.trackIds.length) {
        await say(`:thinking_face: ${set.summary}`);
        return;
      }
      let queued = 0;
      let firstPlayed: string | null = null;
      let aborted = false;
      let abortErr: unknown = null;
      for (const id of set.trackIds) {
        const uri = `spotify:track:${id}`;
        try {
          if (queued === 0) {
            await playNow(uri, host.id);
            firstPlayed = uri;
          } else {
            await addToQueue(uri, host.id);
          }
          recordPendingRequest(id, userId, `memory: ${text}`);
          queued++;
        } catch (err) {
          // First failure aborts the loop. If the host device just
          // disappeared (the common cause), every subsequent
          // playNow/addToQueue would fail the same way and produce a wall
          // of warnings. One log + one user-facing message is enough.
          logger.warn("Memory queue: aborting after enqueue failure", {
            id,
            queuedSoFar: queued,
            error: String(err),
          });
          aborted = true;
          abortErr = err;
          break;
        }
      }
      if (queued > 0) recordUserRequest(userId);
      if (aborted) {
        const status = (abortErr as { statusCode?: number })?.statusCode;
        const deviceGone = status === 404;
        const reason = deviceGone
          ? `Spotify device \`${config.SPOTIFY_DEVICE_NAME}\` is no longer reachable. Restart the Jam from your phone and try again.`
          : "Spotify rejected the request — try again in a moment.";
        await say(
          queued > 0
            ? `:notes: ${set.summary} — started ${queued} of ${set.trackIds.length} tracks, then stopped: ${reason}`
            : `:warning: Couldn't queue any tracks — ${reason}`,
        );
        return;
      }
      await say(
        `:notes: ${set.summary} — ${firstPlayed ? "now playing the first" : "queued"} ${queued} of ${set.trackIds.length} tracks.`,
      );
      return;
    }
    const answer = await askLLM(text);
    await say(answer);
  }),
);

slackApp.command(
  "/jamoptout",
  slashHandler(async ({ text, userId, say, sayEphemeral }) => {
    const arg = text.trim().toLowerCase();
    if (arg === "off" || arg === "false" || arg === "0") {
      setOptOut(userId, false);
      await sayEphemeral(
        ":unlock: You're back in personal Wrapped/DNA/Compat stats.",
      );
      return;
    }
    setOptOut(userId, true);
    await sayEphemeral(
      ":lock: You're now opted out of personal Wrapped/DNA/Compat stats. Run `/jamoptout off` to undo.",
    );
  }),
);

// Scheduler — posts the auto Wrapped recap on the configured cadence.
// The 2nd arg surfaces a short, rate-limited notice in-channel when the
// scheduled fire fails, so a broken weekly post isn't silently invisible.
const wrappedScheduler = new WrappedScheduler(
  postWrappedToChannel,
  async (err) => {
    try {
      await postPlainToChannel(
        ":warning: Couldn't post this week's Wrapped — check logs.",
      );
    } catch (postErr) {
      logger.error("Failed to post Wrapped failure notice", {
        originalError: String(err),
        error: String(postErr),
      });
    }
  },
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

  // Require an explicit @mention of the bot, so we don't try to interpret
  // every message in the channel (which led to the bot answering questions
  // that humans were asking each other). Strip the mention before passing
  // the rest to the intent classifier.
  if (!cachedBotUserId) return;
  const mentionTag = `<@${cachedBotUserId}>`;
  const rawText = message.text;
  if (!rawText.includes(mentionTag)) return;
  const text = rawText.split(mentionTag).join(" ").replace(/\s+/g, " ").trim();
  if (!text) {
    await say({
      text: "Hi! Try `play <song>`, `queue <song>`, `skip`, `what's playing?`, or ask me a question about Jam history. Slash commands like `/play` and `/nowplaying` also work.",
      thread_ts: message.ts,
    });
    return;
  }

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
  wrappedScheduler.start();
  logger.info(`Slack bot connected (channel ${config.SLACK_CHANNEL_ID})`);
}

export function stopWrappedScheduler() {
  wrappedScheduler.stop();
}
