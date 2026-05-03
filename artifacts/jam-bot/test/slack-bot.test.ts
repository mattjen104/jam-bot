import { describe, it, expect, vi, beforeAll } from "vitest";

type CmdHandler = (ctx: {
  command: { channel_id: string; user_id: string; text: string; command: string };
  ack: () => Promise<void>;
  respond: (msg: unknown) => Promise<void>;
}) => Promise<void>;

type MsgHandler = (ctx: {
  message: Record<string, unknown>;
  say: (arg: { text: string; blocks?: unknown; thread_ts?: string }) => Promise<void>;
}) => Promise<void>;

const captured: {
  commands: Record<string, CmdHandler>;
  message?: MsgHandler;
} = { commands: {} };

vi.mock("@slack/bolt", () => {
  class FakeApp {
    client = {
      chat: { postMessage: vi.fn().mockResolvedValue({}) },
      auth: { test: vi.fn().mockResolvedValue({ user_id: "BOT" }) },
    };
    command(name: string, handler: CmdHandler) {
      captured.commands[name] = handler;
    }
    message(handler: MsgHandler) {
      captured.message = handler;
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
  ensurePlaybackOnHost: vi.fn(),
  getCurrentlyPlaying: vi.fn(),
  findHostDevice: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  recordPendingRequest: vi.fn(),
  recentPlayed: vi.fn(() => []),
  expireOldPending: vi.fn(),
  recordUserRequest: vi.fn(),
  countUserRequestsLastHour: vi.fn(() => 0),
  expireOldUserRequests: vi.fn(),
  setOptOut: vi.fn(),
  isOptedOut: vi.fn(() => false),
}));

vi.mock("../src/llm/openrouter.js", () => ({
  askLLM: vi.fn(),
  classifyIntent: vi.fn(),
  narrate: vi.fn().mockResolvedValue("narration"),
}));

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

beforeAll(async () => {
  await import("../src/slack/bot.js");
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
    (spotify.ensurePlaybackOnHost as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "DEV-1",
      name: "Jam Host",
      isActive: true,
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

describe("intent classifier routing in channel messages", () => {
  it("routes intent=play to handlePlayOrQueue and calls Spotify play", async () => {
    const llm = await import("../src/llm/openrouter.js");
    const spotify = await import("../src/spotify/client.js");
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: "play",
      query: "bohemian rhapsody",
    });
    (spotify.ensurePlaybackOnHost as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "DEV-99",
      name: "Jam Host",
      isActive: true,
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

    const handler = captured.message;
    expect(handler).toBeDefined();
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      message: {
        user: "U_carol",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "play bohemian rhapsody",
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
    (spotify.findHostDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
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

    const handler = captured.message;
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      message: {
        user: "U_dave",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "skip this one",
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
    (llm.askLLM as ReturnType<typeof vi.fn>).mockResolvedValue("It was 1975.");
    (spotify.playNow as ReturnType<typeof vi.fn>).mockClear();
    (spotify.skipToNext as ReturnType<typeof vi.fn>).mockClear();

    const handler = captured.message;
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      message: {
        user: "U_eve",
        channel: process.env.SLACK_CHANNEL_ID!,
        text: "when did bohemian rhapsody come out?",
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

  it("ignores messages from a different channel", async () => {
    const llm = await import("../src/llm/openrouter.js");
    (llm.classifyIntent as ReturnType<typeof vi.fn>).mockClear();

    const handler = captured.message;
    const say = vi.fn().mockResolvedValue(undefined);
    await handler!({
      message: {
        user: "U_frank",
        channel: "C_OTHER",
        text: "play something",
        ts: "1700000000.000400",
      },
      say,
    });
    expect(llm.classifyIntent).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });
});
