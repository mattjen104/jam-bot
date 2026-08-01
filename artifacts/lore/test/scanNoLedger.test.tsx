// @vitest-environment jsdom
/**
 * Contract tests: the listen ledger must stay silent while radio.scanning===true.
 *
 * Task #666 added radio.preview() / radio.scanning to let scan hops play
 * without being recorded. ListeningLogger guards every write on
 *   const listening = radio.status === "playing" && !!station && !radio.scanning;
 *
 * These tests pin that contract so a future refactor can't silently
 * re-introduce ledger writes during a scan.
 *
 * Covers:
 *  - appendJournal is never called while radio.scanning === true, even when
 *    now-playing data is available and the user lingers longer than usual.
 *  - postListen is never called while radio.scanning === true.
 *  - Calling radio.toggle() (landing) clears scanning and allows
 *    appendJournal + postListen to resume on the very next render.
 */

import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Hoisted mock factories — must exist before vi.mock() factory functions run.
// ---------------------------------------------------------------------------
const {
  mockAppendJournal,
  mockPostListen,
  mockPatchListen,
  mockUsePlayer,
  mockUseMyPreferences,
  mockUseLatestImportJob,
  mockUseIcecastFallback,
  mockUseSpotifyHistorySync,
  mockUseGetStationNowPlaying,
} = vi.hoisted(() => ({
  mockAppendJournal: vi.fn(),
  mockPostListen: vi.fn().mockResolvedValue({ id: 99 }),
  mockPatchListen: vi.fn().mockResolvedValue(undefined),
  mockUsePlayer: vi.fn(),
  mockUseMyPreferences: vi.fn(() => ({ data: { ledgerEnabled: true } })),
  mockUseLatestImportJob: vi.fn(() => ({ data: null })),
  mockUseIcecastFallback: vi.fn(() => null),
  mockUseSpotifyHistorySync: vi.fn(),
  mockUseGetStationNowPlaying: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../src/lib/local", () => ({
  appendJournal: mockAppendJournal,
  // Other exports used elsewhere — not exercised here.
  appendFollow: vi.fn(),
  removeFollow: vi.fn(),
  getJournal: vi.fn(() => []),
  getFollows: vi.fn(() => []),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useLatestImportJob: mockUseLatestImportJob,
    useMyPreferences: mockUseMyPreferences,
    postListen: mockPostListen,
    patchListen: mockPatchListen,
    useMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
    useMyLibraryInfinite: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
    })),
    useLatestSyncJob: vi.fn(() => ({ data: null })),
    useMyAlbumsCompleted: vi.fn(() => ({ data: undefined })),
  });
});

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: mockUsePlayer,
  });
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useGetStationNowPlaying: mockUseGetStationNowPlaying,
    getGetStationNowPlayingQueryKey: vi.fn((slug: string) => [
      "station-now-playing",
      slug,
    ]),
  });
});

vi.mock("../src/hooks/useIcecastFallback", () => ({
  useIcecastFallback: mockUseIcecastFallback,
}));

vi.mock("../src/hooks/useSpotifyHistorySync", () => ({
  useSpotifyHistorySync: mockUseSpotifyHistorySync,
}));

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const STATION = {
  id: 1,
  slug: "kexp",
  name: "KEXP",
  streamUrl: "https://kexp.org/stream",
  streamFormat: "mp3" as const,
} as const;

/** A fully-resolved now-playing response — the richest possible signal. */
const NOW_PLAYING_DATA = {
  nowPlaying: {
    recording: {
      mbid: "mbid-abc123",
      title: "Gold Dust Woman",
      artist: "Fleetwood Mac",
      artworkUrl: "https://example.com/art.jpg",
      artistMbid: "artist-mbid-fm",
    },
    rawTitle: "Gold Dust Woman",
    rawArtist: "Fleetwood Mac",
    playedAt: "2024-06-02T14:30:00Z",
    spinId: 777,
    artworkUrl: null,
  },
};

function makePlayerValue(scanning: boolean) {
  return {
    radio: {
      status: "playing" as const,
      station: STATION,
      scanning,
      casting: "off" as const,
      castFallbackReason: null,
      castPaused: false,
      volume: 0.85,
      error: null,
      toggle: vi.fn(),
      preview: vi.fn(),
      stop: vi.fn(),
      setVolume: vi.fn(),
      castRetry: vi.fn(),
    },
    ride: {
      active: false,
      status: "idle" as const,
      current: null,
      progressMs: null,
      mode: "trail" as const,
      source: null,
      replayLabel: null,
      listenContext: null,
      queue: [],
      index: 0,
      seeking: false,
      atTrailEnd: false,
      fallbackUsed: false,
      deviceLost: false,
      timeOrientation: "curated" as const,
      playbackMode: "passthrough" as const,
      start: vi.fn(),
      startReplay: vi.fn(),
      stop: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      togglePause: vi.fn(),
      setPlaybackMode: vi.fn(),
      retrySpotify: vi.fn(),
    },
    spotify: {
      connected: false,
      premium: false,
      pinnedDevice: null,
      devices: [],
      notice: null,
      pinDevice: vi.fn(),
      unpinDevice: vi.fn(),
      fetchDevices: vi.fn(),
      showNotice: vi.fn(),
      dismissNotice: vi.fn(),
      logout: vi.fn(),
    },
    scan: {
      active: false,
      current: null,
      dir: 1 as const,
      toggle: vi.fn(),
      toggleDir: vi.fn(),
    },
  };
}

