import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/spotify/client.js", () => ({
  getCurrentlyPlaying: vi.fn(),
  findHostDevice: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  popPendingRequest: vi.fn(),
  recordPlayed: vi.fn(),
  lastPlayed: vi.fn(() => undefined),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function makeTrack(id: string) {
  return {
    id,
    title: `Title ${id}`,
    artist: "Artist",
    album: "Album",
    durationMs: 1000,
    progressMs: 0,
    spotifyUrl: "https://open.spotify.com/track/" + id,
    artistIds: [],
  };
}

describe("NowPlayingWatcher", () => {
  it("emits trackChange exactly once for a stable track and again on a real change", async () => {
    const spotify = await import("../src/spotify/client.js");
    const db = await import("../src/db.js");
    const { nowPlayingWatcher } = await import("../src/now-playing.js");

    const trackA = makeTrack("a");
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: true,
      track: trackA,
    });
    (db.popPendingRequest as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const events: { id: string }[] = [];
    nowPlayingWatcher.on("trackChange", (e) => events.push({ id: e.current.id }));

    const tickable = nowPlayingWatcher as unknown as { tick: () => Promise<void> };
    await tickable.tick();
    await tickable.tick();
    await tickable.tick();

    expect(events).toEqual([{ id: "a" }]);
    expect(db.recordPlayed).toHaveBeenCalledTimes(1);

    const trackB = makeTrack("b");
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: true,
      track: trackB,
    });
    await tickable.tick();
    await tickable.tick();

    expect(events).toEqual([{ id: "a" }, { id: "b" }]);
    expect(db.recordPlayed).toHaveBeenCalledTimes(2);
  });

  it("emits noActiveDevice once while host is offline, then resumed when track returns", async () => {
    const spotify = await import("../src/spotify/client.js");
    const { nowPlayingWatcher } = await import("../src/now-playing.js");

    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: false,
    });
    (spotify.findHostDevice as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const noDevice: unknown[] = [];
    const resumed: unknown[] = [];
    nowPlayingWatcher.on("noActiveDevice", (i) => noDevice.push(i));
    nowPlayingWatcher.on("resumed", () => resumed.push(1));

    const tickable = nowPlayingWatcher as unknown as { tick: () => Promise<void> };
    await tickable.tick();
    await tickable.tick();
    expect(noDevice).toHaveLength(1);

    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: true,
      track: makeTrack("z"),
    });
    await tickable.tick();
    expect(resumed).toHaveLength(1);
  });
});
