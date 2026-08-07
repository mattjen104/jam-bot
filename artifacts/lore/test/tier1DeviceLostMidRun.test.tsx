// @vitest-environment jsdom
/**
 * Tier-1 past-replay resilience — Spotify device goes missing mid-run.
 *
 * The Tier-1 path queues the whole run in ONE spotifyQueueRun call and then
 * relies on Spotify's autonomous advance. These tests confirm the fallback
 * ladder still activates when the device disappears:
 *
 * - 409 (no active device) from the queue-run call → pastRunFailed hard stop,
 *   no silent re-fire, no per-track driver resurrection, index-sync poll stops.
 * - Device-lost poll threshold (pure state machine): the exact
 *   processDeviceConfirmation sequence a Tier-1 driver would run reaches
 *   "device-lost", and the past-orientation ladder lands on preview/skip —
 *   never passthrough.
 * - Driver active-gate suppression (PlayerProvider.tsx Tier-1 gate): while
 *   pastModeTier === 1 the Spotify driver receives active === false so its
 *   per-track play commands cannot race the bulk queue-run; a Tier-4 ride
 *   keeps the driver active.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// vi.hoisted state
// ---------------------------------------------------------------------------

const {
  mockSpotifyQueueRun,
  mockGetSpotifyPlayer,
  spotifyState,
  mockReadLastUsedService,
  mockReadStoredPlaybackMode,
  mockGetRecording,
  mockGuidedOptions,
  driverActiveLog,
} = vi.hoisted(() => ({
  mockSpotifyQueueRun: vi.fn().mockResolvedValue({ queued: 1 }),
  mockGetSpotifyPlayer: vi.fn().mockResolvedValue(null),
  spotifyState: { connected: false, premium: false, hasActiveDevice: false },
  mockReadLastUsedService: vi.fn(() => null as string | null),
  mockReadStoredPlaybackMode: vi.fn(
    () => "resolve_to_service" as "passthrough" | "resolve_to_service",
  ),
  mockGetRecording: vi.fn(async () => ({ links: [] as never[] })),
  mockGuidedOptions: { value: [] as Array<{ service: string; label: string }> },
  // Every render of the Spotify driver records the `active` opt it received —
  // this is the direct observable for the Tier-1 gate in PlayerProvider.
  driverActiveLog: [] as boolean[],
}));

// ---------------------------------------------------------------------------
// Spotify driver stub — captures opts.active so the Tier-1 suppression gate
// is directly assertable.
// ---------------------------------------------------------------------------

vi.mock("../src/player/useSpotifyDriver", () => ({
  useSpotifyDriver: (opts: { active: boolean }) => {
    driverActiveLog.push(opts.active);
    return {
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
    };
  },
}));

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

vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const { makeWebplayerHooksMock } = await import("./helpers/webplayerHooksMock");
  return makeWebplayerHooksMock(importOriginal, {
    useWpOnAir: vi.fn(() => ({ data: undefined, isLoading: false, dataUpdatedAt: 0 })),
    useWpLoreCounts: vi.fn(() => ({ data: undefined })),
  });
});

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

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAppConfig: vi.fn(() => ({ data: null, isLoading: false })),
  };
});

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
// Imports under test (after all vi.mock calls)
// ---------------------------------------------------------------------------

import { PlayerProvider, usePlayer } from "../src/player/PlayerProvider";
import type { RideSeed } from "../src/player/PlayerProvider";
import {
  DEVICE_LOST_POLLS,
  processDeviceConfirmation,
  resolveFallback,
  rideFallbackLabel,
} from "../src/player/playbackSession";

// ---------------------------------------------------------------------------
// Helpers / harness (mirrors pastModePlayback.test.tsx)
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

function makeNoLinkSeed(id: string): RideSeed {
  return {
    mbid: id,
    title: `Track ${id}`,
    artist: "Artist",
    artworkUrl: null,
    links: [],
    spinDurationSeconds: null,
  };
}

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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  latest = null;
  driverActiveLog.length = 0;
  spotifyState.connected = false;
  spotifyState.premium = false;
  spotifyState.hasActiveDevice = false;
  mockGuidedOptions.value = [];
  mockReadLastUsedService.mockReturnValue(null);
  mockReadStoredPlaybackMode.mockReturnValue("resolve_to_service");
  mockGetRecording.mockReset();
  mockGetRecording.mockResolvedValue({ links: [] });
  mockSpotifyQueueRun.mockReset();
  mockSpotifyQueueRun.mockResolvedValue({ queued: 1 });
  mockGetSpotifyPlayer.mockReset();
  mockGetSpotifyPlayer.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function makeTier1Eligible() {
  spotifyState.connected = true;
  spotifyState.premium = true;
  spotifyState.hasActiveDevice = true;
}

function make409() {
  return Object.assign(new Error("No active device"), { status: 409 });
}

// ---------------------------------------------------------------------------
// 409 no-active-device from the bulk queue-run call
// ---------------------------------------------------------------------------

describe("Tier 1: 409 no-active-device from spotifyQueueRun", () => {
  beforeEach(makeTier1Eligible);

  it("sets pastRunFailed and status='error' — a hard stop, not a silent downgrade", async () => {
    mockSpotifyQueueRun.mockRejectedValue(make409());

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

    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);
    expect(latest!.ride.pastRunFailed).toBe(true);
    expect(latest!.ride.status).toBe("error");
  });

  it("never re-fires the queue-run after the 409 — even as timers and index change", async () => {
    mockSpotifyQueueRun.mockRejectedValue(make409());

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

    // Advance the queue manually and let several poll windows pass.
    act(() => { latest!.ride.next(); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();

    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);
    expect(latest!.ride.pastRunFailed).toBe(true);
  });

  it("stops the Tier-1 index-sync poll once pastRunFailed is set", async () => {
    mockSpotifyQueueRun.mockRejectedValue(make409());

    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay([makeSpotifySeed("aaa")], "Run", {
        timeOrientation: "past",
      });
    });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();
    expect(latest!.ride.pastRunFailed).toBe(true);

    mockGetSpotifyPlayer.mockClear();
    // Several 3s poll windows — the index-sync interval must be torn down.
    await act(async () => { vi.advanceTimersByTime(9_500); });
    await flush();

    expect(mockGetSpotifyPlayer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Recovery paths after a pastRunFailed hard stop
// ---------------------------------------------------------------------------

describe("Tier 1: recovery after pastRunFailed", () => {
  beforeEach(makeTier1Eligible);

  async function failTheRun() {
    mockSpotifyQueueRun.mockRejectedValueOnce(make409());

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

    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);
    expect(latest!.ride.pastRunFailed).toBe(true);
    expect(latest!.ride.status).toBe("error");
  }

  it("retryPastRun clears the failure and re-fires the bulk queue-run", async () => {
    await failTheRun();

    mockSpotifyQueueRun.mockResolvedValue({ queued: 2 });
    act(() => { latest!.ride.retryPastRun(); });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(2);
    expect(latest!.ride.pastRunFailed).toBe(false);
    expect(latest!.ride.status).not.toBe("error");
    expect(latest!.ride.pastModeTier).toBe(1);
    expect(latest!.ride.active).toBe(true);
  });

  it("retryPastRun that fails again returns to the hard-stop state (no loop)", async () => {
    await failTheRun();

    mockSpotifyQueueRun.mockRejectedValueOnce(make409());
    act(() => { latest!.ride.retryPastRun(); });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(2);
    expect(latest!.ride.pastRunFailed).toBe(true);
    expect(latest!.ride.status).toBe("error");

    // No silent re-fire after the second failure either.
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(2);
  });

  it("continuePastRunWithCueSheet drops to Tier 4 without Spotify and never re-fires the queue-run", async () => {
    await failTheRun();

    act(() => { latest!.ride.continuePastRunWithCueSheet(); });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    expect(latest!.ride.pastRunFailed).toBe(false);
    // No guided options mocked → re-selection without Spotify lands on Tier 4.
    expect(latest!.ride.pastModeTier).toBe(4);
    expect(latest!.ride.active).toBe(true);

    // The Tier-1 queue-run must stay dead even as timers pass.
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);
  });

  it("continuePastRunWithCueSheet shows the Tier-4 cue sheet for the run", async () => {
    await failTheRun();

    act(() => { latest!.ride.continuePastRunWithCueSheet(); });
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    // Seeds have no spinDurationSeconds → cue sheet appears immediately.
    expect(latest!.ride.cueSheetVisible).toBe(true);
    expect(latest!.ride.cueSheetNext).toEqual({ artist: "Artist", title: "Track bbb" });
  });
});

// ---------------------------------------------------------------------------
// Device lost AFTER a successful queue-run (mid-run disappearance)
// ---------------------------------------------------------------------------

describe("Tier 1: device disappears after a successful queue-run", () => {
  beforeEach(makeTier1Eligible);

  it("a dead device (poll returns null) keeps the ride alive without crashing or re-queuing", async () => {
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
    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);

    // Device vanished: player state polls return null for many ticks.
    mockGetSpotifyPlayer.mockResolvedValue(null);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();

    // No crash, no duplicate queue-run, ride still active on the same index.
    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);
    expect(latest!.ride.active).toBe(true);
    expect(latest!.ride.index).toBe(0);
  });

  it("index-sync survives transient poll rejections and re-syncs when the device returns", async () => {
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

    // Poll rejects (network/device gone) for a few ticks.
    mockGetSpotifyPlayer.mockRejectedValue(new Error("device gone"));
    await act(async () => { vi.advanceTimersByTime(9_000); });
    await flush();
    expect(latest!.ride.active).toBe(true);

    // Device comes back, already advanced to track B.
    mockGetSpotifyPlayer.mockResolvedValue({
      trackUri: "spotify:track:bbb",
      isPlaying: true,
      active: true,
      progressMs: 1000,
    });
    await act(async () => { vi.advanceTimersByTime(3_100); });
    await flush();

    expect(latest!.ride.index).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Driver active-gate suppression (PlayerProvider Tier-1 gate)
// ---------------------------------------------------------------------------

describe("Tier 1: Spotify driver active-gate suppression", () => {
  it("driver receives active=false during a Tier-1 past replay (bulk queue-run owns the run)", async () => {
    makeTier1Eligible();
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

    expect(latest!.ride.pastModeTier).toBe(1);
    expect(latest!.ride.active).toBe(true);
    // The most recent driver render must have been suppressed.
    expect(driverActiveLog[driverActiveLog.length - 1]).toBe(false);
  });

  it("driver stays suppressed even while the queue index advances mid-run", async () => {
    makeTier1Eligible();
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

    const markerBefore = driverActiveLog.length;
    act(() => { latest!.ride.next(); });
    await flush();

    const rendersSinceAdvance = driverActiveLog.slice(markerBefore);
    expect(rendersSinceAdvance.length).toBeGreaterThan(0);
    expect(rendersSinceAdvance.every((a) => a === false)).toBe(true);
  });

  it("a Tier-4 past replay keeps the driver active (gate is Tier-1 specific)", async () => {
    // Spotify ineligible → Tier 4 cue sheet; the suppression clause must NOT fire.
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay([makeNoLinkSeed("aaa")], "Run", {
        timeOrientation: "past",
      });
    });
    await flush();

    expect(latest!.ride.pastModeTier).toBe(4);
    expect(latest!.ride.active).toBe(true);
    expect(driverActiveLog[driverActiveLog.length - 1]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Device-lost poll threshold + past-orientation fallback ladder (pure)
// ---------------------------------------------------------------------------

describe("device-lost threshold and past-orientation fallback ladder", () => {
  it("a silent device reaches 'device-lost' after exactly DEVICE_LOST_POLLS ticks", () => {
    const cur = { sawPlaying: false, noDevicePolls: 0 };
    let outcome: ReturnType<typeof processDeviceConfirmation> | null = null;

    for (let i = 1; i <= DEVICE_LOST_POLLS; i++) {
      outcome = processDeviceConfirmation(cur, { ours: false, isPlaying: false });
      if (outcome.type === "wait") {
        cur.noDevicePolls = outcome.noDevicePolls;
        expect(i).toBeLessThan(DEVICE_LOST_POLLS);
      }
    }
    expect(outcome!.type).toBe("device-lost");
  });

  it("a confirmed-then-silent device is NOT re-declared lost (already-confirmed branch)", () => {
    const cur = { sawPlaying: true, noDevicePolls: 0 };
    // Device paused / on another track after confirmation — handled by the
    // pause/skip branches, never the device-lost fallback.
    const outcome = processDeviceConfirmation(cur, { ours: false, isPlaying: false });
    expect(outcome.type).toBe("already-confirmed");
  });

  it("past orientation with a preview lands on 'preview' after device loss — never passthrough", () => {
    expect(resolveFallback(false, "past", true)).toBe("preview");
  });

  it("past orientation without a preview lands on 'skip' — auto-advance, not a hard stop", () => {
    expect(resolveFallback(false, "past", false)).toBe("skip");
  });

  it("device-lost label for a past ride says preview, not broadcast", () => {
    expect(rideFallbackLabel(true, "past")).toBe(
      "Spotify device lost · playing preview",
    );
  });
});
