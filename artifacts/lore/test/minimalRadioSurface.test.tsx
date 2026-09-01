// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";
import type { DialSpin } from "../src/hooks/useDialData";
import type { LibraryItem } from "../src/lib/meHooks";
import { MinimalRadioSurface } from "../src/components/MinimalRadioSurface";

const { toggle } = vi.hoisted(() => ({
  toggle: vi.fn(),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: { station: null, status: "idle", toggle },
  }),
}));

function row(slug: string, name: string, nowHit: boolean, lifetime: number): DialLaneRow {
  return {
    ds: {
      station: {
        id: lifetime,
        slug,
        name,
        logoUrl: `https://logo.example/${slug}.png`,
        city: `${name} City`,
        country: "UK",
        streamUrl: `https://stream.example/${slug}`,
        relayUrl: null,
      },
      isLive: true,
      shows: [],
      crossings: 0,
      artistCrossings: 0,
      firstPlayCrossings: 0,
      weekCrossings: 0,
      weekArtistCrossings: 0,
      weekFirstPlayCrossings: 0,
      monthCrossings: 0,
      monthArtistCrossings: 0,
      monthFirstPlayCrossings: 0,
      lifetimeCrossings: lifetime,
      lifetimeArtistCrossings: 0,
      lifetimeFirstPlayCrossings: 0,
      topArtistNames: [],
      topArtistNames24h: [],
      topArtistNames7d: [],
      topArtistNamesLifetime: [],
      albumCrossings: [],
      liveTrack: {
        mbid: `${slug}-mbid`,
        artistMbid: null,
        title: `${name} track`,
        artist: `${name} artist`,
        playedAt: new Date().toISOString(),
        isLibraryHit: nowHit,
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

function crossingSpin(index: number): DialSpin {
  return {
    mbid: `recording-${index}`,
    artistMbid: `artist-${index}`,
    releaseGroupMbid: `release-${index}`,
    title: `Track ${index}`,
    artist: `Artist ${index}`,
    playedAt: new Date(2026, 7, 31, 12, index).toISOString(),
    isLibraryHit: true,
    isArtistHit: false,
    isFirstSpin: false,
    releaseYear: 2000 + index,
    ageTier: null,
  };
}

function libraryItem(
  index: number,
  artworkUrl: string | null = `https://art.example/${index}.jpg`,
): LibraryItem {
  return {
    mbid: `recording-${index}`,
    provenance: { kind: "keep" },
    addedAt: new Date(2026, 7, 31, 12, index).toISOString(),
    recording: {
      title: `Track ${index}`,
      artist: `Artist ${index}`,
      artistMbid: `artist-${index}`,
      artworkUrl,
      albumTitle: `Album ${index}`,
      releaseGroupMbid: `release-${index}`,
      spotifyUrl: null,
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("MinimalRadioSurface", () => {
  it("renders roomy three-line rows, keeps identity first, and tunes from Now", () => {
    render(
      <MinimalRadioSurface
        rows={[row("alpha", "Alpha", true, 1), row("beta", "Beta", true, 5)]}
        libraryItems={[]}
        preset="now"
        activeCategories={new Set(["campus"])}
        onToggleCategory={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Alpha" }).textContent).toBe("Alpha");
    expect(screen.getByText("Alpha City")).toBeTruthy();
    expect(screen.queryByText("UK")).toBeNull();
    expect(document.querySelectorAll(".minimal-radio-card__crossing.is-live")).toHaveLength(2);
    expect(screen.getByText("Alpha artist")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tune in to Alpha" }).textContent)
      .toContain("Alpha track");
    expect(screen.getByRole("button", { name: "Tune in to Alpha" }).className)
      .toContain("minimal-radio-card__now");
    expect(screen.getAllByTestId("minimal-radio-card")[0]?.children).toHaveLength(4);
    expect(document.querySelector("[data-station-mark='logo']")).toBeNull();
    expect(screen.queryByText(/matched|shown/i)).toBeNull();
    expect(screen.getAllByTestId("minimal-radio-crossing")).toHaveLength(2);
    expect(screen.getAllByTestId("minimal-radio-crossing")
      .every((element) => element.textContent?.includes("1crossing · this set"))).toBe(true);

    const hero = screen.getByTestId("minimal-radio-hero");
    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tune in to Beta" }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("shows the crossing count and range below Now Playing", () => {
    const station = row("alpha", "Alpha", false, 1);
    station.ds.crossings = 2;

    render(
      <MinimalRadioSurface rows={[station]} libraryItems={[]} preset="now" />,
    );

    expect(screen.getByLabelText("2 crossings, 24 hr")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-crossing").textContent)
      .toContain("2crossings · 24 hr");
    expect(
      screen.getByTestId("minimal-radio-crossing").previousElementSibling
        ?.classList.contains("minimal-radio-card__now"),
    ).toBe(true);
    expect(screen.queryByTestId("minimal-radio-hero-crossing")).toBeNull();
  });

  it("renders both artist and track, and uses honest off-air metadata", () => {
    const station = row("quiet", "Quiet", false, 1);
    station.ds.crossings = 1;
    station.ds.liveTrack = null;

    render(
      <MinimalRadioSurface rows={[station]} libraryItems={[]} preset="now" />,
    );

    expect(screen.getByText("Not broadcasting")).toBeTruthy();
    expect(screen.queryByText("Quiet track")).toBeNull();
  });

  it("shows the two newest crossing covers with resolved artwork", () => {
    const station = row("alpha", "Alpha", true, 6);
    const spins = Array.from({ length: 6 }, (_, index) => crossingSpin(index + 1));
    station.ds.liveTrack = spins[5]!;
    station.show = {
      runId: 1,
      showName: "The Test Show",
      djName: "DJ Test",
      startedAt: "2026-08-31T12:00:00.000Z",
      endedAt: "2026-08-31T14:00:00.000Z",
      ianaTimezone: "America/Los_Angeles",
      state: "live",
      spins,
      crossings: 6,
      artistCrossings: 0,
      topArtists: [],
      topArtistNames: [],
      currentTrack: spins[5]!,
      isPickerShow: false,
      pickerId: null,
    };

    render(
      <MinimalRadioSurface
        rows={[station]}
        libraryItems={Array.from(
          { length: 6 },
          (_, index) => libraryItem(index + 1, index === 5 ? null : undefined),
        )}
        preset="now"
      />,
    );

    const albumLinks = screen.getAllByRole("link", { name: /^Open / });
    expect(albumLinks).toHaveLength(2);
    expect(albumLinks[0]?.getAttribute("href")).toBe("/album/release-5");
    expect(document.querySelectorAll(".minimal-radio-card__album img")).toHaveLength(2);
    expect(document.querySelectorAll(".minimal-radio-card__album-swatch")).toHaveLength(0);
    expect(document.querySelectorAll(".minimal-radio-card__album")).toHaveLength(2);
    const crossingHeader = screen.getByTestId("minimal-radio-crossing");
    expect(crossingHeader.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(crossingHeader);
    expect(crossingHeader.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("minimal-radio-card").className).toContain("is-expanded");
  });

  it("uses station-level recent crossing spins when the saved cover is resolved", () => {
    const station = row("alpha", "Alpha", false, 1);
    station.ds.crossings = 1;
    const stationSpin = crossingSpin(7);

    render(
      <MinimalRadioSurface
        rows={[station]}
        libraryItems={[libraryItem(7)]}
        recentSpinsBySlug={new Map([["alpha", [stationSpin]]])}
        preset="now"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open Album 7 by Artist 7" }).getAttribute("href"),
    ).toBe("/album/release-7");
  });

  it("omits stations with no active crossing and shows one empty state", () => {
    render(
      <MinimalRadioSurface
        rows={[row("quiet", "Quiet", false, 0), row("dark", "Dark", false, 0)]}
        libraryItems={[]}
        preset="now"
      />,
    );

    expect(screen.queryAllByTestId("minimal-radio-card")).toHaveLength(0);
    expect(screen.getByTestId("minimal-radio-no-candidates")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-no-candidates").textContent)
      .not.toMatch(/saved albums|matched|shown/i);
  });

  it("shows lifetime-only stations after toggling the lifetime window", () => {
    render(
      <MinimalRadioSurface
        rows={[row("archive", "Archive", false, 5)]}
        libraryItems={[]}
        preset="now"
      />,
    );

    expect(screen.queryByTestId("minimal-radio-card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show lifetime crossings" }));
    expect(screen.getByTestId("minimal-radio-card")).toBeTruthy();
    expect(screen.getByLabelText("5 crossings, lifetime")).toBeTruthy();
  });
});