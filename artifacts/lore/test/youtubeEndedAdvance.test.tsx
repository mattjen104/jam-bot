// @vitest-environment jsdom
/**
 * Integration tests: YouTube driver "ended" state → PlayerProvider advances queue.
 *
 * When the YouTube IFrame API fires state 0 (ENDED), the driver emits
 * { state: "ended" } via its onStatusChange subscriber.  These tests verify
 * that PlayerProvider wires that signal correctly:
 *
 *   1. Mid-queue track ends  → index advances to the next item.
 *   2. Last track ends       → ride status becomes "ended" (no phantom advance).
 *
 * useYouTubeDriver is replaced by a controllable stub whose `fireStatus()`
 * helper lets tests trigger the ended signal without fighting jsdom's iframe
 * sandbox restrictions (event.source matching).  The Spotify and Apple Music
 * drivers are stubbed out (available: false) so they stay off the hot path.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// YouTube driver stub
// ---------------------------------------------------------------------------

/** Subscribers registered by PlayerProvider via youtubeDriver.onStatusChange(). */
const ytSubscribers = new Set<(s: { state: string; trackId?: string | null }) => void>();

/** Fire a status update to all active subscribers — call this from tests. */
function fireYtStatus(status: { state: string; trackId?: string | null }) {
  ytSubscribers.forEach((cb) => cb(status as never));
}

vi.mock("../src/player/useYouTubeDriver", () => ({
  useYouTubeDriver: () => ({
    id: "youtube" as const,
    available: true,
    surface: null,
    play: vi.fn(async () => {}),
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
// Spotify driver stub — disabled (available: false) so it stays off the path
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
// api-client-react — minimal stubs for what PlayerProvider needs at startup
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    getRecording: vi.fn(async () => ({ links: [] })),
    getRecordingSegues: vi.fn(async () => ({ next: [] })),
    getRecordingPreview: vi.fn(async (mbid: string) => ({
      previewUrl: `https://previews.example/${mbid}.mp3`,
      artworkUrl: null,
    })),
    getStationNowPlaying: vi.fn(),
    getSpotifyStatus: vi.fn(async () => ({
      configured: false,
      connected: false,
      premium: false,
      displayName: null,
      product: null,
    })),
    spotifyLogout: vi.fn(async () => {}),
    spotifyPause: vi.fn(async () => {}),
    spotifyResume: vi.fn(async () => {}),
    spotifyPlay: vi.fn(async () => ({ trackUri: "spotify:track:test" })),
  });
});

// ---------------------------------------------------------------------------
// webplayer/hooks — minimal stubs
// ---------------------------------------------------------------------------

vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const { makeWebplayerHooksMock } = await import("./helpers/webplayerHooksMock");
  return makeWebplayerHooksMock(importOriginal, {
    useWpOnAir: vi.fn(() => ({ data: undefined, isLoading: false, dataUpdatedAt: 0 })),
    useWpLoreCounts: vi.fn(() => ({ data: undefined })),
  });
});

// ---------------------------------------------------------------------------
// useRadioPlayer — minimal stub (no live broadcast)
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
// meHooks — return empty config so Apple Music stays disabled
// ---------------------------------------------------------------------------

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAppConfig: vi.fn(() => ({ data: null, isLoading: false })),
  };
});

// ---------------------------------------------------------------------------
// Import under test (after all vi.mock calls)
// ---------------------------------------------------------------------------

import { PlayerProvider, usePlayer } from "../src/player/PlayerProvider";
import type { RideSeed } from "../src/player/PlayerProvider";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

function makeTrack(n: number): RideSeed {
  return {
    mbid: `mbid-track-${n}`,
    title: `Track ${n}`,
    artist: `Artist ${n}`,
    artworkUrl: null,
    links: [],
  };
}

const TRACK_A = makeTrack(1);
const TRACK_B = makeTrack(2);

// ---------------------------------------------------------------------------
// Harness: exposes usePlayer() to the test body
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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("YouTube ended → queue advance", () => {
  it("advances the queue index when the ended track is not the last", async () => {
    renderPlayer();
    await flush();

    // Start a replay ride with two tracks; YouTube is the active driver
    // (Spotify and Apple Music are both unavailable).
    act(() => {
      latest!.ride.startReplay([TRACK_A, TRACK_B], "Test Ride");
    });
    await flush();

    // Confirm we're on the first track.
    expect(latest!.ride.index).toBe(0);
    expect(latest!.ride.current?.mbid).toBe(TRACK_A.mbid);

    // YouTube fires "ended" for the current track.
    act(() => {
      fireYtStatus({ state: "ended", trackId: TRACK_A.mbid });
    });
    await flush();

    // PlayerProvider must have advanced to track B.
    expect(latest!.ride.index).toBe(1);
    expect(latest!.ride.current?.mbid).toBe(TRACK_B.mbid);
    // The ride must still be active (not ended) while there is a next track.
    expect(latest!.ride.status).not.toBe("ended");
    expect(latest!.ride.active).toBe(true);
  });

  it("sets ride status to 'ended' when the ended track is the last in the queue", async () => {
    renderPlayer();
    await flush();

    // Ride with only one track.
    act(() => {
      latest!.ride.startReplay([TRACK_A], "Test Ride Single");
    });
    await flush();

    expect(latest!.ride.index).toBe(0);
    expect(latest!.ride.current?.mbid).toBe(TRACK_A.mbid);

    // YouTube fires "ended" — no next track.
    act(() => {
      fireYtStatus({ state: "ended", trackId: TRACK_A.mbid });
    });
    await flush();

    // Index must not advance past the last item.
    expect(latest!.ride.index).toBe(0);
    // Status must become "ended" so the UI can stop/present a replay option.
    expect(latest!.ride.status).toBe("ended");
  });
});
