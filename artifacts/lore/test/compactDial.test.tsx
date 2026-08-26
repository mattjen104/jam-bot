// @vitest-environment jsdom
/**
 * CompactDial — the homepage mini Dial band.
 *
 * Covers play controls (Task 216):
 *  - ▶ button appears for playable stations (streamUrl or relayUrl present)
 *  - ▶ button is hidden for attribution-only stations (no stream source)
 *  - clicking ▶ calls onPlay and does NOT call onTuneIn
 *  - when activeSlug matches and playerStatus === "playing", shows ⏸
 *  - when activeSlug matches and playerStatus === "loading", shows muted ▶
 *  - empty state renders the "No stations to show right now." message
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { CompactDial, type CompactDialProps } from "../src/components/CompactDial";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";
import type { Station } from "@workspace/api-client-react";
import type { DialShow, DialSpin, DialStation } from "../src/hooks/useDialData";
import { specialistSubcategoryForStation } from "../src/lib/specialistCategories";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// FrontDoorRow is a complex dependency — render a minimal stub that emits the
// station slug so we can confirm it's present without pulling in the full dial.
vi.mock("../src/components/dial/FrontDoorRow", () => ({
  FrontDoorRow: ({ ds }: { ds: DialStation }) => (
    <div data-testid={`fdrow-${ds.station.slug}`}>{ds.station.name}</div>
  ),
}));

const startReplay = vi.fn();
vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({ ride: { startReplay } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: 1,
    slug: "test-station",
    name: "Test Station",
    streamUrl: "https://stream.example.com/live",
    streamFormat: "mp3",
    mode: "lore",
    attribution: false,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    stationCategories: [],
    ...overrides,
  };
}

function makeDialStation(overrides: Partial<DialStation> = {}): DialStation {
  return {
    station: makeStation(),
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    firstPlayCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    weekFirstPlayCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    monthFirstPlayCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    lifetimeFirstPlayCrossings: 0,
    topArtistNames: [],
    ...overrides,
  };
}

function makeRow(stationOverrides: Partial<Station> = {}): DialLaneRow {
  return {
    ds: makeDialStation({ station: makeStation(stationOverrides) }),
    show: null,
    effectiveDjName: null,
  };
}

function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    title: "Some Track",
    artist: "Some Artist",
    playedAt: "2026-08-18T00:00:00Z",
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    releaseYear: null,
    ageTier: null,
    ...overrides,
  };
}

function makeShow(currentTrack: DialSpin | null): DialShow {
  return {
    runId: 1,
    showName: "Some Show",
    djName: null,
    startedAt: "2026-08-18T00:00:00Z",
    endedAt: "2026-08-18T01:00:00Z",
    ianaTimezone: null,
    state: "live",
    spins: [],
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack,
    isPickerShow: false,
    pickerId: null,
  };
}

/**
 * A row with a now-playing artist — via the live pulse (default) or via the
 * live show's last spin (`via: "show"`), the two sources the remote rows
 * read in priority order.
 */
function makeRowWithTrack(
  stationOverrides: Partial<Station>,
  track: Partial<DialSpin>,
  via: "liveTrack" | "show" = "liveTrack",
): DialLaneRow {
  const spin = makeSpin(track);
  return {
    ds: makeDialStation({
      station: makeStation(stationOverrides),
      liveTrack: via === "liveTrack" ? spin : null,
    }),
    show: via === "show" ? makeShow(spin) : null,
    effectiveDjName: null,
  };
}

