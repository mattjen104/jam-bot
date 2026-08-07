// @vitest-environment jsdom
/**
 * Integration test: device-lost mid-ride triggers unpinDevice in the real
 * PlayerProvider production code.
 *
 * These tests exercise the actual PlayerProvider + useSpotifyConnect wiring:
 * when getSpotifyPlayer returns "not our track playing" for DEVICE_LOST_POLLS
 * consecutive 3 s ticks, the production code at PlayerProvider.tsx ~line 683
 * must call unpinDeviceRef.current() which is the real useSpotifyConnect
 * unpinDevice — clearing pinnedDevice so the next spotifyPlay targets the
 * active device (deviceId: undefined).
 *
 * The tests would FAIL if the `unpinDeviceRef.current()` call were removed
 * from PlayerProvider's device-lost branch, which is the regression these
 * tests are designed to catch.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { useRef, useEffect } from "react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    getSpotifyStatus: vi.fn(async () => ({
      configured: true,
      connected: true,
      displayName: "Test User",
      product: "premium",
    })),
    spotifyLogout: vi.fn(async () => {}),
    getSpotifyDevices: vi.fn(async () => ({ devices: [] })),
    spotifyPlay: vi.fn(async () => ({ trackUri: "spotify:track:test-uri-abc" })),
    spotifyPause: vi.fn(async () => {}),
    spotifyResume: vi.fn(async () => {}),
    getSpotifyPlayer: vi.fn(async () => ({
      trackUri: "spotify:track:something-else",
      isPlaying: false,
      active: false,
      progressMs: 0,
    })),
    getRecording: vi.fn(async () => ({ links: [] })),
    getRecordingSegues: vi.fn(async () => ({ next: [] })),
    getRecordingPreview: vi.fn(async () => ({ previewUrl: null, artworkUrl: null })),
    getStationNowPlaying: vi.fn(async () => null),
    getGetStationNowPlayingQueryKey: vi.fn(() => ["station-now-playing"]),
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
  })),
}));

// PlayerProvider uses useWpOnAir internally (React Query). Stub it so tests
// that render <PlayerProvider> directly don't need a real QueryClientProvider.
vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const { makeWebplayerHooksMock } = await import("./helpers/webplayerHooksMock");
  return makeWebplayerHooksMock(importOriginal, {
    useWpOnAir: vi.fn(() => ({ data: undefined, isLoading: false, dataUpdatedAt: 0 })),
    useWpLoreCounts: vi.fn(() => ({ data: undefined })),
    useWpRecordingSpins: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })),
  });
});

// PlayerProvider reads /api/config via useAppConfig (React Query). Stub the
// meHooks barrel so a real QueryClientProvider isn't required.
vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useAppConfig: vi.fn(() => ({ data: null, isLoading: false })),
  });
});

import {
  PlayerProvider,
  usePlayer,
  type RideSeed,
} from "../src/player/PlayerProvider";
import { DEVICE_LOST_POLLS } from "../src/player/playbackSession";
import type { SpotifyDevice } from "@workspace/api-client-react";
import { spotifyPlay } from "@workspace/api-client-react";

const LOST_DEVICE: SpotifyDevice = {
  id: "device-abc",
  name: "Test Speaker",
  type: "Speaker",
  isActive: true,
  isRestricted: false,
  volumePercent: 50,
};

const TEST_SEED: RideSeed = {
  mbid: "mbid-test-track",
  title: "Test Track",
  artist: "Test Artist",
  artworkUrl: null,
  links: [],
};

/**
 * Minimal consumer that:
 * 1. Waits for Spotify to report connected+premium (async — getSpotifyStatus resolves)
 * 2. Pins a device, switches to resolve_to_service, and starts a curated ride
 * 3. Renders observable state so the test can assert on it
 */
