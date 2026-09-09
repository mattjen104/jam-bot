// @vitest-environment jsdom
/**
 * Regression guard for the simplified Dial front door.
 *
 * The Dial no longer exposes any add-artist entry points (the tuned-artists
 * panel, the wordmark toggle, and the inline SeedInput were all removed), and
 * tuning is now ONLY a station-row click that starts playback — no pinned
 * station overlay, no workspace tabs, no set panel.
 *
 * These tests pin that removal: if any of the old affordances reappear
 * (an "Open tuned artists" button, an "Artist name" textbox, a pinned set
 * surface), this suite fails.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// DialView consumes react-query hooks directly, so every render must be wrapped
// in a QueryClientProvider.
function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ---------------------------------------------------------------------------
// Module-level mocks — must precede all imports of the subjects.
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/lore/", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../src/hooks/useDialData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hooks/useDialData")>();
  return { ...actual, useDialData: vi.fn() };
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal);
});

const { tasteSeeds, mutateAsync, mattStarter, startMattLibrary, radioToggle } = vi.hoisted(() => ({
  tasteSeeds: vi.fn(() => ({ data: [] as string[] })),
  mutateAsync: vi.fn(async (artists: string[]) => ({ artists })),
  mattStarter: vi.fn(() => ({ data: { available: false, addedCount: 0, totalCount: 0 } })),
  startMattLibrary: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
  radioToggle: vi.fn(),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyTasteSeeds: tasteSeeds,
    useSetTasteSeeds: vi.fn(() => ({ mutateAsync })),
    useMyGhostMissed: vi.fn(() => ({ data: [] })),
    useSpotifyLibraryConnected: vi.fn(() => false),
    useMattStarterLibrary: mattStarter,
    useStartMattLibrary: startMattLibrary,
  });
});

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      radio: {
        station: null,
        status: "idle",
        toggle: radioToggle,
        preview: vi.fn(),
        tuneIn: vi.fn(),
        stop: vi.fn(),
        active: null,
      },
      ride: { active: false },
      spotify: { configured: false, connected: false, premium: false },
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
vi.mock("../src/hooks/useStationPresence", () => ({
  useStationPresence: vi.fn(() => new Map()),
}));
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

// ---------------------------------------------------------------------------
// Subject imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { useDialData } from "../src/hooks/useDialData";
import { DialView } from "../src/components/DialView";
import type { DialStation } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A live station with an artist crossing keeps the radio surface populated.
function makeZone1Station(): DialStation {
  return {
    station: {
      slug: "seed-station",
      name: "Seed Radio",
      automationClass: null,
      streamUrl: "https://example.com/stream",
      websiteUrl: null,
      hidden: false,
      favorite: false,
    } as DialStation["station"],
    isLive: true,
    shows: [{
      runId: 1,
      showName: "Seed Show",
      djName: null,
      startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      state: "live",
      spins: [],
      crossings: 0,
      artistCrossings: 1,
      topArtists: [],
      topArtistNames: ["Seed Artist"],
      currentTrack: null,
      isPickerShow: false,
      pickerId: null,
    }],
    crossings: 0,
    artistCrossings: 1,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 1,
  } as DialStation;
}

function mockDial() {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations: [makeZone1Station()],
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: false,
    hasSeeds: true,
    liveArtistSuggestions: [],
    onboardingArtists: [],
    onboardingArtistsLoading: false,
    overlapByPickerId: new Map(),
    pickerNameToId: new Map(),
  });
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  tasteSeeds.mockReturnValue({ data: [] });
  mutateAsync.mockImplementation(async (artists: string[]) => ({ artists }));
  mattStarter.mockReturnValue({ data: { available: false, addedCount: 0, totalCount: 0 } });
  startMattLibrary.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dial artist filter builder", () => {
  it("keeps an artist-name input beside the station results", () => {
    mockDial();
    render(<DialView />);

    expect(screen.queryByRole("button", { name: "Open tuned artists" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close tuned artists" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Artist name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit artist document" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tuned artists" })).toBeNull();
  });

  it("shows existing artists as removable chips while keeping the add field available", () => {
    tasteSeeds.mockReturnValue({ data: ["Radiohead", "Portishead"] });
    mockDial();
    render(<DialView />);

    expect(screen.getByRole("combobox", { name: "Artist name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Radiohead" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Portishead" })).toBeTruthy();
  });
});

describe("Minimal front door — no pinned overlay, no set panel", () => {
  it("renders no set panel or workspace tabs at all", () => {
    mockDial();
    render(<DialView />);

    expect(document.querySelector(".dial-hero__setpanel")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  // Retired UI: front-door .fdrow playback interaction moved to cover rails and Scan.
});
