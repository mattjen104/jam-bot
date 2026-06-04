import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/spotify/client.js", () => ({
  getCurrentlyPlaying: vi.fn(),
  findActiveDevice: vi.fn(),
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

  it("emits a position event every tick while a track plays, carrying live progress and duration", async () => {
    const spotify = await import("../src/spotify/client.js");
    const { nowPlayingWatcher } = await import("../src/now-playing.js");

    // A normal Jam reads the playhead off this event (no fingerprinting, no
    // mic) to anchor its local clock for timed insights, so it must fire on
    // EVERY tick — not just when the track changes — with Spotify's own
    // reported position and duration.
    const track = makeTrack("p");
    track.progressMs = 42000;
    track.durationMs = 210000;
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: true,
      track,
    });

    const positions: {
      trackId: string;
      progressMs: number;
      durationMs: number;
      isPlaying: boolean;
    }[] = [];
    nowPlayingWatcher.on("position", (e) => positions.push(e));

    const tickable = nowPlayingWatcher as unknown as { tick: () => Promise<void> };
    await tickable.tick();
    await tickable.tick();

    // Same stable track across both ticks -> trackChange fires once, but
    // position fires every time.
    expect(positions).toHaveLength(2);
    expect(positions[0]).toEqual({
      trackId: "p",
      progressMs: 42000,
      durationMs: 210000,
      isPlaying: true,
    });
  });

  it("reports isPlaying=false on the position event while playback is paused", async () => {
    const spotify = await import("../src/spotify/client.js");
    const { nowPlayingWatcher } = await import("../src/now-playing.js");

    // Paused: Spotify still returns the track + a (frozen) position, but the
    // playhead isn't moving. Consumers rely on isPlaying to stand their local
    // clock down so timed insights don't fire against a stopped track.
    const track = makeTrack("paused");
    track.progressMs = 60000;
    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: false,
      track,
    });

    const positions: { isPlaying: boolean }[] = [];
    nowPlayingWatcher.on("position", (e) => positions.push(e));

    const tickable = nowPlayingWatcher as unknown as { tick: () => Promise<void> };
    await tickable.tick();

    expect(positions).toHaveLength(1);
    expect(positions[0]!.isPlaying).toBe(false);
  });

  it("emits noActiveDevice once while no device is active, then resumed when track returns", async () => {
    const spotify = await import("../src/spotify/client.js");
    const { nowPlayingWatcher } = await import("../src/now-playing.js");

    (spotify.getCurrentlyPlaying as ReturnType<typeof vi.fn>).mockResolvedValue({
      isPlaying: false,
    });
    (spotify.findActiveDevice as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const noDevice: unknown[] = [];
    const resumed: unknown[] = [];
    nowPlayingWatcher.on("noActiveDevice", () => noDevice.push(1));
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
