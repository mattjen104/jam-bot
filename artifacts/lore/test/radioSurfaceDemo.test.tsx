// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
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

  test("leads with station identity and makes artist-lens copy specific", () => {
    render(
      <RadioSurface
        stations={[matchingStation()]}
        visibleSeeds={["Stereolab"]}
        hasSeeds
        hasLibrary
        showHeader={false}
        focusedArtist="Stereolab"
      />,
    );

    expect(screen.getByText("Stations that play Stereolab")).toBeTruthy();
    expect(screen.getByText("KEXP 90.3 FM")).toBeTruthy();
    expect(screen.getByText("Seattle")).toBeTruthy();
    expect(screen.queryByText("French Disko")).toBeNull();
    expect(screen.getByText("Library match · on air")).toBeTruthy();
    expect(screen.getByText("Stereolab")).toBeTruthy();
    expect(screen.getByText("Has played Stereolab from your music")).toBeTruthy();
    expect(screen.queryByText(/Has played your artists 6 times/)).toBeNull();
    expect(screen.getAllByText("KEXP 90.3 FM")).toHaveLength(1);
  });
});