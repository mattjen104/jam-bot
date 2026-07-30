// @vitest-environment jsdom
/**
 * Unit tests for LibraryRow "Door 1 — Track" Spotify path.
 *
 * Covers three cases from the handleTrack branch in DoorStrip:
 *   1. Spotify connected + premium → spotifyPlay called with correct mbid + deviceId.
 *   2. Spotify connected + premium, but spotifyPlay rejects → ride.startReplay called as fallback.
 *   3. Spotify not connected → ride.startReplay called directly, spotifyPlay never called.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoist mock fns — must be created before vi.mock() factories execute.
// ---------------------------------------------------------------------------

const { mockSpotifyPlay, mockStartReplay } = vi.hoisted(() => ({
  mockSpotifyPlay: vi.fn<[], Promise<void>>(),
  mockStartReplay: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  spotifyPlay: mockSpotifyPlay,
  getRecordingAlbumTracks: vi.fn(async () => ({ tracks: [], rgTitle: null })),
}));

// ---------------------------------------------------------------------------
// Imports (must follow vi.mock calls)
// ---------------------------------------------------------------------------

import { usePlayer } from "../src/player/PlayerProvider";
import { LibraryRow } from "../src/components/LibraryRow";
import type { LibraryItem } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MBID = "test-mbid-1234";
const DEVICE_ID = "device-abc";

const ITEM: LibraryItem = {
  mbid: MBID,
  addedAt: "2024-01-01T00:00:00Z",
  provenance: { kind: "keep" },
  recording: {
    title: "Some Track",
    artist: "Some Artist",
    artworkUrl: null,
    albumTitle: null,
    spotifyUrl: null,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRide() {
  return {
    active: false,
    startReplay: mockStartReplay,
  };
}

function makeSpotify(overrides: {
  connected: boolean;
  premium?: boolean;
  deviceId?: string | null;
}) {
  return {
    configured: true,
    connected: overrides.connected,
    premium: overrides.premium ?? true,
    displayName: null,
    product: overrides.premium === false ? "free" : "premium",
    notice: null,
    clearNotice: vi.fn(),
    showNotice: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    pinnedDevice:
      overrides.deviceId != null ? { id: overrides.deviceId } : null,
    fetchDevices: vi.fn(async () => []),
    pinDevice: vi.fn(),
    unpinDevice: vi.fn(),
  };
}

function renderRow(
  spotify: ReturnType<typeof makeSpotify>,
  ride = makeRide(),
) {
  vi.mocked(usePlayer).mockReturnValue({
    ride: ride as ReturnType<typeof makeRide>,
    spotify: spotify as ReturnType<typeof makeSpotify>,
    // scan and radio are not used by DoorStrip
    scan: {} as never,
    radio: {} as never,
  });

  return render(
    <ul>
      <LibraryRow item={ITEM} isOpen={true} onToggle={vi.fn()} />
    </ul>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Door 1 — Spotify connected + premium", () => {
  it("calls spotifyPlay with the correct mbid and deviceId when Spotify is eligible", async () => {
    mockSpotifyPlay.mockResolvedValue(undefined);

    renderRow(makeSpotify({ connected: true, premium: true, deviceId: DEVICE_ID }));

    fireEvent.click(screen.getByTitle("Play this track"));

    await waitFor(() => {
      expect(mockSpotifyPlay).toHaveBeenCalledTimes(1);
    });

    expect(mockSpotifyPlay).toHaveBeenCalledWith({
      mbid: MBID,
      deviceId: DEVICE_ID,
    });
  });

  it("does NOT call ride.startReplay when spotifyPlay succeeds", async () => {
    mockSpotifyPlay.mockResolvedValue(undefined);

    renderRow(makeSpotify({ connected: true, premium: true, deviceId: DEVICE_ID }));

    fireEvent.click(screen.getByTitle("Play this track"));

    // Give the promise chain time to settle, then confirm no fallback.
    await waitFor(() => {
      expect(mockSpotifyPlay).toHaveBeenCalledTimes(1);
    });
    expect(mockStartReplay).not.toHaveBeenCalled();
  });
});

describe("Door 1 — spotifyPlay rejects → fallback to ride.startReplay", () => {
  it("calls ride.startReplay when spotifyPlay rejects", async () => {
    mockSpotifyPlay.mockRejectedValue(new Error("Spotify error"));

    renderRow(makeSpotify({ connected: true, premium: true, deviceId: DEVICE_ID }));

    fireEvent.click(screen.getByTitle("Play this track"));

    await waitFor(() => {
      expect(mockStartReplay).toHaveBeenCalledTimes(1);
    });
  });

  it("passes the correct seed to ride.startReplay on fallback", async () => {
    mockSpotifyPlay.mockRejectedValue(new Error("Spotify error"));

    renderRow(makeSpotify({ connected: true, premium: true, deviceId: null }));

    fireEvent.click(screen.getByTitle("Play this track"));

    await waitFor(() => {
      expect(mockStartReplay).toHaveBeenCalledTimes(1);
    });

    const [seeds] = mockStartReplay.mock.calls[0] as Parameters<typeof mockStartReplay>;
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({ mbid: MBID });
  });
});

describe("Door 1 — Spotify not connected → ride.startReplay called directly", () => {
  it("calls ride.startReplay immediately when Spotify is not connected", () => {
    mockSpotifyPlay.mockResolvedValue(undefined);

    renderRow(makeSpotify({ connected: false }));

    fireEvent.click(screen.getByTitle("Play this track"));

    expect(mockStartReplay).toHaveBeenCalledTimes(1);
    expect(mockSpotifyPlay).not.toHaveBeenCalled();
  });

  it("calls ride.startReplay immediately when Spotify is connected but not premium", () => {
    mockSpotifyPlay.mockResolvedValue(undefined);

    renderRow(makeSpotify({ connected: true, premium: false }));

    fireEvent.click(screen.getByTitle("Play this track"));

    expect(mockStartReplay).toHaveBeenCalledTimes(1);
    expect(mockSpotifyPlay).not.toHaveBeenCalled();
  });

  it("passes the correct seed to ride.startReplay when falling through directly", () => {
    renderRow(makeSpotify({ connected: false }));

    fireEvent.click(screen.getByTitle("Play this track"));

    const [seeds] = mockStartReplay.mock.calls[0] as Parameters<typeof mockStartReplay>;
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({ mbid: MBID });
  });
});