function DeviceLostObserver() {
  const { ride, spotify } = usePlayer();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !spotify.connected || !spotify.premium) return;
    started.current = true;
    spotify.pinDevice(LOST_DEVICE);
    ride.setPlaybackMode("resolve_to_service");
    ride.start(TEST_SEED, { timeOrientation: "curated" });
  }, [spotify.connected, spotify.premium, ride, spotify]);

  return (
    <div>
      <span data-testid="pinned-device-id">{spotify.pinnedDevice?.id ?? ""}</span>
      <span data-testid="device-lost">{ride.deviceLost ? "true" : "false"}</span>
      <span data-testid="fallback-used">{ride.fallbackUsed ? "true" : "false"}</span>
    </div>
  );
}

function renderObserver() {
  return render(
    <PlayerProvider>
      <DeviceLostObserver />
    </PlayerProvider>,
  );
}

/**
 * Advance fake timers by DEVICE_LOST_POLLS × 3 s, flushing microtasks after
 * each tick so that the getSpotifyPlayer promise chain resolves before the
 * next tick fires. This mirrors the real 3 s polling interval.
 */
async function advancePastDeviceLostThreshold() {
  for (let i = 0; i < DEVICE_LOST_POLLS; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(
    undefined,
  );
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(
    () => {},
  );
  vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(
    () => {},
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Core: device-lost triggers unpinDevice in PlayerProvider (production wiring)
// ---------------------------------------------------------------------------
describe("PlayerProvider device-lost → unpinDevice wiring", () => {
  it("pinnedDevice becomes null after DEVICE_LOST_POLLS silent poll ticks", async () => {
    renderObserver();

    // Flush microtasks so getSpotifyStatus resolves and the ride auto-starts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Wait for spotifyPlay to have been called (Spotify connected, ride started,
    // mode switched to resolve_to_service — pin should be visible).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The device pin must be reflected in the UI before polling starts.
    // (If this fails, the ride did not start or getSpotifyStatus did not resolve.)
    expect(screen.getByTestId("pinned-device-id").textContent).toBe("device-abc");

    // Advance past the device-lost threshold (DEVICE_LOST_POLLS = 5 × 3 s).
    await advancePastDeviceLostThreshold();

    // PlayerProvider's device-lost branch (line ~683) must have called
    // unpinDeviceRef.current() — the real useSpotifyConnect.unpinDevice —
    // which sets pinnedDevice to null.
    expect(screen.getByTestId("pinned-device-id").textContent).toBe("");
  });

  it("ride.deviceLost is true after the device-lost branch fires", async () => {
    renderObserver();

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(screen.getByTestId("device-lost").textContent).toBe("false");

    await advancePastDeviceLostThreshold();

    expect(screen.getByTestId("device-lost").textContent).toBe("true");
  });

  it("ride.fallbackUsed is true after the device-lost branch fires", async () => {
    renderObserver();

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    await advancePastDeviceLostThreshold();

    expect(screen.getByTestId("fallback-used").textContent).toBe("true");
  });

  it("spotifyPlay was called with the pinned device id before device-lost", async () => {
    const playMock = spotifyPlay as Mock;
    renderObserver();

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // spotifyPlay must have been called with the pinned device id.
    expect(playMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "device-abc" }),
    );

    await advancePastDeviceLostThreshold();

    // After device-lost, pinnedDevice is null — any new play would use
    // deviceId: undefined (active-device default), not the lost "device-abc".
    expect(screen.getByTestId("pinned-device-id").textContent).toBe("");
    const allCalls = playMock.mock.calls.map(([args]) => args.deviceId);
    // Every call that reached Spotify had the pinned device id (before unpin).
    // None were sent to a null/undefined device before the user explicitly pinned one.
    expect(allCalls.some((id) => id === "device-abc")).toBe(true);
  });

  it("device-lost does NOT fire before the threshold — pin still intact at poll 4", async () => {
    renderObserver();

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // DEVICE_LOST_POLLS-1 ticks — must not have fired yet.
    for (let i = 0; i < DEVICE_LOST_POLLS - 1; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }

    // Pin must still be in place — one more tick is needed to cross threshold.
    expect(screen.getByTestId("pinned-device-id").textContent).toBe("device-abc");
    expect(screen.getByTestId("device-lost").textContent).toBe("false");
  });
});
