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

vi.mock("../src/lib/dialFilterState", () => ({
  useDialSkipped: () => ({ isSkipped: () => false, toggleSkip: vi.fn() }),
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
      lifetimeCrossings: lifetime,
      lifetimeArtistCrossings: 0,
      lifetimeFirstPlayCrossings: 0,
      topArtistNames: [],
      topArtistNames24h: [],
      topArtistNames7d: [],
      topArtistNamesLifetime: [],
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

function libraryItem(index: number, artworkUrl: string | null = `https://art.example/${index}.jpg`): LibraryItem {
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
  it("shows a vertical card stack, changes the active card with the keyboard, and tunes in explicitly", () => {
    render(
      <MinimalRadioSurface
        rows={[row("alpha", "Alpha", true, 1), row("beta", "Beta", false, 5)]}
        libraryItems={[]}
        preset="now"
        activeCategories={new Set(["campus"])}
        onToggleCategory={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
    const stationLabel = screen.getByTestId("minimal-radio-station-label-alpha");
    expect(stationLabel.textContent).toContain("Alpha");
    expect(stationLabel.textContent).toContain("Alpha City");
    expect(stationLabel.textContent).not.toContain("UK");
    expect(screen.getByRole("button", { name: "Tune in to Alpha" }).className).toContain(
      "minimal-radio-card__station",
    );
    const alphaCard = screen.getByTestId("minimal-radio-hero-card-alpha").querySelector(".minimal-radio-card");
    expect(alphaCard?.children[0]?.classList.contains("minimal-radio-card__track")).toBe(true);
    expect(alphaCard?.children[1]?.classList.contains("minimal-radio-card__station")).toBe(true);
    expect(alphaCard?.children[2]?.classList.contains("minimal-radio-card__albums")).toBe(true);
    expect(alphaCard?.children).toHaveLength(3);
    expect(alphaCard?.children[1]?.querySelector(".minimal-radio-card__station-crossing")).not.toBeNull();
    expect(screen.getByTestId("minimal-radio-hero-card-alpha").querySelector(".minimal-radio-card__track .minimal-radio-card__play")).toBeNull();
    expect(screen.queryByRole("button", { name: /Skip/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Keep/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /station page/i })).toBeNull();
    expect(screen.getByTestId("minimal-radio-hero-card-alpha").querySelector("[data-station-mark='logo']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show lifetime crossings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Station type/ })).toBeTruthy();
    expect(screen.queryByTestId("minimal-radio-rail")).toBeNull();
    expect(screen.getByTestId("minimal-radio-hero-card-alpha")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-card-beta")).toBeTruthy();
    const hero = screen.getByTestId("minimal-radio-hero");
    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(toggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tune in to Beta" }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("shows the selected station crossing summary without adding crossing chips", () => {
    render(
      <MinimalRadioSurface
        rows={[row("alpha", "Alpha", true, 1), row("beta", "Beta", false, 5)]}
        libraryItems={[]}
        preset="now"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("minimal-radio-hero"), { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(document.querySelector(".fdrow__crossing-dot")).toBeNull();
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("5 · lifetime");
    expect(screen.getByTestId("minimal-radio-hero-crossing").getAttribute("aria-label"))
      .toBe("5 crossings lifetime");
  });

  it("links the exact lifetime crossing covers to their album pages in recency order", () => {
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
    const libraryItems = [
      ...Array.from({ length: 6 }, (_, index) => libraryItem(index + 1, index === 5 ? null : undefined)),
      {
        ...libraryItem(99),
        recording: {
          ...libraryItem(99).recording!,
          artist: "Artist 6",
          artistMbid: "artist-6",
        },
      },
    ];

    render(
      <MinimalRadioSurface
        rows={[station]}
        libraryItems={libraryItems}
        preset="now"
      />,
    );

    const nowPlaying = screen.getByLabelText("Current track");
    expect(nowPlaying.textContent).toContain("Artist 6");
    expect(nowPlaying.textContent).not.toContain("Track 6");
    expect(nowPlaying.textContent).toContain("The Test Show");
    const albumLinks = screen.getAllByRole("link", { name: /^Open Album/ });
    expect(albumLinks).toHaveLength(6);
    expect(albumLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/album/release-6",
      "/album/release-5",
      "/album/release-4",
      "/album/release-3",
      "/album/release-2",
      "/album/release-1",
    ]);
    expect(screen.queryByRole("link", { name: "Open Album 99 by Artist 6" })).toBeNull();
    expect(albumLinks[0]?.querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("https://coverartarchive.org/release-group/release-6/front-1200"),
    );
  });

  it("hides placeholder show names from the now-playing cell", () => {
    const station = row("alpha", "Alpha", true, 1);
    station.show = { showName: "Unknown show" } as NonNullable<typeof station.show>;

    render(
      <MinimalRadioSurface
        rows={[station]}
        libraryItems={[]}
        preset="now"
      />,
    );

    const nowPlaying = screen.getByLabelText("Current track");
    expect(nowPlaying.textContent).toContain("Alpha artist");
    expect(nowPlaying.textContent).not.toMatch(/unknown show/i);
  });

  it("shows a release-group crossing cover even when that album is outside the loaded library page", () => {
    const station = row("alpha", "Alpha", true, 1);
    station.ds.liveTrack = crossingSpin(42);

    render(
      <MinimalRadioSurface
        rows={[station]}
        libraryItems={[]}
        preset="now"
      />,
    );

    const album = screen.getByRole("link", { name: "Open Track 42 by Artist 42" });
    expect(album.getAttribute("href")).toBe("/album/release-42");
    expect(album.querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("https://coverartarchive.org/release-group/release-42/front-1200"),
    );
  });

  it("shows covers from station-level recent spins when the station has no schedule run", () => {
    const station = row("alpha", "Alpha", false, 1);
    const stationSpin = crossingSpin(7);

    render(
      <MinimalRadioSurface
        rows={[station]}
        libraryItems={[]}
        recentSpinsBySlug={new Map([["alpha", [stationSpin]]])}
        preset="now"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open Track 7 by Artist 7" }).getAttribute("href"),
    ).toBe("/album/release-7");
  });

  it("fills From your crate for an older lifetime crossing when no recent spin detail remains", () => {
    const station = row("alpha", "Alpha", false, 3);
    station.ds.topArtistNamesLifetime = ["Artist 12"];

    render(
      <MinimalRadioSurface
        rows={[station]}
        libraryItems={[libraryItem(12)]}
        preset="now"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open Album 12 by Artist 12" }).getAttribute("href"),
    ).toBe("/album/release-12");
    expect(screen.queryByText("Your saved albums will appear here when this station crosses them."))
      .toBeNull();
  });

  it("keeps one full card per station and synchronizes keyboard navigation", () => {
    render(
      <MinimalRadioSurface
        rows={[row("alpha", "Alpha", true, 1), row("beta", "Beta", false, 5), row("gamma", "Gamma", false, 3)]}
        libraryItems={[]}
        preset="now"
      />,
    );
    const hero = screen.getByTestId("minimal-radio-hero");
    expect(screen.queryByTestId("minimal-radio-rail")).toBeNull();
    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(3);

    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toContain("5");

    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "Gamma" })).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toContain("3");
  });

  it("removes the station rail and renders one hero per station", () => {
    render(
      <MinimalRadioSurface
        rows={[row("alpha", "Alpha", true, 1), row("beta", "Beta", false, 5)]}
        libraryItems={[]}
        preset="now"
      />,
    );
    expect(screen.queryByTestId("minimal-radio-rail")).toBeNull();
    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tune in to Alpha" })).toBeTruthy();
  });

  it("uses vertical keyboard navigation and leaves horizontal gestures to the album rail", () => {
    render(
      <MinimalRadioSurface
        rows={[row("alpha", "Alpha", true, 1), row("beta", "Beta", false, 5)]}
        libraryItems={[]}
        preset="now"
      />,
    );
    const hero = screen.getByTestId("minimal-radio-hero");
    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();

    fireEvent.keyDown(hero, { key: "ArrowUp" });
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
  });

  it("falls through timeframes and can force lifetime counts on every station", () => {
    const setRow = row("set", "Set", true, 11);
    const dayRow = row("day", "Day", false, 12);
    dayRow.ds.crossings = 3;
    const weekRow = row("week", "Week", false, 13);
    weekRow.ds.weekArtistCrossings = 4;
    const monthRow = row("month", "Month", false, 14);
    monthRow.ds.monthCrossings = 6;
    render(
      <MinimalRadioSurface
        rows={[setRow, dayRow, weekRow, monthRow]}
        libraryItems={[]}
        preset="now"
      />,
    );
    expect(screen.getByTestId("minimal-radio-hero-card-set")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-card-day")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-card-week")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-card-month")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("1 · this set");
    expect(screen.getByTestId("minimal-radio-hero-crossing").getAttribute("aria-label"))
      .toBe("1 crossing this set");
    const hero = screen.getByTestId("minimal-radio-hero");
    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("3 · 24 hr");
    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("6 · 30d");
    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("4 · 7d");
    fireEvent.keyDown(hero, { key: "ArrowUp" });
    fireEvent.keyDown(hero, { key: "ArrowUp" });
    fireEvent.keyDown(hero, { key: "ArrowUp" });
    fireEvent.click(screen.getByRole("button", { name: "Show lifetime crossings" }));
    expect(screen.getByTestId("minimal-radio-hero-card-set")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-card-day")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-card-week")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-card-month")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("11 · lifetime");
    expect(screen.getByRole("button", { name: "Show lifetime crossings" }).textContent).toBe("Auto");
  });

  it("shows an honest zero-lifetime summary when no timeframe has crossings", () => {
    render(
      <MinimalRadioSurface
        rows={[row("quiet", "Quiet", false, 0)]}
        libraryItems={[]}
        preset="now"
      />,
    );
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("0 · lifetime");
    expect(screen.getByTestId("minimal-radio-hero-crossing").getAttribute("aria-label"))
      .toBe("0 crossings lifetime");
  });

  it("keeps the hero and remote summaries aligned when lifetime mode is toggled", () => {
    const first = row("first", "First", true, 9);
    const second = row("second", "Second", false, 12);
    second.ds.crossings = 4;
    render(
      <MinimalRadioSurface
        rows={[first, second]}
        libraryItems={[]}
        preset="now"
      />,
    );

    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("1 · this set");
    expect(screen.getByTestId("minimal-radio-hero-card-first")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show lifetime crossings" }));
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("9 · lifetime");
    expect(screen.getByTestId("minimal-radio-hero-card-first")).toBeTruthy();

    fireEvent.keyDown(screen.getByTestId("minimal-radio-hero"), { key: "ArrowDown" });
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("12 · lifetime");
    expect(screen.getByTestId("minimal-radio-hero-card-second")).toBeTruthy();
    fireEvent.click(screen.getByTestId("radio-preset-lifetime"));
    expect(screen.getByTestId("minimal-radio-hero-crossing").textContent).toBe("4 · 24 hr");
    expect(screen.getByTestId("minimal-radio-hero-card-second")).toBeTruthy();
  });
});