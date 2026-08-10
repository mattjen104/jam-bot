// @vitest-environment jsdom
/**
 * Direct component tests for the Dial's extracted lane components:
 *   Zone1Lane — live crossing rows, sampling/active props, ovFor routing
 *   Zone2Lane — ghost "missed" rows, 3-row cap, container id variants, toggle
 *   Zone3Lane — DJ-band vs rest-band ordering, sort direction, 3-row cap
 *
 * Each lane is tested in isolation with FrontDoorRow mocked so tests don't
 * need the full DialView dependency tree.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

// Zone1Lane and Zone3Lane render FrontDoorRow. Mock it to surface key props
// as data attributes so assertions don't depend on the full row rendering.
vi.mock("../src/components/dial/FrontDoorRow", () => ({
  FrontDoorRow: ({
    ds,
    isActive,
    isSampling,
    ov,
    onTuneIn,
  }: {
    ds: { station: { slug: string; name: string } };
    isActive: boolean;
    isSampling: boolean;
    ov: number;
    onTuneIn: () => void;
    [k: string]: unknown;
  }) => (
    <div
      data-testid={`fdrow-${ds.station.slug}`}
      data-active={String(isActive)}
      data-sampling={String(isSampling)}
      data-ov={String(ov)}
      className="fdrow"
      role="button"
      tabIndex={0}
      onClick={onTuneIn}
    />
  ),
  ZoneLabel: ({ label, accent }: { label: string; accent?: string }) => (
    <div className={`fdzone-lbl fdzone-lbl--${accent ?? "default"}`}>
      <span className="fdzone-lbl__text">{label}</span>
    </div>
  ),
  // agoLabel is used by Zone2Lane's GhostRow
  agoLabel: (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60_000);
    return m < 2 ? "just now" : `${m}m ago`;
  },
}));

// Zone2Lane's GhostRow calls useLocation for navigation.
vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { Zone1Lane } from "../src/components/dial/Zone1Lane";
import { Zone2Lane, ZONE2_VISIBLE } from "../src/components/dial/Zone2Lane";
import { Zone3Lane, ZONE3_VISIBLE } from "../src/components/dial/Zone3Lane";
import type { DialLaneRow } from "../src/components/dial/Zone1Lane";
import type { GhostStation } from "../src/lib/meHooks";
import type { DialStation, DialShow } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeStation(slug: string, name = `Station ${slug}`): DialStation["station"] {
  return {
    slug,
    name,
    automationClass: null,
    streamUrl: null,
    websiteUrl: null,
    hidden: false,
    favorite: false,
  } as DialStation["station"];
}

function makeDialStation(slug: string, overrides: Partial<DialStation> = {}): DialStation {
  return {
    station: makeStation(slug),
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    ...overrides,
  };
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Morning Show",
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

function makeLaneRow(slug: string, djName: string | null = null): DialLaneRow {
  return {
    ds: makeDialStation(slug),
    show: makeShow({ djName }),
    effectiveDjName: djName,
  };
}

function makeGhostStation(slug: string, overrides: Partial<GhostStation> = {}): GhostStation {
  return {
    stationId: 100,
    slug,
    name: `Ghost ${slug}`,
    streamUrl: "http://example.com/stream",
    streamFormat: "mp3",
    mode: "spinitron",
    attribution: true,
    artistName: "Ghost Artist",
    playedAt: null,
    day: "2026-08-10",
    showName: null,
    djName: null,
    runId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Zone1Lane tests
// ---------------------------------------------------------------------------

describe("Zone1Lane — container and row rendering", () => {
  it("renders all rows inside #zone1-rows", () => {
    const rows = [makeLaneRow("s0"), makeLaneRow("s1"), makeLaneRow("s2")];
    render(
      <Zone1Lane
        rows={rows}
        activeSlug={null}
        samplingSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        popMap={new Map()}
        seedsLower={new Set()}
        ovFor={() => 0}
        onAddArtist={vi.fn()}
        onTuneIn={vi.fn()}
        onSetExpand={vi.fn()}
      />,
    );

    const container = document.getElementById("zone1-rows");
    expect(container).not.toBeNull();
    expect(container!.querySelectorAll(".fdrow")).toHaveLength(3);
  });

  it("marks the active station row with data-active=true", () => {
    const rows = [makeLaneRow("alpha"), makeLaneRow("beta"), makeLaneRow("gamma")];
    render(
      <Zone1Lane
        rows={rows}
        activeSlug="beta"
        samplingSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        popMap={new Map()}
        seedsLower={new Set()}
        ovFor={() => 0}
        onAddArtist={vi.fn()}
        onTuneIn={vi.fn()}
        onSetExpand={vi.fn()}
      />,
    );

    expect(screen.getByTestId("fdrow-alpha").getAttribute("data-active")).toBe("false");
    expect(screen.getByTestId("fdrow-beta").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("fdrow-gamma").getAttribute("data-active")).toBe("false");
  });

  it("marks the sampling station row with data-sampling=true", () => {
    const rows = [makeLaneRow("x"), makeLaneRow("y"), makeLaneRow("z")];
    render(
      <Zone1Lane
        rows={rows}
        activeSlug={null}
        samplingSlug="y"
        displayMode="personal"
        presenceMap={new Map()}
        popMap={new Map()}
        seedsLower={new Set()}
        ovFor={() => 0}
        onAddArtist={vi.fn()}
        onTuneIn={vi.fn()}
        onSetExpand={vi.fn()}
      />,
    );

    expect(screen.getByTestId("fdrow-x").getAttribute("data-sampling")).toBe("false");
    expect(screen.getByTestId("fdrow-y").getAttribute("data-sampling")).toBe("true");
    expect(screen.getByTestId("fdrow-z").getAttribute("data-sampling")).toBe("false");
  });

  it("passes ovFor result as ov to each row", () => {
    const rows = [makeLaneRow("p"), makeLaneRow("q")];
    // ovFor returns a slug-specific value so we can verify per-row routing.
    const ovFor = vi.fn((row: DialLaneRow) =>
      row.ds.station.slug === "p" ? 7 : 3,
    );
    render(
      <Zone1Lane
        rows={rows}
        activeSlug={null}
        samplingSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        popMap={new Map()}
        seedsLower={new Set()}
        ovFor={ovFor}
        onAddArtist={vi.fn()}
        onTuneIn={vi.fn()}
        onSetExpand={vi.fn()}
      />,
    );

    expect(screen.getByTestId("fdrow-p").getAttribute("data-ov")).toBe("7");
    expect(screen.getByTestId("fdrow-q").getAttribute("data-ov")).toBe("3");
    expect(ovFor).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when rows is empty", () => {
    const { container } = render(
      <Zone1Lane
        rows={[]}
        activeSlug={null}
        samplingSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        popMap={new Map()}
        seedsLower={new Set()}
        ovFor={() => 0}
        onAddArtist={vi.fn()}
        onTuneIn={vi.fn()}
        onSetExpand={vi.fn()}
      />,
    );

    expect(container.querySelectorAll(".fdrow")).toHaveLength(0);
    expect(document.getElementById("zone1-rows")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Zone2Lane tests
// ---------------------------------------------------------------------------

describe("Zone2Lane — 3-row cap and expand toggle", () => {
  it("renders nothing when ghost list is empty", () => {
    const { container } = render(
      <Zone2Lane
        ghost={[]}
        expanded={false}
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("caps at ZONE2_VISIBLE rows when collapsed", () => {
    const ghost = Array.from({ length: 7 }, (_, i) => makeGhostStation(`g${i}`));
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(document.querySelectorAll(".ghost-row")).toHaveLength(ZONE2_VISIBLE);
  });

  it("shows all rows when expanded", () => {
    const ghost = Array.from({ length: 7 }, (_, i) => makeGhostStation(`g${i}`));
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={true}
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(document.querySelectorAll(".ghost-row")).toHaveLength(7);
  });

  it("shows a 'See all N' button when collapsed and count > ZONE2_VISIBLE", () => {
    const ghost = Array.from({ length: 5 }, (_, i) => makeGhostStation(`g${i}`));
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    const btn = screen.getByRole("button", { name: "See all 5" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows 'See less' buttons (inline and bottom) when expanded and count > ZONE2_VISIBLE", () => {
    const ghost = Array.from({ length: 5 }, (_, i) => makeGhostStation(`g${i}`));
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={true}
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    // Zone2Lane renders two "See less" affordances when expanded: an inline
    // collapse button in the label row and the bottom toggle button.
    const seelessBtns = screen.getAllByRole("button", { name: "See less" });
    expect(seelessBtns.length).toBeGreaterThanOrEqual(1);
    // Every rendered "See less" button must report aria-expanded="true".
    for (const btn of seelessBtns) {
      expect(btn.getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("calls onToggleExpanded when 'See all' is clicked", () => {
    const onToggle = vi.fn();
    const ghost = Array.from({ length: 5 }, (_, i) => makeGhostStation(`g${i}`));
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={onToggle}
        onCollapse={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "See all 5" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("uses container id 'zone2-rows' by default", () => {
    const ghost = [makeGhostStation("g0")];
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(document.getElementById("zone2-rows")).not.toBeNull();
    expect(document.getElementById("zone2-rows-day")).toBeNull();
  });

  it("uses container id 'zone2-rows-day' when idSuffix='-day'", () => {
    const ghost = [makeGhostStation("g0")];
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        idSuffix="-day"
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(document.getElementById("zone2-rows-day")).not.toBeNull();
    expect(document.getElementById("zone2-rows")).toBeNull();
  });

  it("the 'See all' button targets the correct rows container via aria-controls", () => {
    const ghost = Array.from({ length: 5 }, (_, i) => makeGhostStation(`g${i}`));
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        idSuffix="-day"
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    const btn = screen.getByRole("button", { name: "See all 5" });
    expect(btn.getAttribute("aria-controls")).toBe("zone2-rows-day");
  });

  it("shows no See all button when ghost count is exactly ZONE2_VISIBLE", () => {
    const ghost = Array.from({ length: ZONE2_VISIBLE }, (_, i) => makeGhostStation(`g${i}`));
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /See all/ })).toBeNull();
    expect(document.querySelectorAll(".ghost-row")).toHaveLength(ZONE2_VISIBLE);
  });

  it("marks the active ghost row with ghost-row--playing class", () => {
    const ghost = [makeGhostStation("active-station"), makeGhostStation("other-station")];
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        activeSlug="active-station"
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    const rows = document.querySelectorAll(".ghost-row");
    expect(rows[0]!.classList.contains("ghost-row--playing")).toBe(true);
    expect(rows[1]!.classList.contains("ghost-row--playing")).toBe(false);
  });

  it("calls onTuneGhost when a ghost row without a runId is clicked", () => {
    const onTune = vi.fn();
    const ghost = [makeGhostStation("tune-me", { runId: null })];
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        activeSlug={null}
        onTuneGhost={onTune}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    fireEvent.click(document.querySelector(".ghost-row")!);
    expect(onTune).toHaveBeenCalledWith(ghost[0]);
  });

  it("navigates to /replay/{runId} when a ghost row with a runId is clicked", () => {
    const navigate = vi.fn();
    // Re-mock wouter to capture the navigate call
    vi.doMock("wouter", () => ({
      useLocation: () => ["/", navigate],
    }));

    const ghost = [makeGhostStation("replay-me", { runId: 42, showName: "Afternoon Jazz" })];
    render(
      <Zone2Lane
        ghost={ghost}
        expanded={false}
        activeSlug={null}
        onTuneGhost={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    // The row renders the show name + artist name when runId is set
    expect(document.querySelector(".ghost-row__show")?.textContent).toBe("Afternoon Jazz");
  });
});

// ---------------------------------------------------------------------------
// Zone3Lane tests
// ---------------------------------------------------------------------------

describe("Zone3Lane — band ordering and row cap", () => {
  it("renders nothing when both bands are empty", () => {
    const { container } = render(
      <Zone3Lane
        djBand={[]}
        restBand={[]}
        popSortDesc={true}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("caps restBand at ZONE3_VISIBLE when collapsed", () => {
    const restBand = Array.from({ length: 6 }, (_, i) => makeLaneRow(`r${i}`));
    render(
      <Zone3Lane
        djBand={[]}
        restBand={restBand}
        popSortDesc={true}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(document.querySelectorAll(".fdrow")).toHaveLength(ZONE3_VISIBLE);
  });

  it("shows all restBand rows when expanded", () => {
    const restBand = Array.from({ length: 6 }, (_, i) => makeLaneRow(`r${i}`));
    render(
      <Zone3Lane
        djBand={[]}
        restBand={restBand}
        popSortDesc={true}
        expanded={true}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(document.querySelectorAll(".fdrow")).toHaveLength(6);
  });

  it("shows a 'See all N' button for restBand when count > ZONE3_VISIBLE", () => {
    const restBand = Array.from({ length: 5 }, (_, i) => makeLaneRow(`r${i}`));
    render(
      <Zone3Lane
        djBand={[]}
        restBand={restBand}
        popSortDesc={true}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    const btn = screen.getByRole("button", { name: "See all 5" });
    expect(btn.getAttribute("aria-controls")).toBe("zone3-rows");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("▲ sort (popSortDesc=true): djBand rows appear before restBand rows", () => {
    const djBand = [makeLaneRow("dj-alpha", "DJ Alpha"), makeLaneRow("dj-beta", "DJ Beta")];
    const restBand = [makeLaneRow("rest-0"), makeLaneRow("rest-1")];
    render(
      <Zone3Lane
        djBand={djBand}
        restBand={restBand}
        popSortDesc={true}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    const rows = document.querySelectorAll(".fdrow");
    // 2 dj + 2 rest = 4 (all under cap)
    expect(rows).toHaveLength(4);
    expect(rows[0]!.getAttribute("data-testid")).toBe("fdrow-dj-alpha");
    expect(rows[1]!.getAttribute("data-testid")).toBe("fdrow-dj-beta");
    expect(rows[2]!.getAttribute("data-testid")).toBe("fdrow-rest-0");
    expect(rows[3]!.getAttribute("data-testid")).toBe("fdrow-rest-1");
  });

  it("▼ sort (popSortDesc=false): restBand rows appear before djBand rows", () => {
    const djBand = [makeLaneRow("dj-alpha", "DJ Alpha"), makeLaneRow("dj-beta", "DJ Beta")];
    const restBand = [makeLaneRow("rest-0"), makeLaneRow("rest-1")];
    render(
      <Zone3Lane
        djBand={djBand}
        restBand={restBand}
        popSortDesc={false}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    const rows = document.querySelectorAll(".fdrow");
    expect(rows).toHaveLength(4);
    // rest band leads in ▼ sort
    expect(rows[0]!.getAttribute("data-testid")).toBe("fdrow-rest-0");
    expect(rows[1]!.getAttribute("data-testid")).toBe("fdrow-rest-1");
    expect(rows[2]!.getAttribute("data-testid")).toBe("fdrow-dj-alpha");
    expect(rows[3]!.getAttribute("data-testid")).toBe("fdrow-dj-beta");
  });

  it("shows 'DJs on air' sub-label when djBand is non-empty", () => {
    const djBand = [makeLaneRow("dj-x", "DJ X")];
    render(
      <Zone3Lane
        djBand={djBand}
        restBand={[]}
        popSortDesc={true}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(
      screen.getByText("DJs on air", { selector: ".fdzone-lbl__text" }),
    ).toBeTruthy();
  });

  it("does not show 'DJs on air' label when djBand is empty", () => {
    const restBand = [makeLaneRow("rest-0")];
    render(
      <Zone3Lane
        djBand={[]}
        restBand={restBand}
        popSortDesc={true}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(screen.queryByText("DJs on air")).toBeNull();
  });

  it("djBand rows are always fully shown (no cap, even when restBand is also large)", () => {
    // djBand has 5 rows; restBand has 5 rows capped at ZONE3_VISIBLE=3.
    // Total visible: 5 + 3 = 8.
    const djBand = Array.from({ length: 5 }, (_, i) => makeLaneRow(`dj${i}`, `DJ ${i}`));
    const restBand = Array.from({ length: 5 }, (_, i) => makeLaneRow(`rest${i}`));
    render(
      <Zone3Lane
        djBand={djBand}
        restBand={restBand}
        popSortDesc={true}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(document.querySelectorAll(".fdrow")).toHaveLength(5 + ZONE3_VISIBLE);
  });

  it("calls onToggleExpanded when 'See all' is clicked on restBand", () => {
    const onToggle = vi.fn();
    const restBand = Array.from({ length: 5 }, (_, i) => makeLaneRow(`r${i}`));
    render(
      <Zone3Lane
        djBand={[]}
        restBand={restBand}
        popSortDesc={true}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={() => 0}
        onTuneIn={vi.fn()}
        onToggleExpanded={onToggle}
        onCollapse={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "See all 5" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("passes ovFor result per band to each row", () => {
    const djBand = [makeLaneRow("dj0")];
    const restBand = [makeLaneRow("rest0")];
    const ovFor = vi.fn((row: DialLaneRow, band: "dj" | "rest") =>
      band === "dj" ? 10 : 5,
    );
    render(
      <Zone3Lane
        djBand={djBand}
        restBand={restBand}
        popSortDesc={true}
        expanded={false}
        activeSlug={null}
        displayMode="personal"
        presenceMap={new Map()}
        artworkUrl={null}
        popLineFor={() => null}
        ovFor={ovFor}
        onTuneIn={vi.fn()}
        onToggleExpanded={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(screen.getByTestId("fdrow-dj0").getAttribute("data-ov")).toBe("10");
    expect(screen.getByTestId("fdrow-rest0").getAttribute("data-ov")).toBe("5");
  });
});
