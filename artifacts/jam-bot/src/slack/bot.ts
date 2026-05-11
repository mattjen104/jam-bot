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
import { startSpotifyJam, manualJamInstructions } from "../spotify/jam.js";
import { nowPlayingWatcher } from "../now-playing.js";
import {
  historyBlocks,
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

// ---- Quiet (test) mode ---------------------------------------------------
// While quiet mode is on, only the *automated background* posts the bot
// makes on its own (now-playing card, "no active device" notice, "Jam is
// back online", scheduled Wrapped) get rerouted to a private DM to
// JAM_QUIET_DM_USER. Friend interactions are unaffected: slash command
// replies, @mention answers, and vote-skip outcomes still post to the
// channel normally, so other people in the Jam still get the responses
// they asked for.
//
// Toggle from Slack with `/quiet`, `/quiet on`, `/quiet off`, `/quiet status`.
// Resets to OFF on bot restart — intentional, so a forgotten test mode
// doesn't silently swallow real Wrapped/now-playing posts forever.
let silentMode = false;
export function isSilent(): boolean {
  return silentMode;
}
export function setSilent(on: boolean): void {
  silentMode = on;
  logger.info("Quiet mode toggled", { silent: silentMode });
  // Drop any in-flight vote-card reference. The card we'd update is now
  // either nonexistent (background DM'd) or stale; a fresh card will be
  // set up on the next trackChange.
  if (on) activeVote = null;
}

// Plain channel posters — used by interactive paths (vote-skip pass
// announcements, etc). These are NOT gated by quiet mode because they're
// reactions to friend actions, not background noise.
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

/**
 * Send a DM to a user. Slack auto-resolves a user ID passed as `channel`
 * into the IM channel between the bot and that user.
 */
async function postDMToUser(
  userId: string,
  text: string,
  blocks?: KnownBlock[],
) {
  try {
    await slackApp.client.chat.postMessage({
      channel: userId,
      text,
      blocks,
    });
  } catch (err) {
    logger.warn("postDM failed", { error: String(err), userId });
  }
}

/**
 * Background channel poster — used by automated events (now-playing,
 * device-gone, Jam-back, scheduled Wrapped). When quiet mode is on, the
 * post is rerouted as a DM to JAM_QUIET_DM_USER instead of going to the
 * channel, so friends in the Jam aren't notified by every track change
 * while you're testing. If quiet mode is on but no DM target is
 * configured, the post is dropped + logged (rather than leaking to the
 * channel).
 */
async function postBackgroundToChannel(
  blocks: KnownBlock[] | undefined,
  text: string,
  context: string,
) {
  if (silentMode) {
    if (config.JAM_QUIET_DM_USER) {
      await postDMToUser(config.JAM_QUIET_DM_USER, text, blocks);
    } else {
      logger.info("Suppressed background post (quiet mode, no DM target)", {
        context,
        text,
      });
    }
    return;
  }
  await slackApp.client.chat.postMessage({
    channel: config.SLACK_CHANNEL_ID,
    text,
    ...(blocks ? { blocks } : {}),
  });
}

/**
 * Day-of-week gate for the "Now playing" card. Friends only get pinged
 * with track-change cards on the days listed in JAM_NOWPLAYING_DAYS
 * (UTC). Tracks still play and get logged on every day — only the Slack
 * post is suppressed.
 */
function isNowPlayingPostAllowedToday(now: Date = new Date()): boolean {
  const allowed = new Set(
    config.JAM_NOWPLAYING_DAYS
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  );
  if (allowed.size === 0) return true; // misconfigured -> fail-open
  return allowed.has(now.getUTCDay());
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
    // Allow either: (a) the configured Jam channel, or (b) a DM with the
    // bot, but only if the DM is from the configured host (JAM_QUIET_DM_USER).
    // DMs are intended as a host-only test surface — they execute the same
    // real Spotify operations as channel commands, so we don't want random
    // workspace members poking at the bot in private.
    const isDm = command.channel_id.startsWith("D");
    const isJamChannel = command.channel_id === config.SLACK_CHANNEL_ID;
    const isHostDm =
      isDm &&
      !!config.JAM_QUIET_DM_USER &&
      command.user_id === config.JAM_QUIET_DM_USER;
    if (!isJamChannel && !isHostDm) {
      await respond({
        response_type: "ephemeral",
        text: isDm
          ? `:no_entry_sign: DM commands are only enabled for the configured host. Set \`JAM_QUIET_DM_USER\` in the bot's .env to your Slack user ID to enable testing in DMs.`
          : `:no_entry_sign: Jam Bot only accepts commands in the configured Jam channel.`,
      });
      return;
    }
    // Slash command replies always post to the channel — quiet mode does
    // NOT touch friend interactions. If a friend runs /play during a test,
    // they (and the channel) still see the normal "Playing X" reply. In a
    // DM the response_type is moot (it's a 1:1 channel), so the same
    // in_channel reply just lands in the DM.
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
    await postBackgroundToChannel(
      undefined,
      `:notes: Jam Wrapped: nothing played in the last ${config.JAM_WRAPPED_LOOKBACK_DAYS} days. Queue something up!`,
      "wrapped-empty",
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
  await postBackgroundToChannel(
    wrappedBlocks(stats, narration),
    "Jam Wrapped",
    "wrapped",
  );
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
  "/quiet",
  slashHandler(async ({ text, sayEphemeral }) => {
    const arg = text.trim().toLowerCase();
    if (arg === "status" || arg === "?") {
      await sayEphemeral(
        silentMode
          ? ":mute: Quiet mode is *on* — automated background posts are DM'd to the host instead of the channel."
          : ":loud_sound: Quiet mode is *off* — automated background posts go to the channel.",
      );
      return;
    }
    let next: boolean;
    if (arg === "on" || arg === "true" || arg === "1") next = true;
    else if (arg === "off" || arg === "false" || arg === "0") next = false;
    else next = !silentMode; // bare `/quiet` toggles
    setSilent(next);
    const target = config.JAM_QUIET_DM_USER
      ? `<@${config.JAM_QUIET_DM_USER}>`
      : "(no DM target set — posts will be dropped instead)";
    await sayEphemeral(
      next
        ? `:mute: Quiet mode *on*. Now-playing cards, "no device" / "back online" notices, and the scheduled Wrapped will DM ${target} instead of posting in the channel. Friend interactions (slash commands, @mentions, vote-skip) still post normally.`
        : ":loud_sound: Quiet mode *off*. Automated background posts will go to the channel again.",
    );
  }),
);

slackApp.command(
  "/jam",
  slashHandler(async ({ say }) => {
    const result = await startSpotifyJam();
    if (result.ok) {
      await say(
        result.existed
          ? `:notes: A Spotify Jam is already active — join here: ${result.joinUrl}`
          : `:notes: Started a Spotify Jam — join here: ${result.joinUrl}`,
      );
      return;
    }
    logger.info("Jam start fell back to manual instructions", {
      reason: result.reason,
    });
    await say(manualJamInstructions());
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
      await postBackgroundToChannel(
        undefined,
        ":warning: Couldn't post this week's Wrapped — check logs.",
        "wrapped-error",
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

/**
 * Shared NL handler used by both `app_mention` (in the Jam channel) and
 * direct messages from the host. Takes already-stripped text and a
 * `respond` callback that knows where to post the reply.
 */
async function handleNaturalLanguage(
  text: string,
  userId: string,
  respond: (t: string, blocks?: KnownBlock[]) => Promise<void>,
) {
  if (!text) {
    await respond(
      "Hi! Try `play <song>`, `queue <song>`, `skip`, `what's playing?`, `start a jam`, or ask me a question about Jam history. Slash commands like `/play` and `/nowplaying` also work.",
    );
    return;
  }

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
            slackUserId: userId,
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
            slackUserId: userId,
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
        await handleSkip(userId, (t) => respond(t));
        return;
      case "nowplaying":
        await handleNowPlaying(respond);
        return;
      case "history":
        await handleHistory(respond);
        return;
      case "jam": {
        const result = await startSpotifyJam();
        if (result.ok) {
          await respond(
            result.existed
              ? `:notes: A Spotify Jam is already active — join here: ${result.joinUrl}`
              : `:notes: Started a Spotify Jam — join here: ${result.joinUrl}`,
          );
        } else {
          logger.info("NL Jam start fell back to manual instructions", {
            reason: result.reason,
          });
          await respond(manualJamInstructions());
        }
        return;
      }
      case "question": {
        const answer = await askLLM(text);
        await respond(answer);
        return;
      }
    }
  } catch (err) {
    logger.error("NL handler failed", { error: String(err) });
    await respond(
      ":warning: Something went wrong handling that — check the bot logs.",
    );
  }
}

// We use the `app_mention` event (not `message.channels`) so this only
// fires when the bot is explicitly @-mentioned, and so it works even when
// the Slack workspace hasn't granted the channels:history scope.
slackApp.event("app_mention", async ({ event, say }) => {
  logger.info("app_mention received", {
    user: event.user,
    channel: event.channel,
    text: event.text,
  });

  if (event.channel !== config.SLACK_CHANNEL_ID) {
    logger.info("Ignoring app_mention from non-Jam channel", {
      channel: event.channel,
    });
    return;
  }
  if (!event.user) return;
  if (cachedBotUserId && event.user === cachedBotUserId) return;
  if (!event.text) return;

  // Strip the bot's @mention tag(s) out of the text before passing to the
  // intent classifier. The mention tag looks like `<@U12345>`.
  const text = event.text.replace(/<@[A-Z0-9]+>/g, " ").replace(/\s+/g, " ").trim();
  const userId = event.user;
  const threadTs = event.thread_ts ?? event.ts;

  // @mention replies always post to the channel/thread — quiet mode only
  // affects automated background posts, not direct friend interactions.
  const respond = async (t: string, blocks?: KnownBlock[]) => {
    await say({ text: t, blocks, thread_ts: threadTs });
  };

  await handleNaturalLanguage(text, userId, respond);
});

// Direct-message handler. The host (JAM_QUIET_DM_USER) can DM the bot any
// natural-language command — "play X", "skip", "start a jam", "what's
// playing", "who introduced us to Khruangbin?" — and it runs exactly like
// the same message in-channel, but the reply lands in the DM. Slash
// commands also work in DMs (allowed by slashHandler when the caller is
// the host). DMs from anyone other than JAM_QUIET_DM_USER are ignored to
// keep this strictly a host-test surface.
slackApp.event("message", async ({ event, client }) => {
  // The event union is wide; narrow to actual user IM messages.
  if (event.type !== "message") return;
  if ((event as { subtype?: string }).subtype) return; // edits, deletes, joins, etc.
  if ((event as { channel_type?: string }).channel_type !== "im") return;

  const e = event as {
    user?: string;
    text?: string;
    channel: string;
    ts: string;
    bot_id?: string;
  };
  if (e.bot_id || !e.user || !e.text) return;
  if (cachedBotUserId && e.user === cachedBotUserId) return;

  if (!config.JAM_QUIET_DM_USER || e.user !== config.JAM_QUIET_DM_USER) {
    logger.info("Ignoring DM from non-host user", { user: e.user });
    return;
  }

  logger.info("DM received", { user: e.user, text: e.text });

  const text = e.text.replace(/<@[A-Z0-9]+>/g, " ").replace(/\s+/g, " ").trim();
  const respond = async (t: string, blocks?: KnownBlock[]) => {
    await client.chat.postMessage({
      channel: e.channel,
      text: t,
      ...(blocks ? { blocks } : {}),
    });
  };
  await handleNaturalLanguage(text, e.user, respond);
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
  // No public card to update? That's fine — happens when quiet mode was on
  // when the trackChange fired (we DM'd the card instead) or we never
  // posted one (off-day). Vote tally still progresses; nothing visible to
  // refresh.
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

  // In quiet mode, the now-playing card is rerouted as a DM to the host
  // (handled inside postBackgroundToChannel). The day-of-week gate is
  // bypassed in quiet mode — testing should always show you the cards.
  // Out of quiet mode, the day-gate applies (default: Fridays only).
  if (!silentMode && !isNowPlayingPostAllowedToday()) {
    logger.info("Suppressed now-playing post (off-day)", {
      track: event.current.title,
      utcDay: new Date().getUTCDay(),
      allowed: config.JAM_NOWPLAYING_DAYS,
    });
    return;
  }

  try {
    const blocks = nowPlayingBlocks(
      event.current,
      event.requestedBySlackUser,
      event.requestedQuery,
      { count: 0, threshold: config.SKIP_VOTE_THRESHOLD },
    );
    const text = `Now playing: ${event.current.title} by ${event.current.artist}`;
    if (silentMode) {
      // DM the card to the host. No public message means no vote-button
      // card to attach to — vote tallying still works via /skip but we
      // can't update a card the channel can't see.
      if (config.JAM_QUIET_DM_USER) {
        await postDMToUser(config.JAM_QUIET_DM_USER, text, blocks);
      } else {
        logger.info("Suppressed now-playing post (quiet mode, no DM target)", {
          track: event.current.title,
        });
      }
      return;
    }
    const res = await slackApp.client.chat.postMessage({
      channel: config.SLACK_CHANNEL_ID,
      text,
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

// Connection-state notices ("no active device", "Jam is back online") are
// noise nobody actually wants — log them for debugging from the droplet
// shell and that's it. No channel post, no DM, even when quiet mode is
// off. If you need to debug a dropped connection: `journalctl -u jam-bot`.
nowPlayingWatcher.on("noActiveDevice", (info?: { hostVisible?: boolean }) => {
  logger.info("No active Spotify playback detected", {
    hostVisible: info?.hostVisible ?? false,
  });
});

nowPlayingWatcher.on("resumed", () => {
  logger.info("Playback resumed");
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
