// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("../src/components/KeepButton", () => ({
  KeepButton: () => <button type="button">Keep</button>,
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
        visibleSeeds={["Stereolab"]}
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

  test("groups artist, song, and station actions in one row menu", async () => {
    const onAddArtist = vi.fn().mockResolvedValue(undefined);
    const onFocusArtist = vi.fn();
    const onOpenCrossings = vi.fn();
    render(
      <RadioSurface
        stations={[matchingStation()]}
        visibleSeeds={[]}
        hasSeeds={false}
        hasLibrary={false}
        showHeader={false}
        onAddArtist={onAddArtist}
        onFocusArtist={onFocusArtist}
        onOpenStationCrossings={onOpenCrossings}
      />,
    );

    expect(screen.queryByText("Add to my artists")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More options for French Disko" }));

    expect(screen.getByLabelText("Artist actions")).toBeTruthy();
    expect(screen.getByLabelText("Song actions")).toBeTruthy();
    expect(screen.getByLabelText("Station actions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to my artists" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open song details" }).getAttribute("href"))
      .toBe("/song/recording-1");
    expect(screen.queryByText("+")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add to my artists" }));
    await waitFor(() => expect(onAddArtist).toHaveBeenCalledWith("Stereolab"));
  });

  test("shows an honest added state and suppresses placeholder artist actions", () => {
    render(
      <RadioSurface
        stations={[matchingStation()]}
        visibleSeeds={["stereolab"]}
        hasSeeds
        hasLibrary={false}
        showHeader={false}
        onAddArtist={vi.fn()}
        onFocusArtist={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More options for French Disko" }));
    const added = screen.getByRole("button", { name: "Added to my artists" });
    expect(added.getAttribute("aria-pressed")).toBe("true");
    expect(added.hasAttribute("disabled")).toBe(true);

    cleanup();
    const placeholder = matchingStation();
    placeholder.liveTrack = {
      ...placeholder.liveTrack!,
      artist: "",
      artistMbid: null,
    };
    render(
      <RadioSurface
        stations={[placeholder]}
        visibleSeeds={[]}
        hasSeeds={false}
        hasLibrary={false}
        showHeader={false}
        onAddArtist={vi.fn()}
        onFocusArtist={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More options for French Disko" }));
    expect(screen.queryByLabelText("Artist actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to my artists" })).toBeNull();
  });
});