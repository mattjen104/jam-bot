// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("MinimalRadioSurface", () => {
  it("renders artist-only Now rows, keeps identity first, and tunes from Now", () => {
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
    expect(screen.getByTestId("minimal-radio-sheet-header").textContent).toContain("Crossing");
    expect(screen.getByTestId("minimal-radio-sheet-header").textContent).toContain("Premiere");
    expect(screen.getByText("Alpha artist")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tune in to Alpha" }).textContent)
      .toContain("Alpha artist");
    expect(screen.queryByText("Alpha track")).toBeNull();
    expect(screen.getByRole("button", { name: "Tune in to Alpha" }).className)
      .toContain("minimal-radio-card__now");
    expect(screen.getAllByTestId("minimal-radio-card")[0]?.children).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Tune in to Alpha" })
        .closest(".minimal-radio-card__station-line"),
    ).toBeTruthy();
    expect(document.querySelector("[data-station-mark='logo']")).toBeNull();
    expect(screen.queryByText(/matched|shown/i)).toBeNull();
    expect(document.querySelector(".minimal-radio-card__insights-heading")).toBeNull();

    const hero = screen.getByTestId("minimal-radio-hero");
    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tune in to Beta" }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("shows the lifetime crossing badge", () => {
    const station = row("alpha", "Alpha", false, 1);
    station.ds.crossings = 2;
    station.ds.liveTrack = crossingSpin(7);

    render(
      <MinimalRadioSurface
        rows={[station]}
        libraryItems={[libraryItem(7)]}
        preset="now"
      />,
    );

    const heading = screen.getByTestId("minimal-radio-crossing");
    expect(heading.querySelector("strong")?.textContent).toBe("1");
    expect(heading.textContent).not.toContain("crossing");
    expect(heading.getAttribute("aria-label")).toBe("1 lifetime crossings");
    expect(
      screen.getByTestId("minimal-radio-crossing")
        .closest(".minimal-radio-card__album-column--crossings"),
    ).toBeTruthy();
    expect(screen.queryByTestId("minimal-radio-hero-crossing")).toBeNull();
  });

  it("renders only artist metadata and uses honest off-air metadata", () => {
    const station = row("quiet", "Quiet", false, 1);
    station.ds.crossings = 1;
    station.ds.liveTrack = null;

    render(
      <MinimalRadioSurface rows={[station]} libraryItems={[]} preset="now" />,
    );

    expect(screen.getByText("Not broadcasting")).toBeTruthy();
    expect(screen.queryByText("Quiet track")).toBeNull();
  });

  it("switches to a compact station remote and tunes from its tiles", () => {
    render(
      <MinimalRadioSurface
        rows={[row("alpha", "Alpha", true, 1), row("beta", "Beta", true, 2)]}
        libraryItems={[]}
        preset="now"
      />,
    );

    fireEvent.click(screen.getByTestId("minimal-radio-remote-toggle"));

    expect(screen.getByTestId("minimal-radio-remote-view")).toBeTruthy();
    expect(screen.queryByTestId("minimal-radio-sheet-header")).toBeNull();
    expect(screen.getAllByTestId("minimal-radio-remote-station")).toHaveLength(2);
    expect(screen.getByLabelText("Alpha: Alpha artist").textContent)
      .toContain("Alpha artist");

    fireEvent.click(screen.getByLabelText("Alpha: Alpha artist"));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Alpha: Alpha artist").getAttribute("aria-pressed"))
      .toBe("true");
  });

  it("shows one crossing cover collapsed and continues the lifetime grid expanded", () => {
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

    const crossingColumn = document.querySelector(".minimal-radio-card__album-column--crossings");
    expect(crossingColumn).toBeTruthy();
    const albumLinks = within(crossingColumn as HTMLElement).getAllByRole("link", { name: /^Open / });
    expect(albumLinks).toHaveLength(1);
    expect(albumLinks[0]?.getAttribute("href")).toBe("/album/release-5");
    expect(crossingColumn?.querySelectorAll(".minimal-radio-card__album img")).toHaveLength(1);
    expect(document.querySelectorAll(".minimal-radio-card__album-swatch")).toHaveLength(0);
    expect(crossingColumn?.querySelectorAll(".minimal-radio-card__album")).toHaveLength(1);
    const crossingHeader = screen.getByTestId("minimal-radio-crossing");
    expect(crossingHeader.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(crossingHeader);
    expect(crossingHeader.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("minimal-radio-card").className).toContain("is-expanded");
    expect(within(crossingColumn as HTMLElement).getAllByRole("link", { name: /^Open / })).toHaveLength(5);
    expect(crossingColumn?.querySelectorAll(".minimal-radio-card__album img")).toHaveLength(5);
  });

  it("loads station first plays with artwork and expands that column independently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => ({
        items: String(input).includes("filter=crossings")
          ? [{
              id: 700,
              mbid: "crossing-1",
              title: "Known Song",
              artist: "Known Artist",
              artworkUrl: "https://art.example/crossing-1.jpg",
              playedAt: "2026-08-30T16:00:00.000Z",
              station: { slug: "alpha", name: "Alpha" },
            }]
          : [
              {
                id: 701,
                mbid: "first-play-1",
                title: "New Song",
                artist: "New Artist",
                artworkUrl: "https://art.example/first-1.jpg",
                playedAt: "2026-08-29T15:30:00.000Z",
                station: { slug: "alpha", name: "Alpha" },
              },
              {
                id: 702,
                mbid: "first-play-2",
                title: "Another New Song",
                artist: "Another Artist",
                artworkUrl: "https://art.example/first-2.jpg",
                playedAt: "2026-08-28T14:15:00.000Z",
                station: { slug: "alpha", name: "Alpha" },
              },
            ],
      }),
    })));
    const station = row("alpha", "Alpha", false, 1);
    station.ds.crossings = 1;
    station.ds.lifetimeFirstPlayCrossings = 4;

    render(<MinimalRadioSurface rows={[station]} libraryItems={[]} preset="now" />);

    const firstPlays = await waitFor(() => {
      const heading = screen.getByTestId("minimal-radio-first-plays");
      expect(heading.querySelector("strong")?.textContent).toBe("4");
      return heading;
    });
    expect(firstPlays.textContent).toBe("4");
    expect(firstPlays.getAttribute("aria-label")).toBe("4 lifetime premieres");
    const firstPlayColumn = screen
      .getByTestId("minimal-radio-card")
      .querySelector(".minimal-radio-card__album-column--first-plays") as HTMLElement;
    expect(within(firstPlayColumn).getAllByRole("link", { name: /^Open / })).toHaveLength(1);
    expect(firstPlays.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("minimal-radio-card").className).not.toContain("is-expanded");

    fireEvent.click(firstPlays);

    expect(firstPlays.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("minimal-radio-card").className).toContain("is-expanded");
    expect(within(firstPlayColumn).getAllByRole("link", { name: /^Open / })).toHaveLength(2);
    expect(screen.queryByTestId("minimal-radio-crossing")).toBeNull();
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
    expect(screen.queryByLabelText("5 lifetime crossings")).toBeNull();
  });
});