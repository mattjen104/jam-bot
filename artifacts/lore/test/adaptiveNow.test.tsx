// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptiveNow } from "../src/components/AdaptiveNow";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: {
      station: null,
      status: "idle",
      toggle: vi.fn(),
      warmup: vi.fn(),
      releaseWarmup: vi.fn(),
      cancelWarmup: vi.fn(),
    },
    ride: { current: null, sourceLabel: null },
  }),
}));

function crossingRow(topArtistNames24h = ["Crossing Artist"]): DialLaneRow {
  return {
    ds: {
      station: {
        id: 1,
        slug: "crossing-station",
        name: "Crossing Station",
        logoUrl: null,
        city: "Seattle",
        country: "US",
        streamUrl: "https://stream.example/crossing",
        relayUrl: null,
        stationCategories: [],
        homepageBlurb: null,
        donateUrl: null,
      },
      isLive: true,
      shows: [],
      crossings: 1,
      artistCrossings: 0,
      firstPlayCrossings: 0,
      weekCrossings: 1,
      weekArtistCrossings: 0,
      weekFirstPlayCrossings: 0,
      monthCrossings: 1,
      monthArtistCrossings: 0,
      monthFirstPlayCrossings: 0,
      lifetimeCrossings: 1,
      lifetimeArtistCrossings: 0,
      lifetimeFirstPlayCrossings: 0,
      topArtistNames: ["Crossing Artist"],
      topArtistNames24h,
      topArtistNames7d: ["Crossing Artist"],
      topArtistNamesLifetime: ["Crossing Artist"],
      albumCrossings: [],
      liveTrack: {
        mbid: "current-mbid",
        artistMbid: null,
        title: "Current Track",
        artist: "Current Artist",
        playedAt: new Date().toISOString(),
        isLibraryHit: false,
        isArtistHit: false,
        isFirstSpin: false,
        releaseYear: null,
        ageTier: null,
      },
    },
    show: null,
    effectiveDjName: null,
  } as DialLaneRow;
}

afterEach(cleanup);

describe("AdaptiveNow crossing evidence", () => {
  it("focuses the named crossing artist, not the currently playing artist", () => {
    const focusArtist = vi.fn();
    render(
      <AdaptiveNow
        rows={[crossingRow()]}
        state="crossing-ready"
        importJob={null}
        activeCategories={new Set()}
        supportOnly={false}
        onToggleCategory={vi.fn()}
        onSetCategories={vi.fn()}
        onToggleSupport={vi.fn()}
        preserveOrder
        onFocusArtist={focusArtist}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Focus For You on Crossing Artist from this Library crossing",
    }));
    expect(focusArtist).toHaveBeenCalledWith("Crossing Artist");

    fireEvent.click(screen.getByRole("button", { name: "Focus For You on Current Artist" }));
    expect(focusArtist).toHaveBeenLastCalledWith("Current Artist");
  });

  it("keeps ambiguous crossing evidence non-interactive", () => {
    render(
      <AdaptiveNow
        rows={[crossingRow(["Crossing Artist", "Another Artist"])]}
        state="crossing-ready"
        importJob={null}
        activeCategories={new Set()}
        supportOnly={false}
        onToggleCategory={vi.fn()}
        onSetCategories={vi.fn()}
        onToggleSupport={vi.fn()}
        preserveOrder
        onFocusArtist={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", {
      name: /from this Library crossing/,
    })).toBeNull();
    expect(screen.queryByRole("link", {
      name: /Played Crossing Artist and Another Artist/,
    })).toBeNull();
    expect(screen.getByText("Played Crossing Artist and Another Artist from your library.").tagName)
      .toBe("SPAN");
  });
});