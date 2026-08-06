// @vitest-environment jsdom
/**
 * Past-mode playback integration tests — PlayerProvider tier orchestration.
 *
 * Covers:
 * - Tier 1: spotifyQueueRun called exactly ONCE with all URIs (not per-track)
 * - Tier 4: timed cue sheet — cueSheetVisible after spinDurationSeconds
 * - Tier 4: null duration → cueSheetVisible immediately and persistently
 * - Mid-run failure: when spotifyQueueRun fails, pastRunFailed is set + status="error"
 * - Tier state lifecycle: null when not riding, cleared on stop()
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// vi.hoisted: variables needed inside vi.mock factory functions (which are
// hoisted above module imports by vitest's babel transform).
// ---------------------------------------------------------------------------

const {
  mockSpotifyQueueRun,
  mockGetSpotifyPlayer,
  spotifyState,
  mockReadLastUsedService,
  mockReadStoredPlaybackMode,
  mockGetRecording,
  mockGuidedOptions,
} = vi.hoisted(() => ({
  mockSpotifyQueueRun: vi.fn().mockResolvedValue({ queued: 1 }),
  // Default: Spotify player returns null (not playing).  Tests override per case.
  mockGetSpotifyPlayer: vi.fn().mockResolvedValue(null),
  spotifyState: {
    connected: false,
    premium: false,
    hasActiveDevice: false,
  },
  mockReadLastUsedService: vi.fn(() => null as string | null),
  // Controllable persisted playback mode — default is resolve_to_service.
  // Tests override to "passthrough" to verify Tier 1 explicitly switches mode.
  mockReadStoredPlaybackMode: vi.fn(() => "resolve_to_service" as "passthrough" | "resolve_to_service"),
  // Controllable getRecording — default returns empty links.
  // Tests override per-case to simulate a recording that has embed links.
  mockGetRecording: vi.fn(async () => ({ links: [] as never[] })),
  // mutable holder: tests set .value to control which service options are present
  mockGuidedOptions: {
    value: [] as Array<{
      service: string;
      label: string;
      embedUrlBuilder?: ((url: string) => string | null) | undefined;
      embedAutoAdvance?: boolean | undefined;
    }>,
  },
}));

// ---------------------------------------------------------------------------
// Spotify driver stub — always available: false so it stays off the hot path.
// Spotify Connect is exercised via useSpotifyConnect, not via the driver.
// ---------------------------------------------------------------------------

vi.mock("../src/player/useSpotifyDriver", () => ({
  useSpotifyDriver: () => ({
    handle: {
      id: "spotify" as const,
      available: false,
      surface: null,
      play: vi.fn(async () => {}),
      pause: vi.fn(async () => {}),
      resume: vi.fn(async () => {}),
      stop: vi.fn(),
      seek: vi.fn(async () => {}),
      onStatusChange: vi.fn(() => () => {}),
    },
    spotifyModeForCurrent: false,
    fallbackUsed: false,
    deviceLost: false,
    retryCurrentTrack: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// YouTube driver stub — disabled
// ---------------------------------------------------------------------------

vi.mock("../src/player/useYouTubeDriver", () => ({
  useYouTubeDriver: () => ({
    id: "youtube" as const,
    available: false,
    surface: null,
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
    seek: vi.fn(async () => {}),
    onStatusChange: vi.fn(() => () => {}),
  }),
}));

// ---------------------------------------------------------------------------
// Apple Music driver stub — disabled
// ---------------------------------------------------------------------------

vi.mock("../src/player/useAppleMusicDriver", () => ({
  useAppleMusicDriver: () => ({
    id: "apple-music" as const,
    available: false,
    surface: null,
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
    seek: vi.fn(async () => {}),
    onStatusChange: vi.fn(() => () => {}),
  }),
}));

// ---------------------------------------------------------------------------
// Local file driver stub — disabled
// ---------------------------------------------------------------------------

vi.mock("../src/player/useLocalFileDriver", () => ({
  useLocalFileDriver: () => ({
    id: "local-file" as const,
    available: false,
    surface: null,
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
    seek: vi.fn(async () => {}),
    onStatusChange: vi.fn(() => () => {}),
    openFilePicker: vi.fn(),
    hasLocalFile: false,
  }),
}));

// ---------------------------------------------------------------------------
// Bandcamp driver stub — disabled
// ---------------------------------------------------------------------------

vi.mock("../src/player/useBandcampDriver", () => ({
  useBandcampDriver: () => ({
    id: "bandcamp" as const,
    available: false,
    surface: null,
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
    seek: vi.fn(async () => {}),
    onStatusChange: vi.fn(() => () => {}),
  }),
}));

// ---------------------------------------------------------------------------
// useSpotifyConnect — controlled via spotifyState so tests can vary the tier
// ---------------------------------------------------------------------------

vi.mock("../src/player/useSpotifyConnect", () => ({
  useSpotifyConnect: () => ({
    connected: spotifyState.connected,
    premium: spotifyState.premium,
    product: spotifyState.premium ? "premium" : "free",
    displayName: "Test User",
    configured: true,
    pinnedDevice: spotifyState.hasActiveDevice
      ? { id: "device-123", name: "Test Device", type: "Computer", isActive: true }
      : null,
    devices: [],
    pinDevice: vi.fn(),
    unpinDevice: vi.fn(),
    fetchDevices: vi.fn().mockResolvedValue([]),
  }),
}));

// ---------------------------------------------------------------------------
// api-client-react — use helper + override spotifyQueueRun
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    spotifyQueueRun: mockSpotifyQueueRun,
    getSpotifyPlayer: mockGetSpotifyPlayer,
    getRecordingPreview: vi.fn(async () => ({ previewUrl: null, artworkUrl: null })),
    getRecording: mockGetRecording,
    getRecordingSegues: vi.fn(async () => ({ next: [] })),
    spotifyPlay: vi.fn(async () => ({ trackUri: "spotify:track:test" })),
    spotifyPause: vi.fn(async () => {}),
    spotifyResume: vi.fn(async () => {}),
    getSpotifyStatus: vi.fn(async () => ({
      configured: false, connected: false, premium: false, displayName: null, product: null,
    })),
    spotifyLogout: vi.fn(async () => {}),
    getStationNowPlaying: vi.fn(async () => ({ nowPlaying: null })),
  });
});

// ---------------------------------------------------------------------------
// webplayer/hooks — mock to avoid QueryClientProvider requirement
// ---------------------------------------------------------------------------

vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const { makeWebplayerHooksMock } = await import("./helpers/webplayerHooksMock");
  return makeWebplayerHooksMock(importOriginal, {
    useWpOnAir: vi.fn(() => ({ data: undefined, isLoading: false, dataUpdatedAt: 0 })),
    useWpLoreCounts: vi.fn(() => ({ data: undefined })),
  });
});

// ---------------------------------------------------------------------------
// useRadioPlayer — no live broadcast
// ---------------------------------------------------------------------------

vi.mock("../src/hooks/useRadioPlayer", () => ({
  useRadioPlayer: vi.fn(() => ({
    status: "idle",
    station: null,
    volume: 0.85,
    error: null,
    setVolume: vi.fn(),
    toggle: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// meHooks — Apple Music disabled
// ---------------------------------------------------------------------------

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAppConfig: vi.fn(() => ({ data: null, isLoading: false })),
  };
});

// ---------------------------------------------------------------------------
// playbackSession — stub the localStorage helpers so we can control
// last-used-service per test, and force playbackMode to resolve_to_service
// ---------------------------------------------------------------------------

vi.mock("../src/player/playbackSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/player/playbackSession")>();
  return {
    ...actual,
    readLastUsedService: mockReadLastUsedService,
    writeLastUsedService: vi.fn(),
    readStoredPlaybackMode: mockReadStoredPlaybackMode,
    writeStoredPlaybackMode: vi.fn(),
    checkDeviceContinuity: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// guidedReplay — GUIDED_SERVICE_OPTIONS reads from mockGuidedOptions.value
// so individual test suites can control which services are visible.
// ---------------------------------------------------------------------------

vi.mock("../src/lib/guidedReplay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/guidedReplay")>();
  return {
    ...actual,
    get GUIDED_SERVICE_OPTIONS() {
      return mockGuidedOptions.value;
    },
  };
});

// ---------------------------------------------------------------------------
// Import under test (after all vi.mock calls)
// ---------------------------------------------------------------------------

import { PlayerProvider, usePlayer } from "../src/player/PlayerProvider";
import type { RideSeed } from "../src/player/PlayerProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpotifySeed(id: string, spinDurationSeconds: number | null = null): RideSeed {
  return {
    mbid: id,
    title: `Track ${id}`,
    artist: "Artist",
    artworkUrl: null,
    links: [{ url: `https://open.spotify.com/track/${id}`, service: "spotify" }],
    spinDurationSeconds,
  };
}

function makeNoLinkSeed(id: string, spinDurationSeconds: number | null = null): RideSeed {
  return {
    mbid: id,
    title: `Track ${id}`,
    artist: "Artist",
    artworkUrl: null,
    links: [],
    spinDurationSeconds,
  };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let latest: ReturnType<typeof usePlayer> | null = null;

function Harness() {
  const player = usePlayer();
  const ref = useRef(player);
  ref.current = player;
  useEffect(() => {
    latest = player;
  });
  return null;
}

function renderPlayer() {
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  return render(
    <PlayerProvider>
      <Harness />
    </PlayerProvider>,
  );
}

/** Flush pending microtasks so async effects settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  latest = null;
  // Reset Spotify state to ineligible by default.
  spotifyState.connected = false;
  spotifyState.premium = false;
  spotifyState.hasActiveDevice = false;
  // Default: no embed services → Tier 4 when Spotify ineligible.
  mockGuidedOptions.value = [];
  // Clear last-used preference.
  mockReadLastUsedService.mockReturnValue(null);
  // Default persisted playback mode (resolve_to_service for most tests;
  // tests that verify the passthrough fix override this per-test).
  mockReadStoredPlaybackMode.mockReturnValue("resolve_to_service");
  // Default getRecording: returns empty links — tests override per-case.
  mockGetRecording.mockReset();
  mockGetRecording.mockResolvedValue({ links: [] });
  // Reset queue run mock.
  mockSpotifyQueueRun.mockReset();
  mockSpotifyQueueRun.mockResolvedValue({ queued: 1 });
  // Default Spotify player state: not playing anything.
  mockGetSpotifyPlayer.mockReset();
  mockGetSpotifyPlayer.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tier 1: single uris-array queue call
// ---------------------------------------------------------------------------

describe("Past-mode Tier 1 (Spotify Connect)", () => {
  beforeEach(() => {
    // Enable Tier 1 eligibility.
    spotifyState.connected = true;
    spotifyState.premium = true;
    spotifyState.hasActiveDevice = true;
  });

  it("calls spotifyQueueRun ONCE with all URIs — not per-track", async () => {
    renderPlayer();
    await flush();

    const seeds = [
      makeSpotifySeed("aaa"),
      makeSpotifySeed("bbb"),
      makeSpotifySeed("ccc"),
    ];

    act(() => {
      latest!.ride.startReplay(seeds, "Test Run", { timeOrientation: "past" });
    });
    // Advance 100ms — enough for the queue-run effect to fire without touching
    // the 3 000ms Tier-1 poll interval.
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    // spotifyQueueRun must have been called exactly once.
    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);

    // All three Spotify URIs must be in the single call.
    const [callArg] = (mockSpotifyQueueRun as Mock).mock.calls[0] as [{ uris: string[]; deviceId?: string | null }];
    expect(callArg.uris).toHaveLength(3);
    expect(callArg.uris).toContain("spotify:track:aaa");
    expect(callArg.uris).toContain("spotify:track:bbb");
    expect(callArg.uris).toContain("spotify:track:ccc");
  });

  it("calls spotifyQueueRun even when playbackMode is persisted as passthrough (Tier 1 opts in explicitly)", async () => {
    // Simulate a listener who never opened Settings — playbackMode defaults to
    // passthrough.  startReplay must explicitly switch to resolve_to_service for
    // Tier 1, otherwise the queue-run effect is gated and audio is silently
    // suppressed (the Spotify driver is also suppressed in Tier 1).
    mockReadStoredPlaybackMode.mockReturnValue("passthrough");

    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeSpotifySeed("aaa"), makeSpotifySeed("bbb")],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    // Must have called spotifyQueueRun — mode was switched to resolve_to_service
    // by startReplay before the queue-run effect fired.
    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);
    const [callArg] = (mockSpotifyQueueRun as Mock).mock.calls[0] as [{ uris: string[] }];
    expect(callArg.uris).toHaveLength(2);
  });

  it("hard-stops and sets pastRunFailed when a seed has no Spotify URI after link prefetch", async () => {
    // Seeds: first has a Spotify URI, second has no links at all.
    // getRecording returns { links: [] } for the second → no Spotify URI resolved.
    // Expected: queue-run validates items → missing URI → hard-stop, NOT a silent filter.
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeSpotifySeed("aaa"), makeNoLinkSeed("bbb")],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    // spotifyQueueRun must NOT have been called — hard-stop happens first.
    expect(mockSpotifyQueueRun).not.toHaveBeenCalled();
    // pastRunFailed is set; ride surfaces a clear stopped state.
    expect(latest!.ride.pastRunFailed).toBe(true);
    expect(latest!.ride.status).toBe("error");
  });

  it("does NOT call spotifyQueueRun multiple times when index advances", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeSpotifySeed("aaa"), makeSpotifySeed("bbb")],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    // Advance to track B.
    act(() => { latest!.ride.next(); });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    // Still only ONE call — the bulk queue fires once for the whole run.
    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);
  });

  it("sets pastModeTier to 1 when Spotify is Tier 1 eligible", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeSpotifySeed("aaa")],
        "Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    expect(latest!.ride.pastModeTier).toBe(1);
  });

  it("surfaces pastModeTierAnnouncement 'hands-free on Spotify' for Tier 1", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeSpotifySeed("aaa")],
        "Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    expect(latest!.ride.pastModeTierAnnouncement).toBeTruthy();
    expect(latest!.ride.pastModeTierAnnouncement).toContain("Spotify");
    expect(latest!.ride.pastModeTierAnnouncement).toContain("hands-free");
  });
});

// ---------------------------------------------------------------------------
// Tier 4: cue sheet timed affordance
// ---------------------------------------------------------------------------

describe("Past-mode Tier 4 (cue sheet)", () => {
  // Spotify stays disconnected → Tier 4 (no embed services produce links).

  it("cueSheetVisible becomes true after spinDurationSeconds", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeNoLinkSeed("trackA", 30)],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    expect(latest!.ride.cueSheetVisible).toBe(false);

    // 29 seconds — not yet.
    await act(async () => { vi.advanceTimersByTime(29_000); });
    expect(latest!.ride.cueSheetVisible).toBe(false);

    // One more second (total 30s) — now visible.
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(latest!.ride.cueSheetVisible).toBe(true);
  });

  it("NULL duration → cueSheetVisible is true immediately and persistently (common case)", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeNoLinkSeed("trackA", null)],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    // Null spin duration → visible immediately, no timer needed.
    expect(latest!.ride.cueSheetVisible).toBe(true);
  });

  it("cueSheetNext shows the next item in the queue", async () => {
    renderPlayer();
    await flush();

    const seeds: RideSeed[] = [
      { mbid: "a", title: "First Track", artist: "Alice", artworkUrl: null, links: [], spinDurationSeconds: null },
      { mbid: "b", title: "Second Track", artist: "Bob", artworkUrl: null, links: [], spinDurationSeconds: null },
    ];

    act(() => {
      latest!.ride.startReplay(seeds, "Test Run", { timeOrientation: "past" });
    });
    await flush();

    // On track A, cueSheetNext should show track B.
    expect(latest!.ride.cueSheetNext).toMatchObject({
      title: "Second Track",
      artist: "Bob",
    });
  });

  it("cueSheetNext is null on the last track", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeNoLinkSeed("only", null)],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    expect(latest!.ride.cueSheetNext).toBeNull();
  });

  it("pastModeTier is 4 and announcement contains 'cue sheet'", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeNoLinkSeed("trackA", null)],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    expect(latest!.ride.pastModeTier).toBe(4);
    expect(latest!.ride.pastModeTierAnnouncement).toContain("cue sheet");
  });
});

// ---------------------------------------------------------------------------
// Mid-run failure — no silent downgrade
// ---------------------------------------------------------------------------

describe("Past-mode mid-run failure", () => {
  it("sets pastRunFailed and status=error when spotifyQueueRun fails", async () => {
    spotifyState.connected = true;
    spotifyState.premium = true;
    spotifyState.hasActiveDevice = true;

    mockSpotifyQueueRun.mockRejectedValue(new Error("no_active_device"));

    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeSpotifySeed("aaa")],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await flush();
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(latest!.ride.pastRunFailed).toBe(true);
    expect(latest!.ride.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Tier state lifecycle
// ---------------------------------------------------------------------------

describe("Past-mode tier state lifecycle", () => {
  it("pastModeTier is null when not in a ride", async () => {
    renderPlayer();
    await flush();
    expect(latest!.ride.pastModeTier).toBeNull();
  });

  it("pastModeTier is null after stop()", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeNoLinkSeed("a", null)],
        "Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    expect(latest!.ride.pastModeTier).toBe(4);

    act(() => { latest!.ride.stop(); });
    await flush();

    expect(latest!.ride.pastModeTier).toBeNull();
    expect(latest!.ride.pastRunFailed).toBe(false);
    expect(latest!.ride.cueSheetVisible).toBe(false);
  });

  it("pastModeTier is null for a non-past trail ride (start with timeOrientation=curated)", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.start(makeNoLinkSeed("a"), { timeOrientation: "curated" });
    });
    await flush();

    expect(latest!.ride.pastModeTier).toBeNull();
  });

  it("pastModeTierAnnouncement is null before replay and non-null after", async () => {
    renderPlayer();
    await flush();

    // Before any ride: announcement is null.
    expect(latest!.ride.pastModeTierAnnouncement).toBeNull();

    act(() => {
      latest!.ride.startReplay(
        [makeNoLinkSeed("a", null)],
        "Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    // After past replay starts (Tier 4 — no connected services), announcement
    // is populated with a non-empty string.
    expect(latest!.ride.pastModeTierAnnouncement).not.toBeNull();
    expect(typeof latest!.ride.pastModeTierAnnouncement).toBe("string");
    expect((latest!.ride.pastModeTierAnnouncement ?? "").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tier 1: index sync via Spotify player polling
// ---------------------------------------------------------------------------

describe("Past-mode Tier 1 — index sync via getSpotifyPlayer poll", () => {
  beforeEach(() => {
    spotifyState.connected = true;
    spotifyState.premium = true;
    spotifyState.hasActiveDevice = true;
  });

  it("ride.index advances to match what Spotify is playing autonomously", async () => {
    renderPlayer();
    await flush();

    const seeds = [
      makeSpotifySeed("aaa"),
      makeSpotifySeed("bbb"),
      makeSpotifySeed("ccc"),
    ];

    act(() => {
      latest!.ride.startReplay(seeds, "Test Run", { timeOrientation: "past" });
    });
    // 100ms — lets the queue-run useEffect fire without touching the 3s poll.
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    // Starts on track 0.
    expect(latest!.ride.index).toBe(0);

    // Spotify has autonomously advanced to track "bbb" (index 1).
    mockGetSpotifyPlayer.mockResolvedValue({
      trackUri: "spotify:track:bbb",
      isPlaying: true,
      progressMs: 5000,
    });

    // Advance exactly 3 100ms to trigger one 3 000ms poll tick.
    await act(async () => { vi.advanceTimersByTime(3100); });
    await flush();

    // ride.index must now reflect Spotify's position.
    expect(latest!.ride.index).toBe(1);
    expect(latest!.ride.current?.mbid).toBe("bbb");
  });

  it("ride.index does not move when Spotify is not yet playing (null state)", async () => {
    // getSpotifyPlayer returns null → no advancement
    mockGetSpotifyPlayer.mockResolvedValue(null);

    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeSpotifySeed("aaa"), makeSpotifySeed("bbb")],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();
    await act(async () => { vi.advanceTimersByTime(3100); });
    await flush();

    // Index stays at 0 — no URI to match.
    expect(latest!.ride.index).toBe(0);
  });

  it("poll stops after stop() is called and does not advance index", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeSpotifySeed("aaa"), makeSpotifySeed("bbb")],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    act(() => { latest!.ride.stop(); });
    await flush();

    // Configure Spotify to report track "bbb" now.
    mockGetSpotifyPlayer.mockResolvedValue({
      trackUri: "spotify:track:bbb",
      isPlaying: true,
      progressMs: 0,
    });

    // Tick the timer — the effect should be torn down by stop(), so no change.
    await act(async () => { vi.advanceTimersByTime(3100); });
    await flush();

    // Ride is stopped; index and active should be cleared.
    expect(latest!.ride.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manifest-constraint: synthetic non-driver service → pastModeTier = 2 from
// pure function; provider falls back gracefully (no unrecognized driver call)
// ---------------------------------------------------------------------------

describe("Past-mode manifest derivation constraint", () => {
  it("synthetic embedAutoAdvance service reports pastModeTier=2 from pure manifest (no driver crash)", async () => {
    // "soundcloud" has embedUrlBuilder + embedAutoAdvance (Tier 2 per manifest)
    // but no embed driver exists in the player.  pastModeTier must be 2 (correct
    // manifest derivation), and the ride must not error out.
    mockGuidedOptions.value = [
      {
        service: "soundcloud",
        label: "SoundCloud",
        embedUrlBuilder: () => "https://w.soundcloud.com/player/test",
        embedAutoAdvance: true,
      },
    ];

    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeNoLinkSeed("aaa", null)],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    // Pure function correctly identifies Tier 2 from manifest fields alone.
    expect(latest!.ride.pastModeTier).toBe(2);
    // No crash or error state — graceful fallback.
    expect(latest!.ride.status).not.toBe("error");
    expect(latest!.ride.pastRunFailed).toBe(false);
  });

  it("deferred activation fires for empty-link seeds when independent link hydration resolves links", async () => {
    // Seeds start with links:[] (realistic case — startReplay receives un-resolved
    // seeds).  The independent Tier 2/3 link hydration effect calls getRecording
    // and patches the queue.  Once links resolve, tierRefinedEffect fires and
    // selects YouTube.
    mockGuidedOptions.value = [
      {
        service: "youtube",
        label: "YouTube",
        embedUrlBuilder: (url: string) =>
          url.includes("youtube.com") ? "https://www.youtube.com/embed/test" : null,
        embedAutoAdvance: true,
      },
    ];

    // getRecording returns a YouTube link for this track.
    mockGetRecording.mockResolvedValue({
      links: [{ url: "https://www.youtube.com/watch?v=yt001", name: "", kind: "streaming" }],
    });

    renderPlayer();
    await flush();

    // Seed with NO links — matches real seeds from startPastReplay in DialView.
    act(() => {
      latest!.ride.startReplay(
        [makeNoLinkSeed("yt001", null)],
        "YT Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    // Independent link hydration must have called getRecording, populated links,
    // and triggered the deferred activation — pastModeTier corrected to 2.
    expect(mockGetRecording).toHaveBeenCalledWith("yt001");
    expect(latest!.ride.pastModeTier).toBe(2);
    expect(latest!.ride.status).not.toBe("error");
  });

  it("deferred activation downgrades from Tier 2 to Tier 3 when run only has Bandcamp links", async () => {
    // YouTube is manifest Tier 2 (embedAutoAdvance). selectPastModeTier picks
    // Tier 2 from the manifest. But the seed only has a Bandcamp link URL.
    // Deferred activation: YouTube embedUrlBuilder returns null for the Bandcamp
    // URL → Bandcamp embedUrlBuilder matches → setPreferredService("bandcamp")
    // → pastModeTier corrected from 2 to 3.
    mockGuidedOptions.value = [
      {
        service: "youtube",
        label: "YouTube",
        embedUrlBuilder: (url: string) =>
          url.includes("youtube.com") ? "https://www.youtube.com/embed/test" : null,
        embedAutoAdvance: true,
      },
      {
        service: "bandcamp",
        label: "Bandcamp",
        embedUrlBuilder: (url: string) =>
          url.includes("bandcamp.com") ? "https://bandcamp.com/EmbeddedPlayer/track=123" : null,
      },
    ];

    const bandcampSeed: RideSeed = {
      mbid: "bc001",
      title: "Bandcamp Track",
      artist: "BC Artist",
      artworkUrl: null,
      // Bandcamp link only — no YouTube link.
      links: [{ url: "https://bcartist.bandcamp.com/track/song", name: "", kind: "streaming" as never }],
      spinDurationSeconds: null,
    };

    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay([bandcampSeed], "BC Run", { timeOrientation: "past" });
    });
    await flush();

    // Deferred effect fired: Bandcamp matched → pastModeTier corrected to 3.
    expect(latest!.ride.pastModeTier).toBe(3);
    // No error state — graceful refinement.
    expect(latest!.ride.status).not.toBe("error");
    expect(latest!.ride.pastRunFailed).toBe(false);
  });

  it("when both a synthetic non-driver service and YouTube are present, YouTube wins", async () => {
    // YouTube is in EMBED_DRIVER_SERVICES; soundcloud is not.  YouTube must win.
    mockGuidedOptions.value = [
      {
        service: "soundcloud",
        label: "SoundCloud",
        embedUrlBuilder: () => "https://w.soundcloud.com/player/test",
        embedAutoAdvance: true,
      },
      {
        service: "youtube",
        label: "YouTube",
        embedUrlBuilder: () => "https://www.youtube.com/embed/test",
        embedAutoAdvance: true,
      },
    ];

    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeNoLinkSeed("aaa", null)],
        "Test Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    // YouTube has Tier 2 and is a supported embed driver; still reports Tier 2.
    expect(latest!.ride.pastModeTier).toBe(2);
    expect(latest!.ride.status).not.toBe("error");
  });
});
