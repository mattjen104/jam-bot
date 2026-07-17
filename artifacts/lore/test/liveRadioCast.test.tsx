// @vitest-environment jsdom
/**
 * Integration tests: live-radio Spotify casting in the real PlayerProvider.
 *
 * When no ride is active, Spotify is connected+premium, a device is pinned,
 * and a live station is playing, the cast effect must:
 *  - immediately cast the currently-airing resolved track (spotifyPlay) and
 *    pause the browser stream,
 *  - follow station now-playing MBID changes on the 5 s poll,
 *  - fall back to the broadcast (resume) when spotifyPlay fails,
 *  - tear down (spotifyPause + resume broadcast) when the pin is cleared,
 *  - route the player-bar toggle to Spotify pause/resume while casting,
 *  - not command new tracks while cast-paused.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { useEffect, useRef } from "react";

vi.mock("@workspace/api-client-react", () => ({
  getSpotifyStatus: vi.fn(async () => ({
    configured: true,
    connected: true,
    displayName: "Test User",
    product: "premium",
  })),
  spotifyLogout: vi.fn(async () => {}),
  getSpotifyDevices: vi.fn(async () => ({ devices: [] })),
  spotifyPlay: vi.fn(async () => ({ trackUri: "spotify:track:cast-uri" })),
  spotifyPause: vi.fn(async () => {}),
  spotifyResume: vi.fn(async () => {}),
  getSpotifyPlayer: vi.fn(async () => ({
    trackUri: "spotify:track:cast-uri",
    isPlaying: true,
    active: true,
    progressMs: 1000,
  })),
  getRecording: vi.fn(async () => ({ links: [] })),
  getRecordingSegues: vi.fn(async () => ({ next: [] })),
  getRecordingPreview: vi.fn(async () => ({ previewUrl: null, artworkUrl: null })),
  getStationNowPlaying: vi.fn(async () => ({
    nowPlaying: { recording: { mbid: "mbid-track-1" } },
  })),
  useGetStationNowPlaying: vi.fn(() => ({ data: null, isLoading: false })),
  getGetStationNowPlayingQueryKey: vi.fn(() => ["station-now-playing"]),
}));

const radioPause = vi.fn();
const radioResume = vi.fn();
vi.mock("../src/hooks/useRadioPlayer", () => ({
  useRadioPlayer: vi.fn(() => ({
    status: "playing",
    station: {
      slug: "kexp",
      name: "KEXP",
      streamUrl: "https://example.com/stream",
    },
    volume: 0.85,
    error: null,
    setVolume: vi.fn(),
    toggle: vi.fn(),
    stop: vi.fn(),
    pause: radioPause,
    resume: radioResume,
  })),
}));

import { PlayerProvider, usePlayer } from "../src/player/PlayerProvider";
import type { SpotifyDevice, Station } from "@workspace/api-client-react";
import {
  getStationNowPlaying,
  spotifyPause,
  spotifyPlay,
  spotifyResume,
} from "@workspace/api-client-react";

const DEVICE: SpotifyDevice = {
  id: "device-1",
  name: "Kitchen Speaker",
  type: "Speaker",
  isActive: true,
  volumePercent: 50,
} as SpotifyDevice;

/** Harness exposing the player context to the test body. */
function Harness({ onReady }: { onReady: (p: ReturnType<typeof usePlayer>) => void }) {
  const player = usePlayer();
  const ref = useRef(onReady);
  ref.current = onReady;
  useEffect(() => {
    ref.current(player);
  });
  return <div data-testid="cast-status">{player.radio.casting}</div>;
}

let latest: ReturnType<typeof usePlayer> | null = null;

function renderPlayer() {
  return render(
    <PlayerProvider>
      <Harness onReady={(p) => (latest = p)} />
    </PlayerProvider>,
  );
}

