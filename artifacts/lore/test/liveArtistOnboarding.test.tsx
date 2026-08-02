// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("wouter", () => ({
  useLocation: () => ["/lore/", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("../src/hooks/useDialData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hooks/useDialData")>();
  return { ...actual, useDialData: vi.fn() };
});

const { tasteSeeds, mutateAsync } = vi.hoisted(() => ({
  tasteSeeds: vi.fn(() => ({ data: [] as string[] })),
  mutateAsync: vi.fn(async (artists: string[]) => ({ artists })),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyTasteSeeds: tasteSeeds,
    useSetTasteSeeds: vi.fn(() => ({ mutateAsync })),
    useMyGhostMissed: vi.fn(() => ({ data: [] })),
    useSpotifyLibraryConnected: vi.fn(() => false),
  });
});

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      radio: { station: null, status: "idle", toggle: vi.fn(), preview: vi.fn(), stop: vi.fn() },
      ride: { active: false },
      spotify: { connected: false, premium: false },
      scan: {
        active: false,
        samplingIdx: null,
        scanning: false,
        toggle: vi.fn(),
        back: vi.fn(),
        next: vi.fn(),
        land: vi.fn(),
        adjustDwell: vi.fn(),
        stop: vi.fn(),
      },
    })),
  });
});

vi.mock("../src/components/StationLane", () => ({ StationLane: () => null }));
vi.mock("../src/components/ContextRail", () => ({ ContextRail: () => null }));
vi.mock("../src/components/SearchOverlay", () => ({ SearchOverlay: () => null }));
vi.mock("../src/hooks/useFrontDoorScan", () => ({
  useFrontDoorScan: vi.fn(() => ({
    scanning: false,
    samplingIdx: null,
    dwellMs: 7000,
    progress: 0,
    toggle: vi.fn(),
    back: vi.fn(),
    next: vi.fn(),
    land: vi.fn(),
    adjustDwell: vi.fn(),
    stop: vi.fn(),
  })),
}));

import { useDialData, extractLiveArtistSuggestions, type DialStation } from "../src/hooks/useDialData";
import { DialView } from "../src/components/DialView";
import { ME_DIAL_CROSSINGS_KEY, ME_PICKER_NAMES_KEY } from "../src/lib/meHooks";

function makeStation(overrides: Partial<DialStation> = {}): DialStation {
  return {
    station: {
      slug: "wfmu",
      name: "WFMU",
      automationClass: null,
      streamUrl: null,
      websiteUrl: null,
      hidden: false,
      favorite: false,
    } as DialStation["station"],
    isLive: true,
    shows: [],
    liveTrack: {
      mbid: null,
      artistMbid: null,
      title: "A Current Song",
      artist: "Current Artist",
      playedAt: new Date().toISOString(),
      isLibraryHit: false,
      isArtistHit: false,
      isFirstSpin: false,
    },
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    ...overrides,
  };
}

function mockDial(stations: DialStation[] = [], suggestions = []) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations,
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: false,
    hasSeeds: false,
    liveArtistSuggestions: suggestions,
    overlapByPickerId: new Map(),
    pickerNameToId: new Map(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  tasteSeeds.mockReturnValue({ data: [] });
  mutateAsync.mockImplementation(async (artists: string[]) => ({ artists }));
});

describe("extractLiveArtistSuggestions", () => {
  it("uses live now-playing tracks even when schedule data is unavailable", () => {
    const suggestions = extractLiveArtistSuggestions([
      makeStation({ liveTrack: { ...makeStation().liveTrack!, artist: "  Current   Artist " } }),
    ]);
    expect(suggestions).toEqual([
      expect.objectContaining({ artist: "Current Artist", stationName: "WFMU" }),
    ]);
  });

  it("deduplicates artists case-insensitively, filters placeholders, and keeps context", () => {
    const first = makeStation({
      liveTrack: { ...makeStation().liveTrack!, artist: "The Artist", title: "First Track" },
      shows: [{
        runId: 1, showName: "Morning Show", djName: null,
        startedAt: "", endedAt: "", state: "live", spins: [], crossings: 0,
        artistCrossings: 0, topArtists: [], topArtistNames: [], currentTrack: null,
        isPickerShow: false, pickerId: null,
      }],
    });
    const duplicate = makeStation({
      station: { ...first.station, slug: "kcrw", name: "KCRW" },
      liveTrack: { ...makeStation().liveTrack!, artist: "the artist" },
    });
    const placeholder = makeStation({
      station: { ...first.station, slug: "bad", name: "Bad Radio" },
      liveTrack: { ...makeStation().liveTrack!, artist: "Unknown Artist" },
    });

    expect(extractLiveArtistSuggestions([first, duplicate, placeholder])).toEqual([
      expect.objectContaining({
        artist: "The Artist",
        stationName: "WFMU",
        trackTitle: "First Track",
        showName: "Morning Show",
      }),
    ]);
  });
});

describe("no-library onboarding live picker", () => {
  it("renders live choices with a normal manual/import fallback", () => {
    mockDial([], [{
      artist: "Live Artist",
      stationSlug: "wfmu",
      stationName: "WFMU",
      trackTitle: "Live Track",
      showName: "Morning Show",
    }]);

    render(<DialView />);

    expect(screen.getByRole("heading", { name: "Artists playing live now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose Live Artist" })).toBeTruthy();
    expect(screen.getByText("Live Track · Morning Show · WFMU")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. Radiohead")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Spotify library" })).toBeTruthy();
  });

  it("persists a selected live artist through the taste-seed mutation", async () => {
    mockDial([], [{
      artist: "Selected Artist",
      stationSlug: "wfmu",
      stationName: "WFMU",
      trackTitle: null,
      showName: null,
    }]);

    render(<DialView />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Selected Artist" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(["Selected Artist"]);
    });
  });

  it("keeps multiple quick live choices when each write resolves in order", async () => {
    mockDial([], [
      { artist: "First Artist", stationSlug: "one", stationName: "One FM", trackTitle: null, showName: null },
      { artist: "Second Artist", stationSlug: "two", stationName: "Two FM", trackTitle: null, showName: null },
    ]);
    mutateAsync
      .mockImplementationOnce(async (artists: string[]) => ({ artists }))
      .mockImplementationOnce(async (artists: string[]) => ({ artists }));

    render(<DialView />);
    fireEvent.click(screen.getByRole("button", { name: "Choose First Artist" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose Second Artist" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenNthCalledWith(1, ["First Artist"]);
      expect(mutateAsync).toHaveBeenNthCalledWith(2, ["First Artist", "Second Artist"]);
    });
  });

  it("preserves loaded seeds when adding an artist from the live picker", async () => {
    mockDial([], [{
      artist: "New Artist",
      stationSlug: "wfmu",
      stationName: "WFMU",
      trackTitle: null,
      showName: null,
    }]);
    tasteSeeds.mockReturnValue({ data: ["Existing Artist"] });
    render(<DialView />);

    fireEvent.change(screen.getByRole("textbox", { name: "Artist name" }), {
      target: { value: "New Artist" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(["Existing Artist", "New Artist"]);
    });
  });

  it("shows the fallback state when live data has no usable artist", () => {
    mockDial([], []);
    render(<DialView />);

    expect(screen.getByText("No artist names are available right now. You can add one below.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Choose/ })).toBeNull();
  });
});
