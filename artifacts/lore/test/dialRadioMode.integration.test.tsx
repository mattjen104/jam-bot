// @vitest-environment jsdom
/**
 * Radio mode (/radio ↔ /crossings CLI commands) inside DialView.
 *
 * Covers:
 *   1. Default (crossings on): a crossing station leads with the crossing
 *      sentence (", this set" compact lead).
 *   2. /radio switches to the blank radio view: the crossing lead disappears,
 *      the same station row now leads with the live now-playing sentence
 *      (current artist · station), the mode persists to localStorage, and the
 *      DialLensBar marks the Radio lens with the "· pure" indicator.
 *   3. /crossings restores the crossing-ranked view.
 *   4. /radio forces the lens back to Radio from another lens.
 *   5. The mode survives a remount (reload behavior via localStorage init).
 *   6. In radio mode the reason rows are never withheld while crossing scores
 *      load (no skeleton placeholder) — pure station discovery.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    useMyPressCrossings: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    })),
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
import { DialView } from "../src/components/DialView";
import type { DialStation, DialShow, DialSpin } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    title: "A Track",
    artist: "Some Other",
    playedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    releaseYear: null,
    ageTier: null,
    ...overrides,
  };
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Test Show",
    djName: "DJ Test",
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

/** A live station with a SET-level crossing (rung 3): Portishead crossed
 *  earlier this set; the current track is a non-crossing artist. */
function makeCrossingStation(slug: string): DialStation {
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
    shows: [makeShow({
      crossings: 1,
      topArtists: ["Portishead"],
      currentTrack: makeSpin({ artist: "Some Other", title: "Not Yours" }),
    })],
    crossings: 0,
    artistCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
  };
}

