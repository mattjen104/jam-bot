// @vitest-environment jsdom
/**
 * Integration tests: Apple Music driver "ended" state → PlayerProvider advances queue.
 *
 * When MusicKit fires playbackStateDidChange with state ENDED, useAppleMusicDriver
 * emits { state: "ended" } via its onStatusChange subscriber.  These tests verify
 * that PlayerProvider wires that signal correctly through real production code:
 *
 *   1. Mid-queue track ends  → index advances to the next item.
 *   2. Last track ends       → ride status becomes "ended" (no phantom advance).
 *   3. Ended always clears   → altDriverActiveMbid is null regardless of queue position.
 *   4. Live+service-ride     → ended skips queue advance (station poll drives it).
 *   5. Stale ended signal    → late-arriving "ended" from the previous track is ignored.
 *
 * useAppleMusicDriver is replaced by a controllable stub whose `fireAmStatus()`
 * helper lets tests trigger the ended signal without requiring a real MusicKit
 * instance.  Spotify and YouTube are stubbed out (available: false) so Apple
 * Music becomes the preferred alt-driver and stays on the hot path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Apple Music driver stub
// ---------------------------------------------------------------------------

/** Subscribers registered by PlayerProvider via appleMusicDriver.onStatusChange(). */
const amSubscribers = new Set<(s: { state: string; trackId?: string | null; durationMs?: number }) => void>();

/** Fire a status update to all active subscribers — call this from tests. */
function fireAmStatus(status: { state: string; trackId?: string | null; durationMs?: number }) {
  amSubscribers.forEach((cb) => cb(status as never));
}

vi.mock("../src/player/useAppleMusicDriver", () => ({
  useAppleMusicDriver: () => ({
    id: "apple-music" as const,
    available: true,
    surface: null,
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
    seek: vi.fn(async () => {}),
    onStatusChange: (cb: (s: never) => void) => {
      amSubscribers.add(cb);
      return () => amSubscribers.delete(cb);
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
// YouTube driver stub — disabled so Apple Music is the preferred alt-driver
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
// meHooks — return empty config so Apple Music token fetch is skipped
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
    mbid: `mbid-am-track-${n}`,
    title: `Track ${n}`,
    artist: `Artist ${n}`,
    artworkUrl: null,
    links: [],
  };
}

const TRACK_A = makeTrack(1);
const TRACK_B = makeTrack(2);
const TRACK_C = makeTrack(3);

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
  amSubscribers.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Apple Music ended → clears altDriverActiveMbid", () => {
  it("source leaves 'apple-music' when ended fires mid-queue", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay([TRACK_A, TRACK_B], "Test Ride");
    });
    await flush();

    // Simulate Apple Music loading then playing the first track.
    act(() => {
      fireAmStatus({ state: "playing", trackId: TRACK_A.mbid });
    });
    await flush();

    expect(latest!.ride.source).toBe("apple-music");

    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_A.mbid });
    });
    await flush();

    // PlayerProvider sets sourceRef.current=null / setSource(null) on Apple Music
    // ended (lines 1036–1037). A preview effect may fire immediately after
    // (driverActive becomes false), so source will be "preview" or null — either
    // way it must have left "apple-music".
    expect(latest!.ride.source).not.toBe("apple-music");
  });

  it("source leaves 'apple-music' after ended on the last track", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay([TRACK_A], "Single Track Ride");
    });
    await flush();

    act(() => {
      fireAmStatus({ state: "playing", trackId: TRACK_A.mbid });
    });
    await flush();

    expect(latest!.ride.source).toBe("apple-music");

    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_A.mbid });
    });
    await flush();

    expect(latest!.ride.source).not.toBe("apple-music");
    // Last-track ended: status must reflect that the ride is over.
    expect(latest!.ride.status).toBe("ended");
  });
});

