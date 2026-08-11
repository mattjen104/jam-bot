// @vitest-environment jsdom
/**
 * Direct component tests for the Dial's extracted lane components:
 *   DialFeedLane — the unified live feed: reason/dj/rest band order, sort
 *                  direction, sampling/active props, ovFor band routing.
 *   Zone2Lane    — ghost "missed" rows: infinite-scroll pagination (renders
 *                  in full without IntersectionObserver), replay navigation.
 *
 * Each lane is tested in isolation with FrontDoorRow mocked so tests don't
 * need the full DialView dependency tree.
 *
 * NOTE: jsdom has no IntersectionObserver, so both lanes take their
 * progressive-enhancement path and render every row (no sentinel). The
 * pagination itself is covered by the observer wiring, exercised in e2e.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

// DialFeedLane renders FrontDoorRow. Mock it to surface key props as data
// attributes so assertions don't depend on the full row rendering.
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

import { DialFeedLane, FEED_INITIAL } from "../src/components/dial/DialFeedLane";
import { Zone2Lane } from "../src/components/dial/Zone2Lane";
import type { DialLaneRow, DialFeedBand } from "../src/components/dial/DialFeedLane";
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

/** Render DialFeedLane with sensible defaults; override what a test needs. */
function renderFeed(overrides: Partial<React.ComponentProps<typeof DialFeedLane>> = {}) {
  return render(
    <DialFeedLane
      reasonRows={[]}
      djRows={[]}
      restRows={[]}
      popSortDesc={true}
      activeSlug={null}
      samplingSlug={null}
      scrubTarget={null}
      displayMode="personal"
      presenceMap={new Map()}
      popMap={new Map()}
      seedsLower={new Set()}
      artworkUrl={null}
      popLineFor={() => null}
      ovFor={() => 0}
      onAddArtist={vi.fn()}
      onTuneIn={vi.fn()}
      onSetExpand={vi.fn()}
      {...overrides}
    />,
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
// DialFeedLane tests
// ---------------------------------------------------------------------------

describe("DialFeedLane — container and row rendering", () => {
  it("renders all rows inside #dial-feed-rows", () => {
    const rows = [makeLaneRow("s0"), makeLaneRow("s1"), makeLaneRow("s2")];
    renderFeed({ reasonRows: rows });

    const container = document.getElementById("dial-feed-rows");
    expect(container).not.toBeNull();
    expect(container!.querySelectorAll(".fdrow")).toHaveLength(3);
  });

  it("renders nothing when all bands are empty", () => {
    const { container } = renderFeed();
    expect(container.firstChild).toBeNull();
  });

  it("renders every live station even with no reason rows (empty-taste state)", () => {
    // First-run user: no crossings at all — the feed still shows all live
    // stations from the dj/rest bands.
    const djRows = [makeLaneRow("dj0", "DJ A")];
    const restRows = Array.from({ length: 4 }, (_, i) => makeLaneRow(`r${i}`));
    renderFeed({ djRows, restRows });

    expect(document.querySelectorAll(".fdrow")).toHaveLength(5);
  });

  it("marks the active station row with data-active=true", () => {
    const rows = [makeLaneRow("alpha"), makeLaneRow("beta"), makeLaneRow("gamma")];
    renderFeed({ reasonRows: rows, activeSlug: "beta" });

    expect(screen.getByTestId("fdrow-alpha").getAttribute("data-active")).toBe("false");
    expect(screen.getByTestId("fdrow-beta").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("fdrow-gamma").getAttribute("data-active")).toBe("false");
  });

  it("marks the active station even when it lives in the rest band", () => {
    renderFeed({
      reasonRows: [makeLaneRow("reason0")],
      restRows: [makeLaneRow("rest0"), makeLaneRow("rest1")],
      activeSlug: "rest1",
    });

    expect(screen.getByTestId("fdrow-rest1").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("fdrow-reason0").getAttribute("data-active")).toBe("false");
  });

  it("marks the sampling station row with data-sampling=true (reason band only)", () => {
    const rows = [makeLaneRow("x"), makeLaneRow("y"), makeLaneRow("z")];
    renderFeed({ reasonRows: rows, restRows: [makeLaneRow("rest0")], samplingSlug: "y" });

    expect(screen.getByTestId("fdrow-x").getAttribute("data-sampling")).toBe("false");
    expect(screen.getByTestId("fdrow-y").getAttribute("data-sampling")).toBe("true");
    expect(screen.getByTestId("fdrow-z").getAttribute("data-sampling")).toBe("false");
    // dj/rest rows never sample.
    expect(screen.getByTestId("fdrow-rest0").getAttribute("data-sampling")).toBe("false");
  });

  it("passes band-aware ovFor result as ov to each row", () => {
    const ovFor = vi.fn((row: DialLaneRow, band: DialFeedBand) =>
      band === "reason" ? 7 : band === "dj" ? 10 : 5,
    );
    renderFeed({
      reasonRows: [makeLaneRow("p")],
      djRows: [makeLaneRow("dj0", "DJ")],
      restRows: [makeLaneRow("rest0")],
      ovFor,
    });

    expect(screen.getByTestId("fdrow-p").getAttribute("data-ov")).toBe("7");
    expect(screen.getByTestId("fdrow-dj0").getAttribute("data-ov")).toBe("10");
    expect(screen.getByTestId("fdrow-rest0").getAttribute("data-ov")).toBe("5");
  });

  it("tags each row wrapper with its band via data-feed-band", () => {
    renderFeed({
      reasonRows: [makeLaneRow("a")],
      djRows: [makeLaneRow("b", "DJ")],
      restRows: [makeLaneRow("c")],
    });

    expect(screen.getByTestId("fdrow-a").closest("[data-feed-band]")!.getAttribute("data-feed-band")).toBe("reason");
    expect(screen.getByTestId("fdrow-b").closest("[data-feed-band]")!.getAttribute("data-feed-band")).toBe("dj");
    expect(screen.getByTestId("fdrow-c").closest("[data-feed-band]")!.getAttribute("data-feed-band")).toBe("rest");
  });

  it("calls onTuneIn with the clicked row from any band", () => {
    const onTuneIn = vi.fn();
    const rest = makeLaneRow("rest0");
    renderFeed({ reasonRows: [makeLaneRow("a")], restRows: [rest], onTuneIn });

    fireEvent.click(screen.getByTestId("fdrow-rest0"));
    expect(onTuneIn).toHaveBeenCalledWith(rest);
  });
});

describe("DialFeedLane — band order follows the sort triangle", () => {
  const reasonRows = [makeLaneRow("reason-0"), makeLaneRow("reason-1")];
  const djRows = [makeLaneRow("dj-alpha", "DJ Alpha"), makeLaneRow("dj-beta", "DJ Beta")];
  const restRows = [makeLaneRow("rest-0"), makeLaneRow("rest-1")];

  it("▲ sort (popSortDesc=true): reason → dj → rest", () => {
    renderFeed({ reasonRows, djRows, restRows, popSortDesc: true });

    const rows = document.querySelectorAll(".fdrow");
    expect(rows).toHaveLength(6);
    expect(rows[0]!.getAttribute("data-testid")).toBe("fdrow-reason-0");
    expect(rows[1]!.getAttribute("data-testid")).toBe("fdrow-reason-1");
    expect(rows[2]!.getAttribute("data-testid")).toBe("fdrow-dj-alpha");
    expect(rows[3]!.getAttribute("data-testid")).toBe("fdrow-dj-beta");
    expect(rows[4]!.getAttribute("data-testid")).toBe("fdrow-rest-0");
    expect(rows[5]!.getAttribute("data-testid")).toBe("fdrow-rest-1");
  });

  it("▼ sort (popSortDesc=false): rest → dj → reason", () => {
    renderFeed({ reasonRows, djRows, restRows, popSortDesc: false });

    const rows = document.querySelectorAll(".fdrow");
    expect(rows).toHaveLength(6);
    expect(rows[0]!.getAttribute("data-testid")).toBe("fdrow-rest-0");
    expect(rows[1]!.getAttribute("data-testid")).toBe("fdrow-rest-1");
    expect(rows[2]!.getAttribute("data-testid")).toBe("fdrow-dj-alpha");
    expect(rows[3]!.getAttribute("data-testid")).toBe("fdrow-dj-beta");
    expect(rows[4]!.getAttribute("data-testid")).toBe("fdrow-reason-0");
    expect(rows[5]!.getAttribute("data-testid")).toBe("fdrow-reason-1");
  });
});

describe("DialFeedLane — infinite scroll fallback (no IntersectionObserver)", () => {
  it("renders every row past FEED_INITIAL when IntersectionObserver is absent", () => {
    // jsdom has no IntersectionObserver → progressive-enhancement path shows all.
    const many = Array.from({ length: FEED_INITIAL + 8 }, (_, i) => makeLaneRow(`s${i}`));
    renderFeed({ reasonRows: many });

    expect(document.querySelectorAll(".fdrow")).toHaveLength(FEED_INITIAL + 8);
    // No sentinel, no See-all/See-less toggles.
    expect(document.querySelector(".dial-feed-sentinel")).toBeNull();
    expect(screen.queryByRole("button", { name: /^See all/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "See less" })).toBeNull();
  });

  it("paginates at FEED_INITIAL and renders a sentinel when IntersectionObserver exists", () => {
    // Minimal IO stub: never fires, just records observe/disconnect.
    const observed: Element[] = [];
    class FakeIO {
      constructor(_cb: IntersectionObserverCallback) {}
      observe(el: Element) { observed.push(el); }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    vi.stubGlobal("IntersectionObserver", FakeIO as unknown as typeof IntersectionObserver);
    try {
      const many = Array.from({ length: FEED_INITIAL + 8 }, (_, i) => makeLaneRow(`s${i}`));
      renderFeed({ reasonRows: many });

      expect(document.querySelectorAll(".fdrow")).toHaveLength(FEED_INITIAL);
      const sentinel = document.querySelector(".dial-feed-sentinel");
      expect(sentinel).not.toBeNull();
      expect(observed).toContain(sentinel);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reveals the next page when the sentinel intersects", () => {
    let trigger: (() => void) | null = null;
    class FakeIO {
      private cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        trigger = () => this.cb(
          [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    vi.stubGlobal("IntersectionObserver", FakeIO as unknown as typeof IntersectionObserver);
    try {
      const many = Array.from({ length: FEED_INITIAL + 5 }, (_, i) => makeLaneRow(`s${i}`));
      renderFeed({ reasonRows: many });

      expect(document.querySelectorAll(".fdrow")).toHaveLength(FEED_INITIAL);
      // Simulate the sentinel scrolling into view.
      expect(trigger).not.toBeNull();
      act(() => { trigger!(); });

      expect(document.querySelectorAll(".fdrow")).toHaveLength(FEED_INITIAL + 5);
      // Fully revealed — sentinel gone.
      expect(document.querySelector(".dial-feed-sentinel")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// Zone2Lane tests
// ---------------------------------------------------------------------------

describe("Zone2Lane — ghost rows with infinite scroll", () => {
  it("renders nothing when ghost list is empty", () => {
    const { container } = render(
      <Zone2Lane ghost={[]} activeSlug={null} onTuneGhost={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders all rows without IntersectionObserver (jsdom fallback)", () => {
    const ghost = Array.from({ length: 9 }, (_, i) => makeGhostStation(`g${i}`));
    render(<Zone2Lane ghost={ghost} activeSlug={null} onTuneGhost={vi.fn()} />);

    expect(document.querySelectorAll(".ghost-row")).toHaveLength(9);
    // No See-all / See-less toggles anywhere.
    expect(screen.queryByRole("button", { name: /^See all/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "See less" })).toBeNull();
  });

  it("uses container id 'zone2-rows'", () => {
    render(
      <Zone2Lane ghost={[makeGhostStation("g0")]} activeSlug={null} onTuneGhost={vi.fn()} />,
    );

    expect(document.getElementById("zone2-rows")).not.toBeNull();
  });

  it("marks the active ghost row with ghost-row--playing class", () => {
    const ghost = [makeGhostStation("active-station"), makeGhostStation("other-station")];
    render(<Zone2Lane ghost={ghost} activeSlug="active-station" onTuneGhost={vi.fn()} />);

    const rows = document.querySelectorAll(".ghost-row");
    expect(rows[0]!.classList.contains("ghost-row--playing")).toBe(true);
    expect(rows[1]!.classList.contains("ghost-row--playing")).toBe(false);
  });

  it("calls onTuneGhost when a ghost row without a runId is clicked", () => {
    const onTune = vi.fn();
    const ghost = [makeGhostStation("tune-me", { runId: null })];
    render(<Zone2Lane ghost={ghost} activeSlug={null} onTuneGhost={onTune} />);

    fireEvent.click(document.querySelector(".ghost-row")!);
    expect(onTune).toHaveBeenCalledWith(ghost[0]);
  });

  it("renders the show name when a ghost row carries a runId", () => {
    const ghost = [makeGhostStation("replay-me", { runId: 42, showName: "Afternoon Jazz" })];
    render(<Zone2Lane ghost={ghost} activeSlug={null} onTuneGhost={vi.fn()} />);

    // The row renders the show name + artist name when runId is set
    expect(document.querySelector(".ghost-row__show")?.textContent).toBe("Afternoon Jazz");
  });
});
