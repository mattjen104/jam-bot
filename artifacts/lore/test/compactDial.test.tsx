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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

describe("CompactDial category-first home Feed", () => {
  it("uses the stable specialist taxonomy, including named edge cases and a visible fallback", () => {
    expect(specialistSubcategoryForStation(makeStation({ name: "FIP Groove" }))).toBe("groove");
    expect(specialistSubcategoryForStation(makeStation({ name: "t67-4fdb1912 Jazz FM" }))).toBe("jazz");
    expect(specialistSubcategoryForStation(makeStation({ name: "Unclassifiable Signal" }))).toBe("other");
  });

  it("aggregates crossings and first plays by scope, including skipped stations", () => {
    const active = makeRow({
      slug: "active",
      name: "Active",
      stationCategories: ["anchor"],
    });
    active.ds.crossings = 2;
    active.ds.artistCrossings = 1;
    active.ds.firstPlayCrossings = 1;
    active.ds.lifetimeCrossings = 7;
    active.ds.lifetimeArtistCrossings = 2;
    active.ds.lifetimeFirstPlayCrossings = 3;
    const skipped = makeRow({
      slug: "skipped",
      name: "Skipped",
      stationCategories: ["anchor"],
    });
    skipped.ds.crossings = 4;
    skipped.ds.firstPlayCrossings = 2;

    const { rerender } = renderDial({
      activeRows: [active],
      skippedRows: [skipped],
      categoryFirst: true,
      crossingScope: "24h",
    });
    expect(screen.getByTestId("compact-category-anchor").textContent).toContain("7 crossings");
    expect(screen.getByTestId("compact-category-anchor").textContent).toContain("3 first plays");

    rerender(
      <CompactDial
        activeRows={[active]}
        skippedRows={[skipped]}
        activeSlug={null}
        playerStatus="idle"
        presenceMap={new Map()}
        onTuneIn={vi.fn()}
        onPlay={vi.fn()}
        categoryFirst
        crossingScope="lifetime"
      />,
    );
    expect(screen.getByTestId("compact-category-anchor").textContent).toContain("9 crossings");
    expect(screen.getByTestId("compact-category-anchor").textContent).toContain("3 first plays");
  });

  it("renders editorial category cards with fresh now-playing previews", () => {
    const ambient = makeRowWithTrack(
      { slug: "sleep", name: "Sleep Radio", stationCategories: ["ambient"] },
      { artist: "Brian Eno", title: "An Ending" },
    );
    const anchor = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );

    renderDial({ activeRows: [anchor, ambient], categoryFirst: true });

    const lane = screen.getByTestId("compact-category-dial");
    const labels = [...lane.querySelectorAll(".compact-category-dial__label")]
      .map((element) => element.textContent);
    expect(labels).toEqual(["Ambient & Sleep", "Anchor Stations"]);
    expect(screen.getByTestId("compact-category-anchor").textContent)
      .toContain("The Smile — Bending Hectic · KEXP");
    expect(screen.getByTestId("compact-category-anchor").textContent)
      .toContain("1 station");
  });

  it("renders accessible scope-labelled metric badges, including honest zeroes", () => {
    const row = makeRow({
      slug: "kexp",
      name: "KEXP",
      stationCategories: ["anchor"],
    });
    renderDial({ activeRows: [row], categoryFirst: true, crossingScope: "7d" });

    const summary = screen.getByTestId("compact-category-anchor");
    expect(summary.textContent).toContain("0 crossings");
    expect(summary.textContent).toContain("0 first plays");
    expect(screen.getByLabelText("0 crossings in 7d")).toBeTruthy();
    expect(screen.getByLabelText("0 first plays in 7d")).toBeTruthy();
  });

  it("recomputes category badges when the active scope changes", () => {
    const row = makeRow({
      slug: "kexp",
      name: "KEXP",
      stationCategories: ["anchor"],
    });
    row.ds.crossings = 2;
    row.ds.firstPlayCrossings = 1;
    row.ds.lifetimeCrossings = 8;
    row.ds.lifetimeFirstPlayCrossings = 4;
    const { rerender } = renderDial({
      activeRows: [row],
      categoryFirst: true,
      crossingScope: "24h",
    });
    expect(screen.getByTestId("compact-category-anchor").textContent).toContain("2 crossings");
    expect(screen.getByTestId("compact-category-anchor").textContent).toContain("1 first plays");

    rerender(
      <CompactDial
        activeRows={[row]}
        skippedRows={[]}
        activeSlug={null}
        playerStatus="idle"
        presenceMap={new Map()}
        onTuneIn={vi.fn()}
        onPlay={vi.fn()}
        categoryFirst
        crossingScope="lifetime"
      />,
    );
    expect(screen.getByTestId("compact-category-anchor").textContent).toContain("8 crossings");
    expect(screen.getByTestId("compact-category-anchor").textContent).toContain("4 first plays");
  });

  it("uses an honest unavailable state when a category has no live metadata", () => {
    const quiet = makeRow({
      slug: "quiet",
      name: "Quiet Station",
      stationCategories: ["ambient"],
    });
    renderDial({ activeRows: [quiet], categoryFirst: true });

    expect(screen.getByTestId("compact-category-ambient").textContent)
      .toContain("Now playing unavailable");
  });

  it("shows dense playable station entries before expansion and keeps unavailable entries honest", () => {
    const playable = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    const unavailable = makeRow({
      slug: "quiet", name: "Quiet Station", streamUrl: "", relayUrl: null, stationCategories: ["anchor"],
    });
    const onPlay = vi.fn();
    const onTuneIn = vi.fn();
    renderDial({ activeRows: [playable, unavailable], categoryFirst: true, onPlay, onTuneIn });

    expect(screen.getByRole("button", { name: "Play KEXP" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play Quiet Station" })).toBeNull();
    screen.getByRole("button", { name: "The Smile — Bending Hectic · KEXP — tune in" });
    screen.getByRole("button", { name: "Now playing unavailable · Quiet Station — tune in" });
    fireEvent.click(screen.getByRole("button", { name: "Play KEXP" }));
    expect(onPlay).toHaveBeenCalledWith(playable);
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("uses the compact remote density for category station lists", () => {
    const rows = Array.from({ length: 11 }, (_, index) =>
      makeRow({
        slug: `anchor-${index + 1}`,
        name: `Anchor ${index + 1}`,
        stationCategories: ["anchor"],
      }),
    );
    const { container } = renderDial({ activeRows: rows, categoryFirst: true, density: "compact" });

    expect(container.querySelector(".compact-category-dial__dense-list--remote")).toBeTruthy();
    expect(container.querySelectorAll(".compact-category-dial__dense-row")).toHaveLength(10);
    expect(screen.getByRole("group", { name: "Anchor Stations now playing pages" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next Anchor Stations now playing page" })).toBeTruthy();
  });

  it("expands exactly one category inline and keeps its station row controls", () => {
    const anchor = makeRowWithTrack(
      { slug: "kexp", name: "KEXP", stationCategories: ["anchor"] },
      { artist: "The Smile", title: "Bending Hectic" },
    );
    const campus = makeRowWithTrack(
      { slug: "wvum", name: "WVUM", stationCategories: ["campus"] },
      { artist: "Floating Points", title: "Bias" },
    );
    const onToggleSkip = vi.fn();

    renderDial({
      activeRows: [anchor, campus],
      categoryFirst: true,
      onToggleSkip,
    });

    const anchorButton = screen.getByTestId("compact-category-anchor");
    const campusButton = screen.getByTestId("compact-category-campus");
    expect(screen.queryByTestId("fdrow-kexp")).toBeNull();

    fireEvent.click(anchorButton);
    expect(anchorButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("fdrow-kexp")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play KEXP" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Skip KEXP in scan" }));
    expect(onToggleSkip).toHaveBeenCalledWith("kexp");

    fireEvent.click(campusButton);
    expect(campusButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("fdrow-wvum")).toBeTruthy();
    expect(screen.queryByTestId("fdrow-kexp")).toBeNull();

    fireEvent.click(campusButton);
    expect(campusButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("fdrow-wvum")).toBeNull();
  });

  it("keeps uncategorized listener-pinned stations directly reachable", () => {
    const personal = makeRowWithTrack(
      { slug: "my-station", name: "My Station", stationCategories: [] },
      { artist: "Autechre", title: "Rae" },
    );
    renderDial({ activeRows: [personal], categoryFirst: true });

    expect(screen.getByTestId("fdrow-my-station")).toBeTruthy();
    expect(screen.queryByTestId("compact-category-other")).toBeNull();
  });

  it("splits Specialist into ordered subcards with shared fresh now-playing and preserved row controls", () => {
    const ambient = makeRowWithTrack(
      { slug: "ambient-one", name: "Ambient One", stationCategories: ["specialist"] },
      { artist: "Grouper", title: "Heavy Water" },
    );
    const jazzQuiet = makeRow({
      slug: "jazz-quiet",
      name: "Jazz FM",
      stationCategories: ["specialist"],
    });
    jazzQuiet.ds.isLive = false;
    const groove = makeRowWithTrack(
      { slug: "fip-groove", name: "FIP Groove", stationCategories: ["specialist"] },
      { artist: "Roy Ayers", title: "Everybody Loves the Sunshine" },
    );
    const onToggleSkip = vi.fn();

    renderDial({
      activeRows: [groove, jazzQuiet, ambient],
      categoryFirst: true,
      onToggleSkip,
    });

    fireEvent.click(screen.getByTestId("compact-category-specialist"));
    const lane = screen.getByTestId("compact-category-dial");
    const subcards = [...lane.querySelectorAll("[data-testid^='compact-specialist-']")]
      .map((element) => element.getAttribute("data-testid"));
    expect(subcards).toEqual([
      "compact-specialist-ambient",
      "compact-specialist-jazz",
      "compact-specialist-groove",
    ]);
    expect(screen.getByTestId("compact-specialist-ambient").textContent)
      .toContain("Grouper — Heavy Water");
    expect(screen.getByTestId("compact-specialist-jazz").textContent)
      .toContain("Now playing unavailable");
    expect(screen.getByTestId("compact-specialist-jazz").textContent)
      .toContain("Jazz FM");

    const ambientButton = screen.getByTestId("compact-specialist-ambient").querySelector("button");
    expect(ambientButton).toBeTruthy();
    fireEvent.click(ambientButton!);
    expect(screen.getByTestId("fdrow-ambient-one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play Ambient One" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Skip Ambient One in scan" }));
    expect(onToggleSkip).toHaveBeenCalledWith("ambient-one");
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