describe("Apple Music ended → queue advance", () => {
  it("advances the queue index when the ended track is not the last", async () => {
    renderPlayer();
    await flush();

    // Start a replay ride with two tracks; Apple Music is the active driver
    // (Spotify and YouTube are both unavailable).
    act(() => {
      latest!.ride.startReplay([TRACK_A, TRACK_B], "Test Ride");
    });
    await flush();

    // Confirm we're on the first track.
    expect(latest!.ride.index).toBe(0);
    expect(latest!.ride.current?.mbid).toBe(TRACK_A.mbid);

    // Apple Music fires "ended" for the current track.
    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_A.mbid });
    });
    await flush();

    // PlayerProvider must have advanced to track B.
    expect(latest!.ride.index).toBe(1);
    expect(latest!.ride.current?.mbid).toBe(TRACK_B.mbid);
    // The ride must still be active (not ended) while there is a next track.
    expect(latest!.ride.status).not.toBe("ended");
    expect(latest!.ride.active).toBe(true);
  });

  it("advances from the middle of a three-track queue to the next item", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay([TRACK_A, TRACK_B, TRACK_C], "Three Track Ride");
    });
    await flush();

    // Advance to TRACK_B manually so we start mid-queue.
    act(() => {
      latest!.ride.next();
    });
    await flush();

    expect(latest!.ride.index).toBe(1);
    expect(latest!.ride.current?.mbid).toBe(TRACK_B.mbid);

    // Apple Music fires "ended" for TRACK_B.
    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_B.mbid });
    });
    await flush();

    expect(latest!.ride.index).toBe(2);
    expect(latest!.ride.current?.mbid).toBe(TRACK_C.mbid);
    expect(latest!.ride.status).not.toBe("ended");
  });

  it("sets ride status to 'ended' when the ended track is the last in the queue", async () => {
    renderPlayer();
    await flush();

    // Ride with only one track.
    act(() => {
      latest!.ride.startReplay([TRACK_A], "Single Track Ride");
    });
    await flush();

    expect(latest!.ride.index).toBe(0);
    expect(latest!.ride.current?.mbid).toBe(TRACK_A.mbid);

    // Apple Music fires "ended" — no next track.
    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_A.mbid });
    });
    await flush();

    // Index must not advance past the last item.
    expect(latest!.ride.index).toBe(0);
    // Status must become "ended" so the UI can stop/present a replay option.
    expect(latest!.ride.status).toBe("ended");
  });

  it("does not advance index beyond queue length when last track ends", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay([TRACK_A, TRACK_B], "Two Track Ride");
    });
    await flush();

    // Advance to last track.
    act(() => {
      latest!.ride.next();
    });
    await flush();

    expect(latest!.ride.index).toBe(1);

    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_B.mbid });
    });
    await flush();

    // Index stays at 1 — not 2 (which would be out of bounds).
    expect(latest!.ride.index).toBe(1);
    expect(latest!.ride.status).toBe("ended");
  });

  it("ignores ended signal from a track that does not match the current queue item", async () => {
    renderPlayer();
    await flush();

    act(() => {
      latest!.ride.startReplay([TRACK_A, TRACK_B], "Test Ride");
    });
    await flush();

    expect(latest!.ride.index).toBe(0);

    // Fire ended with a stale / mismatched trackId — PlayerProvider guards against this.
    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_B.mbid }); // TRACK_B, not current TRACK_A
    });
    await flush();

    // Index must NOT have advanced — the guard `mbid !== currentMbid` rejects it.
    expect(latest!.ride.index).toBe(0);
    expect(latest!.ride.status).not.toBe("ended");
  });

  it("ignores a stale 'ended' event carrying the previous track's MBID", async () => {
    renderPlayer();
    await flush();

    // Start a two-track ride.
    act(() => {
      latest!.ride.startReplay([TRACK_A, TRACK_B], "Test Ride Stale");
    });
    await flush();

    // Advance to track B by firing a valid ended event for track A.
    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_A.mbid });
    });
    await flush();

    // Confirm we are now on track B (index 1).
    expect(latest!.ride.index).toBe(1);
    expect(latest!.ride.current?.mbid).toBe(TRACK_B.mbid);

    // Now fire a late-arriving "ended" event that still carries track A's MBID.
    // This simulates an out-of-order / stale signal from the previous track.
    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_A.mbid });
    });
    await flush();

    // The MBID guard must have rejected the stale signal:
    // index must remain at 1 (not advance past the end of the queue).
    expect(latest!.ride.index).toBe(1);
    // The ride must still be active — status must not become "ended".
    expect(latest!.ride.status).not.toBe("ended");
    expect(latest!.ride.active).toBe(true);
  });
});

describe("Apple Music ended → live+service-ride skips queue advance", () => {
  it("does not advance the index when isLiveSvcRide is active", async () => {
    // Set playbackMode to resolve_to_service via localStorage before mount so
    // PlayerProvider initialises with the mode that, combined with
    // timeOrientation="live", makes isLiveSvcRide true.
    localStorage.setItem("lore:playback-mode", "resolve_to_service");

    renderPlayer();
    await flush();

    // Start a live-orientation ride — timeOrientation becomes "live".
    act(() => {
      latest!.ride.start(TRACK_A, { timeOrientation: "live", stationSlug: "test-station" });
    });
    await flush();

    const indexBefore = latest!.ride.index;

    // Apple Music fires "ended" but isLiveSvcRide=true means PlayerProvider
    // must NOT call setIndex — the station now-playing poll drives advances.
    act(() => {
      fireAmStatus({ state: "ended", trackId: TRACK_A.mbid });
    });
    await flush();

    expect(latest!.ride.index).toBe(indexBefore);
    // source is still cleared (altDriverActiveMbid=null) even in live mode.
    expect(latest!.ride.source).toBeNull();
  });
});