/** Renders ListeningLogger with a controllable `scanning` value.
 *  Returns `setScanning` so tests can toggle the flag mid-test. */
async function renderLogger() {
  // Dynamic import ensures all vi.mock() factories are fully applied first.
  const { ListeningLogger } = await import(
    "../src/components/ListeningLogger"
  );

  let setScanning!: (v: boolean) => void;

  function Wrapper() {
    const [scanning, setScanningState] = useState(true);
    setScanning = setScanningState;
    mockUsePlayer.mockReturnValue(makePlayerValue(scanning));
    // Re-invoke mock with the current scanning value on every render.
    mockUsePlayer.mockImplementation(() => makePlayerValue(scanning));
    return <ListeningLogger />;
  }

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Wrapper />
    </QueryClientProvider>,
  );

  return { setScanning };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();

  // Default: ledger on, no import job, now-playing data available.
  mockUseMyPreferences.mockReturnValue({ data: { ledgerEnabled: true } });
  mockUseLatestImportJob.mockReturnValue({ data: null });
  mockUseIcecastFallback.mockReturnValue(null);
  mockUseSpotifyHistorySync.mockReturnValue(undefined);
  mockUseGetStationNowPlaying.mockReturnValue({ data: NOW_PLAYING_DATA });
  mockPostListen.mockResolvedValue({ id: 99 });
  mockPatchListen.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scan preview — ledger suppression", () => {
  it("does not call appendJournal while radio.scanning === true, even with now-playing data", async () => {
    // Arrange: render with scanning=true and rich now-playing data available.
    mockUsePlayer.mockReturnValue(makePlayerValue(true));
    const { ListeningLogger } = await import(
      "../src/components/ListeningLogger"
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <ListeningLogger />
      </QueryClientProvider>,
    );

    // Flush pending microtasks and advance timers to simulate a prolonged dwell.
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(30_000); // linger 30 s — more than a typical scan hop
      await Promise.resolve();
    });

    // Assert: no journal write, even after lingering.
    expect(mockAppendJournal).not.toHaveBeenCalled();
  });

  it("does not call postListen while radio.scanning === true, even with ledgerEnabled=true", async () => {
    mockUsePlayer.mockReturnValue(makePlayerValue(true));
    const { ListeningLogger } = await import(
      "../src/components/ListeningLogger"
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <ListeningLogger />
      </QueryClientProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      // Advance past the 10 s ledger-patch interval to ensure no delayed writes.
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(mockPostListen).not.toHaveBeenCalled();
  });

  it("suppresses all writes even when the listener lingers multiple scan-dwell periods", async () => {
    mockUsePlayer.mockReturnValue(makePlayerValue(true));
    const { ListeningLogger } = await import(
      "../src/components/ListeningLogger"
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <ListeningLogger />
      </QueryClientProvider>,
    );

    // Simulate lingering across several potential scan-hop intervals.
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(12_000);
        await Promise.resolve();
      }
    });

    expect(mockAppendJournal).not.toHaveBeenCalled();
    expect(mockPostListen).not.toHaveBeenCalled();
  });
});

describe("landing after scan — ledger resumes", () => {
  it("calls appendJournal after scanning clears (radio.toggle lands the station)", async () => {
    // Start scanning, then flip to scanning=false to simulate radio.toggle().
    let currentScanning = true;
    mockUsePlayer.mockImplementation(() => makePlayerValue(currentScanning));

    const { ListeningLogger } = await import(
      "../src/components/ListeningLogger"
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ListeningLogger />
      </QueryClientProvider>,
    );

    // Confirm nothing written while scanning.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAppendJournal).not.toHaveBeenCalled();

    // Land: toggle clears scanning.
    currentScanning = false;
    act(() => {
      rerender(
        <QueryClientProvider client={qc}>
          <ListeningLogger />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Now the journal should have recorded the landed track.
    expect(mockAppendJournal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "radio",
        title: "Gold Dust Woman",
        artist: "Fleetwood Mac",
        mbid: "mbid-abc123",
        stationSlug: "kexp",
        stationName: "KEXP",
      }),
    );
  });

  it("calls postListen after scanning clears when ledgerEnabled=true", async () => {
    let currentScanning = true;
    mockUsePlayer.mockImplementation(() => makePlayerValue(currentScanning));

    const { ListeningLogger } = await import(
      "../src/components/ListeningLogger"
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ListeningLogger />
      </QueryClientProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockPostListen).not.toHaveBeenCalled();

    // Land.
    currentScanning = false;
    act(() => {
      rerender(
        <QueryClientProvider client={qc}>
          <ListeningLogger />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPostListen).toHaveBeenCalledWith(
      expect.objectContaining({
        mbid: "mbid-abc123",
        context: "broadcast",
        spinId: 777,
      }),
    );
  });
});
