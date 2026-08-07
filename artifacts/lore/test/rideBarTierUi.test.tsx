// @vitest-environment jsdom
/**
 * RideBar past-mode tier UI — component tests.
 *
 * Covers the Dial-facing tier orchestration surface:
 * - Tier announcement sentence shows on a past replay (after the interstitial
 *   gate clears), and is suppressed while the interstitial is armed.
 * - Tier-4 cue sheet "Next: {artist} — {title}" appears when cueSheetVisible
 *   and tapping it calls ride.next().
 * - pastRunFailed shows an explicit "Playback stopped" state.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RideBar } from "../src/components/RideBar";
import type { RideApi, RideItem } from "../src/player/PlayerProvider";
import type { SpotifyConnectApi } from "../src/player/useSpotifyConnect";

// Child components that pull in query-client / server state — stub them out.
vi.mock("../src/components/KeepButton", () => ({
  KeepButton: () => <span data-testid="stub-keep" />,
}));
vi.mock("../src/components/ShareButton", () => ({
  ShareButton: () => <span data-testid="stub-share" />,
}));
vi.mock("../src/components/DevicePicker", () => ({
  DevicePicker: () => <span data-testid="stub-device-picker" />,
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

afterEach(() => cleanup());

const item: RideItem = {
  mbid: "mbid-1",
  title: "Go Your Own Way",
  artist: "Fleetwood Mac",
  artworkUrl: null,
  links: [],
  previewUrl: "https://example.com/p.mp3",
  attribution: null,
};

const nextItem: RideItem = {
  ...item,
  mbid: "mbid-2",
  title: "Dreams",
};

function makeRide(overrides: Partial<RideApi> = {}): RideApi {
  return {
    active: true,
    status: "loading",
    queue: [item, nextItem],
    index: 0,
    current: item,
    seeking: false,
    atTrailEnd: false,
    progressMs: null,
    durationMs: null,
    source: null,
    sourceLabel: null,
    mode: "replay",
    replayLabel: "KEXP · Early · 2024-06-02",
    timeOrientation: "past",
    playbackMode: "passthrough",
    fallbackUsed: false,
    deviceLost: false,
    start: vi.fn(),
    startReplay: vi.fn(),
    listenContext: null,
    stop: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    togglePause: vi.fn(),
    setPlaybackMode: vi.fn(),
    retrySpotify: vi.fn(),
    openConnectionCentre: vi.fn(),
    seek: vi.fn(),
    spotifyDeepLink: null,
    bandcampAlbumUrl: null,
    appleMusicConfigured: false,
    appleMusicConnected: false,
    preferredService: null,
    setPreferredService: vi.fn(),
    interstitialArmed: false,
    dismissInterstitial: vi.fn(),
    deviceMismatch: false,
    dismissDeviceMismatch: vi.fn(),
    bufferOutrun: false,
    pastModeTier: null,
    pastModeTierAnnouncement: null,
    cueSheetVisible: false,
    cueSheetNext: null,
    pastRunFailed: false,
    pastRunFailure: null,
    retryPastRun: vi.fn(),
    continuePastRunWithCueSheet: vi.fn(),
    skipPastRunTrack: vi.fn(),
    ...overrides,
  };
}

const spotify = {
  connected: false,
  premium: false,
  devices: [],
  pinnedDevice: null,
  notice: null,
  clearNotice: vi.fn(),
} as unknown as SpotifyConnectApi;

describe("RideBar past-mode tier UI", () => {
  it("shows the tier announcement on a past replay once the interstitial clears", () => {
    render(
      <RideBar
        ride={makeRide({
          pastModeTier: 1,
          pastModeTierAnnouncement:
            "This run will play gaplessly on your Spotify device.",
        })}
        spotify={spotify}
      />,
    );
    const el = screen.getByTestId("past-tier-announcement");
    expect(el.textContent).toContain("gaplessly");
  });

  it("suppresses the announcement while the interstitial gate is armed", () => {
    render(
      <RideBar
        ride={makeRide({
          interstitialArmed: true,
          pastModeTier: 1,
          pastModeTierAnnouncement:
            "This run will play gaplessly on your Spotify device.",
        })}
        spotify={spotify}
      />,
    );
    expect(screen.queryByTestId("past-tier-announcement")).toBeNull();
    // The gate itself is visible instead.
    expect(screen.getByTestId("ride-crossing-interstitial")).toBeTruthy();
  });

  it("does not show the announcement outside past replay", () => {
    render(
      <RideBar
        ride={makeRide({
          mode: "trail",
          timeOrientation: "curated",
          pastModeTierAnnouncement: "should not render",
        })}
        spotify={spotify}
      />,
    );
    expect(screen.queryByTestId("past-tier-announcement")).toBeNull();
  });

  it("shows the Tier-4 cue sheet and calls ride.next() on tap", () => {
    const next = vi.fn();
    render(
      <RideBar
        ride={makeRide({
          pastModeTier: 4,
          cueSheetVisible: true,
          cueSheetNext: { artist: "Fleetwood Mac", title: "Dreams" },
          next,
        })}
        spotify={spotify}
      />,
    );
    const sheet = screen.getByTestId("past-cue-sheet");
    expect(sheet.textContent).toContain("Fleetwood Mac — Dreams");
    fireEvent.click(screen.getByTestId("past-cue-next"));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("hides the cue sheet before its timer fires (cueSheetVisible=false)", () => {
    render(
      <RideBar
        ride={makeRide({
          pastModeTier: 4,
          cueSheetVisible: false,
          cueSheetNext: { artist: "Fleetwood Mac", title: "Dreams" },
        })}
        spotify={spotify}
      />,
    );
    expect(screen.queryByTestId("past-cue-sheet")).toBeNull();
  });

  it("shows an explicit stopped state when pastRunFailed is true", () => {
    render(
      <RideBar ride={makeRide({ pastRunFailed: true })} spotify={spotify} />,
    );
    const el = screen.getByTestId("past-run-failed");
    expect(el.textContent).toContain("Playback stopped");
  });

  it("names the failing track and service when pastRunFailure is set", () => {
    render(
      <RideBar
        ride={makeRide({
          pastRunFailed: true,
          pastRunFailure: {
            mbid: "mbid-2",
            title: "Dreams",
            artist: "Fleetwood Mac",
            service: "Spotify",
          },
        })}
        spotify={spotify}
      />,
    );
    const el = screen.getByTestId("past-run-failed");
    expect(el.textContent).toContain(
      "Playback stopped — 'Dreams' by Fleetwood Mac couldn't be loaded from Spotify.",
    );
  });

  it("falls back to the generic stopped copy when pastRunFailure is null", () => {
    render(
      <RideBar ride={makeRide({ pastRunFailed: true })} spotify={spotify} />,
    );
    const el = screen.getByTestId("past-run-failed");
    expect(el.textContent).toContain(
      "a track in this run couldn't be loaded from the connected service",
    );
  });

  it("shows a Skip action when the failing track is named, and it calls skipPastRunTrack", () => {
    const skipPastRunTrack = vi.fn();
    render(
      <RideBar
        ride={makeRide({
          pastRunFailed: true,
          pastRunFailure: {
            mbid: "mbid-2",
            title: "Dreams",
            artist: "Fleetwood Mac",
            service: "Spotify",
          },
          skipPastRunTrack,
        })}
        spotify={spotify}
      />,
    );
    const skip = screen.getByTestId("past-run-skip");
    expect(skip.textContent).toContain("Skip this track");
    fireEvent.click(skip);
    expect(skipPastRunTrack).toHaveBeenCalledTimes(1);
  });

  it("hides the Skip action when the failing track is unknown (pastRunFailure null)", () => {
    render(
      <RideBar ride={makeRide({ pastRunFailed: true })} spotify={spotify} />,
    );
    expect(screen.queryByTestId("past-run-skip")).toBeNull();
    // Retry and cue-sheet actions remain available.
    expect(screen.getByTestId("past-run-retry")).toBeTruthy();
    expect(screen.getByTestId("past-run-cue-sheet")).toBeTruthy();
  });
});
