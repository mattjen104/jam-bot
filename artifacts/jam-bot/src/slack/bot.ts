import { App, LogLevel } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  searchTrack,
  addToQueue,
  playNow,
  skipToNext,
  getCurrentlyPlaying,
  findActiveDevice,
  createPlaylistWithTracks,
  getAlbumTrackUris,
  type SearchResultTrack,
} from "../spotify/client.js";
import {
  withPlaybackLock,
  PlaybackLockBusyError,
} from "../spotify/playback-lock.js";
import {
  recordPendingRequest,
  recentPlayed,
  expireOldPending,
  recordUserRequest,
  countUserRequestsLastHour,
  expireOldUserRequests,
  setOptOut,
  isOptedOut,
  addUserMemory,
  getUserMemories,
  forgetUserMemories,
  touchUserMemories,
  getCachedUserName,
  setCachedUserName,
  userTotalPlays,
  userArtistVector,
  userSignatureTrack,
  startEngagementSession,
  refreshEngagementSession,
  getEngagementSession,
  endEngagementSession,
  expireEngagementSessions,
} from "../db.js";
import {
  askLLM,
  classifyIntent,
  narrate,
  extractMemories,
  detectProvoked,
  needsPersonalization,
  isForgetMemoryRequest,
  isRecallMemoryRequest,
  isDismissRequest,
  type ChatMessage,
} from "../llm/openrouter.js";
import { extractUrls, fetchLinkContext } from "../llm/links.js";
import {
  startSpotifyJam,
  manualJamInstructions,
  isJamActive,
} from "../spotify/jam.js";
import {
  nowPlayingWatcher,
  type TrackChangeEvent,
  type PositionEvent,
} from "../now-playing.js";
import {
  turntableSession,
  computeTargetPositionMs,
  type ClockAnchor,
  type TurntableSource,
} from "../turntable/session.js";
import type { AcrMatch } from "../turntable/acrcloud.js";
import { turntableConfigured } from "../turntable/ingest-server.js";
import {
  buildKnowledgeSummary,
  enrichTrack,
  trackKnowledgeEnabled,
  type TrackKnowledge,
} from "../turntable/knowledge.js";
import {
  buildContextSummary,
  enrichContext,
  trackContextEnabled,
} from "../turntable/context.js";
import { fetchTrackLinks, trackLinksEnabled } from "../turntable/odesli.js";
import { enrichPerson } from "../turntable/person.js";
import { resolvePersonSessions } from "../turntable/sessions.js";
import { fetchArtistCatalogue } from "../turntable/catalogue.js";
import {
  renderTrackCard,
  putCard,
  getCard,
  cardKey,
  CARD_PERSON_ACTION_RE,
  CARD_HOP_ACTION_RE,
  CARD_CRUMB_ACTION_RE,
  CARD_CRUMB_ACTION,
  CARD_BACK_ACTION,
  CARD_SESSIONS_ACTION,
  CARD_QUEUE_ACTION_RE,
  CARD_ALBUM_ACTION,
  TAB_ACTION_RE,
  pushPersonTrail,
  type TrackCardState,
  type CardTrack,
  type CardTab,
} from "./track-card.js";
import {
  getInsightsFor,
  insightsEnabled,
  InsightScheduler,
  type TrackInsight,
} from "../turntable/insights.js";
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
import {
  buildTour,
  parseTourLength,
  isStopTourRequest,
  isSaveTourRequest,
  type TourTrack,
} from "../tour.js";
import type { CurrentlyPlaying } from "../spotify/client.js";

export const slackApp = new App({
  token: config.SLACK_BOT_TOKEN,
  appToken: config.SLACK_APP_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
  socketMode: true,
  logLevel: LogLevel.WARN,
});

// ---- Reply routing -------------------------------------------------------
// Routing model: the bot replies wherever it was addressed. A message in
// the Jam channel (slash command, @mention, engaged-thread reply) is
// answered in the channel; a DM from the host is answered in the DM. The
// only proactive posts the bot makes on its own are the ambient now-playing
// cards (gated on an active Jam — see the trackChange handler) and the
// scheduled Wrapped (always to the channel). A guided tour follows its
// origin: a tour started in a DM stays entirely in that DM, a channel tour
// stays in the channel.
//
// `ReplyOrigin` records where a natural-language interaction came from so a
// tour's per-track narration can be routed back to that same surface.
type ReplyOrigin =
  | { kind: "channel" }
  | { kind: "dm"; userId: string };

/** Format a millisecond position as m:ss for the turntable status lines. */
function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Human label for the turntable's active capture source. */
function fmtTurntableSource(source: TurntableSource): string {
  return source === "computer" ? "computer audio" : "a record";
}

// ---- Guided music tour ---------------------------------------------------
// A tour is a curated set of real tracks queued onto the active device. Its
// per-track tidbits are pre-generated at queue time (off the now-playing hot
// path) and posted as the matching track plays — attached to that track's
// now-playing card. The tour's lifecycle is its queued tracks (consumed as
// they play) plus an explicit stop; it is independent of engaged-thread
// auto-exit, so quiet listening never ends it.
interface ActiveTour {
  theme: string;
  // track id -> tidbit, consumed when that track starts playing.
  tidbits: Map<string, string>;
  // ids not yet played; when this empties the tour is complete.
  remaining: Set<string>;
  // Where the tour was started, so each track's card + narration is routed
  // back to that surface (DM tour -> DM, channel tour -> channel).
  origin: ReplyOrigin;
}
let activeTour: ActiveTour | null = null;

// The most recently queued tour, retained for "save this tour". Unlike
// `activeTour` (whose tidbits/remaining sets are consumed as tracks play and
// which clears itself when the last track starts or on "stop the tour"), this
// holds the FULL resolved track list — real uris + tidbits — so saving works
// while the tour plays, after it finishes, and even after it's been stopped.
// Replaced when a new tour starts; only cleared on bot restart. Saving reuses
// these already-resolved uris and never re-fabricates tracks.
let lastSavableTour: {
  theme: string;
  intro: string;
  tracks: TourTrack[];
} | null = null;

/**
 * If the given track belongs to the active tour, pull (and consume) its
 * tidbit. Consumption is synchronous so a track can't be narrated twice, and
 * the tour clears itself once its last track starts playing.
 */
function consumeTourTidbit(
  trackId: string,
): { tidbit: string; origin: ReplyOrigin } | null {
  if (!activeTour) return null;
  const tidbit = activeTour.tidbits.get(trackId);
  if (tidbit === undefined) return null;
  // Capture the origin before the tour may clear itself on its last track.
  const origin = activeTour.origin;
  activeTour.tidbits.delete(trackId);
  activeTour.remaining.delete(trackId);
  if (activeTour.remaining.size === 0) activeTour = null;
  return { tidbit, origin };
}

// Plain channel posters — used by interactive paths (vote-skip pass
// announcements, etc). These always post to the channel because they're
// reactions to friend actions in the channel.
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
 * Background channel poster — used by automated events (device-gone,
 * Jam-back, scheduled Wrapped). Always posts to the channel. Callers that
 * should only fire under specific conditions (e.g. ambient now-playing
 * cards, which require an active Jam) gate themselves before calling.
 */
