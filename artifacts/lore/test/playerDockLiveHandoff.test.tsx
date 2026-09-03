// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";
import type { Station } from "@workspace/api-client-react";
import type { WpOnAirItem } from "../src/webplayer/hooks";
import { useLiveHandoff } from "../src/player/useLiveHandoff";

const mocks = vi.hoisted(() => ({
  useWpOnAir: vi.fn(),
  landOnStation: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetStationNowPlaying: vi.fn(() => ({ data: undefined, isLoading: true })),
  getGetStationNowPlayingQueryKey: vi.fn((slug: string) => [
    "station-now-playing",
    slug,
  ]),
}));

vi.mock("../src/webplayer/hooks", () => ({
  useWpOnAir: mocks.useWpOnAir,
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: vi.fn(() => ({
    radio: {
      station: null,
      status: "idle",
      volume: 1,
      error: null,
      casting: "off",
      castFallbackReason: null,
      castPaused: false,
      castRetry: vi.fn(),
      retry: vi.fn(),
      toggle: vi.fn(),
      stop: vi.fn(),
      setVolume: vi.fn(),
    },
    ride: { active: false },
    spotify: { notice: null, clearNotice: vi.fn() },
    scan: {
      active: false,
      current: null,
      dir: 1,
      toggle: vi.fn(),
      toggleDir: vi.fn(),
    },
  })),
}));

vi.mock("../src/hooks/useStationFastLane", () => ({
  useStationFastLane: vi.fn(() => ({
    landOnStation: mocks.landOnStation,
    confirmation: null,
  })),
}));

import { PlayerDock } from "../src/components/PlayerDock";

function station(slug: string): Station {
  return {
    id: slug.length,
    slug,
    name: slug.toUpperCase(),
    streamUrl: `https://example.com/${slug}.mp3`,
    streamFormat: "mp3",
    mode: "live",
    attribution: false,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    stationCategories: ["campus"],
  } as Station;
}

function onAirItem(slug: string, title = "Track"): WpOnAirItem {
  return {
    station: station(slug),
    show: null,
    now: {
      mbid: `recording-${slug}`,
      title,
      artist: "Artist",
      artworkUrl: null,
      playedAt: "2026-09-03T12:00:00.000Z",
      freshness: "fresh",
      resolved: true,
    },
    earlier: [],
    matchCount: 1,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { hook, searchHook } = memoryLocation({
    path: "/",
    searchPath: "",
    static: true,
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        {children}
      </Router>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlayerDock live suggestions", () => {
  it.each([
    ["absent", { data: undefined }],
    ["loading", { data: undefined, isLoading: true }],
    ["failed", { data: undefined, isError: true, error: new Error("offline") }],
    ["empty", { data: { items: [], authenticated: false } }],
  ])("converges when the on-air request is %s", (_state, queryResult) => {
    mocks.useWpOnAir.mockReturnValue(queryResult);

    const view = render(<PlayerDock />, { wrapper });

    expect(view.container.textContent).toBe("");
    expect(mocks.useWpOnAir).toHaveBeenCalledTimes(1);
  });

  it("keeps equivalent rankings stable and updates meaningful candidate changes", () => {
    const onSwitch = vi.fn();
    const initialItems = [onAirItem("alpha"), onAirItem("beta")];
    const { result, rerender } = renderHook(
      ({ items }) => useLiveHandoff(null, items, onSwitch),
      { initialProps: { items: initialItems } },
    );
    const initialCandidates = result.current.candidates;

    rerender({
      items: initialItems.map((item) => ({
        ...item,
        station: { ...item.station },
        now: { ...item.now },
        earlier: [...item.earlier],
      })),
    });
    expect(result.current.candidates).toBe(initialCandidates);

    rerender({
      items: [onAirItem("alpha", "Corrected title"), onAirItem("beta")],
    });
    expect(result.current.candidates.map((candidate) => candidate.station.slug))
      .toEqual(["alpha", "beta"]);
    expect(result.current.candidates[0]?.now.title).toBe("Corrected title");
  });
});
