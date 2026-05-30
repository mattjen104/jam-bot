import { describe, it, expect, vi, beforeAll } from "vitest";

type CmdHandler = (ctx: {
  command: { channel_id: string; user_id: string; text: string; command: string };
  ack: () => Promise<void>;
  respond: (msg: unknown) => Promise<void>;
}) => Promise<void>;

type EventHandler = (ctx: {
  event: Record<string, unknown>;
  say: (arg: { text: string; blocks?: unknown; thread_ts?: string }) => Promise<void>;
  client?: unknown;
}) => Promise<void>;

const captured: {
  commands: Record<string, CmdHandler>;
  events: Record<string, EventHandler>;
} = { commands: {}, events: {} };

vi.mock("@slack/bolt", () => {
  class FakeApp {
    client = {
      chat: { postMessage: vi.fn().mockResolvedValue({}) },
      auth: { test: vi.fn().mockResolvedValue({ user_id: "BOT" }) },
      users: {
        info: vi
          .fn()
          .mockResolvedValue({ user: { profile: { display_name: "Tester" } } }),
      },
    };
    command(name: string, handler: CmdHandler) {
      captured.commands[name] = handler;
    }
    event(name: string, handler: EventHandler) {
      captured.events[name] = handler;
    }
    message(_handler: unknown) {
      // no-op; the bot uses event("message", ...) instead
    }
    action(_id: string, _handler: unknown) {
      // no-op for tests
    }
    start = vi.fn().mockResolvedValue(undefined);
  }
  return { App: FakeApp, LogLevel: { WARN: "warn", DEBUG: "debug", INFO: "info", ERROR: "error" } };
});

vi.mock("../src/spotify/client.js", () => ({
  searchTrack: vi.fn(),
  addToQueue: vi.fn(),
  playNow: vi.fn(),
  skipToNext: vi.fn(),
  getCurrentlyPlaying: vi.fn(),
  findActiveDevice: vi.fn(),
  createPlaylistWithTracks: vi.fn(),
}));

// In-memory engagement-session store so thread-mode behavior is exercised
// for real (start/get/end), not just spied on.
const fakeSessions = new Map<
  string,
  { channel: string; thread_ts: string; started_by: string | null; topic: string | null; last_activity_ms: number }
>();
const sessKey = (c: string, t: string) => `${c}::${t}`;

vi.mock("../src/db.js", () => ({
  recordPendingRequest: vi.fn(),
  recentPlayed: vi.fn(() => []),
  expireOldPending: vi.fn(),
  recordUserRequest: vi.fn(),
  countUserRequestsLastHour: vi.fn(() => 0),
  expireOldUserRequests: vi.fn(),
  setOptOut: vi.fn(),
  isOptedOut: vi.fn(() => false),
  addUserMemory: vi.fn(),
  getUserMemories: vi.fn(() => []),
  forgetUserMemories: vi.fn(),
  touchUserMemories: vi.fn(),
  getCachedUserName: vi.fn(() => null),
  setCachedUserName: vi.fn(),
  userTotalPlays: vi.fn(() => 0),
  userArtistVector: vi.fn(() => []),
  userSignatureTrack: vi.fn(() => null),
  startEngagementSession: vi.fn(
    (channel: string, thread_ts: string, started_by: string | null, topic: string | null = null) => {
      const existing = fakeSessions.get(sessKey(channel, thread_ts));
      if (existing) {
        existing.last_activity_ms = Date.now();
        return;
      }
      fakeSessions.set(sessKey(channel, thread_ts), {
        channel,
        thread_ts,
        started_by,
        topic,
        last_activity_ms: Date.now(),
      });
    },
  ),
  refreshEngagementSession: vi.fn((channel: string, thread_ts: string) => {
    const s = fakeSessions.get(sessKey(channel, thread_ts));
    if (s) s.last_activity_ms = Date.now();
  }),
  getEngagementSession: vi.fn((channel: string, thread_ts: string, maxIdleMs: number) => {
    const s = fakeSessions.get(sessKey(channel, thread_ts));
    if (!s) return null;
    if (Date.now() - s.last_activity_ms > maxIdleMs) {
      fakeSessions.delete(sessKey(channel, thread_ts));
      return null;
    }
    return s;
  }),
  endEngagementSession: vi.fn((channel: string, thread_ts: string) => {
    fakeSessions.delete(sessKey(channel, thread_ts));
  }),
  expireEngagementSessions: vi.fn(),
}));