async function postBackgroundToChannel(
  blocks: KnownBlock[] | undefined,
  text: string,
  _context: string,
) {
  await slackApp.client.chat.postMessage({
    channel: config.SLACK_CHANNEL_ID,
    text,
    ...(blocks ? { blocks } : {}),
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

  const track = await searchTrack(query);
  if (!track) {
    await respond(`:mag: Couldn't find anything for "${query}".`);
    return;
  }

  // Everything below depends on the host device + actual playback state,
  // which can change between calls if another command runs. To avoid a
  // TOCTOU race (caller A reads "no jam exists", caller B starts one,
  // caller A then restarts the just-started track), we do the host
  // lookup, current-track check, AND the mutation inside a single
  // critical section. Slack responses + DB bookkeeping happen AFTER the
  // lock is released so they don't extend the contended window.
  type Outcome =
    | { kind: "no_device" }
    | { kind: "already_playing" }
    | { kind: "played" }
    | { kind: "queued" };

  let outcome: Outcome;
  try {
    outcome = await withPlaybackLock(async (): Promise<Outcome> => {
      const device = await findActiveDevice();
      if (!device) return { kind: "no_device" };
      if (asPlay) {
        // Don't restart the song someone is already listening to. Common
        // scenario: a friend hears a song they like, runs `/play <title>`,
        // search returns the currently-playing track. Check inside the
        // lock so the answer is current at the moment of mutation.
        const cp = await getCurrentlyPlaying().catch(() => null);
        if (cp?.isPlaying && cp.track?.id === track.id) {
          return { kind: "already_playing" };
        }
        // Use the play endpoint with explicit URI so we always start
        // *this* track rather than queueing and hoping skipToNext lands
        // on it.
        await playNow(track.uri, device.id);
        return { kind: "played" };
      }
      await addToQueue(track.uri, device.id);
      return { kind: "queued" };
    });
  } catch (err) {
    if (err instanceof PlaybackLockBusyError) {
      await respond(
        ":hourglass_flowing_sand: Another track is being queued right now — try again in a sec.",
      );
      return;
    }
    throw err;
  }

  switch (outcome.kind) {
    case "no_device":
      await respond(
        ":warning: No active Spotify device. Open Spotify on your phone (or any device) and start playing something, then try again.",
      );
      return;
    case "already_playing":
      await respond(
        `:notes: *${track.title}* by ${track.artist} is already playing — not restarting.`,
      );
      return;
    case "played":
      recordPendingRequest(track.id, slackUserId, query);
      recordUserRequest(slackUserId);
      await respond(
        `:arrow_forward: Playing *${track.title}* by ${track.artist}`,
      );
      return;
    case "queued":
      recordPendingRequest(track.id, slackUserId, query);
      await respond(
        `:heavy_plus_sign: Queued *${track.title}* by ${track.artist}`,
      );
      return;
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

// On-demand now-playing. Unlike the ambient watcher (which only fires when a
// poll detects a track CHANGE), this renders the full deep-knowledge card —
// now / liner-notes / context / links tabs + live insights — for whatever is
// playing right now, on request. In quiet mode it always lands in the host DM
// (the private test surface), otherwise it follows where the request came from.
// No skip-vote is wired up here: this is an info pull, not a fresh now-playing
// announcement competing for votes, so it never clobbers the ambient card's vote.
async function handleNowPlaying(args: {
  origin: ReplyOrigin;
  respond: (text: string, blocks?: KnownBlock[]) => Promise<void>;
  notifyEphemeral?: (text: string) => Promise<void>;
}) {
  const { origin, respond, notifyEphemeral } = args;
  const cp = await getCurrentlyPlaying();
  if (!cp.track) {
    await respond(":mute: Nothing is playing right now.");
    return;
  }
  const quietUser = quietDmTarget();
  const dest: ReplyOrigin = quietUser
    ? { kind: "dm", userId: quietUser }
    : origin;
  const posted = await serveTrackCard({
    dest,
    source: "jam",
    track: cp.track,
    requestedBy: null,
    requestedQuery: null,
    viaIsrc: !!cp.track.isrc,
    vote: false,
    enrichArgs: nowPlayingToEnrichArgs(cp.track),
  });
  if (!posted) {
    // postMessage failed (e.g. bot can't DM the host yet) — fall back to the
    // minimal inline card so the request never silently does nothing.
    await respond(
      `Now playing: ${cp.track.title} by ${cp.track.artist}`,
      nowPlayingBlocks(cp.track, null, null),
    );
    return;
  }
  // Deep card was routed to the host DM (quiet mode) but the request came from
  // the channel: tell the requester where it landed rather than leaving silence.
  // Anyone in the Jam channel can run this, so the card lands in the configured
  // host DM, not necessarily the requester's — say "host DM" to avoid confusion.
  if (dest.kind === "dm" && origin.kind === "channel") {
    const note =
      ":speech_balloon: Quiet mode is on — sent the full now-playing card to the host's DM.";
    await (notifyEphemeral ?? respond)(note);
  }
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
    isDm: boolean;
    channelId: string;
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
    // Slash command replies post wherever the command was run: a /command in
    // the channel replies in_channel (the channel sees the normal "Playing X"
    // reply); the same command in the host DM lands in that DM, since
    // response_type is moot in a 1:1 channel.
    const say = async (text: string, blocks?: KnownBlock[]) => {
      await respond({ response_type: "in_channel", text, blocks });
    };
    const sayEphemeral = async (text: string) => {
      await respond({ response_type: "ephemeral", text });
    };
    try {
      await fn({
        text: command.text.trim(),
        userId: command.user_id,
        isDm,
        channelId: command.channel_id,
        say,
        sayEphemeral,
      });
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
  slashHandler(async ({ say, sayEphemeral, isDm, userId }) => {
    await handleNowPlaying({
      origin: isDm ? { kind: "dm", userId } : { kind: "channel" },
      respond: say,
      notifyEphemeral: sayEphemeral,
    });
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
      // askLLMForSet can take several seconds — keep it OUTSIDE the
      // playback lock so it doesn't block other commands. Host lookup
      // and the actual mutation loop both go INSIDE the lock so a
      // concurrent transfer/skip can't race with our writes.
      const set = await askLLMForSet(text);
      if (!set.trackIds.length) {
        await say(`:thinking_face: ${set.summary}`);
        return;
      }
      let queued = 0;
      let firstPlayed: string | null = null;
      let aborted = false;
      let abortErr: unknown = null;
      let deviceFound = false;
      try {
        await withPlaybackLock(async () => {
          const device = await findActiveDevice();
          if (!device) return;
          deviceFound = true;
          for (const id of set.trackIds) {
            const uri = `spotify:track:${id}`;
            try {
              if (queued === 0) {
                await playNow(uri, device.id);
                firstPlayed = uri;
              } else {
                await addToQueue(uri, device.id);
              }
              recordPendingRequest(id, userId, `memory: ${text}`);
              queued++;
            } catch (err) {
              // First failure aborts the loop. If the host device just
              // disappeared (the common cause), every subsequent
              // playNow/addToQueue would fail the same way and produce
              // a wall of warnings. One log + one user-facing message
              // is enough.
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
        });
      } catch (err) {
        if (err instanceof PlaybackLockBusyError) {
          await say(
            ":hourglass_flowing_sand: Another track is being queued right now — try again in a sec.",
          );
          return;
        }
        throw err;
      }
      if (!deviceFound) {
        await say(
          ":warning: No active Spotify device. Open Spotify on your phone (or any device) and start playing something, then try again.",
        );
        return;
      }
      if (queued > 0) recordUserRequest(userId);
      if (aborted) {
        const status = (abortErr as { statusCode?: number })?.statusCode;
        const deviceGone = status === 404;
        const reason = deviceGone
          ? "Your Spotify device went away mid-queue. Make sure Spotify is still playing and try again."
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
    await say(
      `:warning: Couldn't start a Jam automatically. Reason: \`${result.reason}\`\n\n` +
        manualJamInstructions(),
    );
  }),
);

// ---- Turntable sync ------------------------------------------------------
// `/turntable start|stop|resync|status` controls the analog-source -> Spotify
// Jam bridge. The host plays a record (or any line-in/mic source); a desktop
// helper streams clips to the ingest server, ACRCloud identifies them, and the
// bot drives the host's single Spotify account so the native Jam cascades the
// same track + offset to every guest. `turntableOrigin` remembers WHERE it was
// started so the "now playing from the turntable" announcement follows the
// reply-routing model (channel-started -> channel, DM-started -> host DM).
let turntableOrigin: ReplyOrigin | null = null;

slackApp.command(
  "/turntable",
  slashHandler(async ({ text, userId, isDm, say, sayEphemeral }) => {
    if (!turntableConfigured()) {
      await sayEphemeral(
        ":warning: Turntable sync isn't configured. Set `ACRCLOUD_HOST`, " +
          "`ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET`, and " +
          "`TURNTABLE_INGEST_SECRET` in the bot's .env — see SETUP.md.",
      );
      return;
    }
    const sub = text.trim().toLowerCase().split(/\s+/)[0] || "status";
    // Record where the command actually ran (real channel-vs-DM context), so
    // later "now playing from the turntable" announcements follow the same
    // reply-routing as everything else: channel-started -> channel, DM-started
    // -> host DM. Deriving this from user identity is wrong — the host running
    // `/turntable start` *in the channel* must announce to the channel.
    const origin: ReplyOrigin = isDm
      ? { kind: "dm", userId }
      : { kind: "channel" };

    switch (sub) {
      case "start": {
        turntableOrigin = origin;
        const device = await findActiveDevice();
        if (!device) {
          await say(
            ":warning: No active Spotify device — open Spotify on the host " +
              "account and start playing anything first, then run " +
              "`/turntable start` again.",
          );
          return;
        }
        turntableSession.start(device.id || undefined);
        // Make sure a Jam is running so guests actually receive the cascade.
        const jam = await startSpotifyJam();
        const jamLine = jam.ok
          ? jam.existed
            ? `A Jam is already live — guests can join: ${jam.joinUrl}`
            : `Started a Jam — guests can join: ${jam.joinUrl}`
          : `:warning: Couldn't auto-start a Jam (\`${jam.reason}\`). Guests won't hear it until one is running — start it from the Spotify app.`;
        await say(
          `:record_button: *Turntable sync on.* Drop the needle — I'll follow ` +
            `the record on \`${device.name}\` and keep everyone in sync.\n${jamLine}`,
        );
        return;
      }
      case "stop": {
        turntableSession.stop();
        turntableOrigin = null;
        insightScheduler.disarm();
        await say(
          ":black_square_for_stop: Turntable sync off. Whatever's playing keeps going — I just stop following the record.",
        );
        return;
      }
      case "resync": {
        if (!turntableSession.isActive()) {
          await sayEphemeral(
            "Turntable sync isn't on. Run `/turntable start` first.",
          );
          return;
        }
        const r = await turntableSession.resync();
        if (!r) {
          await sayEphemeral(
            "Nothing to resync yet — waiting on the first confident match from the record.",
          );
          return;
        }
        await say(
          `:arrows_counterclockwise: Resynced to *${r.track.title}* — ${r.track.artist} at ${fmtClock(r.positionMs)}.`,
        );
        return;
      }
      case "status":
      default: {
        const s = turntableSession.status();
        if (!s.active) {
          await sayEphemeral(
            "Turntable sync is *off*. Run `/turntable start` to follow a record.",
          );
          return;
        }
        const src = fmtTurntableSource(s.source);
        const where =
          s.track && s.positionMs != null
            ? `Following *${s.track.title}* — ${s.track.artist} at ${fmtClock(s.positionMs)} (from ${src}).`
            : `On, following ${src} — waiting for the first confident match.`;
        await sayEphemeral(`:record_button: Turntable sync is *on*. ${where}`);
        return;
      }
    }
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
 * Return the bot's own user id, lazily fetching it if startup caching failed.
 * Engaged-thread dedup depends on knowing our own id so we can skip messages
 * that re-mention us (those are owned by the app_mention handler) — if the
 * boot-time auth.test() failed we MUST recover it here or we'd double-reply.
 */
async function ensureBotUserId(): Promise<string | null> {
  if (cachedBotUserId) return cachedBotUserId;
  try {
    const auth = await slackApp.client.auth.test();
    cachedBotUserId = auth.user_id ?? null;
  } catch (err) {
    logger.warn("Lazy bot-id fetch failed", { error: String(err) });
  }
  return cachedBotUserId;
}

// Rolling per-conversation memory of recent @mention / DM exchanges so the
// LLM persona can see the back-and-forth and escalate when repeatedly razzed.
// In-memory only (not persisted) and expired after inactivity.
const CONV_TURN_LIMIT = 8; // keep the last N messages (user + assistant)
const CONV_TTL_MS = 30 * 60 * 1000; // drop turns older than 30 minutes
const convMemory = new Map<
  string,
  { role: "user" | "assistant"; content: string; name?: string; ts: number }[]
>();

function freshTurns(key: string) {
  const now = Date.now();
  const turns = (convMemory.get(key) ?? []).filter(
    (t) => now - t.ts < CONV_TTL_MS,
  );
  if (turns.length === 0) convMemory.delete(key);
  else convMemory.set(key, turns);
  return turns;
}

// Prefix each prior USER turn with its speaker's name so the model can keep
// several people straight in a shared channel/thread instead of collapsing
// them into one "user". Assistant turns are passed through unchanged.
function getConvHistory(key: string): ChatMessage[] {
  return freshTurns(key).map((t) => ({
    role: t.role,
    content: t.role === "user" && t.name ? `${t.name}: ${t.content}` : t.content,
  }));
}

function pushConvTurn(
  key: string,
  role: "user" | "assistant",
  content: string,
  name?: string,
) {
  const turns = freshTurns(key);
  turns.push({ role, content, name, ts: Date.now() });
  while (turns.length > CONV_TURN_LIMIT) turns.shift();
  convMemory.set(key, turns);
}

// Per (conversation, user) record of the bot's last clap-back, so a repeated
// provocation doesn't get the same burn fired back verbatim. In-memory only.
const lastBurn = new Map<string, string>();

// Conversation-memory key. Channel @mentions/threads are scoped per-thread
// (`channel:threadTs`) so each engaged thread is its own conversation and
// one session's chatter never bleeds into another. DMs use `dm:<user>`.
function threadConvKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

/**
 * If the message dismisses the bot from an active engaged thread, end the
 * session, post a brief in-character sign-off, and return true so the caller
 * skips normal handling. No-op (returns false) when there's no live session.
 */
async function maybeHandleDismissal(
  channel: string,
  threadTs: string,
  text: string,
  respond: (t: string, blocks?: KnownBlock[]) => Promise<void>,
): Promise<boolean> {
  if (!isDismissRequest(text)) return false;
  const session = getEngagementSession(
    channel,
    threadTs,
    config.JAM_ENGAGE_TIMEOUT_MS,
  );
  if (!session) return false;
  endEngagementSession(channel, threadTs);
  await respond("Cool — I'll bow out. Give me a shout if you want me back in.");
  return true;
}

/**
 * Resolve a Slack user ID to a friendly display name, cached in the DB so we
 * don't hit the Slack Web API on every message. Falls back to the `<@U…>`
 * mention (which Slack renders as a name client-side) if lookup fails.
 */
async function resolveUserName(userId: string): Promise<string> {
  const cached = getCachedUserName(userId);
  if (cached) return cached;
  try {
    const res = await slackApp.client.users.info({ user: userId });
    const u = res.user as
      | {
          profile?: { display_name?: string; real_name?: string };
          real_name?: string;
          name?: string;
        }
      | undefined;
    const name =
      u?.profile?.display_name?.trim() ||
      u?.real_name?.trim() ||
      u?.profile?.real_name?.trim() ||
      u?.name?.trim();
    if (name) {
      setCachedUserName(userId, name);
      return name;
    }
  } catch (err) {
    logger.warn("users.info lookup failed", { error: String(err), userId });
  }
  return `<@${userId}>`;
}

// Cheap taste summary derived entirely from existing play-history
// aggregations — no LLM. Returns "" when the user has no history.
function buildTasteSummary(userId: string): string {
  const total = userTotalPlays(userId);
  if (total === 0) return "";
  const artists = userArtistVector(userId)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 3)
    .map((a) => a.artist);
  const sig = userSignatureTrack(userId);
  const parts = [`${total} tracks requested in the Jam`];
  if (artists.length) parts.push(`most-played artists: ${artists.join(", ")}`);
  if (sig) parts.push(`signature track: "${sig.title}" by ${sig.artist}`);
  return parts.join("; ");
}

const PERSONALIZATION_CHAR_CAP = 800;

// Assemble the gated personalization block for ONE speaker: their taste
// summary plus a few most-relevant remembered facts, hard-capped in size.
// Caller must have already confirmed the gate fired and the user isn't
// opted out.
function buildPersonalization(userId: string, speakerName: string): string {
  const taste = buildTasteSummary(userId);
  const facts = getUserMemories(userId, 8).map((m) => `- ${m.fact}`);
  const lines: string[] = [];
  if (taste) lines.push(`Taste (from play history): ${taste}`);
  if (facts.length)
    lines.push(`Remembered about ${speakerName}:\n${facts.join("\n")}`);
  if (lines.length) touchUserMemories(userId);
  let block = lines.join("\n");
  if (block.length > PERSONALIZATION_CHAR_CAP)
    block = block.slice(0, PERSONALIZATION_CHAR_CAP);
  return block;
}

// Fire-and-forget durable-fact extraction on the cheap model. Never throws,
// never blocks the reply. Honors the stats opt-out (no facts extracted or
// stored for opted-out users).
async function extractAndStoreMemories(userId: string, text: string) {
  try {
    if (isOptedOut(userId)) return;
    const existing = getUserMemories(userId).map((m) => m.fact);
    const facts = await extractMemories(text, existing);
    for (const f of facts) addUserMemory(userId, f.fact, f.category);
  } catch (err) {
    logger.warn("Memory extraction failed", { error: String(err), userId });
  }
}

/**
 * Answer a free-form question/chat turn with identity + gated
 * personalization. Used by both the link-aware path and the plain question
 * intent. Resolves the speaker's name (always), decides whether the
 * personalization gate fires (past/self question OR provoked), injects the
 * speaker's compact memory ONLY when it does, varies the burn when
 * provoked, and kicks off background fact extraction after replying.
 */
async function answerQuestion(
  text: string,
  userId: string,
  convKey: string,
  respond: (t: string, blocks?: KnownBlock[]) => Promise<void>,
  linkContext = "",
  engaged = false,
) {
  const speakerName = await resolveUserName(userId);
  const provoked = detectProvoked(text);
  const gateFires = provoked || needsPersonalization(text);
  // Personalization (taste + remembered facts) only when the gate fires AND
  // the speaker hasn't opted out. We never weaponize an opted-out user's
  // history, and never inject personal data into ordinary chat.
  const personalization =
    gateFires && !isOptedOut(userId)
      ? buildPersonalization(userId, speakerName)
      : "";
  const burnKey = `${convKey}:${userId}`;
  const answer = await askLLM(text, getConvHistory(convKey), linkContext, {
    speakerName,
    personalization,
    provoked,
    avoidBurn: provoked ? lastBurn.get(burnKey) : undefined,
    engaged,
  });
  pushConvTurn(convKey, "user", text, speakerName);
  pushConvTurn(convKey, "assistant", answer);
  if (provoked) lastBurn.set(burnKey, answer);
  await respond(answer);
  void extractAndStoreMemories(userId, text);
}

/**
 * Kick off a guided music tour: curate a set of REAL tracks for the theme,
 * queue them onto the active device using the same multi-track set path as
 * /memory, and register the active tour so each track's pre-generated tidbit
 * posts as it plays. Honors the per-user hourly play budget.
 */
async function handleTour(args: {
  theme: string;
  rawText: string;
  slackUserId: string;
  respond: (t: string) => Promise<void>;
  origin: ReplyOrigin;
}) {
  const { theme, rawText, slackUserId, respond, origin } = args;

  const used = countUserRequestsLastHour(slackUserId);
  if (used >= config.MAX_PLAYS_PER_USER_PER_HOUR) {
    await respond(
      `:hourglass_flowing_sand: You've hit your hourly play budget (${used}/${config.MAX_PLAYS_PER_USER_PER_HOUR}). Try again later.`,
    );
    return;
  }

  // Curation + resolution + narration all run OUTSIDE the playback lock (they
  // can take several seconds and hit the network); only device lookup and the
  // queue mutation loop run inside it.
  const tour = await buildTour(theme, parseTourLength(rawText));
  if (!tour.tracks.length) {
    await respond(
      `:thinking_face: I couldn't put together a real, findable set for "${theme}" right now — try another angle?`,
    );
    return;
  }

  let queued = 0;
  let firstPlayed = false;
  let aborted = false;
  let abortErr: unknown = null;
  let deviceFound = false;
  try {
    await withPlaybackLock(async () => {
      const device = await findActiveDevice();
      if (!device) return;
      deviceFound = true;
      for (const track of tour.tracks) {
        try {
          if (queued === 0) {
            await playNow(track.uri, device.id);
            firstPlayed = true;
          } else {
            await addToQueue(track.uri, device.id);
          }
          recordPendingRequest(track.trackId, slackUserId, `tour: ${theme}`);
          queued++;
        } catch (err) {
          logger.warn("Tour queue: aborting after enqueue failure", {
            id: track.trackId,
            queuedSoFar: queued,
            error: String(err),
          });
          aborted = true;
          abortErr = err;
          break;
        }
      }
    });
  } catch (err) {
    if (err instanceof PlaybackLockBusyError) {
      await respond(
        ":hourglass_flowing_sand: Another track is being queued right now — try again in a sec.",
      );
      return;
    }
    throw err;
  }

  if (!deviceFound) {
    await respond(
      ":warning: No active Spotify device. Open Spotify on your phone (or any device) and start playing something, then try again.",
    );
    return;
  }

  // Register the tour over the tracks that actually made it into the queue,
  // so narration only fires for tracks that will really play.
  const queuedTracks = tour.tracks.slice(0, queued);
  if (queuedTracks.length) {
    activeTour = {
      theme: tour.theme,
      tidbits: new Map(queuedTracks.map((t) => [t.trackId, t.tidbit])),
      remaining: new Set(queuedTracks.map((t) => t.trackId)),
      origin,
    };
    // Retain the full queued set (uris + tidbits) so "save this tour" can
    // persist it as a playlist later, even after every track has played.
    lastSavableTour = {
      theme: tour.theme,
      intro: tour.intro,
      tracks: queuedTracks,
    };
    recordUserRequest(slackUserId);
  }

  const intro = tour.intro ? `${tour.intro}\n\n` : "";
  if (aborted) {
    const status = (abortErr as { statusCode?: number })?.statusCode;
    const reason =
      status === 404
        ? "Your Spotify device went away mid-queue. Make sure Spotify is still playing and try again."
        : "Spotify rejected the request — try again in a moment.";
    await respond(
      queued > 0
        ? `:notes: ${intro}Started a ${queued}-track tour of ${theme}, then stopped: ${reason}`
        : `:warning: Couldn't queue any tracks — ${reason}`,
    );
    return;
  }

  await respond(
    `:notes: ${intro}Queued a ${queued}-track tour of ${theme} — ${
      firstPlayed ? "starting now" : "added to the queue"
    }. I'll drop a note on each track as it comes up. Say "stop the tour" any time, or "save the tour" to keep it as a playlist.`,
  );
}

// Spotify caps playlist names at 100 chars and descriptions at 300; keep our
// generated values well within those so a create never 400s on length.
function tourPlaylistName(theme: string): string {
  const name = `Jam Tour: ${theme}`;
  return name.length > 100 ? `${name.slice(0, 97)}...` : name;
}
function tourPlaylistDescription(intro: string, theme: string): string {
  const lead = intro.trim() || `A guided Jam Bot tour of ${theme}.`;
  const full = `${lead} — saved from a Jam Bot guided tour.`;
  return full.length > 300 ? full.slice(0, 300) : full;
}

/**
 * Persist the most recently queued tour (`lastSavableTour`) as a real Spotify
 * playlist: name it for the theme, fill it with the already-resolved tour
 * uris (never re-fabricated), stash the intro in the description, and re-post
 * the per-track tidbits to the channel so the "guided" feel survives a
 * replay. Surfaces a clear note if the refresh token lacks the playlist
 * scope.
 */
async function handleSaveTour(args: { respond: (t: string) => Promise<void> }) {
  const { respond } = args;
  const tour = lastSavableTour;
  if (!tour || !tour.tracks.length) {
    await respond(
      'No tour to save yet — start one first with something like "give us a tour of Motown", then say "save the tour".',
    );
    return;
  }

  let playlist;
  try {
    playlist = await createPlaylistWithTracks({
      name: tourPlaylistName(tour.theme),
      description: tourPlaylistDescription(tour.intro, tour.theme),
      uris: tour.tracks.map((t) => t.uri),
      isPublic: true,
    });
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 403) {
      await respond(
        ":lock: I can't save playlists yet — the Spotify token is missing the `playlist-modify-public` scope. Re-run `pnpm run spotify:auth`, update `SPOTIFY_REFRESH_TOKEN`, and restart the bot (see SETUP.md).",
      );
      return;
    }
    logger.error("Save tour: playlist creation failed", {
      theme: tour.theme,
      error: String(err),
    });
    await respond(
      ":warning: Couldn't save the tour as a playlist just now — try again in a moment.",
    );
    return;
  }

  // Re-post the tidbits so the narrated context travels with the saved set.
  const tidbits = tour.tracks
    .map((t, i) => `${i + 1}. *${t.title}* — ${t.artist}\n   ${t.tidbit}`)
    .join("\n");
  await respond(
    `:floppy_disk: Saved your ${tour.tracks.length}-track tour of ${tour.theme} as a playlist — replay it any time: ${playlist.url}\n\n` +
      `Here are the tidbits so the guided feel comes along for the replay:\n${tidbits}`,
  );
}

/**
 * Shared NL handler used by both `app_mention` (in the Jam channel) and
 * direct messages from the host. Takes already-stripped text and a
 * `respond` callback that knows where to post the reply.
 *
 * `convKey` scopes the rolling conversation memory (channel id for
 * @mentions, `dm:<user>` for DMs) so the persona can track and escalate a
 * running back-and-forth.
 */
async function handleNaturalLanguage(
  text: string,
  userId: string,
  respond: (t: string, blocks?: KnownBlock[]) => Promise<void>,
  convKey: string,
  origin: ReplyOrigin,
  engaged = false,
) {
  if (!text) {
    await respond(
      "Hi! Try `play <song>`, `queue <song>`, `skip`, `what's playing?`, `start a jam`, or ask me a question about Jam history. Slash commands like `/play` and `/nowplaying` also work.",
    );
    return;
  }

  // Memory inspect/control — handled before intent classification (and
  // before any LLM call) so "what do you remember about me" / "forget me"
  // are meta-commands, not questions routed to the persona.
  if (isForgetMemoryRequest(text)) {
    forgetUserMemories(userId);
    await respond("Done — wiped what I had on you. Clean slate.");
    return;
  }
  if (isRecallMemoryRequest(text)) {
    const facts = isOptedOut(userId) ? [] : getUserMemories(userId);
    await respond(
      facts.length
        ? "Here's what I've got on you:\n" +
            facts.map((f) => `• ${f.fact}`).join("\n")
        : "Nothing yet — I haven't picked up anything worth keeping about you.",
    );
    return;
  }

  // Stop the tour — handled before intent classification so "stop the tour"
  // ends narration even mid-set without an LLM round-trip. The queued tracks
  // keep playing; we just stop narrating and let the tour go quiet.
  if (isStopTourRequest(text)) {
    if (activeTour) {
      activeTour = null;
      await respond(
        "Tour's over — the queue keeps playing, I'll just stop narrating.",
      );
    } else {
      await respond("No tour running right now.");
    }
    return;
  }

  // Save the tour as a playlist — handled before intent classification so
  // "save the tour" persists the most recent set without an LLM round-trip,
  // even after it's finished playing or been stopped.
  if (isSaveTourRequest(text)) {
    await handleSaveTour({ respond: (t) => respond(t) });
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

  // Link-reading: only when the message is a general question that happens to
  // contain web links. Command intents (play/queue/skip/nowplaying/history/jam)
  // always run their handler even if a URL is present, so a pasted link can't
  // hijack e.g. a skip request.
  const urls = extractUrls(text);
  if (urls.length > 0 && intent.intent === "question") {
    try {
      const linkContext = await fetchLinkContext(urls);
      await answerQuestion(text, userId, convKey, respond, linkContext, engaged);
    } catch (err) {
      logger.error("Link-aware question failed", { error: String(err) });
      await respond(
        ":warning: I tried to read that link but something went wrong — check the bot logs.",
      );
    }
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
        await handleNowPlaying({ origin, respond });
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
          await respond(
            `:warning: Couldn't start a Jam automatically. Reason: \`${result.reason}\`\n\n` +
              manualJamInstructions(),
          );
        }
        return;
      }
      case "tour": {
        const theme = intent.query?.trim();
        if (!theme) {
          await respond(
            ':thinking_face: A tour of what? Try "give us a tour of Motown" or "a tour of 90s shoegaze".',
          );
          return;
        }
        await handleTour({
          theme,
          rawText: text,
          slackUserId: userId,
          respond: (t) => respond(t),
          origin,
        });
        return;
      }
      case "question": {
        await answerQuestion(text, userId, convKey, respond, "", engaged);
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
  const channel = event.channel;

  // @mention replies post to the channel/thread where the mention happened —
  // the bot replies wherever it's addressed.
  const respond = async (t: string, blocks?: KnownBlock[]) => {
    await say({ text: t, blocks, thread_ts: threadTs });
  };

  // Dismissed mid-thread ("@Jam stop")? End the session and bow out.
  if (await maybeHandleDismissal(channel, threadTs, text, respond)) return;

  // An @mention IS the engagement trigger: from now on she answers
  // follow-ups in this thread without a re-mention until it's dismissed or
  // goes quiet. Starting/refreshing here also keeps a live thread alive.
  startEngagementSession(channel, threadTs, userId, text.slice(0, 120));

  await handleNaturalLanguage(
    text,
    userId,
    respond,
    threadConvKey(channel, threadTs),
    { kind: "channel" },
    true,
  );
});

// Direct-message handler. The host (JAM_QUIET_DM_USER) can DM the bot any
// natural-language command — "play X", "skip", "start a jam", "what's
// playing", "who introduced us to Khruangbin?" — and it runs exactly like
// the same message in-channel, but the reply lands in the DM. Slash
// commands also work in DMs (allowed by slashHandler when the caller is
// the host). DMs from anyone other than JAM_QUIET_DM_USER are ignored to
// keep this strictly a host-test surface.
slackApp.event("message", async ({ event, client }) => {
  // The event union is wide; narrow to actual user messages.
  if (event.type !== "message") return;
  if ((event as { subtype?: string }).subtype) return; // edits, deletes, joins, etc.

  const e = event as {
    user?: string;
    text?: string;
    channel: string;
    channel_type?: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
  };
  if (e.bot_id || !e.user || !e.text) return;
  if (cachedBotUserId && e.user === cachedBotUserId) return;

  // ---- Engaged-thread follow-ups (channel, no @mention) ----------------
  // When she's been pulled into a thread, she keeps answering replies in
  // that thread without needing to be re-mentioned, until dismissed or the
  // session times out. Messages that DO mention her are owned by the
  // app_mention handler — skip them here to avoid double-replies.
  if (e.channel_type !== "im") {
    const threadTs = e.thread_ts;
    if (!threadTs) return; // top-level channel chatter — not ours
    // Messages that re-mention the bot are delivered to BOTH this handler and
    // app_mention. app_mention owns them — skip here so we don't double-reply.
    // We need our own id to detect that; recover it lazily if boot caching
    // failed, and bail out entirely if we still can't (better silent than
    // double-posting). A literal "<@" with no resolvable id means a mention
    // we can't attribute — treat conservatively and skip.
    const botId = await ensureBotUserId();
    if (botId) {
      if (e.text.includes(`<@${botId}>`)) return;
    } else if (e.text.includes("<@")) {
      return;
    }

    const session = getEngagementSession(
      e.channel,
      threadTs,
      config.JAM_ENGAGE_TIMEOUT_MS,
    );
    if (!session) return; // no live session in this thread

    const text = e.text.replace(/<@[A-Z0-9]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return;

    const respond = async (t: string, blocks?: KnownBlock[]) => {
      await client.chat.postMessage({
        channel: e.channel,
        text: t,
        thread_ts: threadTs,
        ...(blocks ? { blocks } : {}),
      });
    };

    if (await maybeHandleDismissal(e.channel, threadTs, text, respond)) return;

    refreshEngagementSession(e.channel, threadTs);
    await handleNaturalLanguage(
      text,
      e.user,
      respond,
      threadConvKey(e.channel, threadTs),
      { kind: "channel" },
      true,
    );
    return;
  }

  // ---- Host DM surface --------------------------------------------------
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
  await handleNaturalLanguage(text, e.user, respond, `dm:${e.user}`, {
    kind: "dm",
    userId: e.user,
  });
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
  // Registry key of the consolidated track card backing this vote, when the
  // vote rides on a unified card (the normal case). Lets the refresh re-render
  // the live card (preserving its current tab) instead of the legacy blocks.
  cardKey?: string;
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
  // No public card to update? That's fine — happens when the trackChange
  // fired with no active Jam (ambient card suppressed) or as a DM-tour track
  // (card DM'd, not posted to the channel). Vote tally still progresses;
  // nothing visible to refresh.
  if (!state.messageTs || !state.channel) return;
  // The vote rides on a consolidated track card: bump its vote count and
  // re-render it in place, preserving whatever tab the listener is on.
  const key = state.cardKey ?? cardKey(state.channel, state.messageTs);
  const card = getCard(key);
  if (card) {
    card.vote = { count, threshold };
    await updateCardMessage(card);
    return;
  }
  // Fallback for a vote with no live card (e.g. created lazily by `/skip`
  // before any card was posted, or one evicted/lost across a restart): render
  // the standalone now-playing blocks so the tally is still visible.
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
  const device = await findActiveDevice().catch(() => null);
  if (!device) {
    return {
      kind: "skip_failed",
      count,
      threshold,
      reason: "no active Spotify device — start playing something in Spotify first",
    };
  }
  try {
    await withPlaybackLock(() => skipToNext(device.id));
  } catch (err) {
    if (err instanceof PlaybackLockBusyError) {
      return {
        kind: "skip_failed",
        count,
        threshold,
        reason: "another playback action is in flight — try again in a sec",
      };
    }
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

// ---- Consolidated track-card interactions ------------------------------
// The track card lives on a single Slack message and swaps its body in place
// via chat.update as listeners tap tabs / explore a person / go back. Each
// handler acks immediately, finds the live card by (channel, message ts), and
// re-renders. A card that's gone (bot restarted, or evicted from the capped
// registry) yields a quiet ephemeral nudge rather than a dead button.

/** Pull (channel, ts) for the message an action fired on. */
function actionMessageRef(body: unknown): { channel?: string; ts?: string } {
  const b = body as {
    channel?: { id?: string };
    container?: { channel_id?: string; message_ts?: string };
    message?: { ts?: string };
  };
  return {
    channel: b.channel?.id ?? b.container?.channel_id,
    ts: b.container?.message_ts ?? b.message?.ts,
  };
}

const CARD_EXPIRED_MSG =
  ":hourglass: That card has aged out — play the track again for a fresh one.";

slackApp.action(TAB_ACTION_RE, async ({ ack, body, action, respond }) => {
  await ack();
  try {
    const tab = ("value" in action ? action.value : undefined) as
      | CardTab
      | undefined;
    const { channel, ts } = actionMessageRef(body);
    if (!tab || !channel || !ts) return;
    const card = getCard(cardKey(channel, ts));
    if (!card) {
      await respond({ response_type: "ephemeral", replace_original: false, text: CARD_EXPIRED_MSG });
      return;
    }
    card.view = { kind: "tab", tab };
    await updateCardMessage(card);
  } catch (err) {
    logger.error("Card tab action failed", { error: String(err) });
  }
});

/**
 * Render a person sub-page, fetching the grounded person info on first visit:
 * show a loading state, enrich (cached after the first time), then re-render.
 * `nameHint` seeds the enrichment lookup (and the loading title) when we know
 * the name from a credit or a parent's collaborator list.
 */
async function ensurePersonAndRender(
  card: TrackCardState,
  artistId: string,
  nameHint: string,
): Promise<void> {
  if (!card.people.has(artistId)) {
    await updateCardMessage(card);
    const info = await enrichPerson({ name: nameHint, artistId });
    card.people.set(artistId, info);
  }
  await updateCardMessage(card);
}

slackApp.action(CARD_PERSON_ACTION_RE, async ({ ack, body, action, respond }) => {
  await ack();
  try {
    const artistId =
      action.type === "static_select"
        ? action.selected_option?.value
        : action.type === "button"
          ? action.value
          : undefined;
    const { channel, ts } = actionMessageRef(body);
    if (!artistId || !channel || !ts) return;
    const card = getCard(cardKey(channel, ts));
    if (!card) {
      await respond({ response_type: "ephemeral", replace_original: false, text: CARD_EXPIRED_MSG });
      return;
    }
    const from: CardTab = card.view.kind === "tab" ? card.view.tab : "credits";
    // Entering from a tab starts a fresh trail at this person.
    card.view = { kind: "person", trail: [artistId], from };
    const credit = card.knowledge?.personnel.find((c) => c.artistId === artistId);
    await ensurePersonAndRender(card, artistId, credit?.name ?? "");
  } catch (err) {
    logger.error("Card person action failed", { error: String(err) });
  }
});

slackApp.action(CARD_HOP_ACTION_RE, async ({ ack, body, action, respond }) => {
  await ack();
  try {
    const artistId = action.type === "button" ? action.value : undefined;
    const { channel, ts } = actionMessageRef(body);
    if (!artistId || !channel || !ts) return;
    const card = getCard(cardKey(channel, ts));
    if (!card) {
      await respond({ response_type: "ephemeral", replace_original: false, text: CARD_EXPIRED_MSG });
      return;
    }
    // Hops only make sense from an open person page; push onto the trail.
    if (card.view.kind !== "person") return;
    const fromId = card.view.trail[card.view.trail.length - 1];
    const hint = fromId
      ? (card.people
          .get(fromId)
          ?.collaborators?.find((c) => c.artistId === artistId)?.name ?? "")
      : "";
    card.view = {
      kind: "person",
      trail: pushPersonTrail(card.view.trail, artistId),
      from: card.view.from,
    };
    await ensurePersonAndRender(card, artistId, hint);
  } catch (err) {
    logger.error("Card hop action failed", { error: String(err) });
  }
});

slackApp.action(CARD_CRUMB_ACTION_RE, async ({ ack, body, action, respond }) => {
  await ack();
  try {
    const { channel, ts } = actionMessageRef(body);
    if (!channel || !ts) return;
    const card = getCard(cardKey(channel, ts));
    if (!card) {
      await respond({ response_type: "ephemeral", replace_original: false, text: CARD_EXPIRED_MSG });
      return;
    }
    if (card.view.kind !== "person") return;
    const actionId = "action_id" in action ? action.action_id : "";
    const suffix = actionId.slice(`${CARD_CRUMB_ACTION}:`.length);
    if (suffix === "tab") {
      card.view = { kind: "tab", tab: card.view.from };
      await updateCardMessage(card);
      return;
    }
    const idx = Number(suffix);
    if (!Number.isInteger(idx) || idx < 0 || idx >= card.view.trail.length) return;
    const trail = card.view.trail.slice(0, idx + 1);
    const targetId = trail[trail.length - 1];
    if (!targetId) return;
    card.view = { kind: "person", trail, from: card.view.from };
    await ensurePersonAndRender(card, targetId, "");
  } catch (err) {
    logger.error("Card crumb action failed", { error: String(err) });
  }
});

slackApp.action(CARD_BACK_ACTION, async ({ ack, body, action, respond }) => {
  await ack();
  try {
    const { channel, ts } = actionMessageRef(body);
    if (!channel || !ts) return;
    const card = getCard(cardKey(channel, ts));
    if (!card) {
      await respond({ response_type: "ephemeral", replace_original: false, text: CARD_EXPIRED_MSG });
      return;
    }
    // Mid-trail, Back pops one person; at the root it returns to the tab.
    if (card.view.kind === "person" && card.view.trail.length > 1) {
      const trail = card.view.trail.slice(0, -1);
      const targetId = trail[trail.length - 1];
      if (targetId) {
        card.view = { kind: "person", trail, from: card.view.from };
        await ensurePersonAndRender(card, targetId, "");
        return;
      }
    }
    const fallback =
      card.view.kind === "person" ? card.view.from : ("now" as CardTab);
    const tab = (("value" in action ? action.value : undefined) ??
      fallback) as CardTab;
    card.view = { kind: "tab", tab };
    await updateCardMessage(card);
  } catch (err) {
    logger.error("Card back action failed", { error: String(err) });
  }
});

slackApp.action(CARD_SESSIONS_ACTION, async ({ ack, body, action, respond }) => {
  await ack();
  const ephemeral = (text: string) =>
    respond({ response_type: "ephemeral", replace_original: false, text });
  try {
    const artistId = "value" in action ? action.value : undefined;
    const userId = body.user?.id;
    const { channel, ts } = actionMessageRef(body);
    if (!artistId || !channel || !ts) return;
    const card = getCard(cardKey(channel, ts));
    if (!card) {
      await ephemeral(CARD_EXPIRED_MSG);
      return;
    }
    const person = card.people.get(artistId) ?? null;
    if (!person) {
      await ephemeral(":hourglass: Still looking this person up — try again in a moment.");
      return;
    }
    const who = person.name;

    // Rate-limit consistent with the other playback paths (play / tour).
    if (userId) {
      const used = countUserRequestsLastHour(userId);
      if (used >= config.MAX_PLAYS_PER_USER_PER_HOUR) {
        await ephemeral(
          `:hourglass_flowing_sand: You've hit your hourly play budget (${used}/${config.MAX_PLAYS_PER_USER_PER_HOUR}). Try again later.`,
        );
        return;
      }
    }

    // Resolve known work to confident Spotify tracks OUTSIDE the playback lock
    // (it hits the network); only the device lookup + queue loop run inside it.
    const tracks = await resolvePersonSessions(person);
    if (!tracks.length) {
      await ephemeral(
        `:see_no_evil: I couldn't confidently match any of *${who}*'s work to Spotify right now.`,
      );
      return;
    }

    let queued = 0;
    let deviceFound = false;
    try {
      await withPlaybackLock(async () => {
        const device = await findActiveDevice();
        if (!device) return;
        deviceFound = true;
        for (const t of tracks) {
          try {
            await addToQueue(t.uri, device.id);
            if (userId) recordPendingRequest(t.trackId, userId, `sessions: ${who}`);
            queued++;
          } catch (err) {
            logger.warn("Sessions queue: aborting after enqueue failure", {
              id: t.trackId,
              queuedSoFar: queued,
              error: String(err),
            });
            break;
          }
        }
      });
    } catch (err) {
      if (err instanceof PlaybackLockBusyError) {
        await ephemeral(
          ":hourglass_flowing_sand: Another track is being queued right now — try again in a sec.",
        );
        return;
      }
      throw err;
    }

    if (!deviceFound) {
      await ephemeral(
        ":warning: No active Spotify device. Open Spotify on your phone (or any device) and start playing something, then try again.",
      );
      return;
    }
    if (!queued) {
      await ephemeral(":warning: Couldn't queue those tracks right now — try again in a sec.");
      return;
    }
    if (userId) recordUserRequest(userId);
    const list = tracks
      .slice(0, queued)
      .map((t) => `• *${t.title}* — ${t.artist}`)
      .join("\n");
    await ephemeral(`:musical_note: Queued ${queued} from *${who}*:\n${list}`);
  } catch (err) {
    logger.error("Card sessions action failed", { error: String(err) });
  }
});

/** Strip a Spotify track URI down to its bare id for request bookkeeping. */
function uriTrackId(uri: string): string {
  return uri.split(":").pop() ?? uri;
}

const NO_ACTIVE_DEVICE_MSG =
  ":warning: No active Spotify device. Open Spotify on your phone (or any " +
  "device) and start playing something, then try again.";

// Catalogue: queue a single one of the artist's top tracks. Same locking +
// rate-limit + device discipline as the play/sessions paths.
slackApp.action(CARD_QUEUE_ACTION_RE, async ({ ack, body, action, respond }) => {
  await ack();
  const ephemeral = (text: string) =>
    respond({ response_type: "ephemeral", replace_original: false, text });
  try {
    const uri = action.type === "button" ? action.value : undefined;
    const userId = body.user?.id;
    const { channel, ts } = actionMessageRef(body);
    if (!uri || !channel || !ts) return;
    const card = getCard(cardKey(channel, ts));
    if (!card) {
      await ephemeral(CARD_EXPIRED_MSG);
      return;
    }
    const title =
      card.catalogue?.topTracks.find((t) => t.uri === uri)?.title ??
      "that track";

    if (userId) {
      const used = countUserRequestsLastHour(userId);
      if (used >= config.MAX_PLAYS_PER_USER_PER_HOUR) {
        await ephemeral(
          `:hourglass_flowing_sand: You've hit your hourly play budget (${used}/${config.MAX_PLAYS_PER_USER_PER_HOUR}). Try again later.`,
        );
        return;
      }
    }

    let queued = false;
    let deviceFound = false;
    try {
      await withPlaybackLock(async () => {
        const device = await findActiveDevice();
        if (!device) return;
        deviceFound = true;
        await addToQueue(uri, device.id);
        queued = true;
      });
    } catch (err) {
      if (err instanceof PlaybackLockBusyError) {
        await ephemeral(
          ":hourglass_flowing_sand: Another track is being queued right now — try again in a sec.",
        );
        return;
      }
      throw err;
    }

    if (!deviceFound) {
      await ephemeral(NO_ACTIVE_DEVICE_MSG);
      return;
    }
    if (!queued) {
      await ephemeral(
        ":warning: Couldn't queue that track right now — try again in a sec.",
      );
      return;
    }
    if (userId) {
      recordPendingRequest(uriTrackId(uri), userId, `catalogue: ${title}`);
      recordUserRequest(userId);
    }
    await ephemeral(`:musical_note: Queued *${title}*.`);
  } catch (err) {
    logger.error("Card queue action failed", { error: String(err) });
  }
});

// Catalogue: queue a full album (capped) from the dropdown.
slackApp.action(CARD_ALBUM_ACTION, async ({ ack, body, action, respond }) => {
  await ack();
  const ephemeral = (text: string) =>
    respond({ response_type: "ephemeral", replace_original: false, text });
  try {
    const albumId =
      action.type === "static_select"
        ? action.selected_option?.value
        : undefined;
    const userId = body.user?.id;
    const { channel, ts } = actionMessageRef(body);
    if (!albumId || !channel || !ts) return;
    const card = getCard(cardKey(channel, ts));
    if (!card) {
      await ephemeral(CARD_EXPIRED_MSG);
      return;
    }
    const albumName =
      card.catalogue?.albums.find((a) => a.id === albumId)?.name ?? "that album";

    if (userId) {
      const used = countUserRequestsLastHour(userId);
      if (used >= config.MAX_PLAYS_PER_USER_PER_HOUR) {
        await ephemeral(
          `:hourglass_flowing_sand: You've hit your hourly play budget (${used}/${config.MAX_PLAYS_PER_USER_PER_HOUR}). Try again later.`,
        );
        return;
      }
    }

    // Resolve album tracks OUTSIDE the playback lock (it hits the network);
    // only the device lookup + queue loop run inside it.
    const uris = await getAlbumTrackUris(albumId);
    if (!uris.length) {
      await ephemeral(
        `:see_no_evil: I couldn't load *${albumName}*'s tracks right now.`,
      );
      return;
    }

    let queued = 0;
    let deviceFound = false;
    try {
      await withPlaybackLock(async () => {
        const device = await findActiveDevice();
        if (!device) return;
        deviceFound = true;
        for (const uri of uris) {
          try {
            await addToQueue(uri, device.id);
            if (userId) {
              recordPendingRequest(uriTrackId(uri), userId, `album: ${albumName}`);
            }
            queued++;
          } catch (err) {
            logger.warn("Album queue: aborting after enqueue failure", {
              queuedSoFar: queued,
              error: String(err),
            });
            break;
          }
        }
      });
    } catch (err) {
      if (err instanceof PlaybackLockBusyError) {
        await ephemeral(
          ":hourglass_flowing_sand: Another track is being queued right now — try again in a sec.",
        );
        return;
      }
      throw err;
    }

    if (!deviceFound) {
      await ephemeral(NO_ACTIVE_DEVICE_MSG);
      return;
    }
    if (!queued) {
      await ephemeral(
        ":warning: Couldn't queue that album right now — try again in a sec.",
      );
      return;
    }
    if (userId) recordUserRequest(userId);
    await ephemeral(
      `:musical_note: Queued ${queued} ${
        queued === 1 ? "track" : "tracks"
      } from *${albumName}*.`,
    );
  } catch (err) {
    logger.error("Card album action failed", { error: String(err) });
  }
});

// ---- Consolidated track card: post + enrich ----------------------------
// Enrichment args shared by the knowledge/context layers — synthesized from
// whatever (Spotify track / turntable match) the caller already has.
type CardEnrichArgs = {
  track: SearchResultTrack;
  match: AcrMatch;
  viaIsrc: boolean;
};

/** Re-render a card's current view onto its Slack message. */
async function updateCardMessage(state: TrackCardState): Promise<void> {
  if (!state.channel || !state.ts) return;
  const { blocks, text } = renderTrackCard(state);
  try {
    await slackApp.client.chat.update({
      channel: state.channel,
      ts: state.ts,
      text,
      blocks,
    });
  } catch (err) {
    logger.warn("Failed to update track card", { error: String(err) });
  }
}

/**
 * Fetch the async layers (liner notes + context + cross-platform links) for a
 * card OFF the playback hot path, then reveal the now-populated tabs with a
 * single in-place update. Fire-and-forget: each layer is independently
 * best-effort and config-gated, fetches are cached, and nothing here can throw
 * into the caller.
 */
function enrichCard(state: TrackCardState, args: CardEnrichArgs): void {
  if (
    !trackKnowledgeEnabled() &&
    !trackContextEnabled() &&
    !trackLinksEnabled()
  ) {
    return;
  }
  void (async () => {
    try {
      let knowledge: TrackKnowledge | null = null;
      if (trackKnowledgeEnabled()) {
        try {
          knowledge = await enrichTrack(args);
          state.knowledge = knowledge;
          if (knowledge) {
            state.knowledgeSummary = await buildKnowledgeSummary(
              args.track,
              knowledge,
            );
          }
        } catch (err) {
          logger.error("Card knowledge enrichment failed", {
            error: String(err),
          });
        }
      }
      if (trackContextEnabled()) {
        try {
          const context = await enrichContext({ ...args, knowledge });
          state.context = context;
          if (context) {
            state.contextSummary = await buildContextSummary(
              args.track,
              context,
            );
          }
        } catch (err) {
          logger.error("Card context enrichment failed", {
            error: String(err),
          });
        }
      }
      // The artist's playable catalogue powers the Context tab's navigable
      // "More from <artist>" section. It lives in the context tab, so it's
      // gated by the same flag. Best-effort; failure leaves the tab to its
      // other content (genre/lyrics).
      if (trackContextEnabled()) {
        try {
          state.catalogue = await fetchArtistCatalogue({
            artistName: state.knowledge?.artistName || state.track.artist,
            spotifyArtistId: state.track.artistIds?.[0] ?? null,
          });
        } catch (err) {
          logger.error("Card catalogue enrichment failed", {
            error: String(err),
          });
        }
      }
      if (trackLinksEnabled()) {
        try {
          state.links = await fetchTrackLinks(state.track.id);
        } catch (err) {
          logger.error("Card links enrichment failed", {
            error: String(err),
          });
        }
      }
      await updateCardMessage(state);
    } catch (err) {
      logger.error("Card enrichment failed", { error: String(err) });
    }
  })();
}

/** Build a CardTrack from a turntable search result + its ACR match. */
function cardTrackFromSearch(
  track: SearchResultTrack,
  match: AcrMatch,
): CardTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    progressMs: 0,
    spotifyUrl: `https://open.spotify.com/track/${track.id}`,
    artistIds: [],
    isrc: match.isrc,
  };
}

/**
 * Post a consolidated track card to the chosen destination, wire up vote-skip
 * (channel only), attach any tour tidbit, and kick off async enrichment that
 * reveals the extra tabs in place. Returns true when a card was posted.
 */
async function serveTrackCard(args: {
  dest: { kind: "channel" } | { kind: "dm"; userId: string };
  source: TrackCardState["source"];
  turntableSource?: TrackCardState["turntableSource"];
  track: CardTrack;
  requestedBy: string | null;
  requestedQuery: string | null;
  viaIsrc: boolean;
  vote: boolean;
  enrichArgs: CardEnrichArgs;
  tourTidbit?: string;
}): Promise<boolean> {
  const threshold = config.SKIP_VOTE_THRESHOLD;
  const wantsVote = args.vote && args.dest.kind === "channel";
  const state: TrackCardState = {
    channel: "",
    ts: "",
    source: args.source,
    turntableSource: args.turntableSource,
    track: args.track,
    requestedBy: args.requestedBy,
    requestedQuery: args.requestedQuery,
    viaIsrc: args.viaIsrc,
    vote: wantsVote ? { count: 0, threshold } : undefined,
    view: { kind: "tab", tab: "now" },
    people: new Map(),
  };
  const channel =
    args.dest.kind === "dm" ? args.dest.userId : config.SLACK_CHANNEL_ID;

  let res;
  try {
    const rendered = renderTrackCard(state);
    res = await slackApp.client.chat.postMessage({
      channel,
      text: rendered.text,
      blocks: rendered.blocks,
    });
  } catch (err) {
    logger.warn("Failed to post track card", { error: String(err) });
    return false;
  }
  if (!res.ts || !res.channel) return false;
  state.channel = res.channel;
  state.ts = res.ts;
  putCard(state);

  if (wantsVote) {
    activeVote = {
      trackId: state.track.id,
      votes: new Map(),
      channel: state.channel,
      messageTs: state.ts,
      current: state.track,
      requestedBy: args.requestedBy,
      requestedQuery: args.requestedQuery,
      skipped: false,
      cardKey: cardKey(state.channel, state.ts),
    };
  }

  if (args.tourTidbit) {
    try {
      if (args.dest.kind === "dm") {
        await slackApp.client.chat.postMessage({
          channel,
          text: args.tourTidbit,
        });
      } else {
        await slackApp.client.chat.postMessage({
          channel: state.channel,
          thread_ts: state.ts,
          text: args.tourTidbit,
        });
      }
    } catch (err) {
      logger.warn("Failed to post tour tidbit", { error: String(err) });
    }
  }

  enrichCard(state, args.enrichArgs);
  return true;
}

// ---- Wire up now-playing watcher ---------------------------------------

nowPlayingWatcher.on("trackChange", async (event) => {
  // Reset votes — any prior card is now stale.
  activeVote = null;

  // If this track belongs to the active tour, pull (and consume) its tidbit
  // up front — synchronously, before any await, so it's never double-narrated.
  // Capturing the origin here too means a tour's narration follows where the
  // tour was started, even on the last track (when the tour clears itself).
  const tour = consumeTourTidbit(event.current.id);

  try {
    if (tour) {
      // A tour track always narrates — to wherever the tour was started.
      // DM tours stay entirely in the DM (no public card, so no vote); channel
      // tours post the consolidated card with vote-skip wired up. Either way
      // the tidbit rides along (DM follow-up / threaded reply) and the extra
      // tabs fill in via async enrichment.
      await serveTrackCard({
        dest:
          tour.origin.kind === "dm"
            ? { kind: "dm", userId: tour.origin.userId }
            : { kind: "channel" },
        source: "tour",
        track: event.current,
        requestedBy: event.requestedBySlackUser,
        requestedQuery: event.requestedQuery,
        viaIsrc: !!event.current.isrc,
        vote: true,
        enrichArgs: nowPlayingToEnrichArgs(event.current),
        tourTidbit: tour.tidbit,
      });
      return;
    }

    // Turntable sync owns the now-playing surface while it's active: every
    // track switch here was driven by the turntable engine, which posts its
    // own "now playing from the turntable" card (see the trackConfirmed
    // listener below). Suppress the ambient path so we never double-post or
    // fight the turntable's own announcement.
    if (turntableSession.isActive()) {
      logger.info("Suppressed ambient now-playing post (turntable owns it)", {
        track: event.current.title,
      });
      return;
    }

    // Ambient (non-tour) track. Normally only post a now-playing card when the
    // host Spotify account is actually in an active Jam. No Jam -> stay quiet
    // (the track still plays + gets logged elsewhere). isJamActive fails SAFE,
    // so a relay/network error resolves to "no Jam" and the card is suppressed.
    // Quiet mode is the escape hatch: route the full deep-knowledge card to the
    // host's DM and skip the relay Jam gate entirely (for private testing when
    // the home relay can't run, so isJamActive() can never be true).
    const quietUser = quietDmTarget();
    if (!quietUser && !(await isJamActive())) {
      logger.info("Suppressed ambient now-playing post (no active Jam)", {
        track: event.current.title,
      });
      return;
    }
    // Post the consolidated track card (now-playing tab). Its liner-notes /
    // context / links tabs fill in via async enrichment off the hot path — the
    // knowledge + context + links layer rides along on a NORMAL Spotify Jam
    // too, not just record mode. Spotify is the source of truth here: we drive
    // enrichment + curated notes off the track's own ISRC and Spotify's
    // reported position — no fingerprinting, no mic, no extra capture. (The
    // turntable path above owns this whole surface when it's active; this
    // branch only runs when it isn't, so the two never double-post.)
    await serveTrackCard({
      dest: quietUser
        ? { kind: "dm", userId: quietUser }
        : { kind: "channel" },
      source: "jam",
      track: event.current,
      requestedBy: event.requestedBySlackUser,
      requestedQuery: event.requestedQuery,
      viaIsrc: !!event.current.isrc,
      vote: true,
      enrichArgs: nowPlayingToEnrichArgs(event.current),
    });

    // Re-anchor the local Jam clock to THIS track synchronously — don't wait
    // for the next position poll. Otherwise the scheduler would evaluate the
    // freshly-armed insights against the *previous* track's still-advancing
    // position and dump a burst of notes at the wrong moment.
    nowPlayingAnchor = {
      offsetMs: event.current.progressMs,
      anchoredAtMs: Date.now(),
      durationMs: event.current.durationMs,
    };
    if (insightsEnabled()) {
      try {
        // No ISRC -> no insight lookup, and arm([]) disarms the scheduler so a
        // track we can't identify can't inherit the previous track's notes.
        const insights = event.current.isrc
          ? getInsightsFor({ isrc: event.current.isrc })
          : [];
        insightScheduler.arm(insights, event.current.progressMs);
      } catch (err) {
        logger.error("Failed to arm Jam insights", { error: String(err) });
      }
    }
  } catch (err) {
    logger.error("Failed to post now-playing", { error: String(err) });
  }
});

// Keep the normal-Jam clock anchor fresh from each poll's reported position so
// insights can interpolate the live playhead between polls. No extra Spotify
// calls — this is the data the watcher already fetched. Ignored while the
// turntable owns the clock (its own anchor wins in the scheduler).
nowPlayingWatcher.on("position", (event: PositionEvent) => {
  // Paused playback still reports a position, but the playhead isn't moving —
  // drop the anchor so the scheduler stands down instead of interpolating
  // forward (and firing notes) against a frozen track. The next playing tick
  // re-anchors it.
  if (!event.isPlaying) {
    nowPlayingAnchor = null;
    return;
  }
  nowPlayingAnchor = {
    offsetMs: event.progressMs,
    anchoredAtMs: Date.now(),
    durationMs: event.durationMs,
  };
});

// Connection-state notices ("no active device", "Jam is back online") are
// noise nobody actually wants — log them for debugging from the droplet
// shell and that's it. No channel post, no DM. If you need to debug a
// dropped connection: `journalctl -u jam-bot`.
nowPlayingWatcher.on("noActiveDevice", () => {
  // Nothing's playing — drop the stale clock anchor so insights stand down
  // instead of firing against a frozen position.
  nowPlayingAnchor = null;
  logger.info("No active Spotify playback detected");
});

nowPlayingWatcher.on("resumed", () => {
  logger.info("Playback resumed");
});

// ---- Turntable sync announcements --------------------------------------
// When the turntable engine confirms a new record side and drives the host
// account to it, announce it where turntable mode was started. Channel
// announcements are gated on an active Jam (isJamActive fails SAFE) — exactly
// like ambient now-playing cards — so we never claim "now playing" to a
// channel whose guests aren't actually in the Jam to hear it.
/**
 * The Slack user ID to route ambient now-playing surfaces to when quiet mode
 * is on, or null when quiet mode is off. Quiet mode requires both
 * JAM_QUIET_MODE and JAM_QUIET_DM_USER; with it on, ambient cards/insights go
 * to that DM and the relay-based Jam gate is bypassed entirely (handy when the
 * home relay can't run, so isJamActive() can never be true).
 */
function quietDmTarget(): string | null {
  return config.JAM_QUIET_MODE && config.JAM_QUIET_DM_USER
    ? config.JAM_QUIET_DM_USER
    : null;
}

/**
 * Deliver a turntable card to wherever the session was started: a DM goes
 * straight to the host; a channel-started session (or one whose origin was
 * lost across a restart) only posts when a Jam is actually live, so the
 * cascade really is reaching guests. Returns true when something was posted.
 * Shared by the now-playing card and the async liner-notes follow-up so both
 * obey the same routing + gating.
 */
async function deliverCard(
  blocks: KnownBlock[],
  text: string,
): Promise<boolean> {
  if (turntableOrigin?.kind === "dm") {
    await postDMToUser(turntableOrigin.userId, text, blocks);
    return true;
  }
  // Quiet mode: deliver privately to the host DM and skip the relay Jam gate.
  const quietUser = quietDmTarget();
  if (quietUser) {
    await postDMToUser(quietUser, text, blocks);
    return true;
  }
  if (await isJamActive()) {
    await postToChannel(blocks, text);
    return true;
  }
  return false;
}

// ---- Live timestamped insights -----------------------------------------
// Surfaces short, hand-curated musical notes at the right moment as a track
// plays — in record mode AND in a normal Spotify Jam. The scheduler reads the
// live position from whichever clock is in play (the turntable needle anchor,
// or Spotify's reported position for a normal Jam) — never seeking, never on
// the resolve/play/seek hot path — and posts a due note through the SAME
// routing + Jam gating as every other card. Armed per confirmed track; ticked
// on its own timer started in startSlackBot().
async function postInsightCard(insight: TrackInsight): Promise<void> {
  const text = `:musical_note: ${insight.text}`;
  const blocks: KnownBlock[] = [
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `:musical_note: ${insight.text}` }],
    },
  ];
  const posted = await deliverCard(blocks, text);
  if (!posted) {
    logger.info("Suppressed insight (no active Jam)", {
      positionMs: insight.positionMs,
    });
  }
}

// Local clock anchor for a NORMAL Spotify Jam. Refreshed every now-playing
// poll tick straight from Spotify's reported position (no extra API calls), so
// we can interpolate the live playhead between polls — the same maths the
// turntable uses for its needle clock. Null when nothing is playing.
let nowPlayingAnchor: ClockAnchor | null = null;

// Single insight scheduler, one position source pluggable by mode: the
// turntable's needle clock when a record session is live, otherwise the normal
// Jam's Spotify-derived clock. Only one path arms it at a time (turntable mode
// suppresses the ambient path), so they never fight over the same scheduler.
const insightScheduler = new InsightScheduler(
  () => {
    const s = turntableSession.status();
    if (s.active) return s.positionMs;
    return nowPlayingAnchor
      ? computeTargetPositionMs(nowPlayingAnchor, Date.now())
      : null;
  },
  postInsightCard,
  { minGapMs: config.TRACK_INSIGHTS_MIN_GAP_MS },
);

/**
 * Adapt a track Spotify is already playing into the {match, track} shape the
 * enrichment + insight lookups expect. There's no fingerprint here — Spotify is
 * the source of truth — so we synthesize a match from the track's own metadata
 * and real ISRC. `viaIsrc` is true whenever Spotify gave us an ISRC, since the
 * track IS the exact recording (not a fuzzy title match).
 */
function nowPlayingToEnrichArgs(track: NonNullable<CurrentlyPlaying["track"]>): {
  track: SearchResultTrack;
  match: AcrMatch;
  viaIsrc: boolean;
} {
  const match: AcrMatch = {
    acrid: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    isrc: track.isrc,
    playOffsetMs: 0,
  };
  const searchTrack: SearchResultTrack = {
    id: track.id,
    uri: `spotify:track:${track.id}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
  };
  return { track: searchTrack, match, viaIsrc: !!track.isrc };
}

turntableSession.on("trackConfirmed", async ({ track, match, viaIsrc }) => {
  try {
    // Resolve the destination with the SAME routing + Jam gating deliverCard
    // uses: a DM-started session goes straight to the host; a channel session
    // only posts when a Jam is actually live (so the cascade really is reaching
    // guests), otherwise the card is suppressed entirely.
    const dest: { kind: "channel" } | { kind: "dm"; userId: string } | null =
      turntableOrigin?.kind === "dm"
        ? { kind: "dm", userId: turntableOrigin.userId }
        : (await isJamActive())
          ? { kind: "channel" }
          : null;
    if (dest) {
      await serveTrackCard({
        dest,
        source: "turntable",
        // Surface whether the Jam is following a physical record or the
        // computer's own audio, from the latest clip the helper labelled.
        turntableSource: turntableSession.status().source,
        track: cardTrackFromSearch(track, match),
        requestedBy: null,
        requestedQuery: null,
        viaIsrc,
        vote: true,
        enrichArgs: { track, match, viaIsrc },
      });
    } else {
      logger.info("Suppressed turntable now-playing post (no active Jam)", {
        track: track.title,
      });
    }
  } catch (err) {
    logger.error("Failed to post turntable now-playing", {
      error: String(err),
    });
  }

  // Arm live timestamped insights for this record. We key off the ISRC the
  // match already carries (no API call, no dependency on the knowledge layer),
  // and baseline at the position the record is at RIGHT NOW so we never fire a
  // note for a moment already passed when we tuned in mid-track. The scheduler
  // reads the live clock on its own timer and posts due notes; an empty lookup
  // simply leaves it disarmed, so tracks with no curated notes stay silent.
  if (insightsEnabled()) {
    try {
      const insights = getInsightsFor({ isrc: match.isrc });
      const pos = turntableSession.status().positionMs ?? 0;
      insightScheduler.arm(insights, pos);
    } catch (err) {
      logger.error("Failed to arm turntable insights", {
        error: String(err),
      });
    }
  }
});

turntableSession.on("error", ({ stage, error }) => {
  logger.warn("Turntable engine error", { stage, error });
});

setInterval(() => {
  expireOldPending();
  expireOldUserRequests();
  expireEngagementSessions(config.JAM_ENGAGE_TIMEOUT_MS);
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
  if (insightsEnabled()) insightScheduler.start();
  logger.info(`Slack bot connected (channel ${config.SLACK_CHANNEL_ID})`);
  const quietUser = quietDmTarget();
  logger.info(
    quietUser
      ? `Quiet mode ACTIVE — ambient + /nowplaying deep cards route to DM ${quietUser}`
      : "Quiet mode OFF — set JAM_QUIET_MODE=true AND JAM_QUIET_DM_USER=<your Slack user id> to DM deep cards",
  );
  logger.info(
    "Active engagement (thread mode) needs the `message.channels` event " +
      "subscription + `channels:history` scope. If she only replies when " +
      "re-mentioned, re-apply deploy/slack-app-manifest.yaml and reinstall.",
  );
}

export function stopWrappedScheduler() {
  wrappedScheduler.stop();
  insightScheduler.stop();
}
