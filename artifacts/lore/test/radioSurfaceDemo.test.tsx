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
    expect(screen.getByText("KEXP 90.3 FM")).toBeTruthy();
    expect(screen.getByText("Seattle")).toBeTruthy();
    expect(screen.queryByText("French Disko")).toBeNull();
    expect(screen.getByText("Library match · on air")).toBeTruthy();
    expect(screen.queryByText("Open set")).toBeNull();
    expect(screen.getByText("Stereolab")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stereolab" }));
    expect(onFocusArtist).toHaveBeenCalledWith("Stereolab");
    expect(screen.getByText("Has played Stereolab from your music")).toBeTruthy();
    fireEvent.click(screen.getByText("Has played Stereolab from your music"));
    expect(onOpenCrossings).toHaveBeenCalledWith("kexp");
    expect(screen.queryByText(/Has played your artists 6 times/)).toBeNull();
    expect(screen.getAllByText("KEXP 90.3 FM")).toHaveLength(1);
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
    expect(screen.getByText("Unknown artist").tagName).toBe("DIV");
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

    expect(screen.getByText(artist).tagName).toBe("DIV");
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

    fireEvent.click(screen.getByRole("button", { name: "Broadcast" }));
    expect(onFocusArtist).toHaveBeenCalledWith("Broadcast");
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

    fireEvent.click(screen.getByRole("button", { name: "Stereolab" }));
    expect(onFocusArtist).toHaveBeenCalledWith("Stereolab");
  });
});