// Partial mock: keep the REAL deterministic gate helpers (detectProvoked,
// needsPersonalization, isForgetMemoryRequest, isRecallMemoryRequest) and
// only stub the network-bound functions.
vi.mock("../src/llm/openrouter.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/llm/openrouter.js")>();
  return {
    ...actual,
    askLLM: vi.fn(),
    classifyIntent: vi.fn(),
    narrate: vi.fn().mockResolvedValue("narration"),
    extractMemories: vi.fn().mockResolvedValue([]),
    curateTourPicks: vi.fn(),
    writeTourTidbits: vi.fn(),
  };
});

vi.mock("../src/wrapped.js", () => ({
  buildWrappedStats: vi.fn(() => ({
    start: new Date(),
    end: new Date(),
    startStr: "",
    endStr: "",
    totalPlays: 0,
    topTracks: [],
    topArtists: [],
    perUser: [],
    lateNightPlays: 0,
    daytimePlays: 0,
  })),
  WrappedScheduler: class {
    start() {}
    stop() {}
  },
}));

vi.mock("../src/dna.js", () => ({
  buildDnaStats: vi.fn(() => ({
    slackUser: "U",
    totalPlays: 0,
    topArtists: [],
    signatureTrackId: null,
    signatureTrackPlays: 0,
    discoveryCount: 0,
    discoveryRate: 0,
  })),
  buildCompatStats: vi.fn(),
}));

vi.mock("../src/memory.js", () => ({
  askLLMForSet: vi.fn(),
  isMemoryPlaybackRequest: vi.fn(() => false),
}));

vi.mock("../src/now-playing.js", async () => {
  const { EventEmitter } = await import("node:events");
  return { nowPlayingWatcher: new EventEmitter() };
});

vi.mock("../src/slack/format.js", () => ({
  historyBlocks: () => [],
  noDeviceBlocks: () => [],
  nowPlayingBlocks: () => [],
  wrappedBlocks: () => [],
  dnaBlocks: () => [],
  compatBlocks: () => [],
  VOTE_SKIP_ACTION_ID: "jam_vote_skip",
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  const bot = await import("../src/slack/bot.js");
  // Caches the bot user id ("BOT" from the FakeApp auth.test mock) so the
  // engaged-thread handler can skip messages that re-mention the bot.
  await bot.startSlackBot();
});

describe("slash command channel authorization", () => {
  it("rejects /play from a non-jam channel ephemerally and never invokes Spotify", async () => {
    const spotify = await import("../src/spotify/client.js");
    (spotify.playNow as ReturnType<typeof vi.fn>).mockClear();
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockClear();

    const handler = captured.commands["/play"];
    expect(handler).toBeDefined();

    const ack = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn().mockResolvedValue(undefined);
    await handler!({
      command: {
        channel_id: "C_WRONG_CHANNEL",
        user_id: "U_alice",
        text: "any song",
        command: "/play",
      },
      ack,
      respond,
    });

    expect(ack).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(1);
    const arg = respond.mock.calls[0]?.[0] as { response_type: string; text: string };
    expect(arg.response_type).toBe("ephemeral");
    expect(arg.text).toMatch(/only accepts commands/i);
    expect(spotify.playNow).not.toHaveBeenCalled();
    expect(spotify.searchTrack).not.toHaveBeenCalled();
  });

  it("calls Spotify play with the searched URI when /play is invoked from the jam channel", async () => {
    const spotify = await import("../src/spotify/client.js");
    (spotify.playNow as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue(undefined);
    (spotify.findActiveDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "DEV-1",
      name: "Jam Host",
      isActive: true,
    });
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: false,
      track: null,
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "trk-42",
      uri: "spotify:track:trk-42",
      title: "Hello",
      artist: "Adele",
      album: "25",
      durationMs: 1000,
    });

    const handler = captured.commands["/play"];
    const ack = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn().mockResolvedValue(undefined);
    await handler!({
      command: {
        channel_id: process.env.SLACK_CHANNEL_ID!,
        user_id: "U_bob",
        text: "hello adele",
        command: "/play",
      },
      ack,
      respond,
    });

    expect(spotify.playNow).toHaveBeenCalledWith("spotify:track:trk-42", "DEV-1");
    const inChannel = respond.mock.calls.find(
      ([m]) => (m as { response_type?: string }).response_type === "in_channel",
    );
    expect(inChannel).toBeDefined();
  });
});

