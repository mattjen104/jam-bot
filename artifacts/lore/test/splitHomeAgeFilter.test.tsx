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

const { mockSetLocation } = vi.hoisted(() => ({
  mockSetLocation: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", mockSetLocation],
}));

vi.mock("../src/components/dial/FrontDoorRow", () => ({
  FrontDoorRow: ({ ds }: { ds: { station: { slug: string } }; [k: string]: unknown }) => (
    <div data-testid={`fdrow-${ds.station.slug}`} className="fdrow" />
  ),
}));

// CompactStack pulls in meHooks/Library — stub it out entirely, but keep
// the onExpandedChange seam so expansion can be simulated (and the dial +
// remote proven to stay mounted through it).
vi.mock("../src/components/CompactStack", () => ({
  CompactStack: ({ onExpandedChange }: { onExpandedChange?: (e: boolean) => void }) => (
    <div data-testid="compact-stack-stub">
      <button type="button" onClick={() => onExpandedChange?.(true)}>
        stub-expand
      </button>
      <button type="button" onClick={() => onExpandedChange?.(false)}>
        stub-collapse
      </button>
    </div>
  ),
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
import { readRadioMode } from "../src/lib/dialRadioMode";
import { readDialLens, writeDialLens } from "../src/lib/dialLensState";

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
  mockSetLocation.mockReset();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SplitHome — age-tier CLI commands filter the compact Dial", () => {
  it.each([
    ["crossings /crossings", false],
    ["radio /radio", true],
  ] as const)("shortcut %s persists its mode and opens the full feed", (name, mode) => {
    render(<SplitHome />);

    fireEvent.click(screen.getByRole("button", { name }));

    expect(readRadioMode()).toBe(mode);
    expect(localStorage.getItem("lore:radioMode")).toBe(mode ? "true" : "false");
    expect(mockSetLocation).toHaveBeenCalledWith("/feed");
  });

  it.each([
    ["/crossings", false],
    ["/radio", true],
  ] as const)("typed %s persists its mode and opens the full feed", (command, mode) => {
    render(<SplitHome />);

    typeCommand(command);

    expect(readRadioMode()).toBe(mode);
    expect(mockSetLocation).toHaveBeenCalledWith("/feed");
  });

  it("/radio forces the Radio lens even when the listener was on Press or Shows", () => {
    // Simulate a returning visitor who previously selected the Press lens.
    writeDialLens("press");
    expect(readDialLens()).toBe("press");

    render(<SplitHome />);

    // Clicking the /radio shortcut must clobber the persisted Press lens.
    fireEvent.click(screen.getByRole("button", { name: "radio /radio" }));

    expect(readRadioMode()).toBe(true);
    expect(readDialLens()).toBe("radio");
    expect(localStorage.getItem("lore:dialLens")).toBe("radio");
    expect(mockSetLocation).toHaveBeenCalledWith("/feed");
  });

  it("/crossings does not clobber the active lens — it only changes the radio-mode flag", () => {
    // A Press-lens visitor using /crossings should still land on Press (only
    // the crossing-ranked sort is toggled, not the lens).
    writeDialLens("press");

    render(<SplitHome />);

    fireEvent.click(screen.getByRole("button", { name: "crossings /crossings" }));

    expect(readRadioMode()).toBe(false);
    expect(readDialLens()).toBe("press");
    expect(mockSetLocation).toHaveBeenCalledWith("/feed");
  });

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

  it("keeps the mini feed and CLI remote mounted while a Stack album is expanded", () => {
    mockStations.value = [makeStation("deep-cuts", "deep")];
    const { container } = render(<SplitHome />);

    // Collapsed: dial band + CLI remote are visible.
    expect(screen.getByTestId("fdrow-deep-cuts")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Dial command" })).toBeTruthy();

    // Expanded: the Stack band grows in place — the mini feed and the remote
    // stay in the DOM and no takeover modifier is applied.
    fireEvent.click(screen.getByRole("button", { name: "stub-expand" }));
    expect(screen.getByTestId("fdrow-deep-cuts")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Dial command" })).toBeTruthy();
    expect(container.querySelector(".split-home--stack-expanded")).toBeNull();

    // Collapsing changes nothing either — the bands never moved.
    fireEvent.click(screen.getByRole("button", { name: "stub-collapse" }));
    expect(screen.getByTestId("fdrow-deep-cuts")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Dial command" })).toBeTruthy();
    expect(container.querySelector(".split-home--stack-expanded")).toBeNull();
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

  it("renders one scan button per 5-row page and navigates past /scan3", () => {
    // 23 stations → 5 pages (/scan1…/scan5); /scan4 shows rows 16–20.
    mockStations.value = Array.from({ length: 23 }, (_, i) =>
      makeStation(`st-${i + 1}`, null),
    );
    render(<SplitHome />);

    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    expect(scanRow.querySelectorAll("button")).toHaveLength(5);

    typeCommand("/scan4");
    expect(screen.getByTestId("fdrow-st-16")).toBeTruthy();
    expect(screen.getByTestId("fdrow-st-20")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-st-15")).toBeNull();
    expect(screen.queryByTestId("fdrow-st-21")).toBeNull();
    expect(
      screen.getByRole("button", { name: "scan 4 /scan4" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("clamps an out-of-range /scanN to the last valid page of a stable short list", () => {
    // 6 stations → 2 pages (offsets 0 and 5). /scan10 (offset 45) must NOT
    // leave the listener on an empty window — it lands on page 2.
    mockStations.value = Array.from({ length: 6 }, (_, i) =>
      makeStation(`st-${i + 1}`, null),
    );
    render(<SplitHome />);

    typeCommand("/scan10");

    expect(screen.getByTestId("fdrow-st-6")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-st-1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "scan 2 /scan2" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "scan 3 /scan3" })).toBeNull();
  });

  it("clamps a stale scan offset when the filtered list shrinks below it", () => {
    // 12 stations → 3 pages; go to the last page (offset 10), then shrink
    // the list to 6 rows — the offset must clamp to 5 (the new last page),
    // not leave the listener staring at an empty scan window.
    mockStations.value = Array.from({ length: 12 }, (_, i) =>
      makeStation(`st-${i + 1}`, null),
    );
    const { rerender } = render(<SplitHome />);

    typeCommand("/scan3");
    expect(screen.getByTestId("fdrow-st-11")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "scan 3 /scan3" }).getAttribute("aria-pressed"),
    ).toBe("true");

    mockStations.value = mockStations.value.slice(0, 6);
    rerender(<SplitHome />);

    // Offset clamped 10 → 5: the 6th row is now visible, page 2 is active,
    // and the now-invalid /scan3 button is gone.
    expect(screen.getByTestId("fdrow-st-6")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-st-1")).toBeNull();
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    expect(scanRow.querySelectorAll("button")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "scan 2 /scan2" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
