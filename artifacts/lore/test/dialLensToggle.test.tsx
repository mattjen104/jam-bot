// @vitest-environment jsdom
/**
 * Dial lens toggle — Radio | Press swap inside DialView.
 *
 * Covers:
 *   1. Radio is the default: live feed renders, no Press feed.
 *   2. Clicking Press swaps to the Press feed (mention rows render, live
 *      feed rows disappear) and persists to localStorage.
 *   3. Clicking Radio restores the untouched Radio feed.
 *   4. Lens survives a remount (reload behavior via localStorage init).
 *   5. aria-pressed tracks the active lens.
 *   6. Press with hasTaste:false renders the taste nudge, not a blank screen.
 *   7. Press failed state shows the honest error copy, never "no press yet".
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../src/hooks/useDialData", () => ({
  useDialData: vi.fn(),
  readPins: vi.fn(() => new Set<string>()),
  togglePin: vi.fn(),
  normalizeDjName: vi.fn((s: string | null) => s ?? ""),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyOverlapSelectors: vi.fn(() => ({ data: [] })),
    useMyGhostMissed: vi.fn(() => ({ data: [] })),
    useSpotifyLibraryConnected: vi.fn(() => false),
    startSpotifyLibraryConnect: vi.fn(),
    useMyTasteSeeds: vi.fn(() => ({ data: [] })),
    useMyPressInfinite: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    })),
    useSavePressArticleAction: vi.fn(() => ({ mutate: vi.fn() })),
    useUnsavePressArticleAction: vi.fn(() => ({ mutate: vi.fn() })),
  });
});

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      radio: {
        status: "idle",
        station: null,
        scanning: false,
        preview: vi.fn(),
        toggle: vi.fn(),
        stop: vi.fn(),
      },
      ride: { active: false },
      spotify: { connected: false, premium: false },
      scan: { active: false },
    })),
  });
});

vi.mock("../src/components/StationLane", () => ({
  StationLane: () => <div data-testid="station-lane" />,
}));
vi.mock("../src/components/ContextRail", () => ({
  ContextRail: () => <div data-testid="context-rail" />,
}));
vi.mock("../src/components/SearchOverlay", () => ({
  SearchOverlay: () => null,
}));
vi.mock("../src/components/LibraryChip", () => ({
  LibraryChip: () => null,
}));
vi.mock("../src/components/ManualImportModal", () => ({
  ManualImportModal: () => null,
}));
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
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { useDialData } from "../src/hooks/useDialData";
import { useMyPressInfinite } from "../src/lib/meHooks";
import type { PressArticle } from "@workspace/api-client-react";
import { DialView } from "../src/components/DialView";
import type { DialStation, DialShow } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Test Show",
    djName: null,
    startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    state: "live",
    spins: [],
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack: null,
    isPickerShow: false,
    pickerId: null,
    ...overrides,
  };
}

function makeLiveStation(slug: string): DialStation {
  return {
    station: {
      slug,
      name: `Station ${slug}`,
      automationClass: null,
      streamUrl: null,
      websiteUrl: null,
      hidden: false,
      favorite: false,
    } as DialStation["station"],
    isLive: true,
    // One set-level crossing so the row survives the crossing-positive filter
    // (crossings on by default) — these tests exercise the lens toggle.
    shows: [makeShow({ crossings: 1, topArtists: ["Fleetwood Mac"] })],
    crossings: 1,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
  };
}

const MENTION: PressArticle = {
  id: 1,
  title: "A great review",
  url: "https://pitchfork.example/1977",
  guid: "test-guid",
  publishedAt: "2023-01-01T00:00:00.000Z",
  tags: ["Review"],
  matchedArtist: "Fleetwood Mac",
  matchedWork: "Rumours",
  pickerId: 10,
  publication: "Pitchfork",
  handle: "pitchfork",
  overlap: true,
  saved: false,
  savedAt: null,
};

function mockPress(page: {
  items?: PressArticle[];
  hasTaste?: boolean;
  computing?: boolean;
  failed?: boolean;
} | null) {
  (useMyPressInfinite as ReturnType<typeof vi.fn>).mockReturnValue({
    data: page
      ? {
          pages: [{
            items: page.items ?? [],
            nextOffset: null,
          }],
        }
      : undefined,
    isLoading: page?.computing ?? false,
    isError: page?.failed ?? false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
}

function baseDialData(overrides: Record<string, unknown> = {}) {
  return {
    stations: [makeLiveStation("kexp")],
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: true,
    hasSeeds: false,
    liveArtistSuggestions: [],
    onboardingArtists: [],
    onboardingArtistsLoading: false,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
    crossingSourceMode: "personal",
    crossingError: null,
    crossingsPhase: "settled",
    ...overrides,
  };
}

function mockDialData(overrides: Record<string, unknown> = {}) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(baseDialData(overrides));
}

function renderDial() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DialView /></QueryClientProvider>);
}

const lensBtn = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  localStorage.clear();
  mockPress({ items: [MENTION] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dial lens toggle", () => {
  it("defaults to Radio: live feed renders, Press feed absent", () => {
    mockDialData();
    renderDial();
    expect(lensBtn("Radio").getAttribute("aria-pressed")).toBe("true");
    expect(lensBtn("Press").getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("#dial-feed-rows")).toBeTruthy();
    expect(document.querySelector("#press-feed-rows")).toBeNull();
  });

  it("clicking Press swaps feeds and persists the lens", () => {
    mockDialData();
    renderDial();
    fireEvent.click(lensBtn("Press"));

    expect(lensBtn("Press").getAttribute("aria-pressed")).toBe("true");
    expect(lensBtn("Radio").getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("#press-feed-rows")).toBeTruthy();
    expect(document.querySelector("#dial-feed-rows")).toBeNull();
    expect(document.querySelector("#press-feed-rows")?.textContent).toContain(
      "A great review",
    );
    expect(localStorage.getItem("lore:dialLens")).toBe("press");
  });

  it("clicking Radio restores the live feed", () => {
    mockDialData();
    renderDial();
    fireEvent.click(lensBtn("Press"));
    fireEvent.click(lensBtn("Radio"));
    expect(document.querySelector("#dial-feed-rows")).toBeTruthy();
    expect(document.querySelector("#press-feed-rows")).toBeNull();
    expect(localStorage.getItem("lore:dialLens")).toBe("radio");
  });

  it("the lens survives a remount (reload persistence)", () => {
    mockDialData();
    const first = renderDial();
    fireEvent.click(lensBtn("Press"));
    first.unmount();

    mockDialData();
    renderDial();
    expect(lensBtn("Press").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#press-feed-rows")).toBeTruthy();
  });

  it("Press with no taste still shows retained publisher articles", () => {
    mockDialData({ hasLibrary: false, hasSeeds: false });
    mockPress({ items: [MENTION], hasTaste: false });
    renderDial();
    fireEvent.click(lensBtn("Press"));

    expect(document.querySelector("#press-feed-rows")).toBeTruthy();
    expect(screen.getByText("A great review")).toBeTruthy();
  });

  it("Press failed state shows the error copy, never the empty state", () => {
    mockDialData();
    mockPress({ items: [], failed: true });
    renderDial();
    fireEvent.click(lensBtn("Press"));

    expect(screen.getByText(/couldn't check the press/i)).toBeTruthy();
    expect(screen.queryByText(/No press articles have arrived yet/i)).toBeNull();
  });

  it("Press settled-empty state shows 'no press yet'", () => {
    mockDialData();
    mockPress({ items: [] });
    renderDial();
    fireEvent.click(lensBtn("Press"));

    expect(screen.getByText(/No press articles have arrived yet/i)).toBeTruthy();
  });
});