describe("intent classifier routing via app_mention", () => {
  it("routes intent=play to handlePlayOrQueue and calls Spotify play", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const spotify = await import("../src/spotify/client.js");
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "play",
      query: "bohemian rhapsody",
    });
    (spotify.findActiveDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "DEV-99",
      name: "Jam Host",
      isActive: true,
    });
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: false,
      track: null,
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "br",
      uri: "spotify:track:br",
      title: "Bohemian Rhapsody",
      artist: "Queen",
      album: "A Night at the Opera",
      durationMs: 1,
    });
    (spotify.playNow as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue(undefined);
    (spotify.skipToNext as ReturnType<typeof vi.fn>).mockClear();

    const handler = captured.events["app_mention"];
    expect(handler).toBeDefined();
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_carol",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> play bohemian rhapsody",
        ts: "1700000000.000100",
      },
      say,
    });
    expect(llm.classifyIntent).toHaveBeenCalledWith("play bohemian rhapsody");
    expect(spotify.playNow).toHaveBeenCalledWith("spotify:track:br", "DEV-99");
    expect(spotify.skipToNext).not.toHaveBeenCalled();
  });

  it("routes intent=skip to handleSkip and calls Spotify skipToNext", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const spotify = await import("../src/spotify/client.js");
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "skip",
    });
    (spotify.findActiveDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "DEV-77",
      name: "Jam Host",
      isActive: true,
    });
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: true,
      track: {
        id: "trk-skip",
        title: "Skip Me",
        artist: "Tester",
        album: "Album",
        durationMs: 1000,
        progressMs: 0,
        spotifyUrl: "https://open.spotify.com/track/trk-skip",
        artistIds: [],
      },
    });
    (spotify.skipToNext as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue(undefined);
    (spotify.playNow as ReturnType<typeof vi.fn>).mockClear();

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_dave",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> skip this one",
        ts: "1700000000.000200",
      },
      say,
    });
    expect(spotify.skipToNext).toHaveBeenCalledWith("DEV-77");
    expect(spotify.playNow).not.toHaveBeenCalled();
  });

  it("routes intent=question to askLLM and replies with the answer", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const spotify = await import("../src/spotify/client.js");
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue("It was 1975.");
    (spotify.playNow as ReturnType<typeof vi.fn>).mockClear();
    (spotify.skipToNext as ReturnType<typeof vi.fn>).mockClear();

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_eve",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> when did bohemian rhapsody come out?",
        ts: "1700000000.000300",
      },
      say,
    });
    expect(llm.askLLM).toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({ text: "It was 1975." }),
    );
    expect(spotify.playNow).not.toHaveBeenCalled();
    expect(spotify.skipToNext).not.toHaveBeenCalled();
  });

  it("ignores app_mentions from a different channel", async () => {
    const llm = await import("../src/llm/openrouter.js");
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockClear();

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_frank",
        channel: "C_OTHER",
        text: "<@BOT> play something",
        ts: "1700000000.000400",
      },
      say,
    });
    expect(llm.classifyIntent).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });
});

