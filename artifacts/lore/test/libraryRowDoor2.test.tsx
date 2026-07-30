// @vitest-environment jsdom
/**
 * Unit tests for LibraryRow "Door 2 — Album" path.
 *
 * Covers three cases from the handleAlbum branch in DoorStrip:
 *   1. getRecordingAlbumTracks is called with the correct mbid when clicking "💿 Album".
 *   2. ride.startReplay is called with all returned tracks as seeds in order.
 *   3. When getRecordingAlbumTracks returns an empty tracklist, ride.startReplay is NOT called.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoist mock fns — must be created before vi.mock() factories execute.
// ---------------------------------------------------------------------------

const { mockGetRecordingAlbumTracks, mockStartReplay } = vi.hoisted(() => ({
  mockGetRecordingAlbumTracks: vi.fn<[string], Promise<{ tracks: Array<{ mbid: string; title: string; artist: string }>; rgTitle: string | null }>>(),
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
  spotifyPlay: vi.fn(async () => undefined),
  getRecordingAlbumTracks: mockGetRecordingAlbumTracks,
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

const MBID = "album-test-mbid-5678";

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

const ALBUM_TRACKS = [
  { mbid: "track-mbid-1", title: "Track One", artist: "Some Artist" },
  { mbid: "track-mbid-2", title: "Track Two", artist: "Some Artist" },
  { mbid: "track-mbid-3", title: "Track Three", artist: "Some Artist" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRide() {
  return {
    active: false,
    startReplay: mockStartReplay,
  };
}

function makeSpotify() {
  return {
    configured: true,
    connected: false,
    premium: false,
    displayName: null,
    product: "free",
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
  };
}

function renderRow(ride = makeRide()) {
  vi.mocked(usePlayer).mockReturnValue({
    ride: ride as ReturnType<typeof makeRide>,
    spotify: makeSpotify() as ReturnType<typeof makeSpotify>,
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

describe("Door 2 — Album button calls getRecordingAlbumTracks with the correct mbid", () => {
  it("calls getRecordingAlbumTracks with the item mbid when the album button is clicked", async () => {
    mockGetRecordingAlbumTracks.mockResolvedValue({
      tracks: ALBUM_TRACKS,
      rgTitle: "Some Album",
    });

    renderRow();

    fireEvent.click(screen.getByTitle("Play full album from track 1"));

    await waitFor(() => {
      // Called at least once for the button click (may also be called by the
      // pre-fetch useEffect, so we check that it was called with the right mbid).
      expect(mockGetRecordingAlbumTracks).toHaveBeenCalledWith(MBID);
    });
  });
});

describe("Door 2 — ride.startReplay is called with all tracks in order", () => {
  it("calls ride.startReplay with seeds matching all returned tracks in order", async () => {
    mockGetRecordingAlbumTracks.mockResolvedValue({
      tracks: ALBUM_TRACKS,
      rgTitle: "Some Album",
    });

    renderRow();

    fireEvent.click(screen.getByTitle("Play full album from track 1"));

    await waitFor(() => {
      expect(mockStartReplay).toHaveBeenCalledTimes(1);
    });

    const [seeds] = mockStartReplay.mock.calls[0] as Parameters<typeof mockStartReplay>;
    expect(seeds).toHaveLength(ALBUM_TRACKS.length);
    ALBUM_TRACKS.forEach((track, i) => {
      expect(seeds[i]).toMatchObject({ mbid: track.mbid, title: track.title, artist: track.artist });
    });
  });

  it("passes the album title as the ride label", async () => {
    mockGetRecordingAlbumTracks.mockResolvedValue({
      tracks: ALBUM_TRACKS,
      rgTitle: "Some Album",
    });

    renderRow();

    fireEvent.click(screen.getByTitle("Play full album from track 1"));

    await waitFor(() => {
      expect(mockStartReplay).toHaveBeenCalledTimes(1);
    });

    const [, label] = mockStartReplay.mock.calls[0] as Parameters<typeof mockStartReplay>;
    expect(label).toBe("Some Album");
  });
});

describe("Door 2 — empty tracklist does NOT call ride.startReplay", () => {
  it("does not call ride.startReplay when getRecordingAlbumTracks returns an empty tracks array", async () => {
    mockGetRecordingAlbumTracks.mockResolvedValue({
      tracks: [],
      rgTitle: "Empty Album",
    });

    renderRow();

    fireEvent.click(screen.getByTitle("Play full album from track 1"));

    // Wait for the handleAlbum call to complete — the mock will have been called
    // at least twice (once from the pre-fetch useEffect, once from the button click).
    await waitFor(() => {
      expect(mockGetRecordingAlbumTracks).toHaveBeenCalledTimes(2);
    });

    expect(mockStartReplay).not.toHaveBeenCalled();
  });
});
