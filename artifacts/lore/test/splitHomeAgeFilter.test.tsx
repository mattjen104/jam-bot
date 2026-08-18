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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const { mockStations, mockCrossingsLoading } = vi.hoisted(() => ({
  mockStations: { value: [] as unknown[] },
  mockCrossingsLoading: { value: false },
}));

vi.mock("../src/hooks/useDialData", () => ({
  useDialData: () => ({
    stations: mockStations.value,
    crossingsLoading: mockCrossingsLoading.value,
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

function makeStation(
  slug: string,
  tier: AgeTier | null | "none",
  overrides: Partial<{
    name: string;
    isLive: boolean;
    crossings: number;
    lifetimeCrossings: number;
  }> = {},
) {
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
    station: { id: nextId++, slug, name: overrides.name ?? `Station ${slug}` },
    isLive: overrides.isLive ?? true,
    shows: [],
    crossings: overrides.crossings ?? 0,
    artistCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    lifetimeCrossings: overrides.lifetimeCrossings ?? 0,
    // Every fixture station carries a lifetime crossing so the crossing-positive
    // filter (crossings on by default; scope pinned to "lifetime" in beforeEach)
    // never hides rows — these tests exercise the AGE-TIER filter in isolation.
    lifetimeArtistCrossings: 1,
    topArtistNames: [],
    liveTrack,
  };
}

/** Slugs of the fdrow stubs currently rendered, in document order. */
function renderedRowSlugs(): string[] {
  return [...document.querySelectorAll('[data-testid^="fdrow-"]')].map((el) =>
    el.getAttribute("data-testid")!.replace(/^fdrow-/, ""),
  );
}

function typeCommand(command: string) {
  const input = screen.getByRole("textbox", { name: "Dial command" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: command } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  // Pin the crossing scope wide so the crossing-positive filter passes every
  // fixture station (they all carry one lifetime crossing) — age-tier
  // filtering stays the only variable under test here.
  localStorage.setItem("lore:crossingScope", "lifetime");
});

afterEach(() => {
  cleanup();
  mockStations.value = [];
  mockCrossingsLoading.value = false;
  mockSetLocation.mockReset();
  mockPreview.mockReset();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SplitHome — age-tier CLI commands filter the compact Dial", () => {
  function clickCrossingsCheckbox() {
    fireEvent.click(screen.getByRole("button", { name: /^Crossings/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Crossings on/ }));
  }

  it.each([
    ["crossings", false],
    ["radio", true],
  ] as const)("Crossings dropdown (%s) persists its mode and opens the full feed", (_name, mode) => {
    // Start in the opposite mode so the checkbox flip lands on `mode`.
    localStorage.setItem("lore:radioMode", mode ? "false" : "true");
    render(<SplitHome />);

    clickCrossingsCheckbox();

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

  it("radio mode forces the Radio lens even when the listener was on Press or Shows", () => {
    // Simulate a returning visitor who previously selected the Press lens.
    writeDialLens("press");
    expect(readDialLens()).toBe("press");

    render(<SplitHome />);

    // Unchecking "Crossings on" (switching to radio mode) must clobber the
    // persisted Press lens.
    fireEvent.click(screen.getByRole("button", { name: /^Crossings/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Crossings on/ }));

    expect(readRadioMode()).toBe(true);
    expect(readDialLens()).toBe("radio");
    expect(localStorage.getItem("lore:dialLens")).toBe("radio");
    expect(mockSetLocation).toHaveBeenCalledWith("/feed");
  });

  it("crossings mode does not clobber the active lens — it only changes the radio-mode flag", () => {
    // A Press-lens visitor switching back to crossings should still land on
    // Press (only the crossing-ranked sort is toggled, not the lens).
    writeDialLens("press");
    localStorage.setItem("lore:radioMode", "true");

    render(<SplitHome />);

    fireEvent.click(screen.getByRole("button", { name: /^Crossings/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Crossings on/ }));

    expect(readRadioMode()).toBe(false);
    expect(readDialLens()).toBe("press");
    expect(mockSetLocation).toHaveBeenCalledWith("/feed");
  });

  it("/deep removes deep from the active set, hiding deep rows while others stay", () => {
    // Default: all four age tiers are active, so every row renders initially.
    mockStations.value = [
      makeStation("deep-cuts", "deep"),
      makeStation("new-music", "current"),
      makeStation("no-year", null),
      makeStation("dark-station", "none"),
    ];
    render(<SplitHome />);

    // All four render with the default all-tiers-active state.
    expect(screen.getByTestId("fdrow-deep-cuts")).toBeTruthy();
    expect(screen.getByTestId("fdrow-new-music")).toBeTruthy();

    // /deep toggles deep OUT of the active set (first/current/catalog remain).
    // Deep-tagged rows are now hidden; current, unknown-age, and trackless pass.
    typeCommand("/deep");

    expect(screen.queryByTestId("fdrow-deep-cuts")).toBeNull();
    expect(screen.getByTestId("fdrow-new-music")).toBeTruthy();
    expect(screen.getByTestId("fdrow-no-year")).toBeTruthy();
    expect(screen.getByTestId("fdrow-dark-station")).toBeTruthy();
  });

  it("tier commands toggle: /current twice restores the all-tiers feed", () => {
    // Start: all four tiers active — both rows visible.
    // /current once: removes current from active set (first/catalog/deep remain)
    //   → deep-cuts visible, new-music hidden.
    // /current again: re-adds current (all four active again)
    //   → both rows visible again.
    mockStations.value = [
      makeStation("deep-cuts", "deep"),
      makeStation("new-music", "current"),
    ];
    render(<SplitHome />);

    typeCommand("/current");
    expect(screen.getByTestId("fdrow-deep-cuts")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-new-music")).toBeNull();

    typeCommand("/current");
    expect(screen.getByTestId("fdrow-deep-cuts")).toBeTruthy();
    expect(screen.getByTestId("fdrow-new-music")).toBeTruthy();
  });

  it("tiers are additive: /current + /first remove those tiers, leaving catalog + deep", () => {
    // Default: all four tiers active — all three rows visible.
    // /current removes current → premieres (first) + catalog-fm (catalog) visible,
    //   new-music (current) hidden.
    // /first removes first → only catalog-fm (catalog) visible.
    mockStations.value = [
      makeStation("premieres", "first"),
      makeStation("catalog-fm", "catalog"),
      makeStation("new-music", "current"),
    ];
    render(<SplitHome />);

    typeCommand("/current");
    expect(screen.getByTestId("fdrow-premieres")).toBeTruthy();
    expect(screen.getByTestId("fdrow-catalog-fm")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-new-music")).toBeNull();

    typeCommand("/first");
    expect(screen.queryByTestId("fdrow-premieres")).toBeNull();
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
    // 7 current rows interleaved with deep rows — after /deep (removes deep
    // from the active set), scan 2 (offset 5) must show the 6th and 7th
    // CURRENT rows, not raw-index rows.
    mockStations.value = [
      ...Array.from({ length: 7 }, (_, i) => makeStation(`cur-${i + 1}`, "current" as AgeTier)),
      ...Array.from({ length: 3 }, (_, i) => makeStation(`deep-${i + 1}`, "deep" as AgeTier)),
    ];
    render(<SplitHome />);

    // /deep removes deep from the active set → only current rows remain.
    typeCommand("/deep");
    typeCommand("/scan2");

    expect(screen.getByTestId("fdrow-cur-6")).toBeTruthy();
    expect(screen.getByTestId("fdrow-cur-7")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-cur-1")).toBeNull();
    expect(screen.queryByTestId("fdrow-deep-1")).toBeNull();
  });

  it("renders one numeric page selector per 5-row page and navigates past page 3", () => {
    // 23 stations → 5 pages (1…5); /scan4 shows rows 16–20.
    mockStations.value = Array.from({ length: 23 }, (_, i) =>
      makeStation(`st-${i + 1}`, null),
    );
    render(<SplitHome />);

    const pageGroup = screen.getByRole("group", { name: "Page" });
    expect(pageGroup.querySelectorAll("button")).toHaveLength(5);
    // The scan remote has exactly two scan actions plus the crossing-scope
    // pill — no per-page scan buttons.
    const scanRow = screen.getByRole("group", { name: "Scan commands" });
    expect(scanRow.querySelectorAll("button")).toHaveLength(8); // 5 pages + Scan + Scan all + scope pill
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

    // The filters live in the top remote as dropdown menus, not the seam.
    expect(remote.contains(screen.getByRole("button", { name: /^Track age/ }))).toBe(true);
    expect(remote.contains(screen.getByRole("button", { name: /^Station type/ }))).toBe(true);
    expect(remote.contains(screen.getByRole("button", { name: /^Crossings/ }))).toBe(true);
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
// All-stations deterministic ordering
// ---------------------------------------------------------------------------

describe("SplitHome — crossing-positive filter progressive loading", () => {
  it("does not blank the feed while crossing scores are still loading", () => {
    // A zero-crossing station (scope pinned to "set" by default → the fixture
    // has no live show, so hasAnyCrossing is false once scores settle).
    mockStations.value = [makeStation("kcrw", null, { name: "KCRW" })];
    localStorage.setItem("lore:crossingScope", "set");

    // While the crossings compute is in flight the filter is suspended —
    // filtering on unsettled zero counters would flash "No stations to show".
    mockCrossingsLoading.value = true;
    const { rerender } = render(<SplitHome />);
    expect(document.querySelectorAll('[data-testid="fdrow-kcrw"]').length).toBe(1);

    // Once scores settle, the crossing-positive filter engages and the
    // zero-crossing station is hidden.
    mockCrossingsLoading.value = false;
    act(() => { rerender(<SplitHome />); });
    expect(document.querySelectorAll('[data-testid="fdrow-kcrw"]').length).toBe(0);
  });
});

describe("SplitHome — all stations in one deterministic order", () => {
  it("sorts alphabetically by station name regardless of crossing data", () => {
    // Crossing counts would have ranked zebra first under the old personal
    // sort — the deterministic order must ignore them entirely.
    mockStations.value = [
      makeStation("zebra", null, { name: "Zebra Radio", crossings: 99, lifetimeCrossings: 500 }),
      makeStation("mid", null, { name: "Midtown FM" }),
      makeStation("alpha", null, { name: "Alpha College Radio" }),
    ];
    render(<SplitHome />);

    expect(renderedRowSlugs()).toEqual(["alpha", "mid", "zebra"]);
  });

  it("includes off-air stations in the same alphabetical order", () => {
    mockStations.value = [
      makeStation("live-1", null, { name: "B Live Station" }),
      makeStation("dark-1", "none", { name: "A Dark Station", isLive: false }),
      makeStation("dark-2", "none", { name: "C Dark Station", isLive: false }),
    ];
    render(<SplitHome />);

    expect(renderedRowSlugs()).toEqual(["dark-1", "live-1", "dark-2"]);
  });

  it("name ties fall back to slug so the order never depends on fetch order", () => {
    mockStations.value = [
      makeStation("twin-b", null, { name: "Twin FM" }),
      makeStation("twin-a", null, { name: "Twin FM" }),
    ];
    render(<SplitHome />);

    expect(renderedRowSlugs()).toEqual(["twin-a", "twin-b"]);
  });

  it("numeric names sort naturally (Channel 2 before Channel 10)", () => {
    mockStations.value = [
      makeStation("ch-10", null, { name: "Channel 10" }),
      makeStation("ch-2", null, { name: "Channel 2" }),
    ];
    render(<SplitHome />);

    expect(renderedRowSlugs()).toEqual(["ch-2", "ch-10"]);
  });

  it("skipping a station moves it below the fold (skipped-region), not onto a later page", () => {
    mockStations.value = [
      makeStation("alpha", null, { name: "Alpha FM" }),
      makeStation("bravo", null, { name: "Bravo FM" }),
      makeStation("charlie", null, { name: "Charlie FM" }),
    ];
    const { container } = render(<SplitHome />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Skip Alpha FM in scan" }));

    // Alpha moves into the scrollable skipped region below the active grid…
    const skippedRegion = container.querySelector(".compact-dial__skipped-region");
    expect(skippedRegion).toBeTruthy();
    expect(skippedRegion!.querySelector('[data-testid="fdrow-alpha"]')).toBeTruthy();

    // …while Bravo and Charlie remain in the active grid on page 1.
    const activeRows = container.querySelectorAll(".compact-dial__row:not(.compact-dial__row--skipped):not(.compact-dial__row--empty)");
    const activeSlugs = [...activeRows].map((el) =>
      el.querySelector('[data-testid^="fdrow-"]')?.getAttribute("data-testid")?.replace(/^fdrow-/, ""),
    ).filter(Boolean);
    expect(activeSlugs).toEqual(["bravo", "charlie"]);
  });

  it("every row has a trailing scan checkbox; included rows are checked", () => {
    mockStations.value = [
      makeStation("alpha", null, { name: "Alpha FM" }),
      makeStation("bravo", null, { name: "Bravo FM" }),
    ];
    const { container } = render(<SplitHome />);

    const boxes = container.querySelectorAll(".compact-dial__scan-checkbox");
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect((box as HTMLInputElement).checked).toBe(true);
      // Trailing edge: the checkbox is the last element in its row.
      expect(box.parentElement!.lastElementChild).toBe(box);
    }

    fireEvent.click(screen.getByRole("checkbox", { name: "Skip Bravo FM in scan" }));
    const bravoBox = screen.getByRole("checkbox", { name: "Include Bravo FM in scan" }) as HTMLInputElement;
    expect(bravoBox.checked).toBe(false);
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

// ---------------------------------------------------------------------------
// Per-station scan-skip preference
// ---------------------------------------------------------------------------

describe("SplitHome — per-station scan skip", () => {
  it("unchecking a station moves it to the below-fold skipped region, freeing the active page", () => {
    mockStations.value = Array.from({ length: 6 }, (_, i) =>
      makeStation(`st-${i + 1}`, null),
    );
    const { container } = render(<SplitHome />);

    // Page 1 active slots show st-1 … st-5 (st-6 is on page 2). Skip st-1.
    fireEvent.click(screen.getByRole("checkbox", { name: "Skip Station st-1 in scan" }));

    // Active page 1 now has st-2 … st-6 (st-1 freed a slot, st-6 fills it).
    expect(screen.getByTestId("fdrow-st-6")).toBeTruthy();

    // st-1 is in the skipped-region (below the fold), not on any active page.
    const skippedRegion = container.querySelector(".compact-dial__skipped-region");
    expect(skippedRegion).toBeTruthy();
    expect(skippedRegion!.querySelector('[data-testid="fdrow-st-1"]')).toBeTruthy();

    // The re-include checkbox is present on the skipped row.
    expect(screen.getByRole("checkbox", { name: "Include Station st-1 in scan" })).toBeTruthy();

    // pageCount shrinks: 5 active stations → 1 page (no page 2 button).
    expect(screen.queryByRole("button", { name: "page 2 /scan2" })).toBeNull();
  });

  it("skip preference persists in localStorage under lore:dialSkipped", () => {
    mockStations.value = [makeStation("kexp-ish", null)];
    render(<SplitHome />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Skip Station kexp-ish in scan" }));
    expect(JSON.parse(localStorage.getItem("lore:dialSkipped")!)).toEqual(["kexp-ish"]);
  });

  it("Scan all skips unchecked stations entirely", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 4 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      // Skip st-2: it moves to the below-fold skipped region AND is excluded
      // from the scan. The active list becomes [st-1, st-3, st-4].
      fireEvent.click(screen.getByRole("checkbox", { name: "Skip Station st-2 in scan" }));

      fireEvent.click(screen.getByRole("button", { name: "scan all stations" }));
      for (let hop = 0; hop < 4; hop++) {
        act(() => { vi.advanceTimersByTime(7000); });
      }
      const slugs = mockPreview.mock.calls.map((c) => c[0].slug);
      // Wraps within the included stations only — st-2 never sampled.
      expect(slugs).toEqual(["st-1", "st-3", "st-4", "st-1", "st-3"]);
      expect(slugs).not.toContain("st-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("page scan only samples active (non-skipped) rows on the page", () => {
    vi.useFakeTimers();
    try {
      // 5 stations; skipping st-3 moves it below the fold so the active page
      // becomes [st-1, st-2, st-4, st-5] — 4 active rows, all on page 1.
      mockStations.value = Array.from({ length: 5 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      fireEvent.click(screen.getByRole("checkbox", { name: "Skip Station st-3 in scan" }));

      fireEvent.click(screen.getByRole("button", { name: "scan this page" }));
      for (let hop = 0; hop < 4; hop++) {
        act(() => { vi.advanceTimersByTime(7000); });
      }
      const slugs = mockPreview.mock.calls.map((c) => c[0].slug);
      // st-3 is below the fold and is excluded from sampling.
      expect(slugs).toEqual(["st-1", "st-2", "st-4", "st-5", "st-1"]);
      expect(slugs).not.toContain("st-3");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Scan all is disabled-equivalent (no-op) when every station is skipped", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = [makeStation("only-one", null)];
      render(<SplitHome />);

      fireEvent.click(screen.getByRole("checkbox", { name: "Skip Station only-one in scan" }));
      fireEvent.click(screen.getByRole("button", { name: "scan all stations" }));

      // Scan never started: control still reads "Scan all", no preview fired.
      expect(screen.getByRole("button", { name: "scan all stations" }).textContent).toBe("Scan all");
      expect(mockPreview).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(30000); });
      expect(mockPreview).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("toggling a skip stops an active scan (the candidate list changed)", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 4 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      fireEvent.click(screen.getByRole("button", { name: "scan all stations" }));
      expect(screen.getByRole("button", { name: "stop scan all" })).toBeTruthy();

      fireEvent.click(screen.getByRole("checkbox", { name: "Skip Station st-4 in scan" }));
      expect(screen.getByRole("button", { name: "scan all stations" }).textContent).toBe("Scan all");
      const callsBefore = mockPreview.mock.calls.length;
      act(() => { vi.advanceTimersByTime(30000); });
      expect(mockPreview.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Scan all with every station checked behaves identically to before", () => {
    vi.useFakeTimers();
    try {
      mockStations.value = Array.from({ length: 7 }, (_, i) =>
        makeStation(`st-${i + 1}`, null),
      );
      render(<SplitHome />);

      fireEvent.click(screen.getByRole("button", { name: "scan all stations" }));
      for (let hop = 0; hop < 7; hop++) {
        act(() => { vi.advanceTimersByTime(7000); });
      }
      const slugs = mockPreview.mock.calls.map((c) => c[0].slug);
      expect(slugs).toEqual(["st-1", "st-2", "st-3", "st-4", "st-5", "st-6", "st-7", "st-1"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
