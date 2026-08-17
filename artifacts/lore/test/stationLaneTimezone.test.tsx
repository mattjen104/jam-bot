// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StationLane } from "../src/components/StationLane";
import type { DialShow, DialStation } from "../src/hooks/useDialData";

function show(overrides: Partial<DialShow>): DialShow {
  return {
    runId: 1,
    showName: "Overnight",
    djName: null,
    startedAt: "2026-01-01T04:30:00.000Z",
    endedAt: "2026-01-01T05:30:00.000Z",
    ianaTimezone: "America/New_York",
    state: "past",
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

function station(shows: DialShow[]): DialStation {
  return {
    station: {
      slug: "eastern-radio",
      name: "Eastern Radio",
      ianaTimezone: "America/New_York",
      automationClass: null,
      streamUrl: null,
      websiteUrl: null,
      hidden: false,
      favorite: false,
    } as DialStation["station"],
    isLive: true,
    shows,
    crossings: 0,
    artistCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
  };
}

describe("StationLane station-local time labels", () => {
  it("uses the station timezone for live and past sets across the local date boundary", () => {
    // Both starts are on Jan 1 UTC. In New York, the live set begins Dec 31
    // at 11:30pm and the following past set begins Jan 1 at midnight.
    render(
      <StationLane
        dialStation={station([
          show({ runId: 1, state: "live", endedAt: "2026-01-01T05:30:00.000Z" }),
          show({
            runId: 2,
            state: "past",
            startedAt: "2026-01-01T05:00:00.000Z",
            endedAt: "2026-01-01T06:00:00.000Z",
          }),
        ])}
        isPinned={false}
        onStationClick={() => {}}
        onShowClick={() => {}}
        onPinToggle={() => {}}
        onPlay={() => {}}
        isActive={false}
      />,
    );

    expect(screen.getByText("11:30pm–now")).toBeTruthy();
    expect(screen.getByText("12:00am–1:00am")).toBeTruthy();
  });
});

describe("StationLane controls", () => {
  it("uses the fixed site control for attribution-only stations without tuning in", () => {
    const onPlay = vi.fn();
    const onStationClick = vi.fn();
    const dialStation = station([]);
    dialStation.station = {
      ...dialStation.station,
      name: "Very Long Community Radio Station",
      homepageUrl: "https://example.org",
    } as DialStation["station"];

    render(
      <StationLane
        dialStation={dialStation}
        isPinned={false}
        onStationClick={onStationClick}
        onShowClick={() => {}}
        onPinToggle={() => {}}
        onPlay={onPlay}
        isActive={false}
      />,
    );

    const link = screen.getByTestId("station-site-link") as HTMLAnchorElement;
    expect(link.className).toContain("dial-lane__play");
    expect(link.getAttribute("aria-label")).toBe("Open Very Long Community Radio Station site");
    expect(link.title).toBe("Open Very Long Community Radio Station site");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");

    fireEvent.click(link);
    expect(onPlay).not.toHaveBeenCalled();
    expect(onStationClick).not.toHaveBeenCalled();
  });

  it("clicking the station name still activates the lane header", () => {
    const onStationClick = vi.fn();
    const dialStation = station([]);

    const { container } = render(
      <StationLane
        dialStation={dialStation}
        isPinned={false}
        onStationClick={onStationClick}
        onShowClick={() => {}}
        onPinToggle={() => {}}
        onPlay={() => {}}
        isActive={false}
      />,
    );

    const name = container.querySelector(".dial-lane__name") as HTMLElement;
    fireEvent.click(name);
    expect(onStationClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the playable control and active stop state", () => {
    const onPlay = vi.fn();
    const dialStation = station([]);
    dialStation.station = {
      ...dialStation.station,
      streamUrl: "https://example.org/stream",
    } as DialStation["station"];

    const { rerender } = render(
      <StationLane
        dialStation={dialStation}
        isPinned={false}
        onStationClick={() => {}}
        onShowClick={() => {}}
        onPinToggle={() => {}}
        onPlay={onPlay}
        isActive={false}
      />,
    );
    const btn = screen.getByTestId("station-play-btn") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toBe("Play Eastern Radio");
    expect(btn.textContent).toBe("▶");

    rerender(
      <StationLane
        dialStation={dialStation}
        isPinned={false}
        onStationClick={() => {}}
        onShowClick={() => {}}
        onPinToggle={() => {}}
        onPlay={onPlay}
        isActive
      />,
    );
    expect(btn.getAttribute("aria-label")).toBe("Stop Eastern Radio");
    expect(btn.textContent).toBe("■");
  });

  it("keeps long station names in a bounded no-wrap scroll region", () => {
    const dialStation = station([]);
    dialStation.station = {
      ...dialStation.station,
      name: "A station name long enough to require user-controlled horizontal scrolling",
      homepageUrl: "javascript:alert(1)",
    } as DialStation["station"];

    const { container } = render(
      <StationLane
        dialStation={dialStation}
        isPinned={false}
        onStationClick={() => {}}
        onShowClick={() => {}}
        onPinToggle={() => {}}
        onPlay={() => {}}
        isActive={false}
      />,
    );
    const header = container.querySelector(".dial-lane__hd") as HTMLElement;
    const name = container.querySelector(".dial-lane__name") as HTMLElement;
    // The header must not carry inline wrapping overrides (wrapping is controlled via CSS)
    expect(header.style.whiteSpace).toBe("");
    // Station name span must be focusable and carry its accessible label
    expect(name.getAttribute("tabindex")).toBe("0");
    expect(name.getAttribute("aria-label")).toBe(dialStation.station.name);
    // An invalid homepageUrl must not produce a site-link anchor
    expect(container.querySelector(".dial-lane__site-link")).toBeNull();
  });
});