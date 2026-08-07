// @vitest-environment jsdom
/**
 * Regression guard for the Dial seed-input type-to-add flow.
 *
 * Exercises the full cycle in the Dial's original context — the exact page
 * where SeedInput and SeedBar lived before Task #1189 extracted them into a
 * shared component:
 *
 *   type artist name → submit → chip appears → remove chip → chip disappears
 *
 * Any missed context dependency (hook wiring, provider, prop threading) would
 * break one of these steps and surface here before reaching production.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
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

const { tasteSeeds, mutateAsync, mattStarter, startMattLibrary } = vi.hoisted(() => ({
  tasteSeeds: vi.fn(() => ({ data: [] as string[] })),
  mutateAsync: vi.fn(async (artists: string[]) => ({ artists })),
  mattStarter: vi.fn(() => ({ data: { available: false, addedCount: 0, totalCount: 0 } })),
  startMattLibrary: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
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
        toggle: vi.fn(),
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

// A live station with an artist crossing so Zone 1 has content. The inline
// SeedBar (which hosts SeedInput + the seed chips) only renders alongside a
// Zone 1 crossing row, so the seed-input flow needs at least one live station.
function makeZone1Station(): DialStation {
  return {
    station: {
      slug: "seed-station",
      name: "Seed Radio",
      automationClass: null,
      streamUrl: null,
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

describe("Dial SeedInput — type-to-add full cycle", () => {
  it("adds a typed artist name as a chip and removes it on the × button", async () => {
    mockDial();
    render(<DialView />);

    // The seed input renders in the onboarding section (no library, no seeds).
    const input = screen.getByRole("textbox", { name: "Artist name" });
    fireEvent.change(input, { target: { value: "Radiohead" } });

    // Click Add — triggers optimistic update synchronously.
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // The mutation is called with the new seed list.
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(["Radiohead"]);
    });

    // The chip appears inside SeedBar once visibleSeeds.length > 0.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove Radiohead" })).toBeTruthy();
    });

    // Click the × remove button on the chip.
    fireEvent.click(screen.getByRole("button", { name: "Remove Radiohead" }));

    // The mutation is called with the empty list.
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith([]);
    });

    // The chip is gone.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove Radiohead" })).toBeNull();
    });
  });

  it("submits via Enter keypress as well as the Add button", async () => {
    mockDial();
    render(<DialView />);

    const input = screen.getByRole("textbox", { name: "Artist name" });
    fireEvent.change(input, { target: { value: "Arcade Fire" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(["Arcade Fire"]);
    });

    // Chip appears after Enter submission.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove Arcade Fire" })).toBeTruthy();
    });
  });

  it("clears the text field immediately after submission so the next artist can be typed", async () => {
    mockDial();
    render(<DialView />);

    const input = screen.getByRole("textbox", { name: "Artist name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "LCD Soundsystem" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // SeedInput calls setValue("") synchronously on submit.
    expect(input.value).toBe("");
  });

  it("rolls back the optimistic chip when the mutation fails", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("network error"));
    mockDial();
    render(<DialView />);

    const input = screen.getByRole("textbox", { name: "Artist name" });
    fireEvent.change(input, { target: { value: "Portishead" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // After the rejection, optimisticSeeds resets to null → falls back to
    // seedArtists (empty []) → the chip must disappear.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove Portishead" })).toBeNull();
    });
  });

  it("accumulates multiple seeds when added one after another", async () => {
    mockDial();
    render(<DialView />);

    const input = screen.getByRole("textbox", { name: "Artist name" });

    fireEvent.change(input, { target: { value: "Radiohead" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove Radiohead" })).toBeTruthy();
    });

    // After the first seed appears, the SeedBar renders an inline "+ artist" input.
    // That input also has aria-label "Artist name".
    const inputs = screen.getAllByRole("textbox", { name: "Artist name" });
    const activeInput = inputs[inputs.length - 1];
    fireEvent.change(activeInput, { target: { value: "Portishead" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(["Radiohead", "Portishead"]);
    });
  });
});