/** Flush pending microtasks under fake timers. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function pinDeviceAndSettleStatus() {
  // Let the initial getSpotifyStatus resolve (connected + premium).
  await flush();
  act(() => {
    latest!.spotify.pinDevice(DEVICE);
  });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  latest = null;
  // clearAllMocks does not reset implementations — restore defaults here.
  (spotifyPlay as Mock).mockResolvedValue({ trackUri: "spotify:track:cast-uri" });
  (getStationNowPlaying as Mock).mockResolvedValue({
    nowPlaying: { recording: { mbid: "mbid-track-1" } },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("live radio Spotify casting", () => {
  it("casts the currently-airing track immediately and pauses the stream", async () => {
    renderPlayer();
    await pinDeviceAndSettleStatus();

    expect(getStationNowPlaying).toHaveBeenCalledWith("kexp");
    expect(spotifyPlay).toHaveBeenCalledWith({
      mbid: "mbid-track-1",
      deviceId: "device-1",
    });
    expect(radioPause).toHaveBeenCalled();
    expect(screen.getByTestId("cast-status").textContent).toBe("casting");
  });

  it("follows station now-playing MBID changes on the poll", async () => {
    renderPlayer();
    await pinDeviceAndSettleStatus();
    expect(spotifyPlay).toHaveBeenCalledTimes(1);

    (getStationNowPlaying as Mock).mockResolvedValue({
      nowPlaying: { recording: { mbid: "mbid-track-2" } },
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await flush();

    expect(spotifyPlay).toHaveBeenCalledTimes(2);
    expect(spotifyPlay).toHaveBeenLastCalledWith({
      mbid: "mbid-track-2",
      deviceId: "device-1",
    });
  });

  it("falls back to the broadcast when spotifyPlay fails", async () => {
    (spotifyPlay as Mock).mockRejectedValue(Object.assign(new Error("nope"), { status: 404 }));
    renderPlayer();
    await pinDeviceAndSettleStatus();

    expect(screen.getByTestId("cast-status").textContent).toBe("fallback");
    expect(radioResume).toHaveBeenCalled();
  });

  it("tears down the cast (pause Spotify, resume broadcast) when the pin is cleared", async () => {
    renderPlayer();
    await pinDeviceAndSettleStatus();
    expect(screen.getByTestId("cast-status").textContent).toBe("casting");

    radioResume.mockClear();
    act(() => {
      latest!.spotify.unpinDevice();
    });
    await flush();

    expect(spotifyPause).toHaveBeenCalled();
    expect(radioResume).toHaveBeenCalled();
    expect(screen.getByTestId("cast-status").textContent).toBe("off");
  });

  it("routes the player-bar toggle to Spotify pause/resume while casting and holds new commands while paused", async () => {
    renderPlayer();
    await pinDeviceAndSettleStatus();
    expect(screen.getByTestId("cast-status").textContent).toBe("casting");

    // Toggle while casting → Spotify pause, never the stream.
    act(() => {
      latest!.radio.toggle({ slug: "kexp", name: "KEXP" } as Station);
    });
    await flush();
    expect(spotifyPause).toHaveBeenCalledTimes(1);
    expect(latest!.radio.castPaused).toBe(true);

    // Station moves on while paused — no new play command is sent.
    (getStationNowPlaying as Mock).mockResolvedValue({
      nowPlaying: { recording: { mbid: "mbid-track-3" } },
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await flush();
    expect(spotifyPlay).toHaveBeenCalledTimes(1);

    // Toggle again → Spotify resume.
    act(() => {
      latest!.radio.toggle({ slug: "kexp", name: "KEXP" } as Station);
    });
    await flush();
    expect(spotifyResume).toHaveBeenCalledTimes(1);
    expect(latest!.radio.castPaused).toBe(false);
  });

  it("castRetry re-issues the play for the current track and clears the fallback on success", async () => {
    (spotifyPlay as Mock).mockRejectedValue(
      Object.assign(new Error("rate-limited"), { status: 429 }),
    );
    renderPlayer();
    await pinDeviceAndSettleStatus();
    expect(screen.getByTestId("cast-status").textContent).toBe("fallback");
    expect(latest!.radio.castFallbackReason).toBe("rate_limited");
    expect(spotifyPlay).toHaveBeenCalledTimes(1);

    // Spotify recovers — retry succeeds and the cast resumes.
    (spotifyPlay as Mock).mockResolvedValue({ trackUri: "spotify:track:cast-uri" });
    radioPause.mockClear();
    act(() => {
      latest!.radio.castRetry();
    });
    await flush();

    expect(spotifyPlay).toHaveBeenCalledTimes(2);
    expect(spotifyPlay).toHaveBeenLastCalledWith({
      mbid: "mbid-track-1",
      deviceId: "device-1",
    });
    expect(screen.getByTestId("cast-status").textContent).toBe("casting");
    expect(latest!.radio.castFallbackReason).toBeNull();
    expect(radioPause).toHaveBeenCalled();
  });

  it("castRetry keeps the honest fallback message when Spotify fails again", async () => {
    (spotifyPlay as Mock).mockRejectedValue(
      Object.assign(new Error("boom"), { status: 502 }),
    );
    renderPlayer();
    await pinDeviceAndSettleStatus();
    expect(screen.getByTestId("cast-status").textContent).toBe("fallback");
    expect(latest!.radio.castFallbackReason).toBe("spotify_error");

    act(() => {
      latest!.radio.castRetry();
    });
    await flush();

    expect(spotifyPlay).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("cast-status").textContent).toBe("fallback");
    expect(latest!.radio.castFallbackReason).toBe("spotify_error");
  });

  it("castRetry is a no-op when no cast session is active", async () => {
    renderPlayer();
    await flush(); // status resolves, but no device is pinned
    act(() => {
      latest!.radio.castRetry();
    });
    await flush();
    expect(spotifyPlay).not.toHaveBeenCalled();
  });
});
