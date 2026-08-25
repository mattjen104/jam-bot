// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { mockUsePlayer } = vi.hoisted(() => ({ mockUsePlayer: vi.fn() }));

vi.mock("../src/player/PlayerProvider", () => ({ usePlayer: mockUsePlayer }));
vi.mock("../src/components/dial/HistoryScanner", () => ({
  HistoryScanner: () => <div data-testid="history-scanner">Archive scanner</div>,
}));
vi.mock("../src/components/dial/CategoryScanLane", () => ({
  CategoryScanLane: () => <div data-testid="category-scan-lane">Category focus</div>,
}));

import { ScanSession } from "../src/components/ScanSession";

const STATIONS = [
  { slug: "kexp", name: "KEXP" },
  { slug: "wvum", name: "WVUM" },
] as never[];

function renderSession(overrides: Partial<React.ComponentProps<typeof ScanSession>> = {}) {
  mockUsePlayer.mockReturnValue({
    scan: { active: false, current: null, dir: 1, toggle: vi.fn(), toggleDir: vi.fn() },
    ride: { active: false, replayLabel: null, status: "idle" },
  });
  const onFilterChange = vi.fn();
  const view = render(
    <ScanSession
      scope="set"
      categories={[]}
      source="archive"
      filter="all"
      onSourceChange={vi.fn()}
      onFilterChange={onFilterChange}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
  return { ...view, onFilterChange };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScanSession mode-specific controls", () => {
  it("shows only Live controls in Live mode", () => {
    renderSession({ source: "live" });
    expect(screen.getByRole("group", { name: "Scan source" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Archive filter" })).toBeNull();
    expect(screen.getByRole("group", { name: "Live scan controls" })).toBeTruthy();
    expect(screen.queryByTestId("history-scanner")).toBeNull();
  });

  it("shows Archive filters and no Live controls in Archive mode", () => {
    const { onFilterChange } = renderSession({ source: "archive", filter: "firstPlays" });
    expect(screen.getByRole("group", { name: "Archive filter" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Live scan controls" })).toBeNull();
    expect(screen.getByTestId("history-scanner")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Crossings" }));
    expect(onFilterChange).toHaveBeenCalledWith("crossings");
  });
});

describe("ScanSession selection summary", () => {
  it.each([
    ["archive", "Archive · All Lore · All"],
    ["category", "Archive · Category: Campus Radio · First plays"],
    ["station", "Live · Station: KEXP · Crossings"],
  ] as const)("names the %s selection", (kind, expected) => {
    renderSession(
      kind === "station"
        ? { source: "live", filter: "crossings", stationName: "KEXP", stationSlug: "kexp", liveStations: STATIONS }
        : kind === "category"
          ? { categories: ["campus"], filter: "firstPlays" }
          : {},
    );
    expect(screen.getByTestId("scan-selection-summary").textContent).toContain(expected);
  });

  it("labels multiple categories and keeps the summary stable across track refreshes", () => {
    const { rerender } = renderSession({
      source: "live",
      categories: ["ambient", "specialist"],
      liveStations: STATIONS,
      liveNowPlayingBySlug: new Map(),
    });
    expect(screen.getByTestId("scan-selection-summary").textContent).toContain(
      "Live · Categories: Ambient & Sleep, Specialist Radio · All",
    );
    rerender(
      <ScanSession
        scope="set"
        categories={["ambient", "specialist"]}
        source="live"
        filter="all"
        onSourceChange={vi.fn()}
        onFilterChange={vi.fn()}
        onClose={vi.fn()}
        liveStations={STATIONS}
        liveNowPlayingBySlug={new Map([["kexp", { artist: "New artist" }]])}
      />,
    );
    expect(screen.getByTestId("scan-selection-summary").textContent).toContain("Specialist Radio");
  });

  it("distinguishes ready, scanning, paused, and focused live states", () => {
    const { rerender } = renderSession({ source: "live", liveStations: STATIONS });
    expect(screen.getByText("Ready", { selector: ".scan-session__status" })).toBeTruthy();

    for (const state of [
      { scan: { active: true, current: null }, expected: "Scanning" },
      { scan: { active: false, current: { stationName: "KEXP" } }, expected: "Paused" },
    ] as const) {
      mockUsePlayer.mockReturnValue({ scan: { ...state.scan, dir: 1 }, ride: { active: false, replayLabel: null, status: "idle" } });
      rerender(
        <ScanSession scope="set" categories={[]} source="live" filter="all"
          onSourceChange={vi.fn()} onFilterChange={vi.fn()} onClose={vi.fn()} liveStations={STATIONS} />,
      );
      expect(screen.getByText(state.expected, { selector: ".scan-session__status" })).toBeTruthy();
    }

    mockUsePlayer.mockReturnValue({
      scan: { active: false, current: null, dir: 1 },
      ride: { active: false, replayLabel: null, status: "idle" },
    });
    rerender(
      <ScanSession scope="set" categories={[]} source="live" filter="all"
        onSourceChange={vi.fn()} onFilterChange={vi.fn()} onClose={vi.fn()}
        liveStations={STATIONS} activeStationSlug="wvum" />,
    );
    expect(screen.getByText("Focused on WVUM", { selector: ".scan-session__status" })).toBeTruthy();
  });
});