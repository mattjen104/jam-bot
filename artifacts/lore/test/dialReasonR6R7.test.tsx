// @vitest-environment jsdom
/**
 * Regression tests for r=6 and r=7 reason() row labels in Zone 1.
 *
 * r=6 and r=7 were moved from Zone 3 into Zone 1 ("On air, with a reason")
 * because 24h station-level crossings ARE a reason to tune in. Their copy was
 * updated at the same time: the "no selector listed" suffix was removed. These
 * tests pin the rendered copy so a future change to the reason() rungs or
 * surrounding copy cannot silently reintroduce stale text.
 *
 * Covers:
 *   1. r=6: "{N} of yours here in the last 24h" — station has 24h exact crossings
 *   2. r=7: "{N} tracks by your artists here in the last 24h" — station has 24h
 *      artist crossings only
 *   3. Neither rung includes "no selector listed" or any variant
 *   4. r=6 singular: "1 of yours here in the last 24h"
 *   5. r=7 singular: "1 tracks by your artists here in the last 24h"
 *   6. r=6 takes priority over r=7 when both stationCrossings and
 *      stationArtistCrossings are > 0
 *   7. r=6/r=7 rows land in Zone 1 ("On air, with a reason"), not Zone 3
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/lore/", vi.fn()],
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
    useSpotifyLibraryConnected: vi.fn(() => true),
    startSpotifyLibraryConnect: vi.fn(),
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
      scan: { active: false, samplingIdx: null, scanning: false },
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
import { useMyGhostMissed } from "../src/lib/meHooks";
import { DialView } from "../src/components/DialView";
import type { DialStation, DialShow } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Afternoon Mix",
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

/**
 * Builds a live station that fires r=6: stationCrossings > 0, no show-level
 * evidence, no DJ name. The show must be live so reason() receives a non-null
 * show and reaches the r=6 rung (if show is null it short-circuits to r=0).
 */
function makeR6Station(slug: string, stationCrossings = 5): DialStation {
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
    shows: [makeShow({ djName: null, crossings: 0, artistCrossings: 0, currentTrack: null })],
    crossings: stationCrossings,
    artistCrossings: 0,
    lifetimeCrossings: stationCrossings,
    lifetimeArtistCrossings: 0,
  };
}

/**
 * Builds a live station that fires r=7: stationArtistCrossings > 0,
 * stationCrossings = 0, no show-level evidence, no DJ name.
 */
function makeR7Station(slug: string, stationArtistCrossings = 3): DialStation {
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
    shows: [makeShow({ djName: null, crossings: 0, artistCrossings: 0, currentTrack: null })],
    crossings: 0,
    artistCrossings: stationArtistCrossings,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: stationArtistCrossings,
  };
}

function mockDialData(stations: DialStation[]) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations,
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: true,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
  });
  (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: [] });
}

