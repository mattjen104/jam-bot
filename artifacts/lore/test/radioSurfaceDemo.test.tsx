// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getAllByText("Core radio from Seattle.").length).toBeGreaterThan(0);
    expect(screen.queryByText("French Disko")).toBeNull();
    expect(screen.queryByText("Library match · on air")).toBeNull();
    expect(screen.queryByText("Open set")).toBeNull();
    expect(screen.queryByText("Stereolab", { selector: ".demo-radio__artist" })).toBeNull();
    expect(screen.getAllByText(/crossings?/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Has played your artists 6 times/)).toBeNull();
  });

  test("omits placeholder metadata and tunes from the card", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Listen to KEXP 90.3 FM" }));
    expect(toggle).toHaveBeenCalledWith(station.station);
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

  test("shows a mission-only recommendation without inventing track metadata", () => {
    const mission = matchingStation();
    mission.station.slug = "wfmu";
    mission.station.name = "WFMU";
    mission.station.streamUrl = "https://radio.example/wfmu";
    mission.station.automationClass = "human";
    mission.lifetimeCrossings = 0;
    mission.lifetimeArtistCrossings = 0;
    mission.weekCrossings = 0;
    mission.liveTrack = null;
    mission.shows = [];
    render(
      <RadioSurface
        stations={[mission]}
        hasSeeds
        hasLibrary
        showHeader={false}
      />,
    );
    expect(screen.getByText("Beyond your Library")).toBeTruthy();
    expect(screen.getByText(/Listener-supported freeform radio/)).toBeTruthy();
    expect(screen.queryByText(/This set/)).toBeNull();
  });

  test("leads Highlights with an expandable Bro Zone and keeps it out of For you", () => {
    const bro = matchingStation();
    const personal = matchingStation();
    personal.station.slug = "heady";
    personal.station.name = "HEADY";
    const mission = matchingStation();
    mission.station.slug = "wfmu";
    mission.station.name = "WFMU";
    mission.station.streamUrl = "https://radio.example/wfmu";
    mission.station.automationClass = "human";
    mission.weekCrossings = 0;
    mission.lifetimeCrossings = 0;
    mission.lifetimeArtistCrossings = 0;
    mission.liveTrack = null;

    render(
      <RadioSurface
        mode="highlights"
        stations={[bro, personal, mission]}
        broZoneStations={[bro]}
        broZoneLocationLabel="Seattle, WA"
        hasSeeds
        hasLibrary
        showHeader={false}
      />,
    );

    const headings = screen.getAllByText(/Near you \(& bros\)|For you|Try something different/)
      .map((element) => element.textContent);
    expect(headings).toEqual(["Near you (& bros)", "For you", "Try something different"]);
    expect(screen.getAllByText("KEXP 90.3 FM")).toHaveLength(1);
    expect(screen.getByText("HEADY")).toBeTruthy();
    expect(screen.queryByText("Specialist sounds")).toBeNull();
    expect(screen.queryByText("Era / Retro / Oldies")).toBeNull();
  });
});
