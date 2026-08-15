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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

const { mockSetLocation } = vi.hoisted(() => ({
  mockSetLocation: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", mockSetLocation],
  // SplitHome imports buildAlbumGroups from the Library page, which imports
  // these wouter members — the mock must provide them even though the
  // compact-stack stub keeps Library's components from ever rendering.
  useSearch: () => "",
  Link: () => null,
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
  // SplitHome reads the first library page itself to size the stack pager.
  useMyLibraryInfinite: () => ({
    data: { pages: [{ items: [], nextCursor: null }] },
    isLoading: false,
  }),
}));

vi.mock("../src/components/dialViewHelpers", () => ({
  reason: () => ({ r: 0, cls: "w0", node: "on air" }),
}));

const { mockPreview } = vi.hoisted(() => ({
  mockPreview: vi.fn(),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: { station: null, status: "idle", toggle: vi.fn(), preview: mockPreview },
  }),
}));

vi.mock("../src/hooks/useRadioPlayer", () => ({
  // Scan tests need stations to count as playable so preview() is invoked;
  // the station stubs carry a streamUrl-equivalent identity via their slug.
  resolvePlaybackSource: (station: { slug: string }) => ({ kind: "stream", station }),
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
  mockPreview.mockReset();
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

  it("renders one numeric page selector per 5-row page and navigates past page 3", () => {
    // 23 stations → 5 pages (1…5); /scan4 shows rows 16–20.
    mockStations.value = Array.from({ length: 23 }, (_, i) =>
      makeStation(`st-${i + 1}`, null),
    );
    render(<SplitHome />);

    const pageGroup = screen.getByRole("group", { name: "Page" });
    expect(pageGroup.querySelectorAll("button")).toHaveLength(5);
    // The scan remote has exactly two scan actions — no per-page scan buttons.
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    expect(scanRow.querySelectorAll("button")).toHaveLength(7); // 5 pages + Scan + Scan all
    expect(screen.getByRole("button", { name: "scan this page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "scan all stations" })).toBeTruthy();

    typeCommand("/scan4");
    expect(screen.getByTestId("fdrow-st-16")).toBeTruthy();
    expect(screen.getByTestId("fdrow-st-20")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-st-15")).toBeNull();
    expect(screen.queryByTestId("fdrow-st-21")).toBeNull();
    expect(
      screen.getByRole("button", { name: "page 4 /scan4" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("clicking a numeric page selector changes the visible window", () => {
    mockStations.value = Array.from({ length: 12 }, (_, i) =>
      makeStation(`st-${i + 1}`, null),
    );
    render(<SplitHome />);

    fireEvent.click(screen.getByRole("button", { name: "page 2 /scan2" }));
    expect(screen.getByTestId("fdrow-st-6")).toBeTruthy();
    expect(screen.getByTestId("fdrow-st-10")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-st-1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "page 2 /scan2" }).getAttribute("aria-pressed"),
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
      screen.getByRole("button", { name: "page 2 /scan2" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "page 3 /scan3" })).toBeNull();
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
      screen.getByRole("button", { name: "page 3 /scan3" }).getAttribute("aria-pressed"),
    ).toBe("true");

    mockStations.value = mockStations.value.slice(0, 6);
    rerender(<SplitHome />);

    // Offset clamped 10 → 5: the 6th row is now visible, page 2 is active,
    // and the now-invalid page 3 selector is gone.
    expect(screen.getByTestId("fdrow-st-6")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-st-1")).toBeNull();
    const pageGroup = screen.getByRole("group", { name: "Page" });
    expect(pageGroup.querySelectorAll("button")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "page 2 /scan2" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("pins the radio remote above the Dial band and the stack pager below the Stack band", () => {
    mockStations.value = [makeStation("deep-cuts", "deep")];
    const { container } = render(<SplitHome />);

    const remote = screen.getByRole("toolbar", { name: "Radio remote" });
    const dialBand = container.querySelector(".split-home__band--dial")!;
    const seam = container.querySelector(".home-cli-strip")!;
    const stackBand = container.querySelector(".split-home__band--stack")!;
    const pager = container.querySelector(".stack-pager-bar")!;

    // Grid contract: remote → dial → seam → stack → pager, top to bottom.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(remote.compareDocumentPosition(dialBand) & FOLLOWING).toBeTruthy();
    expect(dialBand.compareDocumentPosition(seam) & FOLLOWING).toBeTruthy();
    expect(seam.compareDocumentPosition(stackBand) & FOLLOWING).toBeTruthy();
    expect(stackBand.compareDocumentPosition(pager) & FOLLOWING).toBeTruthy();

    // The filters live in the top remote, not the seam.
    expect(remote.contains(screen.getByRole("group", { name: "Age commands" }))).toBe(true);
    expect(remote.contains(screen.getByRole("group", { name: "Station category commands" }))).toBe(true);
    expect(seam.contains(screen.getByRole("group", { name: "Scan commands" }))).toBe(true);

    // The pager shows stack page selectors + Shuffle / Shuffle all.
    expect(pager.contains(screen.getByRole("group", { name: "Stack page" }))).toBe(true);
    expect(pager.contains(screen.getByRole("button", { name: "shuffle this page" }))).toBe(true);
    expect(pager.contains(screen.getByRole("button", { name: "shuffle all albums" }))).toBe(true);
  });

  it("disables Scan and Scan all when no stations are on air", () => {
    mockStations.value = [];
    render(<SplitHome />);

    expect(
      (screen.getByRole("button", { name: "scan this page" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "scan all stations" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compact scan remote — page/all preview scans
// ---------------------------------------------------------------------------

describe("SplitHome — compact scan remote", () => {
  it("Scan previews the first row of the selected page and becomes Stop", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 12 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      // Select page 2, then start a page scan.
      fireEvent.click(screen.getByRole("button", { name: "page 2 /scan2" }));
      fireEvent.click(screen.getByRole("button", { name: "scan this page" }));

      // The control is now a Stop action with active state.
      const stopBtn = screen.getByRole("button", { name: "stop page scan" });
      expect(stopBtn.textContent).toBe("Stop");
      expect(mockPreview).toHaveBeenCalledTimes(1);
      // First hop = first row of page 2 (st-6).
      expect(mockPreview.mock.calls[0][0].slug).toBe("st-6");
      // Sampling highlight lands on the previewed row.
      expect(document.querySelector(".compact-dial__row--sampling")).toBeTruthy();

      // Advance one dwell — hops to the next row within the page.
      act(() => { vi.advanceTimersByTime(7000); });
      expect(mockPreview).toHaveBeenCalledTimes(2);
      expect(mockPreview.mock.calls[1][0].slug).toBe("st-7");

      // Stop returns the control to a start action and clears the highlight.
      fireEvent.click(stopBtn);
      expect(screen.getByRole("button", { name: "scan this page" }).textContent).toBe("Scan");
      expect(document.querySelector(".compact-dial__row--sampling")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("page scan wraps within its five-row window, never leaving the page", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 12 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      fireEvent.click(screen.getByRole("button", { name: "scan this page" }));
      // Page 1 rows: st-1 … st-5, then wrap back to st-1.
      for (let hop = 0; hop < 5; hop++) {
        act(() => { vi.advanceTimersByTime(7000); });
      }
      const slugs = mockPreview.mock.calls.map((c) => c[0].slug);
      expect(slugs).toEqual(["st-1", "st-2", "st-3", "st-4", "st-5", "st-1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Scan all walks past the page boundary through the full filtered list", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 7 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      fireEvent.click(screen.getByRole("button", { name: "scan all stations" }));
      expect(screen.getByRole("button", { name: "stop scan all" }).textContent).toBe("Stop");

      for (let hop = 0; hop < 7; hop++) {
        act(() => { vi.advanceTimersByTime(7000); });
      }
      const slugs = mockPreview.mock.calls.map((c) => c[0].slug);
      // Crosses the page-1 boundary (st-5 → st-6) and wraps at the end.
      expect(slugs).toEqual(["st-1", "st-2", "st-3", "st-4", "st-5", "st-6", "st-7", "st-1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Scan all advances the visible page window so the sampled row stays rendered", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 7 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      // Start from page 2 — an all-scan snaps back to page 1 (it begins at
      // the top of the full list).
      fireEvent.click(screen.getByRole("button", { name: "page 2 /scan2" }));
      fireEvent.click(screen.getByRole("button", { name: "scan all stations" }));
      expect(
        screen.getByRole("button", { name: "page 1 /scan1" }).getAttribute("aria-pressed"),
      ).toBe("true");
      // The sampled row is visible and highlighted on page 1.
      expect(document.querySelector(".compact-dial__row--sampling")).toBeTruthy();

      // Hop through the rest of page 1 (st-2 … st-5): still page 1.
      for (let hop = 0; hop < 4; hop++) {
        act(() => { vi.advanceTimersByTime(7000); });
      }
      expect(
        screen.getByRole("button", { name: "page 1 /scan1" }).getAttribute("aria-pressed"),
      ).toBe("true");

      // Next hop crosses to st-6 — the window follows to page 2 and the
      // highlight stays on the (now visible) sampled row.
      act(() => { vi.advanceTimersByTime(7000); });
      expect(
        screen.getByRole("button", { name: "page 2 /scan2" }).getAttribute("aria-pressed"),
      ).toBe("true");
      expect(document.querySelector(".compact-dial__row--sampling")).toBeTruthy();

      // Wrap at the end returns the window to page 1.
      act(() => { vi.advanceTimersByTime(7000); }); // st-7
      act(() => { vi.advanceTimersByTime(7000); }); // wrap → st-1
      expect(
        screen.getByRole("button", { name: "page 1 /scan1" }).getAttribute("aria-pressed"),
      ).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("typed /scanN stops an active all-scan, matching the page buttons", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 12 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      fireEvent.click(screen.getByRole("button", { name: "scan all stations" }));
      expect(screen.getByRole("button", { name: "stop scan all" })).toBeTruthy();

      act(() => { typeCommand("/scan2"); });
      // Scan stopped and the page changed; no further hops fire.
      expect(screen.getByRole("button", { name: "scan all stations" }).textContent).toBe("Scan all");
      expect(
        screen.getByRole("button", { name: "page 2 /scan2" }).getAttribute("aria-pressed"),
      ).toBe("true");
      const callsBefore = mockPreview.mock.calls.length;
      act(() => { vi.advanceTimersByTime(30000); });
      expect(mockPreview.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clicking the other scan control switches modes instead of only stopping", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 7 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      // Page scan running…
      fireEvent.click(screen.getByRole("button", { name: "scan this page" }));
      expect(screen.getByRole("button", { name: "stop page scan" })).toBeTruthy();

      // …click Scan all: page scan stops, all-scan starts immediately.
      fireEvent.click(screen.getByRole("button", { name: "scan all stations" }));
      expect(screen.getByRole("button", { name: "stop scan all" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "scan this page" }).textContent).toBe("Scan");
      // The all-scan restarted from the top of the list.
      const lastSlug = mockPreview.mock.calls.at(-1)?.[0].slug;
      expect(lastSlug).toBe("st-1");

      // And back: click Scan (page) while the all-scan runs — switches again.
      fireEvent.click(screen.getByRole("button", { name: "scan this page" }));
      expect(screen.getByRole("button", { name: "stop page scan" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "scan all stations" }).textContent).toBe("Scan all");
    } finally {
      vi.useRealTimers();
    }
  });

  it("changing page stops an active page scan", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 12 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      fireEvent.click(screen.getByRole("button", { name: "scan this page" }));
      expect(screen.getByRole("button", { name: "stop page scan" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "page 2 /scan2" }));
      // Scan stopped; the control is a start action again and no more hops fire.
      expect(screen.getByRole("button", { name: "scan this page" }).textContent).toBe("Scan");
      const callsBefore = mockPreview.mock.calls.length;
      act(() => { vi.advanceTimersByTime(30000); });
      expect(mockPreview.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("changing an age filter stops an active scan", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = [
        ...Array.from({ length: 6 }, (_, i) => makeStation(`deep-${i + 1}`, "deep" as AgeTier)),
        makeStation("cur-1", "current"),
      ];
      render(<SplitHome />);

      fireEvent.click(screen.getByRole("button", { name: "scan all stations" }));
      expect(screen.getByRole("button", { name: "stop scan all" })).toBeTruthy();

      act(() => { typeCommand("/deep"); });
      expect(screen.getByRole("button", { name: "scan all stations" }).textContent).toBe("Scan all");
      const callsBefore = mockPreview.mock.calls.length;
      act(() => { vi.advanceTimersByTime(30000); });
      expect(mockPreview.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });
});
