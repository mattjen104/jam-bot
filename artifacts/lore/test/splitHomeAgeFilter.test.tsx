// @vitest-environment jsdom
/**
 * SplitHome — CLI age-tier commands filter the compact Dial rows.
 *
 * The strip inherits /first /current /catalog /deep from DialCliBar; this
 * test proves the commands actually change which rows the CompactDial shows
 * (same semantics as DialFeedLane: the row's age identity is its station's
 * current track; rows with no current track always pass).
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("../src/components/dial/FrontDoorRow", () => ({
  FrontDoorRow: ({ ds }: { ds: { station: { slug: string } }; [k: string]: unknown }) => (
    <div data-testid={`fdrow-${ds.station.slug}`} className="fdrow" />
  ),
}));

// CompactStack pulls in meHooks/Library — stub it out entirely.
vi.mock("../src/components/CompactStack", () => ({
  CompactStack: () => <div data-testid="compact-stack-stub" />,
}));

vi.mock("../src/lib/meHooks", () => ({
  useStartMattLibrary: () => ({ mutate: vi.fn(), isPending: false, data: undefined, error: null }),
}));

vi.mock("../src/components/dialViewHelpers", () => ({
  reason: () => ({ r: 0, cls: "w0", node: "on air" }),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({ radio: { station: null, status: "idle", toggle: vi.fn() } }),
}));

vi.mock("../src/hooks/useRadioPlayer", () => ({
  resolvePlaybackSource: () => null,
}));

vi.mock("../src/hooks/useSeedManager", () => ({
  useSeedManager: () => ({ addSeed: vi.fn() }),
}));

vi.mock("../src/hooks/useStationPresence", () => ({
  useStationPresence: () => new Map(),
}));

const { mockStations } = vi.hoisted(() => ({
  mockStations: { value: [] as unknown[] },
}));

vi.mock("../src/hooks/useDialData", () => ({
  useDialData: () => ({
    stations: mockStations.value,
    overlapByPickerId: new Map(),
    pickerNameToId: new Map(),
    crossingSourceMode: "personal",
  }),
  readPins: () => new Set<string>(),
  normalizeDjName: (s: string) => s.toLowerCase(),
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import SplitHome from "../src/pages/SplitHome";
import type { AgeTier } from "../src/lib/dialAgeFilter";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let nextId = 1;

function makeStation(slug: string, tier: AgeTier | null | "none") {
  const liveTrack = tier === "none" ? null : {
    mbid: "00000000-0000-0000-0000-000000000001",
    artistMbid: null,
    title: "Track",
    artist: "Artist",
    playedAt: new Date().toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: tier === "first",
    releaseYear: null,
    ageTier: tier,
  };
  return {
    station: { id: nextId++, slug, name: `Station ${slug}` },
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
    liveTrack,
  };
}

function typeCommand(command: string) {
  const input = screen.getByRole("textbox", { name: "Dial command" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: command } });
  fireEvent.keyDown(input, { key: "Enter" });
}

afterEach(() => {
  cleanup();
  mockStations.value = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SplitHome — age-tier CLI commands filter the compact Dial", () => {
  it("/deep hides rows whose current track is not deep; unknown-age and trackless rows stay", () => {
    mockStations.value = [
      makeStation("deep-cuts", "deep"),
      makeStation("new-music", "current"),
      makeStation("no-year", null),
      makeStation("dark-station", "none"),
    ];
    render(<SplitHome />);

    // All four render before any tier is active.
    expect(screen.getByTestId("fdrow-deep-cuts")).toBeTruthy();
    expect(screen.getByTestId("fdrow-new-music")).toBeTruthy();

    typeCommand("/deep");

    // The "current" row is hidden; deep matches, and the unknown-age +
    // trackless rows always pass (never hide rows for missing data).
    expect(screen.queryByTestId("fdrow-new-music")).toBeNull();
    expect(screen.getByTestId("fdrow-deep-cuts")).toBeTruthy();
    expect(screen.getByTestId("fdrow-no-year")).toBeTruthy();
    expect(screen.getByTestId("fdrow-dark-station")).toBeTruthy();
  });

  it("tier commands toggle: /current twice restores the unfiltered feed", () => {
    mockStations.value = [
      makeStation("deep-cuts", "deep"),
      makeStation("new-music", "current"),
    ];
    render(<SplitHome />);

    typeCommand("/current");
    expect(screen.queryByTestId("fdrow-deep-cuts")).toBeNull();
    expect(screen.getByTestId("fdrow-new-music")).toBeTruthy();

    typeCommand("/current");
    expect(screen.getByTestId("fdrow-deep-cuts")).toBeTruthy();
    expect(screen.getByTestId("fdrow-new-music")).toBeTruthy();
  });

  it("tiers are additive: /first + /catalog show both tiers, hide the rest", () => {
    mockStations.value = [
      makeStation("premieres", "first"),
      makeStation("catalog-fm", "catalog"),
      makeStation("new-music", "current"),
    ];
    render(<SplitHome />);

    typeCommand("/first");
    typeCommand("/catalog");

    expect(screen.getByTestId("fdrow-premieres")).toBeTruthy();
    expect(screen.getByTestId("fdrow-catalog-fm")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-new-music")).toBeNull();
  });

  it("filtering happens before scan windowing: /scan2 pages within the filtered set", () => {
    // 7 deep rows interleaved with current rows — after /deep, scan 2
    // (offset 5) must show the 6th and 7th DEEP rows, not raw-index rows.
    mockStations.value = [
      ...Array.from({ length: 7 }, (_, i) => makeStation(`deep-${i + 1}`, "deep" as AgeTier)),
      ...Array.from({ length: 3 }, (_, i) => makeStation(`cur-${i + 1}`, "current" as AgeTier)),
    ];
    render(<SplitHome />);

    typeCommand("/deep");
    typeCommand("/scan2");

    expect(screen.getByTestId("fdrow-deep-6")).toBeTruthy();
    expect(screen.getByTestId("fdrow-deep-7")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-deep-1")).toBeNull();
    expect(screen.queryByTestId("fdrow-cur-1")).toBeNull();
  });
});
