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
    weekCrossings: 0,
    weekArtistCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
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
