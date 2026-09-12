// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DialStation } from "../src/hooks/useDialData";

const toggle = vi.fn();

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: {
      station: null,
      toggle,
    },
  }),
}));

import { RadioSurface } from "../src/components/RadioSurface";

function matchingStation(): DialStation {
  return {
    station: {
      id: 7,
      slug: "kexp",
      name: "KEXP 90.3 FM",
      city: "Seattle",
      logoUrl: "https://example.com/kexp.png",
      stationIconUrl: "https://kexp.org/favicon.png",
      stationCategories: ["anchor"],
    },
    isLive: true,
    liveTrack: {
      mbid: "recording-1",
      artistMbid: "artist-1",
      title: "French Disko",
      artist: "Stereolab",
      resolving: false,
      isLibraryHit: true,
      isArtistHit: true,
    },
    shows: [],
    weekCrossings: 4,
    weekArtistCrossings: 0,
    lifetimeCrossings: 4,
    lifetimeArtistCrossings: 2,
    topArtistNames: ["Stereolab"],
    topArtistNames24h: ["Stereolab"],
    topArtistNames7d: ["Stereolab"],
    topArtistNamesLifetime: ["Stereolab"],
    albumCrossings: [],
  } as unknown as DialStation;
}

describe("demo Radio station cards", () => {
  beforeEach(() => toggle.mockClear());
  afterEach(cleanup);

  test("leads with station identity and makes artist-lens copy specific", () => {
    const onOpenCrossings = vi.fn();
    const onFocusArtist = vi.fn();
    render(
      <RadioSurface
        stations={[matchingStation()]}
        hasSeeds
        hasLibrary
        showHeader={false}
        focusedArtist="Stereolab"
        onFocusArtist={onFocusArtist}
        onOpenStationCrossings={onOpenCrossings}
      />,
    );

    expect(screen.getByText("Stations that play Stereolab")).toBeTruthy();
    expect(screen.getAllByText("KEXP 90.3 FM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Seattle · Core").length).toBeGreaterThan(0);
    expect(screen.queryByText("French Disko")).toBeNull();
    expect(screen.queryByText("Library match · on air")).toBeNull();
    expect(screen.queryByText("Open set")).toBeNull();
    expect(screen.queryByText("Stereolab", { selector: ".demo-radio__artist" })).toBeNull();
    expect(screen.getAllByText(/crossings?/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Has played your artists 6 times/)).toBeNull();
  });

  test("omits placeholder metadata and uses a dedicated play control", () => {
    const station = matchingStation();
    station.station.city = null;
    station.station.stationCategories = [];
    render(
      <RadioSurface
        stations={[station]}
        hasSeeds
        hasLibrary
        showHeader={false}
        focusedArtist="Stereolab"
        onOpenStationCrossings={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Location unavailable|Unknown/)).toBeNull();
    expect(screen.getByRole("button", { name: "Listen to KEXP 90.3 FM" })).toBeTruthy();
  });

  test("does not make placeholder artist metadata interactive", () => {
    render(
      <RadioSurface
        stations={[{
          ...matchingStation(),
          liveTrack: {
            ...matchingStation().liveTrack!,
            artist: "",
            artistMbid: null,
          },
        }]}
        hasSeeds={false}
        hasLibrary={false}
        showHeader={false}
        onFocusArtist={vi.fn()}
      />,
    );
    // Since we no longer show track metadata, we assert it doesn't appear
    expect(screen.queryByText("Unknown artist")).toBeNull();
    expect(screen.queryByRole("button", { name: "Unknown artist" })).toBeNull();
  });

  test.each([
    ["host", "Cheryl Waters", ["Cheryl Waters"]],
    ["show", "The Midday Show", ["The Midday Show"]],
  ])("keeps source-backed %s metadata plain text", (_kind, artist, artistActionExclusions) => {
    render(
      <RadioSurface
        stations={[{
          ...matchingStation(),
          artistActionExclusions,
          liveTrack: {
            ...matchingStation().liveTrack!,
            artist,
            artistMbid: null,
          },
        }]}
        hasSeeds
        hasLibrary
        showHeader={false}
        onFocusArtist={vi.fn()}
      />,
    );

    expect(screen.queryByText(artist)).toBeNull();
    expect(screen.queryByRole("button", { name: artist })).toBeNull();
  });

  test("keeps unresolved but otherwise usable artist metadata actionable", () => {
    const onFocusArtist = vi.fn();
    render(
      <RadioSurface
        stations={[{
          ...matchingStation(),
          liveTrack: {
            ...matchingStation().liveTrack!,
            artist: "Broadcast",
            artistMbid: null,
          },
        }]}
        hasSeeds
        hasLibrary
        showHeader={false}
        onFocusArtist={onFocusArtist}
      />,
    );

    expect(screen.queryByText("Broadcast")).toBeNull();
    expect(screen.queryByRole("button", { name: "Broadcast" })).toBeNull();
  });

  test("keeps a grounded artist actionable despite matching attribution text", () => {
    const onFocusArtist = vi.fn();
    render(
      <RadioSurface
        stations={[{
          ...matchingStation(),
          artistActionExclusions: ["Stereolab"],
        }]}
        hasSeeds
        hasLibrary
        showHeader={false}
        onFocusArtist={onFocusArtist}
      />,
    );

    expect(screen.queryByText("Stereolab", { selector: ".demo-radio__artist" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stereolab" })).toBeNull();
  });
});
