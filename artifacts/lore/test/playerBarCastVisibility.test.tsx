// @vitest-environment jsdom
/**
 * PlayerBar cast affordance gating:
 *  - connected + premium tier → device picker shown;
 *  - connected + UNKNOWN tier (profile fetch failed at connect time) →
 *    device picker still shown (server is equally permissive);
 *  - connected + explicit free tier → picker hidden;
 *  - configured but NOT connected → cast icon shown as a connect entry point.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    spotifyPause: vi.fn(async () => {}),
    getRecordingPreview: vi.fn(async () => ({ previewUrl: null, artworkUrl: null })),
  });
});

import { PlayerBar } from "../src/components/PlayerBar";
import type { SpotifyConnectApi } from "../src/player/useSpotifyConnect";
import type { Station } from "@workspace/api-client-react";

const STATION = { slug: "kexp", name: "KEXP" } as Station;

function makeSpotify(overrides: Partial<SpotifyConnectApi>): SpotifyConnectApi {
  const product = overrides.product ?? null;
  return {
    configured: true,
    connected: false,
    premium: product == null || product === "" || product === "premium",
    displayName: null,
    product,
    notice: null,
    clearNotice: vi.fn(),
    showNotice: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    pinnedDevice: null,
    fetchDevices: vi.fn(async () => []),
    pinDevice: vi.fn(),
    unpinDevice: vi.fn(),
    ...overrides,
  };
}

function renderBar(spotify: SpotifyConnectApi) {
  return render(
    <PlayerBar
      station={STATION}
      status="playing"
      volume={0.8}
      error={null}
      onToggle={vi.fn()}
      onStop={vi.fn()}
      onVolume={vi.fn()}
      spotify={spotify}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlayerBar cast button visibility", () => {
  it("shows the device picker when connected with a premium tier", () => {
    renderBar(makeSpotify({ connected: true, product: "premium" }));
    expect(screen.getByTestId("device-picker-button")).toBeTruthy();
    expect(screen.queryByTestId("cast-connect-button")).toBeNull();
  });

  it("shows the device picker when connected with an UNKNOWN tier", () => {
    renderBar(makeSpotify({ connected: true, product: null }));
    expect(screen.getByTestId("device-picker-button")).toBeTruthy();
  });

  it("hides the picker for an explicitly free-tier account", () => {
    renderBar(makeSpotify({ connected: true, product: "free", premium: false }));
    expect(screen.queryByTestId("device-picker-button")).toBeNull();
    expect(screen.queryByTestId("cast-connect-button")).toBeNull();
  });

  it("shows a connect entry point when Spotify is configured but not connected", () => {
    const spotify = makeSpotify({ connected: false });
    renderBar(spotify);
    expect(screen.queryByTestId("device-picker-button")).toBeNull();
    const btn = screen.getByLabelText("Connect Spotify");
    fireEvent.click(btn);
    expect(spotify.connect).toHaveBeenCalled();
  });

  it("shows nothing when Spotify isn't configured at all", () => {
    renderBar(makeSpotify({ configured: false, connected: false }));
    expect(screen.queryByTestId("device-picker-button")).toBeNull();
    expect(screen.queryByLabelText("Connect Spotify")).toBeNull();
  });
});

describe("PlayerBar cast retry control", () => {
  function renderFallbackBar(
    reason: "not_on_spotify" | "rate_limited" | "spotify_error",
    onCastRetry?: () => void,
  ) {
    return render(
      <PlayerBar
        station={STATION}
        status="playing"
        volume={0.8}
        error={null}
        casting="fallback"
        castFallbackReason={reason}
        onCastRetry={onCastRetry}
        onToggle={vi.fn()}
        onStop={vi.fn()}
        onVolume={vi.fn()}
        spotify={makeSpotify({ connected: true, product: "premium" })}
      />,
    );
  }

  it.each(["rate_limited", "spotify_error"] as const)(
    "shows Retry for a retryable fallback (%s), wired to onCastRetry",
    (reason) => {
      const onCastRetry = vi.fn();
      renderFallbackBar(reason, onCastRetry);
      fireEvent.click(screen.getByTestId("cast-retry"));
      expect(onCastRetry).toHaveBeenCalledTimes(1);
    },
  );

  it("hides Retry when the track is simply not on Spotify", () => {
    renderFallbackBar("not_on_spotify", vi.fn());
    expect(screen.queryByTestId("cast-retry")).toBeNull();
  });

  it("hides Retry when no retry handler is provided", () => {
    renderFallbackBar("rate_limited");
    expect(screen.queryByTestId("cast-retry")).toBeNull();
  });
});
