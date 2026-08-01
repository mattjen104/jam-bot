// @vitest-environment jsdom
/**
 * Component tests for the webplayer Spotify cast control (WpCast).
 *
 * States:
 *  - server not configured → control absent (feature honestly missing)
 *  - not connected → "Connect Spotify to cast" prompt wired to spotify.connect
 *  - connected but non-premium → premium note, no cast button
 *  - connected+premium → cast button; picker lists devices, pin/close on select
 *  - pinned device → button shows the device name; "Stop casting" unpins
 *  - status line mirrors the provider's cast state: connecting / casting /
 *    paused / fallback (all three honest reasons)
 *  - device fetch failure and empty device list render distinct messages
 *
 * The live cast loop itself (cast-on-track-change, browser-stream muting,
 * fallback resume) runs in PlayerProvider and is covered by
 * liveRadioCast.test.tsx — these tests cover the webplayer-surface UI.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WpCast } from "../src/webplayer/WpCast";
import { usePlayer } from "../src/player/PlayerProvider";
import type { SpotifyDevice } from "../src/player/useSpotifyConnect";

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DEVICE: SpotifyDevice = {
  id: "dev-1",
  name: "Kitchen Speaker",
  type: "Speaker",
  isActive: true,
  volumePercent: 50,
} as SpotifyDevice;

interface MockOpts {
  configured?: boolean;
  connected?: boolean;
  premium?: boolean;
  pinnedDevice?: SpotifyDevice | null;
  casting?: "off" | "connecting" | "casting" | "fallback";
  castFallbackReason?: "not_on_spotify" | "rate_limited" | "spotify_error" | null;
  castPaused?: boolean;
  fetchDevices?: () => Promise<SpotifyDevice[]>;
}

function mockPlayer(opts: MockOpts = {}) {
  const connect = vi.fn();
  const pinDevice = vi.fn();
  const unpinDevice = vi.fn();
  const castRetry = vi.fn();
  const fetchDevices = opts.fetchDevices ?? vi.fn(async () => [DEVICE]);
  vi.mocked(usePlayer).mockReturnValue({
    radio: {
      status: "playing",
      station: { slug: "kexp", name: "KEXP" },
      volume: 0.85,
      error: null,
      casting: opts.casting ?? "off",
      castFallbackReason: opts.castFallbackReason ?? null,
      castPaused: opts.castPaused ?? false,
      castRetry,
      toggle: vi.fn(),
      stop: vi.fn(),
      setVolume: vi.fn(),
    },
    spotify: {
      configured: opts.configured ?? true,
      connected: opts.connected ?? true,
      premium: opts.premium ?? true,
      displayName: "Test User",
      product: "premium",
      notice: null,
      clearNotice: vi.fn(),
      showNotice: vi.fn(),
      connect,
      disconnect: vi.fn(),
      refresh: vi.fn(),
      pinnedDevice: opts.pinnedDevice ?? null,
      fetchDevices,
      pinDevice,
      unpinDevice,
    },
    ride: {} as never,
  } as unknown as ReturnType<typeof usePlayer>);
  return { connect, pinDevice, unpinDevice, fetchDevices, castRetry };
}

describe("WpCast visibility states", () => {
  it("renders nothing when the server has no Spotify credentials", () => {
    mockPlayer({ configured: false });
    const { container } = render(<WpCast />);
    expect(container.innerHTML).toBe("");
  });

  it("prompts to connect when Spotify is not linked", () => {
    const { connect } = mockPlayer({ connected: false });
    render(<WpCast />);
    const btn = screen.getByTestId("wp-cast-connect");
    expect(btn.textContent).toContain("Connect Spotify to cast");
    fireEvent.click(btn);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("wp-cast-button")).toBeNull();
  });

  it("shows the premium note for non-premium accounts", () => {
    mockPlayer({ premium: false });
    render(<WpCast />);
    expect(screen.getByTestId("wp-cast-premium-note").textContent).toContain(
      "Premium",
    );
    expect(screen.queryByTestId("wp-cast-button")).toBeNull();
  });

  it("shows the cast button when connected and premium", () => {
    mockPlayer();
    render(<WpCast />);
    expect(screen.getByTestId("wp-cast-button").textContent).toContain("Cast");
    expect(screen.queryByTestId("wp-cast-status")).toBeNull();
  });
});

describe("WpCast device picker", () => {
  it("lists devices and pins the selected one", async () => {
    const { pinDevice } = mockPlayer();
    render(<WpCast />);
    fireEvent.click(screen.getByTestId("wp-cast-button"));
    await waitFor(() =>
      expect(screen.getByTestId("wp-cast-device-dev-1")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("wp-cast-device-dev-1"));
    expect(pinDevice).toHaveBeenCalledWith(DEVICE);
    // Picker closes after pinning.
    expect(screen.queryByTestId("wp-cast-panel")).toBeNull();
  });

  it("shows the empty state when no devices are found", async () => {
    mockPlayer({ fetchDevices: vi.fn(async () => []) });
    render(<WpCast />);
    fireEvent.click(screen.getByTestId("wp-cast-button"));
    await waitFor(() =>
      expect(screen.getByTestId("wp-cast-devices-empty")).toBeTruthy(),
    );
  });

  it("shows an error state when the device fetch fails", async () => {
    mockPlayer({
      fetchDevices: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    render(<WpCast />);
    fireEvent.click(screen.getByTestId("wp-cast-button"));
    await waitFor(() =>
      expect(screen.getByTestId("wp-cast-devices-error")).toBeTruthy(),
    );
  });

  it("offers Stop casting when a device is pinned, wired to unpin", async () => {
    const { unpinDevice } = mockPlayer({
      pinnedDevice: DEVICE,
      casting: "casting",
    });
    render(<WpCast />);
    expect(screen.getByTestId("wp-cast-button").textContent).toContain(
      "Kitchen Speaker",
    );
    fireEvent.click(screen.getByTestId("wp-cast-button"));
    await waitFor(() => expect(screen.getByTestId("wp-cast-stop")).toBeTruthy());
    fireEvent.click(screen.getByTestId("wp-cast-stop"));
    expect(unpinDevice).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("wp-cast-panel")).toBeNull();
  });
});

describe("WpCast status line", () => {
  it("shows the connecting state while waiting for a resolvable track", () => {
    mockPlayer({ pinnedDevice: DEVICE, casting: "connecting" });
    render(<WpCast />);
    expect(screen.getByTestId("wp-cast-status").textContent).toContain(
      "Waiting for a track to resolve",
    );
  });

  it("shows casting-to-device while the cast is live", () => {
    mockPlayer({ pinnedDevice: DEVICE, casting: "casting" });
    render(<WpCast />);
    expect(screen.getByTestId("wp-cast-status").textContent).toBe(
      "Casting to Kitchen Speaker",
    );
  });

  it("shows the paused state when the listener paused the cast", () => {
    mockPlayer({ pinnedDevice: DEVICE, casting: "casting", castPaused: true });
    render(<WpCast />);
    expect(screen.getByTestId("wp-cast-status").textContent).toBe(
      "Paused on Kitchen Speaker",
    );
  });

  it.each([
    ["not_on_spotify", "Not on Spotify · playing the broadcast"],
    ["rate_limited", "Spotify is rate-limited right now · playing the broadcast"],
    ["spotify_error", "Spotify unavailable · playing the broadcast"],
  ] as const)("shows the honest fallback line for %s", (reason, expected) => {
    mockPlayer({
      pinnedDevice: DEVICE,
      casting: "fallback",
      castFallbackReason: reason,
    });
    render(<WpCast />);
    expect(screen.getByTestId("wp-cast-status").textContent).toBe(expected);
  });

  it("shows no status line when casting is off", () => {
    mockPlayer({ casting: "off" });
    render(<WpCast />);
    expect(screen.queryByTestId("wp-cast-status")).toBeNull();
  });
});

describe("WpCast retry control", () => {
  it.each(["rate_limited", "spotify_error"] as const)(
    "shows Retry for a retryable fallback (%s), wired to castRetry",
    (reason) => {
      const { castRetry } = mockPlayer({
        pinnedDevice: DEVICE,
        casting: "fallback",
        castFallbackReason: reason,
      });
      render(<WpCast />);
      const btn = screen.getByTestId("wp-cast-retry");
      fireEvent.click(btn);
      expect(castRetry).toHaveBeenCalledTimes(1);
    },
  );

  it("hides Retry when the track is simply not on Spotify", () => {
    mockPlayer({
      pinnedDevice: DEVICE,
      casting: "fallback",
      castFallbackReason: "not_on_spotify",
    });
    render(<WpCast />);
    expect(screen.queryByTestId("wp-cast-retry")).toBeNull();
  });

  it("hides Retry outside the fallback state", () => {
    mockPlayer({ pinnedDevice: DEVICE, casting: "casting" });
    render(<WpCast />);
    expect(screen.queryByTestId("wp-cast-retry")).toBeNull();
  });
});
