// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ScanFilter, ScanSource } from "../src/components/ScanSession";
import { ScanSession } from "../src/components/ScanSession";

const player = {
  scan: {
    active: false,
    current: null,
    dir: 1,
    toggle: vi.fn(),
    toggleDir: vi.fn(),
  },
};

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => player,
}));
vi.mock("../src/components/dial/HistoryScanner", () => ({
  HistoryScanner: () => <div data-testid="history-scanner">Archive scanner</div>,
}));
vi.mock("../src/components/dial/CategoryScanLane", () => ({
  CategoryScanLane: () => <div data-testid="category-scan-lane">Category focus</div>,
}));

function renderSession(source: ScanSource = "live", filter: ScanFilter = "firstPlays") {
  const onSourceChange = vi.fn();
  const onFilterChange = vi.fn();
  const view = render(
    <ScanSession
      scope={"all" as never}
      categories={[]}
      source={source}
      filter={filter}
      onSourceChange={onSourceChange}
      onFilterChange={onFilterChange}
      liveStations={[]}
      onClose={vi.fn()}
    />,
  );
  return { ...view, onSourceChange, onFilterChange };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScanSession mode-specific controls", () => {
  it("shows only Live controls and does not include an Archive filter in Live mode", () => {
    renderSession("live");

    expect(screen.getByText("Live stations · across Lore")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Archive filter" })).toBeNull();
    expect(screen.getByRole("group", { name: "Live scan controls" })).toBeTruthy();
    expect(screen.queryByTestId("history-scanner")).toBeNull();
    expect(screen.getByRole("button", { name: "Live stations" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Archive" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows Archive filters and no Live controls after switching to Archive", () => {
    const { rerender, onFilterChange } = renderSession("live");

    rerender(
      <ScanSession
        scope={"all" as never}
        categories={[]}
        source="archive"
        filter="firstPlays"
        onSourceChange={vi.fn()}
        onFilterChange={onFilterChange}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Archive · across Lore · first plays")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Archive filter" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Live scan controls" })).toBeNull();
    expect(screen.getByTestId("history-scanner")).toBeTruthy();
    expect(screen.getByRole("button", { name: "First plays" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Crossings" }));
    expect(onFilterChange).toHaveBeenCalledWith("crossings");
  });
});