describe("per-user identity & on-demand memory (#25)", () => {
  it("passes the resolved speaker name into askLLM for plain questions", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const db = await import("../src/db.js");
    (db.getCachedUserName as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue("answer");

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_grace",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> who produced this album?",
        ts: "1700000000.000500",
      },
      say,
    });

    const opts = (llm.askLLM as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[3] as {
      speakerName?: string;
      personalization?: string;
      provoked?: boolean;
    };
    expect(opts?.speakerName).toBe("Tester");
    // Ordinary chat: no personalization injected, not provoked.
    expect(opts?.personalization).toBe("");
    expect(opts?.provoked).toBe(false);
  });

  it("marks the turn provoked when the speaker insults the bot", async () => {
    const llm = await import("../src/llm/openrouter.js");
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue("zinger");

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_heckler",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> you suck and your taste is trash",
        ts: "1700000000.000600",
      },
      say,
    });

    const opts = (llm.askLLM as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[3] as {
      provoked?: boolean;
    };
    expect(opts?.provoked).toBe(true);
  });

  it("injects personalization on a self/past question but not on ordinary chat", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const db = await import("../src/db.js");
    (db.userTotalPlays as ReturnType<typeof vi.fn>).mockReturnValue(12);
    (db.userArtistVector as ReturnType<typeof vi.fn>).mockReturnValue([
      { artist: "Radiohead", plays: 9 },
    ]);
    (db.getUserMemories as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 1, slack_user: "U_x", fact: "Loves shoegaze", category: "taste" },
    ]);
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue("ok");

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_self",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> what do you think I should listen to for me?",
        ts: "1700000000.000700",
      },
      say,
    });

    const opts = (llm.askLLM as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[3] as {
      personalization?: string;
    };
    expect(opts?.personalization).toMatch(/Radiohead/);
    expect(opts?.personalization).toMatch(/shoegaze/);

    // Reset the memory mocks so other tests see the empty default again.
    (db.getUserMemories as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (db.userTotalPlays as ReturnType<typeof vi.fn>).mockReturnValue(0);
    (db.userArtistVector as ReturnType<typeof vi.fn>).mockReturnValue([]);
  });

  it("never injects personalization for an opted-out heckler", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const db = await import("../src/db.js");
    (db.isOptedOut as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    (db.userTotalPlays as ReturnType<typeof vi.fn>).mockReturnValue(50);
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue("x");

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_optout",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> you absolute idiot",
        ts: "1700000000.000800",
      },
      say,
    });

    const opts = (llm.askLLM as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[3] as {
      provoked?: boolean;
      personalization?: string;
    };
    expect(opts?.provoked).toBe(true);
    expect(opts?.personalization).toBe("");
    (db.userTotalPlays as ReturnType<typeof vi.fn>).mockReturnValue(0);
  });

  it("answers 'what do you remember about me' from the store without an LLM call", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const db = await import("../src/db.js");
    (db.getUserMemories as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { id: 1, slack_user: "U_r", fact: "Hates country", category: "taste" },
    ]);
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear();
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockClear();

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_r",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> what do you remember about me?",
        ts: "1700000000.000900",
      },
      say,
    });

    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Hates country") }),
    );
    expect(llm.askLLM).not.toHaveBeenCalled();
    expect(llm.classifyIntent).not.toHaveBeenCalled();
  });

  it("clears stored memories on a forget request", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const db = await import("../src/db.js");
    (db.forgetUserMemories as ReturnType<typeof vi.fn>).mockClear();
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear();

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_forget",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> forget everything about me",
        ts: "1700000000.001000",
      },
      say,
    });

    expect(db.forgetUserMemories).toHaveBeenCalledWith("U_forget");
    expect(llm.askLLM).not.toHaveBeenCalled();
  });

  it("kicks off background fact extraction after a question reply", async () => {
    const llm = await import("../src/llm/openrouter.js");
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockResolvedValue("noted");
    (llm.extractMemories as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue([]);

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_fact",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "<@BOT> I love jazz and hate country",
        ts: "1700000000.001100",
      },
      say,
    });
    await flush();
    expect(llm.extractMemories).toHaveBeenCalled();
  });
});

