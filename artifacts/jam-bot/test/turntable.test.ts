import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AcrMatch } from "../src/turntable/acrcloud.js";

vi.mock("../src/spotify/client.js", () => ({
  findActiveDevice: vi.fn(),
  playNow: vi.fn(),
  seek: vi.fn(),
  searchTrack: vi.fn(),
  searchTrackByIsrc: vi.fn(),
}));

const {
  TrackChangeDebouncer,
  computeTargetPositionMs,
  matchKey,
  resolveMatchToSpotify,
  TurntableSession,
} = await import("../src/turntable/session.js");
const client = await import("../src/spotify/client.js");

function mkMatch(over: Partial<AcrMatch> = {}): AcrMatch {
  return {
    acrid: "acr-default",
    title: "Title",
    artist: "Artist",
    album: "Album",
    playOffsetMs: 0,
    ...over,
  };
}

const spTrack = (id: string, durationMs = 200000) => ({
  id,
  uri: `spotify:track:${id}`,
  title: `Track ${id}`,
  artist: "Artist",
  album: "Album",
  durationMs,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("matchKey", () => {
  it("prefers ISRC, falls back to acrid", () => {
    expect(matchKey(mkMatch({ isrc: "ISRC1", acrid: "A" }))).toBe("isrc:ISRC1");
    expect(matchKey(mkMatch({ isrc: undefined, acrid: "A" }))).toBe("acrid:A");
  });
});

describe("TrackChangeDebouncer", () => {
  it("ignores misses entirely (no streak advance or reset)", () => {
    const d = new TrackChangeDebouncer(2);
    expect(d.observe(null)).toEqual({ kind: "miss" });
    expect(d.observe(mkMatch({ isrc: "A" }))).toEqual({ kind: "pending" });
    // A miss between two A samples must NOT reset the streak.
    expect(d.observe(null)).toEqual({ kind: "miss" });
    expect(d.observe(mkMatch({ isrc: "A" }))).toEqual({
      kind: "changed",
      key: "isrc:A",
    });
  });

  it("confirms a new track only after N consecutive agreeing samples", () => {
    const d = new TrackChangeDebouncer(3);
    expect(d.observe(mkMatch({ isrc: "A" })).kind).toBe("pending");
    expect(d.observe(mkMatch({ isrc: "A" })).kind).toBe("pending");
    expect(d.observe(mkMatch({ isrc: "A" }))).toEqual({
      kind: "changed",
      key: "isrc:A",
    });
  });

  it("resets the candidate streak when a different track interrupts it", () => {
    const d = new TrackChangeDebouncer(2);
    expect(d.observe(mkMatch({ isrc: "A" })).kind).toBe("pending");
    // B interrupts — A's streak is gone, B starts fresh.
    expect(d.observe(mkMatch({ isrc: "B" })).kind).toBe("pending");
    expect(d.observe(mkMatch({ isrc: "B" }))).toEqual({
      kind: "changed",
      key: "isrc:B",
    });
  });

  it("reports re-confirmation of the current track and drops partial streaks", () => {
    const d = new TrackChangeDebouncer(2);
    d.observe(mkMatch({ isrc: "A" }));
    d.observe(mkMatch({ isrc: "A" })); // confirmed A
    expect(d.observe(mkMatch({ isrc: "A" }))).toEqual({
      kind: "confirmed-current",
    });
    // A single stray B doesn't switch with threshold 2...
    expect(d.observe(mkMatch({ isrc: "B" })).kind).toBe("pending");
    // ...and a return to A wipes B's partial streak.
    expect(d.observe(mkMatch({ isrc: "A" }))).toEqual({
      kind: "confirmed-current",
    });
    expect(d.observe(mkMatch({ isrc: "B" })).kind).toBe("pending");
  });

  it("treats threshold 1 as immediate", () => {
    const d = new TrackChangeDebouncer(1);
    expect(d.observe(mkMatch({ isrc: "A" }))).toEqual({
      kind: "changed",
      key: "isrc:A",
    });
  });
});

describe("computeTargetPositionMs", () => {
  it("adds wall-clock elapsed to the offset", () => {
    expect(
      computeTargetPositionMs(
        { offsetMs: 10_000, anchoredAtMs: 1_000 },
        6_000 + 1_000,
      ),
    ).toBe(16_000);
  });

  it("clamps to >= 0", () => {
    expect(
      computeTargetPositionMs({ offsetMs: 0, anchoredAtMs: 10_000 }, 5_000),
    ).toBe(0);
  });

  it("clamps to the track duration when known", () => {
    expect(
      computeTargetPositionMs(
        { offsetMs: 100_000, anchoredAtMs: 0, durationMs: 120_000 },
        1_000_000,
      ),
    ).toBe(120_000);
  });
});

describe("resolveMatchToSpotify", () => {
  it("resolves via ISRC when available", async () => {
    vi.mocked(client.searchTrackByIsrc).mockResolvedValue(spTrack("byisrc"));
    const r = await resolveMatchToSpotify(mkMatch({ isrc: "ISRC1" }));
    expect(r).toEqual({ track: spTrack("byisrc"), viaIsrc: true });
    expect(client.searchTrack).not.toHaveBeenCalled();
  });

  it("falls back to title/artist search when ISRC misses", async () => {
    vi.mocked(client.searchTrackByIsrc).mockResolvedValue(null);
    vi.mocked(client.searchTrack).mockResolvedValue(spTrack("bytext"));
    const r = await resolveMatchToSpotify(
      mkMatch({ isrc: "ISRC1", title: "T", artist: "A" }),
    );
    expect(r).toEqual({ track: spTrack("bytext"), viaIsrc: false });
    expect(client.searchTrack).toHaveBeenCalledWith("T A");
  });

  it("returns null when nothing resolves", async () => {
    vi.mocked(client.searchTrackByIsrc).mockResolvedValue(null);
    vi.mocked(client.searchTrack).mockResolvedValue(null);
    expect(await resolveMatchToSpotify(mkMatch({ isrc: "X" }))).toBeNull();
  });
});

describe("TurntableSession", () => {
  it("ignores observations while inactive", async () => {
    const s = new TurntableSession();
    const r = await s.observe(mkMatch({ isrc: "A" }));
    expect(r).toEqual({ kind: "miss" });
    expect(client.playNow).not.toHaveBeenCalled();
  });

  it("drives play + seek and emits trackConfirmed on a confirmed change", async () => {
    vi.mocked(client.findActiveDevice).mockResolvedValue({
      id: "dev1",
      name: "Host",
      isActive: true,
    });
    vi.mocked(client.searchTrackByIsrc).mockResolvedValue(spTrack("t1"));
    const s = new TurntableSession();
    const confirmed: unknown[] = [];
    s.on("trackConfirmed", (e) => confirmed.push(e));
    s.start();

    // Threshold defaults to 2 in test env -> needs two agreeing samples.
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 30_000 }));
    expect(client.playNow).not.toHaveBeenCalled();
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 31_000 }));

    expect(client.playNow).toHaveBeenCalledWith("spotify:track:t1", "dev1");
    expect(client.seek).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveLength(1);
  });

  it("compensates the seek target by the clip duration the helper reports", async () => {
    vi.mocked(client.findActiveDevice).mockResolvedValue({
      id: "dev1",
      name: "Host",
      isActive: true,
    });
    vi.mocked(client.searchTrackByIsrc).mockResolvedValue(spTrack("t1"));
    const s = new TurntableSession();
    s.start();
    // play_offset_ms points at the START of a 12s clip, so the real position
    // is ~offset + 12000. With offset 5000 that's well past the no-seek floor.
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 5_000 }), {
      clipDurationMs: 12_000,
    });
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 5_000 }), {
      clipDurationMs: 12_000,
    });
    expect(client.seek).toHaveBeenCalledTimes(1);
    const seekArg = vi.mocked(client.seek).mock.calls[0][0];
    // Should be at least offset + clip window (allow a little wall-clock slop).
    expect(seekArg).toBeGreaterThanOrEqual(17_000);
    expect(seekArg).toBeLessThan(17_000 + 5_000);
  });

  it("does not commit playback or emit after stop() mid-resolve (race guard)", async () => {
    vi.mocked(client.findActiveDevice).mockResolvedValue({
      id: "dev1",
      name: "Host",
      isActive: true,
    });
    // Make ISRC resolution hang until we choose to release it.
    let release!: (track: ReturnType<typeof spTrack>) => void;
    vi.mocked(client.searchTrackByIsrc).mockReturnValue(
      new Promise<ReturnType<typeof spTrack>>((res) => {
        release = res;
      }),
    );
    const s = new TurntableSession();
    const confirmed: unknown[] = [];
    s.on("trackConfirmed", (e) => confirmed.push(e));
    s.start();
    await s.observe(mkMatch({ isrc: "A" }));
    const pending = s.observe(mkMatch({ isrc: "A" })); // enters applyTrackChange, awaits resolve
    s.stop(); // session torn down while resolve is in flight
    release(spTrack("t1")); // now resolution completes
    await pending;
    expect(client.playNow).not.toHaveBeenCalled();
    expect(confirmed).toHaveLength(0);
  });

  it("does not seek when the matched track starts near 0:00", async () => {
    vi.mocked(client.findActiveDevice).mockResolvedValue({
      id: "dev1",
      name: "Host",
      isActive: true,
    });
    vi.mocked(client.searchTrackByIsrc).mockResolvedValue(spTrack("t1"));
    const s = new TurntableSession();
    s.start();
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 200 }));
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 400 }));
    expect(client.playNow).toHaveBeenCalledTimes(1);
    expect(client.seek).not.toHaveBeenCalled();
  });

  it("refreshes the anchor on re-confirmation without re-driving playback", async () => {
    vi.mocked(client.findActiveDevice).mockResolvedValue({
      id: "dev1",
      name: "Host",
      isActive: true,
    });
    vi.mocked(client.searchTrackByIsrc).mockResolvedValue(spTrack("t1"));
    const s = new TurntableSession();
    s.start();
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 30_000 }));
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 31_000 })); // confirmed
    const playCalls = vi.mocked(client.playNow).mock.calls.length;
    // Same track again -> anchor refresh only, no new play.
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 35_000 }));
    expect(vi.mocked(client.playNow).mock.calls.length).toBe(playCalls);
  });

  it("resync seeks to the computed position and returns the track", async () => {
    vi.mocked(client.findActiveDevice).mockResolvedValue({
      id: "dev1",
      name: "Host",
      isActive: true,
    });
    vi.mocked(client.searchTrackByIsrc).mockResolvedValue(spTrack("t1"));
    const s = new TurntableSession();
    s.start();
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 30_000 }));
    await s.observe(mkMatch({ isrc: "A", playOffsetMs: 31_000 }));
    vi.mocked(client.seek).mockClear();
    const r = await s.resync();
    expect(r?.track.id).toBe("t1");
    expect(client.seek).toHaveBeenCalledTimes(1);
  });

  it("resync is a no-op before any confirmed track", async () => {
    const s = new TurntableSession();
    s.start();
    expect(await s.resync()).toBeNull();
  });

  it("emits an error (no playback) when no Spotify track resolves", async () => {
    vi.mocked(client.findActiveDevice).mockResolvedValue({
      id: "dev1",
      name: "Host",
      isActive: true,
    });
    vi.mocked(client.searchTrackByIsrc).mockResolvedValue(null);
    vi.mocked(client.searchTrack).mockResolvedValue(null);
    const s = new TurntableSession();
    const errs: unknown[] = [];
    s.on("error", (e) => errs.push(e));
    s.start();
    await s.observe(mkMatch({ isrc: "A" }));
    await s.observe(mkMatch({ isrc: "A" }));
    expect(client.playNow).not.toHaveBeenCalled();
    expect(errs).toHaveLength(1);
  });
});
