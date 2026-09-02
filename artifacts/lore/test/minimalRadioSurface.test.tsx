// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";
import type { DialSpin } from "../src/hooks/useDialData";
import type { LibraryItem } from "../src/lib/meHooks";
import type { StationCategory } from "../src/lib/dialCategories";
import { MinimalRadioSurface } from "../src/components/MinimalRadioSurface";

const { toggle, startReplay } = vi.hoisted(() => ({
  toggle: vi.fn(),
  startReplay: vi.fn(),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: { station: null, status: "idle", toggle },
    ride: { startReplay },
  }),
}));

function row(
  slug: string,
  name: string,
  nowHit: boolean,
  lifetime: number,
  category?: StationCategory,
): DialLaneRow {
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
        stationCategories: category ? [category] : [],
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
  it("groups live stations and switches global history into a category view", async () => {
    const historyItems = [
      {
        id: 801,
        mbid: "alpha-history",
        title: "Alpha history",
        artist: "Alpha archive artist",
        artworkUrl: "https://art.example/alpha.jpg",
        station: { slug: "alpha", name: "Alpha" },
      },
      {
        id: 802,
        mbid: "beta-history",
        title: "Beta history",
        artist: "Beta archive artist",
        artworkUrl: "https://art.example/beta.jpg",
        station: { slug: "beta", name: "Beta" },
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: historyItems }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const categoryByStationSlug = new Map<string, StationCategory>([
      ["alpha", "campus"],
      ["beta", "anchor"],
    ]);

    render(
      <MinimalRadioSurface
        rows={[
          row("alpha", "Alpha", true, 2, "campus"),
          row("beta", "Beta", true, 2, "anchor"),
        ]}
        libraryItems={[]}
        categoryByStationSlug={categoryByStationSlug}
        preset="now"
      />,
    );

    expect(screen.getByTestId("minimal-radio-overview")).toBeTruthy();
    expect(screen.getByTestId("overview-category-campus")).toBeTruthy();
    expect(screen.getByTestId("overview-category-anchor")).toBeTruthy();
    expect(screen.getByLabelText("Tune in to Alpha, playing Alpha artist")).toBeTruthy();
    expect(screen.queryByText("Alpha track")).toBeNull();

    await waitFor(() => {
      expect(within(screen.getByTestId("overview-history-crossings"))
        .getAllByTestId("overview-history-crossings-item")).toHaveLength(2);
      expect(within(screen.getByTestId("overview-history-firstPlays"))
        .getAllByTestId("overview-history-firstPlays-item")).toHaveLength(2);
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url)).every((url) => !url.includes("station=")))
      .toBe(true);

    fireEvent.click(screen.getByTestId("overview-scope-campus"));

    await waitFor(() => {
      expect(screen.queryByTestId("overview-category-anchor")).toBeNull();
      expect(within(screen.getByTestId("overview-history-crossings"))
        .getAllByTestId("overview-history-crossings-item")).toHaveLength(1);
      expect(within(screen.getByTestId("overview-history-firstPlays"))
        .getAllByTestId("overview-history-firstPlays-item")).toHaveLength(1);
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url)))
      .toContain("/api/player/history?scope=7d&filter=crossings&order=desc&limit=60&categories=campus");

    fireEvent.click(
      within(screen.getByTestId("overview-category-campus"))
        .getByRole("button", { name: "View Campus Radio cards" }),
    );
    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
  });

  it("fetches category premieres beyond the unfiltered home page", async () => {
    const globalItems = Array.from({ length: 18 }, (_, index) => ({
      id: 900 + index,
      mbid: `anchor-${index}`,
      title: `Anchor premiere ${index}`,
      artist: `Anchor artist ${index}`,
      artworkUrl: null,
      station: { slug: "beta", name: "Beta" },
    }));
    const campusItem = {
      id: 999,
      mbid: "campus-beyond-global-page",
      title: "Campus premiere",
      artist: "Campus archive artist",
      artworkUrl: null,
      station: { slug: "alpha", name: "Alpha" },
    };
    const fetchMock = vi.fn().mockImplementation(async (input: string) => ({
      ok: true,
      json: async () => ({
        items:
          input.includes("filter=firstPlays") && input.includes("categories=campus")
            ? [campusItem]
            : input.includes("filter=firstPlays")
              ? globalItems
              : [],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MinimalRadioSurface
        rows={[
          row("alpha", "Alpha", true, 2, "campus"),
          row("beta", "Beta", true, 2, "anchor"),
        ]}
        libraryItems={[]}
        categoryByStationSlug={new Map([
          ["alpha", "campus"],
          ["beta", "anchor"],
        ])}
        preset="now"
      />,
    );

    await waitFor(() => {
      expect(within(screen.getByTestId("overview-history-firstPlays"))
        .queryByText("Campus archive artist")).toBeNull();
      expect(within(screen.getByTestId("overview-history-firstPlays"))
        .getAllByTestId("overview-history-firstPlays-item")).toHaveLength(18);
    });

    fireEvent.click(screen.getByTestId("overview-scope-campus"));

    await waitFor(() => {
      expect(within(screen.getByTestId("overview-history-firstPlays"))
        .getByText("Campus archive artist")).toBeTruthy();
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      "/api/player/history?scope=7d&filter=firstPlays&order=desc&limit=18&home=1&categories=campus",
    );
  });

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

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));

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

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));

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

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));

    expect(screen.getByText("Not broadcasting")).toBeTruthy();
    expect(screen.queryByText("Quiet track")).toBeNull();
  });

  it("shows all remote rows, scopes them by category, and tunes from its tiles", () => {
    const alpha = row("alpha", "Alpha", true, 1, "campus");
    const beta = row("beta", "Beta", true, 2, "anchor");
    const quiet = row("quiet", "Quiet", false, 0, "public");
    quiet.ds.isLive = false;
    quiet.ds.liveTrack = null;
    const extras = Array.from({ length: 5 }, (_, index) => (
      row(`extra-${index}`, `Extra ${index + 1}`, false, index + 3, "public")
    ));

    function RemoteHarness() {
      const [activeCategories, setActiveCategories] = React.useState<Set<StationCategory>>(
        new Set(["campus", "anchor", "public"]),
      );
      const allRows = [alpha, beta, quiet, ...extras];
      const visibleRemoteRows = activeCategories.size === 0
        ? allRows
        : allRows.filter((candidate) => {
            const category = candidate.ds.station.stationCategories?.[0] as StationCategory | undefined;
            return category ? activeCategories.has(category) : false;
          });
      return (
        <MinimalRadioSurface
          rows={[alpha, beta]}
          remoteRows={visibleRemoteRows}
          libraryItems={[]}
          preset="now"
          activeCategories={activeCategories}
          onToggleCategory={(category) => {
            setActiveCategories((previous) => {
              const next = new Set(previous);
              if (next.has(category)) next.delete(category);
              else next.add(category);
              return next;
            });
          }}
          onSetCategories={(categories) => setActiveCategories(new Set(categories))}
        />
      );
    }

    render(<RemoteHarness />);

    expect(screen.getByTestId("minimal-radio-remote-view")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-remote-view").getAttribute("aria-label"))
      .toBe("Compact station preview");
    expect(screen.getAllByTestId("minimal-radio-remote-station")).toHaveLength(6);
    expect(screen.getByTestId("minimal-radio-remote-toggle").getAttribute("aria-pressed"))
      .toBe("false");

    fireEvent.click(screen.getByTestId("minimal-radio-remote-toggle"));

    expect(screen.getByTestId("minimal-radio-remote-view").getAttribute("aria-label"))
      .toBe("Expanded compact station remote");
    expect(screen.queryByTestId("minimal-radio-sheet-header")).toBeNull();
    expect(screen.getAllByTestId("minimal-radio-remote-station")).toHaveLength(8);
    expect(screen.getByTestId("minimal-radio-remote-category-all")).toBeTruthy();
    expect(screen.getByTestId("minimal-radio-remote-category-campus")).toBeTruthy();
    expect(screen.getByText("Alpha", { selector: ".minimal-radio__remote-station-name" })).toBeTruthy();
    expect(screen.getByText("Alpha artist", { selector: ".minimal-radio__remote-artist" })).toBeTruthy();
    expect(screen.getByText("Not broadcasting")).toBeTruthy();

    fireEvent.click(screen.getByTestId("minimal-radio-remote-category-campus"));
    expect(screen.getAllByTestId("minimal-radio-remote-station")).toHaveLength(1);
    expect(screen.getByLabelText("Alpha: Alpha artist").textContent)
      .toContain("Alpha artist");

    fireEvent.click(screen.getByLabelText("Alpha: Alpha artist"));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Alpha: Alpha artist").getAttribute("aria-pressed"))
      .toBe("true");

    fireEvent.click(screen.getByTestId("minimal-radio-remote-category-all"));
    expect(screen.getAllByTestId("minimal-radio-remote-station")).toHaveLength(8);
    expect(screen.getByTestId("minimal-radio-remote-category-all").getAttribute("aria-pressed"))
      .toBe("true");

    fireEvent.click(screen.getByTestId("minimal-radio-remote-toggle"));
    expect(screen.getAllByTestId("minimal-radio-remote-station")).toHaveLength(6);
    expect(screen.getByTestId("minimal-radio-overview")).toBeTruthy();
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

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));

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

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));

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

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));

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

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));
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

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));
    expect(screen.queryByTestId("minimal-radio-card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show lifetime crossings" }));
    expect(screen.getByTestId("minimal-radio-card")).toBeTruthy();
    expect(screen.queryByLabelText("5 lifetime crossings")).toBeNull();
  });
});