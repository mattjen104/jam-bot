// @vitest-environment jsdom
/**
 * Integration tests: Tier 2 (YouTube embed + auto-advance) driver ordering.
 *
 * These tests prove that:
 *
 *   1. When a past replay run has Tier 2 selected (YouTube), the YouTube driver
 *      is called — NOT Bandcamp — even when both drivers are available.
 *   2. After YouTube fires "ended", the player advances to the next track in
 *      the run (IFrame ENDED path exercised for past-mode).
 *   3. Bandcamp's play() is never called in a Tier 2 run.
 *
 * Setup mirrors youtubeEndedAdvance.test.tsx with:
 * - YouTube driver: available + controllable "ended" subscriber
 * - Bandcamp driver: available, play() tracked — must NOT be called for Tier 2
 * - GUIDED_SERVICE_OPTIONS: YouTube with embedAutoAdvance=true (Tier 2)
 * - Spotify: disconnected (not Tier 1 eligible)
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// YouTube driver stub — available, with controllable "ended" events
// ---------------------------------------------------------------------------

const ytSubscribers = new Set<(s: { state: string; trackId?: string | null }) => void>();

function fireYtEnded(mbid: string) {
  ytSubscribers.forEach((cb) => cb({ state: "ended", trackId: mbid } as never));
}

const mockYtPlay = vi.fn(async () => {});

vi.mock("../src/player/useYouTubeDriver", () => ({
  useYouTubeDriver: () => ({
    id: "youtube" as const,
    available: true,
    surface: null,
    play: mockYtPlay,
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
    seek: vi.fn(async () => {}),
    onStatusChange: (cb: (s: never) => void) => {
      ytSubscribers.add(cb);
      return () => ytSubscribers.delete(cb);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Bandcamp driver stub — available, but play() must NOT be called for Tier 2
// ---------------------------------------------------------------------------

const mockBandcampPlay = vi.fn(async () => {});

vi.mock("../src/player/useBandcampDriver", () => ({
  useBandcampDriver: () => ({
    id: "bandcamp" as const,
    available: true,
    surface: null,
    play: mockBandcampPlay,
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
    seek: vi.fn(async () => {}),
    onStatusChange: vi.fn(() => () => {}),
  }),
}));

// ---------------------------------------------------------------------------
// Spotify driver stub — unavailable (not Tier 1 eligible)
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
// useSpotifyConnect — Spotify not Tier 1 eligible
// ---------------------------------------------------------------------------

vi.mock("../src/player/useSpotifyConnect", () => ({
  useSpotifyConnect: () => ({
    connected: false,
    premium: false,
    product: "free",
    displayName: null,
    configured: false,
    pinnedDevice: null,
    devices: [],
    pinDevice: vi.fn(),
    unpinDevice: vi.fn(),
    fetchDevices: vi.fn().mockResolvedValue([]),
  }),
}));

// ---------------------------------------------------------------------------
// api-client-react — minimal stubs
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    getRecording: vi.fn(async () => ({ links: [] })),
    getRecordingSegues: vi.fn(async () => ({ next: [] })),
    getRecordingPreview: vi.fn(async () => ({ previewUrl: null, artworkUrl: null })),
    getStationNowPlaying: vi.fn(async () => ({ nowPlaying: null })),
    getSpotifyStatus: vi.fn(async () => ({
      configured: false, connected: false, premium: false, displayName: null, product: null,
    })),
    spotifyPause: vi.fn(async () => {}),
    spotifyResume: vi.fn(async () => {}),
    spotifyPlay: vi.fn(async () => ({ trackUri: "spotify:track:test" })),
    spotifyLogout: vi.fn(async () => {}),
    spotifyQueueRun: vi.fn(async () => ({ queued: 0 })),
  });
});

// ---------------------------------------------------------------------------
// webplayer/hooks — avoid QueryClientProvider requirement
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
// guidedReplay — YouTube with embedAutoAdvance=true (Tier 2) + Bandcamp (Tier 3)
// Both are available so the cascade order determines which runs first.
// ---------------------------------------------------------------------------

vi.mock("../src/lib/guidedReplay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/guidedReplay")>();
  return {
    ...actual,
    GUIDED_SERVICE_OPTIONS: [
      {
        service: "bandcamp",
        label: "Bandcamp",
        embedUrlBuilder: (url: string) => (url.includes("bandcamp") ? url : null),
      },
      {
        service: "youtube",
        label: "YouTube",
        embedUrlBuilder: (url: string) =>
          url.includes("youtube") ? `https://www.youtube.com/embed/test?enablejsapi=1` : null,
        embedAutoAdvance: true,
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// playbackSession — default mode resolve_to_service
// ---------------------------------------------------------------------------

vi.mock("../src/player/playbackSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/player/playbackSession")>();
  return {
    ...actual,
    readLastUsedService: vi.fn(() => null as string | null),
    writeLastUsedService: vi.fn(),
    readStoredPlaybackMode: () => "resolve_to_service" as const,
    writeStoredPlaybackMode: vi.fn(),
    checkDeviceContinuity: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { PlayerProvider, usePlayer } from "../src/player/PlayerProvider";
import type { RideSeed } from "../src/player/PlayerProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeYouTubeSeed(id: string): RideSeed {
  return {
    mbid: id,
    title: `Track ${id}`,
    artist: "Artist",
    artworkUrl: null,
    links: [{ url: `https://www.youtube.com/watch?v=${id}`, service: "youtube" }],
    spinDurationSeconds: null,
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
  ytSubscribers.clear();
  mockYtPlay.mockReset();
  mockYtPlay.mockResolvedValue(undefined);
  mockBandcampPlay.mockReset();
  mockBandcampPlay.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Tier 2 (YouTube): driver order — YouTube owns the run, not Bandcamp", () => {
  it("calls YouTube play() for the first track, NOT Bandcamp, when Tier 2 is selected", async () => {
    renderPlayer();
    await flush();

    // Both YouTube and Bandcamp are available; Tier 2 should select YouTube.
    act(() => {
      latest!.ride.startReplay(
        [makeYouTubeSeed("vid1"), makeYouTubeSeed("vid2")],
        "Past Run",
        { timeOrientation: "past" },
      );
    });
    await flush();
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    // YouTube must have been called.
    expect(mockYtPlay).toHaveBeenCalledTimes(1);
    // Bandcamp must NOT have been called — a Tier-2 run must skip straight to YouTube.
    expect(mockBandcampPlay).not.toHaveBeenCalled();
  });

  it("ride.pastModeTier is 2 for a YouTube-capable run", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeYouTubeSeed("vid1")],
        "Past Run",
        { timeOrientation: "past" },
      );
    });
    await flush();

    expect(latest!.ride.pastModeTier).toBe(2);
  });

  it("IFrame ENDED advances to the next track (auto-advance path for past mode)", async () => {
    renderPlayer();
    await flush();

    const seeds = [makeYouTubeSeed("vid1"), makeYouTubeSeed("vid2")];

    act(() => {
      latest!.ride.startReplay(seeds, "Past Run", { timeOrientation: "past" });
    });
    await flush();
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();

    // Confirm on track 1 (index 0).
    expect(latest!.ride.index).toBe(0);

    // YouTube fires "ended" for the first track.
    act(() => {
      fireYtEnded("vid1");
    });
    await flush();

    // PlayerProvider must advance to index 1.
    expect(latest!.ride.index).toBe(1);
    expect(latest!.ride.current?.mbid).toBe("vid2");
    expect(latest!.ride.active).toBe(true);
  });

  it("Bandcamp play() is never invoked in a Tier-2 run, even with multiple tracks", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay(
        [makeYouTubeSeed("vid1"), makeYouTubeSeed("vid2"), makeYouTubeSeed("vid3")],
        "Past Run",
        { timeOrientation: "past" },
      );
    });
    await flush();
    await act(async () => { vi.advanceTimersByTime(200); });
    await flush();

    // Advance through all tracks via YouTube "ended".
    act(() => { fireYtEnded("vid1"); });
    await flush();
    act(() => { fireYtEnded("vid2"); });
    await flush();

    // Bandcamp must have been called zero times throughout the whole run.
    expect(mockBandcampPlay).not.toHaveBeenCalled();
  });
});
