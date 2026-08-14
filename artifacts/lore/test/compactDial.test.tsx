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
 *  - empty state renders the "No stations on air right now." message
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CompactDial, type CompactDialProps } from "../src/components/CompactDial";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";
import type { Station } from "@workspace/api-client-react";
import type { DialStation } from "../src/hooks/useDialData";

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

function renderDial(props: Partial<CompactDialProps> = {}) {
  const defaults: CompactDialProps = {
    rows: [],
    offset: 0,
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
    renderDial({ rows: [] });
    screen.getByText("No stations on air right now.");
  });
});

// ---------------------------------------------------------------------------
// Play controls
// ---------------------------------------------------------------------------

describe("CompactDial play controls", () => {
  it("renders a ▶ play button for a station with a streamUrl", () => {
    const row = makeRow({ slug: "kexp", name: "KEXP", streamUrl: "https://stream.kexp.org/kexp128.mp3" });
    renderDial({ rows: [row] });
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
    renderDial({ rows: [row] });
    screen.getByRole("button", { name: "Play Relay Station" });
  });

  it("hides the play button for attribution-only stations (no stream, no relay)", () => {
    const row = makeRow({
      slug: "attr-only",
      name: "Attribution Only",
      streamUrl: "",
      relayUrl: null,
    });
    renderDial({ rows: [row] });
    // FrontDoorRow stub is rendered (station is shown)
    screen.getByTestId("fdrow-attr-only");
    // But play button must be absent
    expect(screen.queryByRole("button", { name: /Play/ })).toBeNull();
  });

  it("clicking ▶ calls onPlay and does NOT call onTuneIn", () => {
    const onPlay = vi.fn();
    const onTuneIn = vi.fn();
    const row = makeRow({ slug: "wmfo", name: "WMFO" });
    renderDial({ rows: [row], onPlay, onTuneIn });
    fireEvent.click(screen.getByRole("button", { name: "Play WMFO" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("shows ⏸ (Pause) when activeSlug matches and playerStatus is 'playing'", () => {
    const row = makeRow({ slug: "kcrw", name: "KCRW" });
    renderDial({ rows: [row], activeSlug: "kcrw", playerStatus: "playing" });
    screen.getByRole("button", { name: "Pause KCRW" });
    expect(screen.queryByRole("button", { name: "Play KCRW" })).toBeNull();
  });

  it("clicking ⏸ calls onPlay (which internally toggles/pauses) and NOT onTuneIn", () => {
    const onPlay = vi.fn();
    const onTuneIn = vi.fn();
    const row = makeRow({ slug: "kcrw", name: "KCRW" });
    renderDial({ rows: [row], activeSlug: "kcrw", playerStatus: "playing", onPlay, onTuneIn });
    fireEvent.click(screen.getByRole("button", { name: "Pause KCRW" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("shows muted ▶ (Play label, not Pause) when activeSlug matches and playerStatus is 'loading'", () => {
    const row = makeRow({ slug: "wfmu", name: "WFMU" });
    renderDial({ rows: [row], activeSlug: "wfmu", playerStatus: "loading" });
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
    renderDial({ rows: [row], activeSlug: "wfmu", playerStatus: "loading", onPlay, onTuneIn });
    fireEvent.click(screen.getByRole("button", { name: "Play WFMU" }));
    // Never re-fire radio.toggle for a buffering station — useRadioPlayer.toggle
    // treats a loading current station as a fresh play() and reattaches the source.
    expect(onPlay).not.toHaveBeenCalled();
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("shows ▶ for an inactive station even when another station is playing", () => {
    const onPlay = vi.fn();
    const row = makeRow({ slug: "kexp", name: "KEXP" });
    renderDial({ rows: [row], activeSlug: "kcrw", playerStatus: "playing", onPlay });
    // KEXP is not active — shows Play
    screen.getByRole("button", { name: "Play KEXP" });
  });
});