function baseDialData(overrides: Record<string, unknown> = {}) {
  return {
    stations: [makeCrossingStation("kexp")],
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

function cliInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Dial command" }) as HTMLInputElement;
}

function runCommand(command: string) {
  const input = cliInput();
  fireEvent.change(input, { target: { value: command } });
  fireEvent.keyDown(input, { key: "Enter" });
}

const feedText = () => document.querySelector("#dial-feed-rows")?.textContent ?? "";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dial radio mode (/radio ↔ /crossings)", () => {
  it("defaults to crossings on: the crossing station shows the ⬤ dot, never a crossing sentence", () => {
    mockDialData();
    renderDial();
    // The row identity is always the now-playing artist · station — crossing
    // artist names never lead the sentence; the ⬤ dot carries the meaning.
    expect(feedText()).not.toContain("Portishead");
    expect(feedText()).not.toContain("this set");
    expect(feedText()).toContain("Some Other");
    expect(feedText()).toContain("Station kexp");
    expect(document.querySelector("#dial-feed-rows .fdrow__crossing-dot")).not.toBeNull();
    expect(localStorage.getItem("lore:radioMode")).toBeNull();
  });

  it("/radio suppresses crossing evidence: no ⬤ dot, plain live identity", () => {
    mockDialData();
    renderDial();
    runCommand("/radio");

    expect(feedText()).not.toContain("this set");
    expect(feedText()).toContain("Some Other");
    expect(feedText()).toContain("Station kexp");
    expect(document.querySelector("#dial-feed-rows .fdrow__crossing-dot")).toBeNull();
    expect(localStorage.getItem("lore:radioMode")).toBe("true");
    expect(cliInput().value).toBe("");
  });

  it("/radio marks the Radio lens with the dimmed · pure indicator", () => {
    mockDialData();
    renderDial();
    const radioBtn = screen.getByRole("button", { name: "Radio" });
    expect(radioBtn.textContent).not.toContain("pure");
    runCommand("/radio");
    expect(radioBtn.textContent).toContain("· pure");
    expect(radioBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("/crossings restores the crossing-ranked view", () => {
    mockDialData();
    renderDial();
    runCommand("/radio");
    expect(document.querySelector("#dial-feed-rows .fdrow__crossing-dot")).toBeNull();
    runCommand("/crossings");
    expect(document.querySelector("#dial-feed-rows .fdrow__crossing-dot")).not.toBeNull();
    expect(localStorage.getItem("lore:radioMode")).toBe("false");
    expect(screen.getByRole("button", { name: "Radio" }).textContent).not.toContain("pure");
  });

  it("/radio forces the lens back to Radio from the Press lens", () => {
    mockDialData();
    renderDial();
    fireEvent.click(screen.getByRole("button", { name: "Press" }));
    expect(document.querySelector("#dial-feed-rows")).toBeNull();

    runCommand("/radio");
    expect(screen.getByRole("button", { name: "Radio" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#dial-feed-rows")).toBeTruthy();
    expect(localStorage.getItem("lore:dialLens")).toBe("radio");
    expect(localStorage.getItem("lore:radioMode")).toBe("true");
  });

  it("the mode survives a remount (reload persistence)", () => {
    mockDialData();
    const first = renderDial();
    runCommand("/radio");
    first.unmount();

    mockDialData();
    renderDial();
    expect(feedText()).not.toContain("this set");
    expect(feedText()).toContain("Some Other");
    expect(screen.getByRole("button", { name: "Radio" }).textContent).toContain("· pure");
  });

  it("a corrupted stored value falls back to the crossing-ranked view", () => {
    localStorage.setItem("lore:radioMode", "!!corrupt!!");
    mockDialData();
    renderDial();
    expect(document.querySelector("#dial-feed-rows .fdrow__crossing-dot")).not.toBeNull();
  });

  it("crossings on filters the feed to crossing-positive stations only", () => {
    const noCrossing: DialStation = {
      ...makeCrossingStation("quiet-fm"),
      shows: [makeShow({
        crossings: 0,
        topArtists: [],
        currentTrack: makeSpin({ artist: "Nobody Known", title: "Filler" }),
      })],
    };
    mockDialData({ stations: [makeCrossingStation("kexp"), noCrossing] });
    renderDial();

    // Crossings on (default): the zero-crossing station is hidden.
    expect(feedText()).toContain("Station kexp");
    expect(feedText()).not.toContain("Station quiet-fm");

    // /radio (crossings off): no filter — both stations render.
    runCommand("/radio");
    expect(feedText()).toContain("Station kexp");
    expect(feedText()).toContain("Station quiet-fm");
  });

  it("scope pill cycles the scope and re-filters; disabled in radio mode", () => {
    // kexp only has a SET-level crossing (ds-level counters are all zero),
    // so cycling the scope past "this set" empties the crossing filter.
    mockDialData();
    renderDial();
    const pill = () => document.querySelector(".crossing-scope-pill") as HTMLButtonElement;
    expect(pill()).not.toBeNull();
    expect(pill().disabled).toBe(false);
    expect(pill().textContent).toContain("this set");
    expect(feedText()).toContain("Station kexp");

    // set → 24h: ds.crossings is 0, so the station drops out of the feed.
    fireEvent.click(pill());
    expect(pill().textContent).toContain("24h");
    expect(feedText()).not.toContain("Station kexp");
    expect(localStorage.getItem("lore:crossingScope")).toBe("24h");

    // Radio mode disables the pill and lifts the filter.
    runCommand("/radio");
    expect(pill().disabled).toBe(true);
    expect(feedText()).toContain("Station kexp");
  });

  it("feed rows with a stream render a direct play button (click isolation)", () => {
    const playable = makeCrossingStation("kexp");
    playable.station = { ...playable.station, streamUrl: "https://example.com/stream" };
    mockDialData({ stations: [playable] });
    renderDial();
    expect(document.querySelector('[data-testid="dial-feed-play-kexp"]')).not.toBeNull();
  });

  it("radio mode never withholds reason rows while crossing scores load (no skeleton)", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("lore:radioMode", "true");
      mockDialData({ crossingsLoading: true });
      renderDial();
      act(() => { vi.advanceTimersByTime(500); });

      // The row renders immediately with its live sentence — no skeleton and
      // no crossing placeholder, regardless of crossingsLoading.
      expect(feedText()).toContain("Some Other");
      expect(feedText()).not.toContain("this set");
      expect(document.querySelector(".z1-placeholder")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
