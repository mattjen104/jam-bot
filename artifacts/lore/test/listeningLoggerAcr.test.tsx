// @vitest-environment jsdom
/**
 * Contract tests for the ListeningLogger's automatic ACR fingerprint
 * scheduling — the production `{trigger:"auto"}` caller behind the server's
 * shared trigger policy:
 *
 *  - no metadata at all (no np, no Icecast) → auto request fires after the
 *    45 s initial delay;
 *  - a STALE now-playing observation → auto request fires (metadata exists
 *    but has exceeded its freshness budget);
 *  - an AGING observation → auto request fires (server admits it only for
 *    allowlisted stations; a 409 is swallowed silently);
 *  - a FRESH observation (and a pre-freshness payload without the field)
 *    → no request is ever sent — healthy stations cost nothing;
 *  - the request body carries trigger:"auto".
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const {
  mockUsePlayer,
  mockUseMyPreferences,
  mockUseLatestImportJob,
  mockUseIcecastFallback,
  mockUseSpotifyHistorySync,
  mockUseGetStationNowPlaying,
} = vi.hoisted(() => ({
  mockUsePlayer: vi.fn(),
  mockUseMyPreferences: vi.fn(() => ({ data: { ledgerEnabled: false } })),
  mockUseLatestImportJob: vi.fn(() => ({ data: null })),
  mockUseIcecastFallback: vi.fn(() => null),
  mockUseSpotifyHistorySync: vi.fn(),
  mockUseGetStationNowPlaying: vi.fn(),
}));

vi.mock("../src/lib/local", () => ({
  appendJournal: vi.fn(),
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
    postListen: vi.fn().mockResolvedValue({ id: 1 }),
    patchListen: vi.fn().mockResolvedValue(undefined),
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

const STATION = {
  id: 1,
  slug: "kexp",
  name: "KEXP",
  streamUrl: "https://kexp.org/stream",
  streamFormat: "mp3" as const,
} as const;

function playerValue() {
  return {
    radio: {
      status: "playing" as const,
      station: STATION,
      scanning: false,
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

function nowPlayingWith(freshness?: string) {
  return {
    nowPlaying: {
      recording: null,
      rawTitle: "Some Track",
      rawArtist: "Some Artist",
      playedAt: "2026-08-15T12:00:00Z",
      artworkUrl: null,
      ...(freshness ? { freshness } : {}),
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

async function renderLogger() {
  const { ListeningLogger } = await import("../src/components/ListeningLogger");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ListeningLogger />
    </QueryClientProvider>,
  );
}

/** Advance past the 45s initial ACR delay and flush the resulting mutation. */
async function passInitialDelay() {
  await act(async () => {
    vi.advanceTimersByTime(46_000);
    await Promise.resolve();
  });
}

function fingerprintCalls() {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/fingerprint"),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockUsePlayer.mockImplementation(playerValue);
  mockUseMyPreferences.mockReturnValue({ data: { ledgerEnabled: false } });
  mockUseLatestImportJob.mockReturnValue({ data: null });
  mockUseIcecastFallback.mockReturnValue(null);
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ logged: false, mbid: null }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ListeningLogger — automatic ACR trigger scheduling", () => {
  it("fires trigger:'auto' after the initial delay when no metadata exists at all", async () => {
    mockUseGetStationNowPlaying.mockReturnValue({ data: { nowPlaying: null } });
    await renderLogger();
    expect(fingerprintCalls()).toHaveLength(0); // not before the delay
    await passInitialDelay();
    const calls = fingerprintCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("/api/stations/kexp/fingerprint");
    expect(JSON.parse((calls[0]![1] as RequestInit).body as string)).toEqual({
      trigger: "auto",
    });
  });

  it("fires for a STALE now-playing observation", async () => {
    mockUseGetStationNowPlaying.mockReturnValue({ data: nowPlayingWith("stale") });
    await renderLogger();
    await passInitialDelay();
    expect(fingerprintCalls()).toHaveLength(1);
  });

  it("fires for an AGING observation (allowlist admission is the server's call)", async () => {
    // The server answers 409 for non-allowlisted aging stations — swallowed.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "healthy" }),
    });
    mockUseGetStationNowPlaying.mockReturnValue({ data: nowPlayingWith("aging") });
    await renderLogger();
    await passInitialDelay();
    expect(fingerprintCalls()).toHaveLength(1);
  });

  it("never fires for a FRESH observation", async () => {
    mockUseGetStationNowPlaying.mockReturnValue({ data: nowPlayingWith("fresh") });
    await renderLogger();
    await passInitialDelay();
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000); // linger well past several poll intervals
    });
    expect(fingerprintCalls()).toHaveLength(0);
  });

  it("never fires for a pre-freshness payload (no freshness field)", async () => {
    mockUseGetStationNowPlaying.mockReturnValue({ data: nowPlayingWith() });
    await renderLogger();
    await passInitialDelay();
    expect(fingerprintCalls()).toHaveLength(0);
  });

  it("does not fire when Icecast metadata covers a server-silent station", async () => {
    mockUseGetStationNowPlaying.mockReturnValue({ data: { nowPlaying: null } });
    mockUseIcecastFallback.mockReturnValue({
      rawArtist: "Icecast Artist",
      rawTitle: "Icecast Track",
    });
    await renderLogger();
    await passInitialDelay();
    expect(fingerprintCalls()).toHaveLength(0);
  });
});