function renderDial(props: Partial<CompactDialProps> = {}) {
  const defaults: CompactDialProps = {
    activeRows: [],
    skippedRows: [],
    activeSlug: null,
    playerStatus: "idle",
    presenceMap: new Map(),
    onTuneIn: vi.fn(),
    onPlay: vi.fn(),
  };
  return render(<CompactDial {...defaults} {...props} />);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("CompactDial empty state", () => {
  it("shows the no-stations message when rows is empty", () => {
    renderDial({ activeRows: [], skippedRows: [] });
    screen.getByText("No stations to show right now.");
  });
});

// ---------------------------------------------------------------------------
// Category-first home Feed
// ---------------------------------------------------------------------------

describe("CompactDial category tabs", () => {
  it("uses the stable specialist taxonomy, including named edge cases and a visible fallback", () => {
    expect(specialistSubcategoryForStation(makeStation({ name: "FIP Groove" }))).toBe("groove");
    expect(specialistSubcategoryForStation(makeStation({ name: "t67-4fdb1912 Jazz FM" }))).toBe("jazz");
    expect(specialistSubcategoryForStation(makeStation({ name: "Unclassifiable Signal" }))).toBe("other");
  });

  it("renders the tab strip in a fixed order: All, then the seven short category labels", () => {
    const row = makeRow({ slug: "kexp", name: "KEXP", stationCategories: ["anchor"] });
    renderDial({ activeRows: [row], categoryFirst: true });

    const strip = screen.getByRole("tablist", { name: "Station categories" });
    const tabs = within(strip).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "All",
      "Anchor",
      "Campus",
      "Specialist",
      "Public",
      "Indie",
      "Ambient",
      "Discovery",
    ]);
    // The All overview is selected initially.
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Anchor" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby"))
      .toBe("compact-category-tab-all");
  });

  it("shows one flattened All feed containing only checked-category stations", () => {
    const categories = ["ambient", "campus", "specialist", "anchor", "public", "indie", "discovery"] as const;
    const rows = categories.map((category) => makeRow({
      slug: `${category}-station`,
      name: `${category} station`,
      stationCategories: [category],
    }));

    renderDial({
      activeRows: rows,
      categoryFirst: true,
      activeCategories: new Set(["anchor", "campus", "specialist", "public", "indie"]),
      onToggleCategory: vi.fn(),
    });

    const feed = screen.getByTestId("compact-category-all-feed");
    expect(feed.querySelectorAll(".compact-category-dial__station")).toHaveLength(5);
    expect(feed.querySelector(".compact-category-dial__station-strip")).toBeNull();
    expect(feed.querySelector(".compact-category-dial__group")).toBeNull();
    expect(screen.getByTestId("compact-category-station-anchor-station")).toBeTruthy();
    expect(screen.queryByTestId("compact-category-station-ambient-station")).toBeNull();
    expect(screen.queryByTestId("compact-category-station-discovery-station")).toBeNull();
    const ambientTab = screen.getByTestId("compact-category-tab-ambient");
    expect(
      ambientTab.closest(".compact-category-dial__tab")
        ?.classList.contains("compact-category-dial__tab--excluded"),
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Include Ambient" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole("checkbox", { name: "Include Anchor" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("shows only the artist beside every All-feed station mark", () => {
    const station = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    renderDial({ activeRows: [station], categoryFirst: true });

    const card = screen.getByTestId("compact-category-station-kexp");
    expect(card.querySelector(".compact-category-dial__station-name")).toBeNull();
    expect(card.querySelector(".compact-category-dial__station-track")?.textContent)
      .toBe("The Smile");
  });

  it("unchecking a category tab removes its stations from All while keeping the tab available", () => {
    const anchor = makeRow({ slug: "kexp", name: "KEXP", stationCategories: ["anchor"] });
    const campus = makeRow({ slug: "wvum", name: "WVUM", stationCategories: ["campus"] });
    const onToggleCategory = vi.fn();
    const { rerender } = renderDial({
      activeRows: [anchor, campus],
      categoryFirst: true,
      activeCategories: new Set(["anchor", "campus"]),
      onToggleCategory,
    });

    expect(screen.getByTestId("compact-category-station-wvum")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Campus" }));
    expect(onToggleCategory).toHaveBeenCalledWith("campus");

    // The parent removes the category from the checked set…
    rerender(
      <CompactDial
        activeRows={[anchor, campus]}
        skippedRows={[]}
        activeSlug={null}
        playerStatus="idle"
        presenceMap={new Map()}
        onTuneIn={vi.fn()}
        onPlay={vi.fn()}
        categoryFirst
        activeCategories={new Set(["anchor"])}
        onToggleCategory={onToggleCategory}
      />,
    );
    // …its station leaves All, but the tab stays to re-enable it.
    expect(screen.queryByTestId("compact-category-station-wvum")).toBeNull();
    expect(screen.getByTestId("compact-category-tab-campus")).toBeTruthy();
  });

  it("clicking an unchecked tab re-includes the category and focuses it", () => {
    const ambient = makeRowWithTrack(
      { slug: "sleep", name: "Sleep Radio", stationCategories: ["ambient"] },
      { artist: "Brian Eno", title: "An Ending" },
    );
    const onToggleCategory = vi.fn();
    renderDial({
      activeRows: [ambient],
      categoryFirst: true,
      activeCategories: new Set(["anchor"]),
      onToggleCategory,
    });

    fireEvent.click(screen.getByTestId("compact-category-tab-ambient"));
    expect(onToggleCategory).toHaveBeenCalledWith("ambient");
    expect(screen.getByTestId("compact-category-ambient-now-feed")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Ambient" }).getAttribute("aria-selected")).toBe("true");
  });

  it("clicking a checked category tab focuses the feed on only that category's stations", () => {
    const anchor = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    const campus = makeRowWithTrack(
      { slug: "wvum", name: "WVUM", stationCategories: ["campus"] },
      { artist: "Floating Points", title: "Bias" },
    );
    renderDial({ activeRows: [anchor, campus], categoryFirst: true });

    fireEvent.click(screen.getByTestId("compact-category-tab-campus"));
    expect(screen.getByTestId("compact-category-campus-now-feed")).toBeTruthy();
    expect(screen.queryByTestId("compact-category-anchor-now-feed")).toBeNull();
    // The global All feed is swapped for the single focused station list.
    expect(screen.queryByTestId("compact-category-all-feed")).toBeNull();
    expect(screen.getByRole("tab", { name: "Campus" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby"))
      .toBe("compact-category-tab-campus");

    // Selecting All returns to the flattened live feed.
    fireEvent.click(screen.getByTestId("compact-category-tab-all"));
    expect(screen.getByTestId("compact-category-all-feed")).toBeTruthy();
    expect(screen.queryByTestId("compact-category-campus-now-feed")).toBeNull();
  });

  it("keeps All as stations only; category tabs are the drill-down controls", () => {
    const anchor = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    renderDial({ activeRows: [anchor], categoryFirst: true });

    expect(screen.queryByRole("button", { name: "Open Anchor stations" })).toBeNull();
    fireEvent.click(screen.getByTestId("compact-category-tab-anchor"));
    expect(screen.getByTestId("compact-category-anchor-now-feed")).toBeTruthy();
    screen.getByRole("button", { name: "The Smile — Bending Hectic · KEXP — tune in" });
  });

  it("unchecking the focused category returns to the All overview", () => {
    const anchor = makeRow({ slug: "kexp", name: "KEXP", stationCategories: ["anchor"] });
    const onToggleCategory = vi.fn();
    renderDial({
      activeRows: [anchor],
      categoryFirst: true,
      activeCategories: new Set(["anchor"]),
      onToggleCategory,
    });

    fireEvent.click(screen.getByTestId("compact-category-tab-anchor"));
    expect(screen.getByTestId("compact-category-anchor-now-feed")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Anchor" }));
    expect(onToggleCategory).toHaveBeenCalledWith("anchor");
    // Focus falls back to All even before the parent applies the change.
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("compact-category-anchor-now-feed")).toBeNull();
  });

  it("orders the flattened All feed freshest-first with quiet stations last, and hides metric chrome", () => {
    const stale = makeRowWithTrack(
      { slug: "old", name: "Old Station", stationCategories: ["anchor"] },
      { artist: "Alpha Old", title: "Earlier", playedAt: "2026-08-18T01:00:00Z" },
    );
    const fresh = makeRowWithTrack(
      { slug: "new", name: "New Station", stationCategories: ["anchor"] },
      { artist: "Zed Fresh", title: "Just Now", playedAt: "2026-08-18T02:00:00Z" },
    );
    const quiet = makeRow({ slug: "quiet", name: "Quiet Station", stationCategories: ["anchor"] });
    quiet.ds.isLive = false;
    stale.ds.crossings = 9;
    stale.ds.firstPlayCrossings = 4;
    const { container } = renderDial({
      activeRows: [stale, fresh, quiet],
      categoryFirst: true,
      crossingScope: "24h",
    });

    // Live now-playing begins in the top-left slot; a station that isn't
    // broadcasting now-playing never takes the first spot.
    const feed = screen.getByTestId("compact-category-all-feed");
    const order = [...feed.querySelectorAll(".compact-category-dial__station")]
      .map((element) => element.getAttribute("data-testid"));
    expect(order).toEqual([
      "compact-category-station-new",
      "compact-category-station-old",
      "compact-category-station-quiet",
    ]);
    // Each station card leads with just the now-playing artist name.
    const firstCard = screen.getByTestId("compact-category-station-new");
    expect(firstCard.querySelector(".compact-category-dial__station-track")?.textContent)
      .toBe("Zed Fresh");
    // Crossings/first-play counts and the age-distribution pie stay hidden.
    expect(container.textContent).not.toContain("crossings");
    expect(container.textContent).not.toContain("first plays");
    expect(container.querySelector(".dial-age-badge")).toBeNull();
    expect(container.querySelector(".compact-category-dial__metrics")).toBeNull();
  });

  it("keeps one global recency sequence across categories for the four-row columns", () => {
    const rows = [
      makeRowWithTrack(
        { slug: "fifth", name: "Fifth", stationCategories: ["indie"] },
        {
          artist: "Fifth Artist",
          title: "Five",
          // REST live rows all share this UI freshness timestamp.
          playedAt: "2026-08-18T06:00:00Z",
          sourcePlayedAt: "2026-08-18T01:00:00Z",
        },
      ),
      makeRowWithTrack(
        { slug: "newest", name: "Newest", stationCategories: ["anchor"] },
        {
          artist: "Newest Artist",
          title: "One",
          playedAt: "2026-08-18T06:00:00Z",
          sourcePlayedAt: "2026-08-18T05:00:00Z",
        },
      ),
      makeRowWithTrack(
        { slug: "third", name: "Third", stationCategories: ["specialist"] },
        {
          artist: "Third Artist",
          title: "Three",
          playedAt: "2026-08-18T06:00:00Z",
          sourcePlayedAt: "2026-08-18T03:00:00Z",
        },
      ),
      makeRowWithTrack(
        { slug: "fourth", name: "Fourth", stationCategories: ["public"] },
        {
          artist: "Fourth Artist",
          title: "Four",
          playedAt: "2026-08-18T06:00:00Z",
          sourcePlayedAt: "2026-08-18T02:00:00Z",
        },
      ),
      makeRowWithTrack(
        { slug: "second", name: "Second", stationCategories: ["campus"] },
        {
          artist: "Second Artist",
          title: "Two",
          playedAt: "2026-08-18T06:00:00Z",
          sourcePlayedAt: "2026-08-18T04:00:00Z",
        },
      ),
    ];
    const { container } = renderDial({
      activeRows: rows,
      categoryFirst: true,
      activeCategories: new Set(["anchor", "campus", "specialist", "public", "indie"]),
    });

    const feed = screen.getByTestId("compact-category-all-feed");
    expect([...feed.querySelectorAll(".compact-category-dial__station")].map(
      (station) => station.getAttribute("data-testid"),
    )).toEqual([
      "compact-category-station-newest",
      "compact-category-station-second",
      "compact-category-station-third",
      "compact-category-station-fourth",
      "compact-category-station-fifth",
    ]);
    expect(container.querySelector(".compact-category-dial__all-feed")).toBeTruthy();
  });

  it("makes each station card itself the play control without opening the drill-down", () => {
    const playable = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    const second = makeRowWithTrack(
      { slug: "wfmu", name: "WFMU", stationCategories: ["anchor"] },
      { artist: "Yo La Tengo", title: "Autumn Sweater" },
    );
    const onPlay = vi.fn();
    renderDial({ activeRows: [playable, second], categoryFirst: true, onPlay });

    // There is no separate play button: the whole station card is the control.
    expect(screen.queryByTestId("compact-category-play-anchor")).toBeNull();
    fireEvent.click(screen.getByTestId("compact-category-station-wfmu"));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(second);
    // The card did not open — the All overview is still showing.
    expect(screen.queryByTestId("compact-category-anchor-now-feed")).toBeNull();
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the station card as the play control without an inline play cue", () => {
    const row = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    renderDial({ activeRows: [row], categoryFirst: true });

    const card = screen.getByTestId("compact-category-station-kexp");
    expect(card.getAttribute("aria-label")).toBe("Play KEXP");
    expect(card.querySelector(".compact-category-dial__station-play-cue")).toBeNull();
    expect(card.querySelector(".compact-category-dial__station-track")?.textContent).toBe("The Smile");
    expect(card.querySelector(".compact-category-dial__station-name")).toBeNull();
  });

  it("keeps the card layout the same for an attribution-only station", () => {
    const attrOnly = makeRowWithTrack(
      { slug: "attr-only", name: "Attribution Only", streamUrl: "", relayUrl: null, stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    const playable = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Wall of Eyes" },
    );
    renderDial({ activeRows: [attrOnly, playable], categoryFirst: true });

    // The attribution-only station card still shows its artist and identity…
    const card = screen.getByTestId("compact-category-station-attr-only");
    expect(card.querySelector(".compact-category-dial__station-track")?.textContent)
      .toBe("The Smile");
    expect(card.querySelector(".compact-category-dial__station-play-cue")).toBeNull();
    expect(screen.queryByTestId("compact-category-play-attr-only")).toBeNull();
  });

  it("reflects playing and loading states on the card without adding a play cue", () => {
    const row = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    const { rerender } = renderDial({
      activeRows: [row],
      categoryFirst: true,
      activeSlug: "kexp",
      playerStatus: "playing",
    });
    expect(screen.getByRole("button", { name: "Pause KEXP" })
      .querySelector(".compact-category-dial__station-play-cue")).toBeNull();

    rerender(
      <CompactDial
        activeRows={[row]}
        skippedRows={[]}
        activeSlug="kexp"
        playerStatus="loading"
        presenceMap={new Map()}
        onTuneIn={vi.fn()}
        onPlay={vi.fn()}
        categoryFirst
      />,
    );
    const loading = screen.getByRole("button", { name: "Loading KEXP" });
    expect(loading.getAttribute("aria-disabled")).toBe("true");
    expect(loading.querySelector(".compact-category-dial__station-play-cue")).toBeNull();
  });

  it("uses an honest unavailable state on station cards with no live metadata", () => {
    const quiet = makeRow({
      slug: "quiet",
      name: "Quiet Station",
      stationCategories: ["ambient"],
    });
    renderDial({ activeRows: [quiet], categoryFirst: true });

    const station = screen.getByTestId("compact-category-station-quiet");
    expect(station.querySelector(".compact-category-dial__station-track")?.textContent)
      .toBe("Now playing unavailable");
    expect(station.classList.contains("compact-category-dial__station--quiet")).toBe(true);
  });

  it("pulses station cards whose now-playing is fresh, and only those", () => {
    const fresh = makeRowWithTrack(
      { slug: "live-now", name: "Live Now", stationCategories: ["anchor"] },
      { artist: "Current Artist", title: "On Air", playedAt: new Date().toISOString() },
    );
    const stale = makeRowWithTrack(
      { slug: "stale-one", name: "Stale One", stationCategories: ["anchor"] },
      { artist: "Old Artist", title: "Yesterday", playedAt: "2026-08-18T00:00:00Z" },
    );
    renderDial({ activeRows: [stale, fresh], categoryFirst: true });

    expect(screen.getByTestId("compact-category-station-live-now")
      .classList.contains("compact-category-dial__station--fresh")).toBe(true);
    expect(screen.getByTestId("compact-category-station-stale-one")
      .classList.contains("compact-category-dial__station--fresh")).toBe(false);
  });

  it("marks overview stations with the shared safe station-mark treatment", () => {
    const withLogo = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"], logoUrl: "https://img.example.test/kexp.png" },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    const without = makeRowWithTrack(
      { slug: "wfmu", name: "WFMU", stationCategories: ["anchor"] },
      { artist: "Yo La Tengo", title: "Autumn Sweater" },
    );
    renderDial({ activeRows: [withLogo, without], categoryFirst: true });

    // External logos route through the art proxy (never fetched directly),
    // lazy/async, and keep the card sizing class on the shared mark.
    const img = screen.getByTestId("compact-category-station-kexp")
      .querySelector("img[data-station-mark='logo']");
    expect(img?.getAttribute("src")).toBe(
      `/api/art?src=${encodeURIComponent("https://img.example.test/kexp.png")}`,
    );
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.classList.contains("compact-category-dial__station-logo")).toBe(true);
    // Missing logo → neutral fallback mark, never a broken image.
    const wfmu = screen.getByTestId("compact-category-station-wfmu");
    expect(wfmu.querySelector("img")).toBeNull();
    expect(wfmu.querySelector("[data-station-mark='fallback']")).not.toBeNull();
  });

  it("falls back to the neutral mark for invalid or failed overview logos", () => {
    const invalid = makeRowWithTrack(
      { slug: "odd", name: "Odd Radio", stationCategories: ["anchor"], logoUrl: "ftp://not-http.example/logo.png" },
      { artist: "Can", title: "Vitamin C" },
    );
    const failing = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"], logoUrl: "https://img.example.test/kexp.png" },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    renderDial({ activeRows: [invalid, failing], categoryFirst: true });

    // Non-http(s) URLs never reach an <img> at all.
    const odd = screen.getByTestId("compact-category-station-odd");
    expect(odd.querySelector("img")).toBeNull();
    expect(odd.querySelector("[data-station-mark='fallback']")).not.toBeNull();

    // A failed image degrades to the same neutral mark — never broken art.
    const kexp = screen.getByTestId("compact-category-station-kexp");
    const img = kexp.querySelector("img[data-station-mark='logo']");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(kexp.querySelector("img[data-station-mark='logo']")).toBeNull();
    expect(kexp.querySelector("[data-station-mark='fallback']")).not.toBeNull();
  });

  it("shows an honest empty state when a focused category has no stations", () => {
    const anchor = makeRow({ slug: "kexp", name: "KEXP", stationCategories: ["anchor"] });
    renderDial({ activeRows: [anchor], categoryFirst: true });

    fireEvent.click(screen.getByTestId("compact-category-tab-campus"));
    expect(screen.getByTestId("compact-category-campus-now-feed").textContent)
      .toContain("No stations in Campus yet.");
  });

  it("renders the focused category as one compact station list with skip and play controls", () => {
    const groove = makeRowWithTrack(
      { slug: "fip-groove", name: "FIP Groove", stationCategories: ["specialist"] },
      { artist: "Roy Ayers", title: "Everybody Loves the Sunshine" },
    );
    const jazzQuiet = makeRow({
      slug: "jazz-quiet",
      name: "Jazz FM",
      stationCategories: ["specialist"],
    });
    jazzQuiet.ds.isLive = false;
    const ambientOne = makeRowWithTrack(
      { slug: "ambient-one", name: "Ambient One", stationCategories: ["specialist"] },
      { artist: "Grouper", title: "Heavy Water" },
    );
    const onToggleSkip = vi.fn();
    const onPlay = vi.fn();

    renderDial({
      activeRows: [groove, jazzQuiet, ambientOne],
      categoryFirst: true,
      onToggleSkip,
      onPlay,
    });

    fireEvent.click(screen.getByTestId("compact-category-tab-specialist"));
    const feed = screen.getByTestId("compact-category-specialist-now-feed");
    // One flat station list — no subcategory cards.
    expect(feed.querySelectorAll("[data-testid^='compact-specialist-']")).toHaveLength(0);
    expect(feed.querySelectorAll(".compact-category-dial__feed-row")).toHaveLength(3);
    // Trackless stations stay honest in the list.
    expect(feed.textContent).toContain("Now playing unavailable");
    expect(feed.textContent).toContain("Jazz FM");
    // Play and per-station scan-skip controls still work in the drill-down.
    fireEvent.click(screen.getByRole("button", { name: "Play Ambient One" }));
    expect(onPlay).toHaveBeenCalledWith(ambientOne);
    fireEvent.click(screen.getByRole("checkbox", { name: "Skip Ambient One in scan" }));
    expect(onToggleSkip).toHaveBeenCalledWith("ambient-one");
  });

  it("orders the focused station list by current track values and reorders on refresh", () => {
    const first = makeRowWithTrack(
      { slug: "first", name: "First", stationCategories: ["anchor"] },
      { artist: "Zed", title: "Late" },
    );
    const second = makeRowWithTrack(
      { slug: "second", name: "Second", stationCategories: ["anchor"] },
      { artist: "Alpha", title: "Early" },
    );
    const { rerender } = renderDial({
      activeRows: [first, second],
      categoryFirst: true,
    });
    fireEvent.click(screen.getByTestId("compact-category-tab-anchor"));
    const feed = screen.getByTestId("compact-category-anchor-now-feed");
    expect([...feed.querySelectorAll(".compact-category-dial__feed-tune b")]
      .map((element) => element.textContent))
      .toEqual(["Second", "First"]);

    first.ds.liveTrack = makeSpin({ artist: "Aardvark", title: "New" });
    rerender(
      <CompactDial
        activeRows={[first, second]}
        skippedRows={[]}
        activeSlug={null}
        playerStatus="idle"
        presenceMap={new Map()}
        onTuneIn={vi.fn()}
        onPlay={vi.fn()}
        categoryFirst
      />,
    );
    expect([...screen.getByTestId("compact-category-anchor-now-feed")
      .querySelectorAll(".compact-category-dial__feed-tune b")]
      .map((element) => element.textContent))
      .toEqual(["First", "Second"]);
  });

  it("keeps skipped stations visible but dimmed in the focused list", () => {
    const active = makeRow({ slug: "kexp", name: "KEXP", stationCategories: ["anchor"] });
    const skipped = makeRow({ slug: "wfmu", name: "WFMU", stationCategories: ["anchor"] });
    renderDial({
      activeRows: [active],
      skippedRows: [skipped],
      categoryFirst: true,
      onToggleSkip: vi.fn(),
    });

    // Skipped stations remain in the global All feed, dimmed but reachable.
    expect(screen.getByTestId("compact-category-station-wfmu")
      .classList.contains("compact-category-dial__station--skipped"))
      .toBe(true);

    fireEvent.click(screen.getByTestId("compact-category-tab-anchor"));
    const feed = screen.getByTestId("compact-category-anchor-now-feed");
    expect(feed.querySelector(".compact-category-dial__feed-row--skipped")?.textContent)
      .toContain("WFMU");
    // …and deselection stays a scan preference, never a deletion.
    expect(
      (screen.getByRole("checkbox", { name: "Include WFMU in scan" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("keeps uncategorized listener-pinned stations directly reachable", () => {
    const personal = makeRowWithTrack(
      { slug: "my-station", name: "My Station", stationCategories: [] },
      { artist: "Autechre", title: "Rae" },
    );
    renderDial({ activeRows: [personal], categoryFirst: true });

    expect(screen.getByTestId("compact-category-station-my-station")).toBeTruthy();
    expect(screen.queryByTestId("compact-category-card-other")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Trailing scan checkbox (far-right edge)
// ---------------------------------------------------------------------------

describe("CompactDial scan checkbox", () => {
  it("renders a trailing checked checkbox for an active row", () => {
    const onToggleSkip = vi.fn();
    const row = makeRow({ slug: "kexp", name: "KEXP" });
    const { container } = renderDial({ activeRows: [row], onToggleSkip });

    const box = screen.getByRole("checkbox", { name: "Skip KEXP in scan" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    // Trailing edge: last element in the row, after the play button + FrontDoorRow.
    const rowEl = container.querySelector(".compact-dial__row")!;
    expect(rowEl.lastElementChild).toBe(box);
  });

  it("renders an unchecked checkbox and dims the row when the station is in skippedRows", () => {
    const row = makeRow({ slug: "kexp", name: "KEXP" });
    const { container } = renderDial({
      skippedRows: [row],
      onToggleSkip: vi.fn(),
    });

    const box = screen.getByRole("checkbox", { name: "Include KEXP in scan" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(container.querySelector(".compact-dial__row--skipped")).toBeTruthy();
  });

  it("skipped rows appear in .compact-dial__skipped-region below the active grid", () => {
    const active = makeRow({ slug: "kcrw", name: "KCRW" });
    const skipped = makeRow({ slug: "kexp", name: "KEXP" });
    const { container } = renderDial({
      activeRows: [active],
      skippedRows: [skipped],
      onToggleSkip: vi.fn(),
    });

    const region = container.querySelector(".compact-dial__skipped-region");
    expect(region).toBeTruthy();
    expect(region!.querySelector('[data-testid="fdrow-kexp"]')).toBeTruthy();
    // Active row is NOT inside the skipped region
    expect(container.querySelector(".compact-dial__row:not(.compact-dial__row--skipped) [data-testid='fdrow-kcrw']")).toBeTruthy();
  });

  it("toggling the checkbox calls onToggleSkip with the slug, not onPlay/onTuneIn", () => {
    const onToggleSkip = vi.fn();
    const onPlay = vi.fn();
    const onTuneIn = vi.fn();
    const row = makeRow({ slug: "kexp", name: "KEXP" });
    renderDial({ activeRows: [row], onToggleSkip, onPlay, onTuneIn });

    fireEvent.click(screen.getByRole("checkbox", { name: "Skip KEXP in scan" }));
    expect(onToggleSkip).toHaveBeenCalledWith("kexp");
    expect(onPlay).not.toHaveBeenCalled();
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("renders no checkbox when onToggleSkip is not provided", () => {
    const row = makeRow({ slug: "kexp", name: "KEXP" });
    renderDial({ activeRows: [row] });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Play controls
// ---------------------------------------------------------------------------

describe("CompactDial play controls", () => {
  it("renders a ▶ play button for a station with a streamUrl", () => {
    const row = makeRow({ slug: "kexp", name: "KEXP", streamUrl: "https://stream.kexp.org/kexp128.mp3" });
    renderDial({ activeRows: [row] });
    screen.getByRole("button", { name: "Play KEXP" });
  });

  it("renders a ▶ play button for a station with only a relayUrl (no streamUrl)", () => {
    const row = makeRow({
      slug: "relay-only",
      name: "Relay Station",
      // streamUrl is required in the schema with a string value; use empty string
      // and relayUrl to simulate relay-only (resolvePlaybackSource returns relay)
      streamUrl: "",
      relayUrl: "/api/stations/relay-only/relay",
    });
    renderDial({ activeRows: [row] });
    screen.getByRole("button", { name: "Play Relay Station" });
  });

  it("hides the play button for attribution-only stations (no stream, no relay)", () => {
    const row = makeRow({
      slug: "attr-only",
      name: "Attribution Only",
      streamUrl: "",
      relayUrl: null,
    });
    renderDial({ activeRows: [row] });
    // FrontDoorRow stub is rendered (station is shown)
    screen.getByTestId("fdrow-attr-only");
    // But play button must be absent
    expect(screen.queryByRole("button", { name: /Play/ })).toBeNull();
  });

  it("clicking ▶ calls onPlay and does NOT call onTuneIn", () => {
    const onPlay = vi.fn();
    const onTuneIn = vi.fn();
    const row = makeRow({ slug: "wmfo", name: "WMFO" });
    renderDial({ activeRows: [row], onPlay, onTuneIn });
    fireEvent.click(screen.getByRole("button", { name: "Play WMFO" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("shows ⏸ (Pause) when activeSlug matches and playerStatus is 'playing'", () => {
    const row = makeRow({ slug: "kcrw", name: "KCRW" });
    renderDial({ activeRows: [row], activeSlug: "kcrw", playerStatus: "playing" });
    screen.getByRole("button", { name: "Pause KCRW" });
    expect(screen.queryByRole("button", { name: "Play KCRW" })).toBeNull();
  });

  it("clicking ⏸ calls onPlay (which internally toggles/pauses) and NOT onTuneIn", () => {
    const onPlay = vi.fn();
    const onTuneIn = vi.fn();
    const row = makeRow({ slug: "kcrw", name: "KCRW" });
    renderDial({ activeRows: [row], activeSlug: "kcrw", playerStatus: "playing", onPlay, onTuneIn });
    fireEvent.click(screen.getByRole("button", { name: "Pause KCRW" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("shows muted ▶ (Play label, not Pause) when activeSlug matches and playerStatus is 'loading'", () => {
    const row = makeRow({ slug: "wfmu", name: "WFMU" });
    renderDial({ activeRows: [row], activeSlug: "wfmu", playerStatus: "loading" });
    // Shows Play (not Pause) during loading — isLoading=true keeps it as ▶
    const btn = screen.getByRole("button", { name: "Play WFMU" });
    expect(screen.queryByRole("button", { name: "Pause WFMU" })).toBeNull();
    // Muted/inert affordance is signalled on the element itself
    expect(btn.getAttribute("data-loading")).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("clicking ▶ while the station is loading is a no-op (does not call onPlay)", () => {
    const onPlay = vi.fn();
    const onTuneIn = vi.fn();
    const row = makeRow({ slug: "wfmu", name: "WFMU" });
    renderDial({ activeRows: [row], activeSlug: "wfmu", playerStatus: "loading", onPlay, onTuneIn });
    fireEvent.click(screen.getByRole("button", { name: "Play WFMU" }));
    // Never re-fire radio.toggle for a buffering station — useRadioPlayer.toggle
    // treats a loading current station as a fresh play() and reattaches the source.
    expect(onPlay).not.toHaveBeenCalled();
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("shows ▶ for an inactive station even when another station is playing", () => {
    const onPlay = vi.fn();
    const row = makeRow({ slug: "kexp", name: "KEXP" });
    renderDial({ activeRows: [row], activeSlug: "kcrw", playerStatus: "playing", onPlay });
    // KEXP is not active — shows Play
    screen.getByRole("button", { name: "Play KEXP" });
  });
});

// ---------------------------------------------------------------------------
// Density modes (remote-control views)
// ---------------------------------------------------------------------------

describe("CompactDial compact density", () => {
  it("renders name-only keys in a two-column remote grid", () => {
    const rows = [
      makeRow({ slug: "kcrw", name: "KCRW" }),
      makeRow({ slug: "kexp", name: "KEXP" }),
    ];
    const { container } = renderDial({
      activeRows: rows,
      density: "compact",
      firstOrdinal: 11, // page 2 of a 10-row compact list
      onToggleSkip: vi.fn(),
    });

    const remoteRows = container.querySelectorAll("button.compact-dial__remote-row");
    expect(remoteRows).toHaveLength(2);
    expect(container.querySelector(".compact-dial--compact")).toBeTruthy();
    expect(remoteRows[0].textContent).toBe("11KCRW");
    expect(remoteRows[1].textContent).toBe("12KEXP");

    // No FrontDoorRow track detail, no play triangle, no scan checkbox.
    expect(container.querySelector("[data-testid^='fdrow-']")).toBeNull();
    expect(screen.queryByRole("button", { name: /Play/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();

    // The grid always spans 10 slots — empties fill the remainder.
    expect(container.querySelectorAll(".compact-dial__remote-row--empty")).toHaveLength(8);
  });

  it("shows the now-playing artist as the primary label, station demoted to a muted byline", () => {
    const row = makeRowWithTrack(
      { slug: "kcrw", name: "KCRW" },
      { artist: "Wet Leg", title: "Chaise Longue" },
    );
    renderDial({ activeRows: [row], density: "compact" });

    const btn = screen.getByRole("button", { name: "1. Wet Leg on KCRW — tune in" });
    expect(btn.querySelector(".compact-dial__remote-name")!.textContent).toBe("Wet Leg");
    expect(btn.querySelector(".compact-dial__remote-station")!.textContent).toBe("KCRW");
    // The ordinal is retained as the muted secondary label.
    expect(btn.querySelector(".compact-dial__remote-ordinal")!.textContent).toBe("1");
  });

  it("falls back to the live show's current track when the live pulse has none", () => {
    const row = makeRowWithTrack(
      { slug: "kcrw", name: "KCRW" },
      { artist: "Wet Leg" },
      "show",
    );
    renderDial({ activeRows: [row], density: "compact" });
    screen.getByRole("button", { name: "1. Wet Leg on KCRW — tune in" });
  });

  it("falls back to the station name (no byline) when no track is playing", () => {
    const row = makeRow({ slug: "kcrw", name: "KCRW" });
    renderDial({ activeRows: [row], density: "compact" });

    const btn = screen.getByRole("button", { name: "1. KCRW — tune in" });
    expect(btn.querySelector(".compact-dial__remote-name")!.textContent).toBe("KCRW");
    expect(btn.querySelector(".compact-dial__remote-station")).toBeNull();
  });

  it("tapping a compact row tunes in (no separate play control)", () => {
    const onTuneIn = vi.fn();
    const onPlay = vi.fn();
    const row = makeRow({ slug: "kexp", name: "KEXP" });
    renderDial({ activeRows: [row], density: "compact", onTuneIn, onPlay });

    fireEvent.click(screen.getByRole("button", { name: "1. KEXP — tune in" }));
    expect(onTuneIn).toHaveBeenCalledWith(row);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("keeps the sampling highlight and active-station cue in compact density", () => {
    const rows = [
      makeRow({ slug: "kcrw", name: "KCRW" }),
      makeRow({ slug: "kexp", name: "KEXP" }),
    ];
    const { container } = renderDial({
      activeRows: rows,
      density: "compact",
      samplingRowIdx: 1,
      activeSlug: "kcrw",
    });
    expect(container.querySelector(".compact-dial__remote-row--sampling")?.textContent).toContain("KEXP");
    expect(container.querySelector(".compact-dial__remote-row--active")?.textContent).toContain("KCRW");
  });
});

describe("CompactDial micro density", () => {
  it("renders the page's stations as numbered keypad buttons in three columns", () => {
    const rows = [1, 2, 3, 4, 5].map((n) =>
      makeRow({ slug: `st-${n}`, name: `Station ${n}` }),
    );
    const { container } = renderDial({ activeRows: rows, density: "micro" });

    const buttons = [...container.querySelectorAll(".compact-dial__micro-btn")];
    // Ordinal badge + station name (no now-playing artist in these fixtures).
    expect(buttons.map((b) => b.textContent)).toEqual([
      "1Station 1",
      "2Station 2",
      "3Station 3",
      "4Station 4",
      "5Station 5",
    ]);
    expect(container.querySelector(".compact-dial__micro-grid")).toBeTruthy();
    // Grouped 3 per row of keys: triads of 3 + 2.
    const triads = container.querySelectorAll(".compact-dial__micro-triad");
    expect(triads).toHaveLength(2);
    expect(triads[0].querySelectorAll("button")).toHaveLength(3);
    expect(triads[1].querySelectorAll("button")).toHaveLength(2);
    // Names stay reachable via the accessible label.
    screen.getByRole("button", { name: "4. Station 4 — tune in" });
    // No rows, no checkboxes, no FrontDoorRow detail.
    expect(container.querySelector(".compact-dial__row")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the now-playing artist beside the ordinal, station name in the label and title", () => {
    const row = makeRowWithTrack(
      { slug: "kcrw", name: "KCRW" },
      { artist: "Wet Leg", title: "Chaise Longue" },
    );
    renderDial({ activeRows: [row], density: "micro" });

    const btn = screen.getByRole("button", { name: "1. Wet Leg on KCRW — tune in" });
    expect(btn.querySelector(".compact-dial__micro-name")!.textContent).toBe("Wet Leg");
    expect(btn.querySelector(".compact-dial__micro-ordinal")!.textContent).toBe("1");
    expect(btn.getAttribute("title")).toBe("Wet Leg — KCRW");
  });

  it("falls back to the show's current track artist on the keypad", () => {
    const row = makeRowWithTrack(
      { slug: "kcrw", name: "KCRW" },
      { artist: "Wet Leg" },
      "show",
    );
    renderDial({ activeRows: [row], density: "micro" });
    screen.getByRole("button", { name: "1. Wet Leg on KCRW — tune in" });
  });

  it("tapping a keypad button tunes in that station", () => {
    const onTuneIn = vi.fn();
    const rows = [1, 2, 3].map((n) => makeRow({ slug: `st-${n}`, name: `Station ${n}` }));
    renderDial({ activeRows: rows, density: "micro", onTuneIn });

    fireEvent.click(screen.getByRole("button", { name: "2. Station 2 — tune in" }));
    expect(onTuneIn).toHaveBeenCalledWith(rows[1]);
  });

  it("micro keypad buttons continue ordinals from the page offset", () => {
    // Page 2 of a 15-per-page micro list: the parent slices rows 16–20 and
    // passes firstOrdinal=16, so the keypad keeps full-list numbering.
    const rows = [1, 2, 3, 4, 5].map((n) =>
      makeRow({ slug: `st-${n}`, name: `Station ${n}` }),
    );
    const { container } = renderDial({
      activeRows: rows,
      density: "micro",
      firstOrdinal: 16,
    });

    const buttons = [...container.querySelectorAll(".compact-dial__micro-btn")];
    expect(buttons.map((b) => b.textContent)).toEqual([
      "16Station 1",
      "17Station 2",
      "18Station 3",
      "19Station 4",
      "20Station 5",
    ]);
    screen.getByRole("button", { name: "16. Station 1 — tune in" });
  });

  it("marks the sampling and active keys in micro density", () => {
    const rows = [1, 2, 3].map((n) => makeRow({ slug: `st-${n}`, name: `Station ${n}` }));
    const { container } = renderDial({
      activeRows: rows,
      density: "micro",
      samplingRowIdx: 2,
      activeSlug: "st-1",
    });
    expect(container.querySelector(".compact-dial__micro-btn--sampling")?.getAttribute("aria-label")).toContain("Station 3");
    expect(container.querySelector(".compact-dial__micro-btn--active")?.getAttribute("aria-label")).toContain("Station 1");
  });
});

// ---------------------------------------------------------------------------
// Station identity marks in the expanded category now-playing feed
// ---------------------------------------------------------------------------

describe("CompactDial category feed station marks", () => {
  it("shows the logo cube for stations with logoUrl and a neutral mark otherwise", () => {
    const withLogo = makeRowWithTrack(
      {
        slug: "kexp",
        name: "KEXP",
        stationCategories: ["anchor"],
        logoUrl: "https://static.example.com/kexp-logo.png",
      },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    const withoutLogo = makeRowWithTrack(
      { slug: "quiet", name: "Quiet Station", stationCategories: ["anchor"] },
      { artist: "Low", title: "Words" },
    );
    renderDial({ activeRows: [withLogo, withoutLogo], categoryFirst: true });
    fireEvent.click(screen.getByTestId("compact-category-tab-anchor"));

    const feed = screen.getByTestId("compact-category-anchor-now-feed");
    const cubes = feed.querySelectorAll(".station-mark--cube");
    // Both rows carry the cube treatment — logo where available, neutral
    // fallback otherwise — and the station names stay visible.
    expect(cubes.length).toBe(2);
    expect(feed.querySelectorAll("img[data-station-mark='logo']").length).toBe(1);
    expect(feed.querySelectorAll("[data-station-mark='fallback']").length).toBe(1);
    expect(feed.textContent).toContain("KEXP");
    expect(feed.textContent).toContain("Quiet Station");
  });
});

describe("CompactDial first-play rail", () => {
  it("renders recent first plays with square artwork, station provenance, and a preview action", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          id: 42,
          mbid: "first-play-mbid",
          artist: "New Artist",
          title: "New Track",
          artworkUrl: "https://images.example.com/new-track.jpg",
          playedAt: "2026-08-25T20:00:00.000Z",
          station: { slug: "kexp", name: "KEXP" },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    renderDial({
      activeRows: [makeRowWithTrack(
        { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
        { artist: "Now Artist", title: "Now Track" },
      )],
      categoryFirst: true,
    });

    const tile = await screen.findByRole("button", {
      name: "Preview New Artist — New Track, first played on KEXP",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/player/history?scope=7d&filter=firstPlays&order=desc&limit=18&home=1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(tile.querySelector("img")?.getAttribute("src")).toBe(
      "/api/art?src=https%3A%2F%2Fimages.example.com%2Fnew-track.jpg",
    );
    expect(tile.textContent).toContain("KEXP");

    fireEvent.click(tile);
    expect(startReplay).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          mbid: "first-play-mbid",
          artworkUrl: "https://images.example.com/new-track.jpg",
        }),
      ]),
      "First play · KEXP",
      expect.objectContaining({ previewOnly: true }),
    );
  });
});