describe("isDismissRequest deterministic helper (#26)", () => {
  it("matches clear dismissals", async () => {
    const { isDismissRequest } = await import("../src/llm/openrouter.js");
    for (const t of [
      "stop",
      "stop it",
      "ok stop",
      "okay, that's enough",
      "thanks, we're done",
      "that's all",
      "you can go",
      "knock it off",
      "alright, dismissed",
      "we're all set",
    ]) {
      expect(isDismissRequest(t), t).toBe(true);
    }
  });

  it("does NOT match ordinary chatter that merely contains a stop-word", async () => {
    const { isDismissRequest } = await import("../src/llm/openrouter.js");
    for (const t of [
      "stop me if you've heard this one",
      "what time does the show stop?",
      "I'm done with my homework, what next?",
      "that's enough about me, tell me about you",
      "should we go to the concert?",
    ]) {
      expect(isDismissRequest(t), t).toBe(false);
    }
  });
});

describe("active engagement / thread mode (#26)", () => {
  const CH = process.env.SLACK_CHANNEL_ID!;

  it("starts a thread session and passes engaged=true to askLLM on @mention", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const db = await import("../src/db.js");
    fakeSessions.clear();
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue("sure");

    const handler = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      event: {
        user: "U_thread",
        channel: CH,
        text: "<@BOT> tell me about shoegaze",
        ts: "1700000001.000100",
      },
      say,
    });

    expect(db.startEngagementSession).toHaveBeenCalled();
    expect(db.getEngagementSession(CH, "1700000001.000100", 10 * 60 * 1000)).not.toBeNull();
    const opts = (llm.askLLM as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[3] as {
      engaged?: boolean;
    };
    expect(opts?.engaged).toBe(true);
  });

  it("answers an un-mentioned thread reply while a session is active", async () => {
    const llm = await import("../src/llm/openrouter.js");
    fakeSessions.clear();
    const thread = "1700000002.000100";
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue("more");

    const mention = captured.events["app_mention"];
    const say = vi.fn().mockResolvedValue(undefined);
    await mention!({
      event: { user: "U_a", channel: CH, text: "<@BOT> hey", ts: thread },
      say,
    });

    const msg = captured.events["message"];
    const client = { chat: { postMessage: vi.fn().mockResolvedValue({}) } };
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear();
    await msg!({
      event: {
        user: "U_b",
        channel: CH,
        type: "message",
        channel_type: "channel",
        text: "what about slowdive specifically?",
        ts: "1700000002.000200",
        thread_ts: thread,
      },
      say: vi.fn(),
      client,
    } as never);

    expect(llm.askLLM).toHaveBeenCalled();
    const opts = (llm.askLLM as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[3] as {
      engaged?: boolean;
    };
    expect(opts?.engaged).toBe(true);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: thread }),
    );
  });

  it("ignores a thread reply when there is no active session", async () => {
    const llm = await import("../src/llm/openrouter.js");
    fakeSessions.clear();
    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear();
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockClear();

    const msg = captured.events["message"];
    const client = { chat: { postMessage: vi.fn().mockResolvedValue({}) } };
    await msg!({
      event: {
        user: "U_c",
        channel: CH,
        type: "message",
        channel_type: "channel",
        text: "just chatting in a random thread",
        ts: "1700000003.000200",
        thread_ts: "1700000003.000100",
      },
      say: vi.fn(),
      client,
    } as never);

    expect(llm.askLLM).not.toHaveBeenCalled();
    expect(llm.classifyIntent).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("ignores a thread reply that re-mentions the bot (owned by app_mention)", async () => {
    const llm = await import("../src/llm/openrouter.js");
    fakeSessions.clear();
    const thread = "1700000004.000100";
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockResolvedValue("x");
    const mention = captured.events["app_mention"];
    await mention!({
      event: { user: "U_a", channel: CH, text: "<@BOT> hey", ts: thread },
      say: vi.fn(),
    });

    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear();
    const msg = captured.events["message"];
    const client = { chat: { postMessage: vi.fn().mockResolvedValue({}) } };
    await msg!({
      event: {
        user: "U_b",
        channel: CH,
        type: "message",
        channel_type: "channel",
        text: "<@BOT> follow up question",
        ts: "1700000004.000200",
        thread_ts: thread,
      },
      say: vi.fn(),
      client,
    } as never);

    expect(llm.askLLM).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("still answers an engaged reply that @mentions a DIFFERENT user (skip is bot-specific)", async () => {
    const llm = await import("../src/llm/openrouter.js");
    fakeSessions.clear();
    const thread = "1700000006.000100";
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockResolvedValue("yep");
    const mention = captured.events["app_mention"];
    await mention!({
      event: { user: "U_a", channel: CH, text: "<@BOT> hey", ts: thread },
      say: vi.fn(),
    });

    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear();
    const msg = captured.events["message"];
    const client = { chat: { postMessage: vi.fn().mockResolvedValue({}) } };
    await msg!({
      event: {
        user: "U_b",
        channel: CH,
        type: "message",
        channel_type: "channel",
        text: "what does <@U_someone_else> think about this?",
        ts: "1700000006.000200",
        thread_ts: thread,
      },
      say: vi.fn(),
      client,
    } as never);

    expect(llm.askLLM).toHaveBeenCalled();
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: thread }),
    );
  });

  it("ends the session and bows out on dismissal in-thread", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const db = await import("../src/db.js");
    fakeSessions.clear();
    const thread = "1700000005.000100";
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "question",
    });
    (llm.askLLM as ReturnType<typeof vi.fn>).mockResolvedValue("ok");
    const mention = captured.events["app_mention"];
    await mention!({
      event: { user: "U_a", channel: CH, text: "<@BOT> hey", ts: thread },
      say: vi.fn(),
    });
    expect(db.getEngagementSession(CH, thread, 10 * 60 * 1000)).not.toBeNull();

    (llm.askLLM as ReturnType<typeof vi.fn>).mockClear();
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockClear();
    const msg = captured.events["message"];
    const client = { chat: { postMessage: vi.fn().mockResolvedValue({}) } };
    await msg!({
      event: {
        user: "U_b",
        channel: CH,
        type: "message",
        channel_type: "channel",
        text: "ok, that's enough",
        ts: "1700000005.000200",
        thread_ts: thread,
      },
      say: vi.fn(),
      client,
    } as never);

    expect(db.getEngagementSession(CH, thread, 10 * 60 * 1000)).toBeNull();
    expect(llm.askLLM).not.toHaveBeenCalled();
    expect(llm.classifyIntent).not.toHaveBeenCalled();
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe("guided music tour", () => {
  const CH = process.env.SLACK_CHANNEL_ID!;

  function trackEvent(id: string) {
    return {
      current: {
        id,
        title: `Title ${id}`,
        artist: "Artist",
        album: "Album",
        albumImageUrl: null,
        durationMs: 1000,
        progressMs: 0,
        spotifyUrl: `https://open.spotify.com/track/${id}`,
        artistIds: [],
      },
      requestedBySlackUser: "U_tour",
      requestedQuery: null,
    };
  }

  it("curates real tracks, queues the set, and narrates each track as it plays", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const spotify = await import("../src/spotify/client.js");
    const bot = await import("../src/slack/bot.js");
    const { nowPlayingWatcher } = await import("../src/now-playing.js");

    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "tour",
      query: "Motown",
    });
    (llm.curateTourPicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      intro: "Welcome to Motown.",
      picks: [
        { title: "My Girl", artist: "The Temptations" },
        { title: "Ghost Track", artist: "Nobody" },
        { title: "Respect", artist: "Aretha Franklin" },
      ],
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockImplementation(
      async (q: string) => {
        if (q.startsWith("My Girl"))
          return { id: "t1", uri: "spotify:track:t1", title: "My Girl", artist: "The Temptations", album: "The Temptations Sing Smokey", durationMs: 1 };
        if (q.startsWith("Respect"))
          return { id: "t2", uri: "spotify:track:t2", title: "Respect", artist: "Aretha Franklin", album: "I Never Loved a Man", durationMs: 1 };
        return null; // fabricated pick is unfindable -> dropped
      },
    );
    (llm.writeTourTidbits as ReturnType<typeof vi.fn>).mockResolvedValue([
      "Tidbit one.",
      "Tidbit two.",
    ]);
    (spotify.findActiveDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "DEV-T",
      name: "Jam Host",
      isActive: true,
    });
    (spotify.playNow as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue(undefined);
    (spotify.addToQueue as ReturnType<typeof vi.fn>).mockClear().mockResolvedValue(undefined);

    const post = bot.slackApp.client.chat.postMessage as ReturnType<typeof vi.fn>;
    post.mockResolvedValue({ ts: "CARD1", channel: CH });

    const mention = captured.events["app_mention"];
    await mention!({
      event: {
        user: "U_tour",
        channel: CH,
        text: "<@BOT> give us a tour of Motown",
        ts: "1700001000.000100",
      },
      say: vi.fn().mockResolvedValue(undefined),
    });

    // Only the two REAL tracks were queued; the fabricated pick was dropped.
    expect(spotify.playNow).toHaveBeenCalledWith("spotify:track:t1", "DEV-T");
    expect(spotify.addToQueue).toHaveBeenCalledTimes(1);
    expect(spotify.addToQueue).toHaveBeenCalledWith("spotify:track:t2", "DEV-T");

    // First tour track plays -> its tidbit posts as a threaded reply on the card.
    post.mockClear();
    nowPlayingWatcher.emit("trackChange", trackEvent("t1"));
    await flush();
    const threaded1 = post.mock.calls
      .map((c) => c[0] as { thread_ts?: string; text?: string })
      .filter((a) => a.thread_ts === "CARD1");
    expect(threaded1).toHaveLength(1);
    expect(threaded1[0]!.text).toBe("Tidbit one.");

    // Second (last) tour track plays -> second tidbit, tour completes.
    post.mockClear();
    nowPlayingWatcher.emit("trackChange", trackEvent("t2"));
    await flush();
    const threaded2 = post.mock.calls
      .map((c) => c[0] as { thread_ts?: string; text?: string })
      .filter((a) => a.thread_ts === "CARD1");
    expect(threaded2).toHaveLength(1);
    expect(threaded2[0]!.text).toBe("Tidbit two.");

    // Tour is over: a further track change posts no threaded tidbit.
    post.mockClear();
    nowPlayingWatcher.emit("trackChange", trackEvent("t3"));
    await flush();
    const threadedAfter = post.mock.calls
      .map((c) => c[0] as { thread_ts?: string })
      .filter((a) => a.thread_ts !== undefined);
    expect(threadedAfter).toHaveLength(0);
  });

  it("stops the tour on request and goes quiet on later track changes", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const spotify = await import("../src/spotify/client.js");
    const bot = await import("../src/slack/bot.js");
    const { nowPlayingWatcher } = await import("../src/now-playing.js");

    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "tour",
      query: "Dub",
    });
    (llm.curateTourPicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      intro: "",
      picks: [{ title: "King Tubby Meets", artist: "King Tubby" }],
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "d1",
      uri: "spotify:track:d1",
      title: "King Tubby Meets",
      artist: "King Tubby",
      album: "Dub",
      durationMs: 1,
    });
    (llm.writeTourTidbits as ReturnType<typeof vi.fn>).mockResolvedValue(["Dub tidbit."]);
    (spotify.findActiveDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "DEV-D",
      name: "Jam Host",
      isActive: true,
    });
    (spotify.playNow as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const post = bot.slackApp.client.chat.postMessage as ReturnType<typeof vi.fn>;
    post.mockResolvedValue({ ts: "CARD2", channel: CH });

    const mention = captured.events["app_mention"];
    await mention!({
      event: {
        user: "U_tour2",
        channel: CH,
        text: "<@BOT> give us a tour of Dub",
        ts: "1700002000.000100",
      },
      say: vi.fn().mockResolvedValue(undefined),
    });

    // Stop the tour BEFORE its track plays — classifyIntent must NOT be hit
    // (deterministic stop short-circuit) and the tour goes inactive.
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockClear();
    const say = vi.fn().mockResolvedValue(undefined);
    await mention!({
      event: {
        user: "U_tour2",
        channel: CH,
        text: "<@BOT> stop the tour",
        ts: "1700002000.000200",
      },
      say,
    });
    expect(llm.classifyIntent).not.toHaveBeenCalled();

    // The queued track now plays, but the tour was stopped -> no tidbit.
    post.mockClear();
    nowPlayingWatcher.emit("trackChange", trackEvent("d1"));
    await flush();
    const threaded = post.mock.calls
      .map((c) => c[0] as { thread_ts?: string })
      .filter((a) => a.thread_ts !== undefined);
    expect(threaded).toHaveLength(0);
  });

  it("saves the last tour as a playlist using the already-resolved uris", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const spotify = await import("../src/spotify/client.js");

    // First, kick off a tour so there's a savable set with real uris.
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "tour",
      query: "Soul",
    });
    (llm.curateTourPicks as ReturnType<typeof vi.fn>).mockResolvedValue({
      intro: "A soul primer.",
      picks: [
        { title: "What's Going On", artist: "Marvin Gaye" },
        { title: "A Change Is Gonna Come", artist: "Sam Cooke" },
      ],
    });
    (spotify.searchTrack as ReturnType<typeof vi.fn>).mockImplementation(
      async (q: string) => {
        if (q.startsWith("What's Going On"))
          return { id: "s1", uri: "spotify:track:s1", title: "What's Going On", artist: "Marvin Gaye", album: "What's Going On", durationMs: 1 };
        if (q.startsWith("A Change Is Gonna Come"))
          return { id: "s2", uri: "spotify:track:s2", title: "A Change Is Gonna Come", artist: "Sam Cooke", album: "Ain't That Good News", durationMs: 1 };
        return null;
      },
    );
    (llm.writeTourTidbits as ReturnType<typeof vi.fn>).mockResolvedValue([
      "Marvin tidbit.",
      "Sam tidbit.",
    ]);
    (spotify.findActiveDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "DEV-S",
      name: "Jam Host",
      isActive: true,
    });
    (spotify.playNow as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (spotify.addToQueue as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const mention = captured.events["app_mention"];
    await mention!({
      event: {
        user: "U_save",
        channel: CH,
        text: "<@BOT> give us a tour of Soul",
        ts: "1700003000.000100",
      },
      say: vi.fn().mockResolvedValue(undefined),
    });

    // Now ask to save it. classifyIntent must NOT be hit — deterministic
    // save short-circuit — and the resolved tour uris get persisted.
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockClear();
    (spotify.createPlaylistWithTracks as ReturnType<typeof vi.fn>)
      .mockClear()
      .mockResolvedValue({
        id: "PL1",
        url: "https://open.spotify.com/playlist/PL1",
      });

    const say = vi.fn().mockResolvedValue(undefined);
    await mention!({
      event: {
        user: "U_save",
        channel: CH,
        text: "<@BOT> save the tour",
        ts: "1700003000.000200",
      },
      say,
    });

    expect(llm.classifyIntent).not.toHaveBeenCalled();
    expect(spotify.createPlaylistWithTracks).toHaveBeenCalledTimes(1);
    const arg = (spotify.createPlaylistWithTracks as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as { name: string; uris: string[] };
    expect(arg.uris).toEqual(["spotify:track:s1", "spotify:track:s2"]);
    expect(arg.name).toContain("Soul");
    // The reply links the playlist and re-posts the tidbits.
    const reply = say.mock.calls.at(-1)?.[0] as { text: string };
    expect(reply.text).toContain("https://open.spotify.com/playlist/PL1");
    expect(reply.text).toContain("Marvin tidbit.");
    expect(reply.text).toContain("Sam tidbit.");
  });
});