function renderDial() {
  // DialView consumes react-query hooks directly, so it must render inside a
  // QueryClientProvider.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialView />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// r=6 — 24h station exact crossings
// ---------------------------------------------------------------------------

describe("reason() r=6 — 24h station exact crossings row label", () => {
  it("renders the crossing count followed by 'of yours here in the last 24h'", () => {
    mockDialData([makeR6Station("r6-station", 5)]);
    renderDial();

    const t1 = document.querySelector(".fdrow__t1");
    expect(t1).not.toBeNull();
    const text = t1!.textContent ?? "";
    expect(text).toContain("5");
    expect(text).toContain("of yours");
    expect(text).toContain("here in the last 24h");
  });

  it("does not include 'no selector listed' text", () => {
    mockDialData([makeR6Station("r6-no-selector", 7)]);
    const { container } = renderDial();

    expect(container.textContent).not.toContain("no selector listed");
  });

  it("renders singular count (1) correctly", () => {
    mockDialData([makeR6Station("r6-single", 1)]);
    renderDial();

    const t1 = document.querySelector(".fdrow__t1");
    expect(t1).not.toBeNull();
    const text = t1!.textContent ?? "";
    expect(text).toContain("1");
    expect(text).toContain("of yours");
    expect(text).toContain("here in the last 24h");
  });

  it("lands the row in Zone 1 (history band), not the Zone 3 'DJs on air' band", () => {
    mockDialData([makeR6Station("r6-zone1", 4)]);
    renderDial();

    // The fdrow must exist and carry the Zone 1 history class (r=6/r=7 →
    // fdrow--hist), never the Zone 3 dim class (r=0/r=5 → fdrow--dim).
    const rows = document.querySelectorAll(".fdrow");
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains("fdrow--hist")).toBe(true);
    expect(rows[0].classList.contains("fdrow--dim")).toBe(false);

    // The Zone 3 "DJs on air" band must not appear for a crossing row.
    expect(
      screen.queryByText("DJs on air", { selector: ".fdzone-lbl__text" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// r=7 — 24h station artist crossings
// ---------------------------------------------------------------------------

describe("reason() r=7 — 24h station artist crossings row label", () => {
  it("renders the crossing count followed by 'tracks by your artists here in the last 24h'", () => {
    mockDialData([makeR7Station("r7-station", 3)]);
    renderDial();

    const t1 = document.querySelector(".fdrow__t1");
    expect(t1).not.toBeNull();
    const text = t1!.textContent ?? "";
    expect(text).toContain("3");
    expect(text).toContain("tracks by your artists");
    expect(text).toContain("here in the last 24h");
  });

  it("does not include 'no selector listed' text", () => {
    mockDialData([makeR7Station("r7-no-selector", 2)]);
    const { container } = renderDial();

    expect(container.textContent).not.toContain("no selector listed");
  });

  it("renders singular count (1) correctly", () => {
    mockDialData([makeR7Station("r7-single", 1)]);
    renderDial();

    const t1 = document.querySelector(".fdrow__t1");
    expect(t1).not.toBeNull();
    const text = t1!.textContent ?? "";
    expect(text).toContain("1");
    expect(text).toContain("tracks by your artists");
    expect(text).toContain("here in the last 24h");
  });

  it("lands the row in Zone 1 (history band), not the Zone 3 'DJs on air' band", () => {
    mockDialData([makeR7Station("r7-zone1", 2)]);
    renderDial();

    const rows = document.querySelectorAll(".fdrow");
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains("fdrow--hist")).toBe(true);
    expect(rows[0].classList.contains("fdrow--dim")).toBe(false);

    expect(
      screen.queryByText("DJs on air", { selector: ".fdzone-lbl__text" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// r=6 vs r=7 priority: r=6 wins when both station crossings are nonzero
// ---------------------------------------------------------------------------

describe("reason() r=6 takes priority over r=7", () => {
  it("renders the exact-crossing copy (r=6) when stationCrossings > 0 even if artistCrossings is also > 0", () => {
    // Station has both exact and artist station crossings.
    // reason() reaches r=6 first, so the exact count copy must appear.
    const station: DialStation = {
      station: {
        slug: "r6-priority",
        name: "Station r6-priority",
        automationClass: null,
        streamUrl: null,
        websiteUrl: null,
        hidden: false,
        favorite: false,
      } as DialStation["station"],
      isLive: true,
      shows: [makeShow({ djName: null, crossings: 0, artistCrossings: 0, currentTrack: null })],
      crossings: 4,
      artistCrossings: 9,
      lifetimeCrossings: 4,
      lifetimeArtistCrossings: 9,
    };

    mockDialData([station]);
    renderDial();

    const t1 = document.querySelector(".fdrow__t1");
    expect(t1).not.toBeNull();
    const text = t1!.textContent ?? "";

    // r=6 copy present
    expect(text).toContain("of yours");
    expect(text).toContain("here in the last 24h");

    // r=7 copy absent
    expect(text).not.toContain("tracks by your artists");
  });
});
