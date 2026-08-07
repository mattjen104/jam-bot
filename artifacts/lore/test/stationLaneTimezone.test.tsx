// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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