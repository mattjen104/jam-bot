// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";
import type { StationCategory } from "../src/lib/dialCategories";
import { MinimalRadioSurface } from "../src/components/MinimalRadioSurface";

const { toggle, warmup, releaseWarmup, cancelWarmup, startReplay } = vi.hoisted(() => ({
  toggle: vi.fn(),
  warmup: vi.fn(),
  releaseWarmup: vi.fn(),
  cancelWarmup: vi.fn(),
  startReplay: vi.fn(),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: {
      station: null,
      status: "idle",
      toggle,
      warmup,
      releaseWarmup,
      cancelWarmup,
    },
    ride: { startReplay },
  }),
}));

function row(
  slug: string,
  name: string,
  nowHit: boolean,
  lifetime: number,
  category?: StationCategory,
  homepageBlurb?: string | null,
  donateUrl?: string | null,
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
        homepageBlurb: homepageBlurb ?? null,
        donateUrl: donateUrl ?? null,
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

    function FilterHarness() {
      const [activeCategories, setActiveCategories] = React.useState<Set<StationCategory>>(new Set());
      return (
        <MinimalRadioSurface
          rows={[
            row("alpha", "Alpha", true, 2, "campus"),
            row("beta", "Beta", true, 2, "anchor"),
          ]}
          categoryByStationSlug={categoryByStationSlug}
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
    render(<FilterHarness />);

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

    fireEvent.click(screen.getByTestId("minimal-radio-remote-category-campus"));

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

    function FilterHarness() {
      const [activeCategories, setActiveCategories] = React.useState<Set<StationCategory>>(new Set());
      return (
        <MinimalRadioSurface
          rows={[
            row("alpha", "Alpha", true, 2, "campus"),
            row("beta", "Beta", true, 2, "anchor"),
          ]}
          categoryByStationSlug={new Map([
            ["alpha", "campus"],
            ["beta", "anchor"],
          ])}
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
    render(<FilterHarness />);

    await waitFor(() => {
      expect(within(screen.getByTestId("overview-history-firstPlays"))
        .queryByText("Campus archive artist")).toBeNull();
      expect(within(screen.getByTestId("overview-history-firstPlays"))
        .getAllByTestId("overview-history-firstPlays-item")).toHaveLength(18);
    });

    fireEvent.click(screen.getByTestId("minimal-radio-remote-category-campus"));

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
        preset="now"
        activeCategories={new Set(["campus"])}
        onToggleCategory={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));

    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(2);
    expect(screen.getAllByTestId("minimal-radio-card")[0]?.getAttribute("aria-label"))
      .toBe("Beta station card");
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Beta" }).textContent).toBe("Beta");
    expect(screen.getByText("Beta City")).toBeTruthy();
    expect(screen.queryByText("UK")).toBeNull();
    expect(screen.queryByTestId("minimal-radio-sheet-header")).toBeNull();
    expect(screen.getByText("Beta artist")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tune in to Beta" }).textContent)
      .toContain("Beta artist");
    expect(screen.queryByText("Beta track")).toBeNull();
    expect(screen.getByRole("button", { name: "Tune in to Beta" }).className)
      .toContain("minimal-radio-card__now");
    expect(screen.getAllByTestId("minimal-radio-card")[0]?.children).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Tune in to Beta" })
        .closest(".minimal-radio-card__station-line"),
    ).toBeTruthy();
    expect(document.querySelector("[data-station-mark='logo']")).toBeNull();
    expect(screen.queryByText(/matched|shown/i)).toBeNull();
    expect(document.querySelector(".minimal-radio-card__insights-heading")).toBeNull();

    const hero = screen.getByTestId("minimal-radio-hero");
    fireEvent.keyDown(hero, { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
    const tuneButton = screen.getByRole("button", { name: "Tune in to Alpha" });
    fireEvent.pointerDown(tuneButton);
    expect(warmup).toHaveBeenCalledWith(expect.objectContaining({ slug: "alpha" }));
    fireEvent.pointerUp(tuneButton);
    expect(releaseWarmup).toHaveBeenCalledTimes(1);
    fireEvent.click(tuneButton);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("uses lifetime crossings as the default order for All and category-filtered stations", () => {
    const low = row("low", "Low", true, 2, "campus");
    const high = row("high", "High", true, 9, "campus");
    const middle = row("middle", "Middle", true, 5, "anchor");

    function FilterHarness() {
      const [activeCategories, setActiveCategories] = React.useState<Set<StationCategory>>(
        new Set(),
      );
      const allRows = [low, high, middle];
      const remoteRows = activeCategories.size === 0
        ? allRows
        : allRows.filter((candidate) => {
            const category = candidate.ds.station.stationCategories?.[0] as StationCategory | undefined;
            return category ? activeCategories.has(category) : false;
          });
      return (
        <MinimalRadioSurface
          rows={allRows}
          remoteRows={remoteRows}
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

    render(<FilterHarness />);
    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));

    expect(screen.getAllByTestId("minimal-radio-card").map((card) =>
      card.querySelector("h2")?.textContent,
    )).toEqual(["High", "Middle", "Low"]);

    fireEvent.click(screen.getByTestId("minimal-radio-remote-toggle"));
    expect(screen.getAllByTestId("minimal-radio-remote-station").map((station) =>
      within(station).getByText(/^(High|Middle|Low)$/, {
        selector: ".minimal-radio__remote-station-name",
      }).textContent,
    )).toEqual(["High", "Middle", "Low"]);

    fireEvent.click(screen.getByTestId("minimal-radio-remote-category-campus"));
    expect(screen.getAllByTestId("minimal-radio-remote-station").map((station) =>
      within(station).getByText(/^(High|Low)$/, {
        selector: ".minimal-radio__remote-station-name",
      }).textContent,
    )).toEqual(["High", "Low"]);
  });

  it("shows each available station sentence and removes card insight columns", () => {
    const alpha = row(
      "alpha",
      "Alpha",
      false,
      0,
      "anchor",
      "Independent radio from Alpha City, shaped by adventurous selectors.",
    );
    const beta = row("beta", "Beta", false, 0, "campus", "   ");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MinimalRadioSurface rows={[alpha, beta]} preset="now" />);

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));

    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(2);
    expect(screen.getByText("Independent radio from Alpha City, shaped by adventurous selectors."))
      .toBeTruthy();
    const blurbRegions = screen.getAllByTestId("minimal-radio-card-blurb");
    expect(blurbRegions[0]?.textContent).toContain("Independent radio from Alpha City");
    expect(blurbRegions[1]?.textContent).toBe("");
    expect(document.querySelector(".minimal-radio-card__albums-columns")).toBeNull();
    expect(document.querySelector(".minimal-radio-card__album-column--crossings")).toBeNull();
    expect(document.querySelector(".minimal-radio-card__album-column--first-plays")).toBeNull();
    expect(screen.queryByTestId("minimal-radio-crossing")).toBeNull();
    expect(screen.queryByTestId("minimal-radio-first-plays")).toBeNull();
    expect(screen.queryByTestId("minimal-radio-sheet-header")).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => String(url)).every((url) => !url.includes("station=")))
      .toBe(true);
  });

  it("renders only artist metadata and uses honest off-air metadata", () => {
    const station = row("quiet", "Quiet", false, 1);
    station.ds.crossings = 1;
    station.ds.liveTrack = null;

    render(
      <MinimalRadioSurface rows={[station]} preset="now" />,
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
          rows={allRows}
          remoteRows={visibleRemoteRows}
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

    expect(screen.queryByTestId("minimal-radio-remote-view")).toBeNull();
    expect(screen.getByTestId("minimal-radio-remote-count").textContent)
      .toContain("8 stations selected");
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
    expect(screen.getByTestId("minimal-radio-remote-count").textContent)
      .toContain("1 station selected");
    expect(screen.getByLabelText("Alpha: Alpha artist").textContent)
      .toContain("Alpha artist");

    fireEvent.click(screen.getByLabelText("Alpha: Alpha artist"));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Alpha: Alpha artist").getAttribute("aria-pressed"))
      .toBe("true");

    fireEvent.click(screen.getByTestId("minimal-radio-remote-category-all"));
    expect(screen.getAllByTestId("minimal-radio-remote-station")).toHaveLength(8);
    expect(screen.getByTestId("minimal-radio-remote-count").textContent)
      .toContain("8 stations selected");
    expect(screen.getByTestId("minimal-radio-remote-category-all").getAttribute("aria-pressed"))
      .toBe("true");

    fireEvent.click(screen.getByTestId("minimal-radio-remote-toggle"));
    expect(screen.queryByTestId("minimal-radio-remote-view")).toBeNull();
    expect(screen.getByTestId("minimal-radio-overview")).toBeTruthy();
    expect(screen.getAllByLabelText(/Tune in to .* playing/)).toHaveLength(8);

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));
    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(8);
    expect(screen.getByText("Not broadcasting")).toBeTruthy();
  });

  it("keeps playable core stations in cards even when they have no crossing", () => {
    render(
      <MinimalRadioSurface
        rows={[row("quiet", "Quiet", false, 0), row("dark", "Dark", false, 0)]}
        preset="now"
      />,
    );

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));
    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(2);
    expect(screen.queryByTestId("radio-preset-lifetime")).toBeNull();
  });

  it("filters to valid support links without changing lifetime/name order", () => {
    function FilterHarness() {
      const [supportOnly, setSupportOnly] = React.useState(false);
      return (
        <MinimalRadioSurface
          rows={[
            row("zulu", "Zulu", true, 4, undefined, null, "https://zulu.example/support"),
            row("alpha", "Alpha", true, 4, undefined, null, " https://alpha.example/join "),
            row("broken", "Broken", true, 9, undefined, null, "javascript:alert(1)"),
            row("empty", "Empty", true, 7, undefined, null, "   "),
            row("none", "None", true, 6),
          ]}
          remoteRows={[
            row("zulu", "Zulu", true, 4, undefined, null, "https://zulu.example/support"),
            row("alpha", "Alpha", true, 4, undefined, null, "https://alpha.example/join"),
            row("none", "None", true, 6),
          ]}
          preset="now"
          supportOnly={supportOnly}
          onToggleSupport={() => setSupportOnly((active) => !active)}
          onSetCategories={() => {}}
        />
      );
    }

    render(<FilterHarness />);

    fireEvent.click(screen.getByTestId("minimal-radio-remote-toggle"));
    const remoteNames = () => screen
      .getAllByTestId("minimal-radio-remote-station")
      .map((station) => station.querySelector(".minimal-radio__remote-station-name")?.textContent);
    expect(remoteNames())
      .toEqual(["None", "Alpha", "Zulu"]);

    fireEvent.click(screen.getByRole("button", { name: /^Support/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Has support info/ }));

    expect(remoteNames())
      .toEqual(["Alpha", "Zulu"]);

    fireEvent.click(screen.getByTestId("minimal-radio-remote-toggle"));
    expect(screen.getAllByLabelText(/Tune in to .* playing/).map((station) => station.getAttribute("aria-label")))
      .toEqual([
        "Tune in to Alpha, playing Alpha artist",
        "Tune in to Zulu, playing Zulu artist",
      ]);

    fireEvent.click(screen.getByRole("checkbox", { name: /^Has support info/ }));

    expect(screen.getAllByLabelText(/Tune in to .* playing/).map((station) => station.getAttribute("aria-label")))
      .toEqual([
        "Tune in to Broken, playing Broken artist",
        "Tune in to Empty, playing Empty artist",
        "Tune in to None, playing None artist",
        "Tune in to Alpha, playing Alpha artist",
        "Tune in to Zulu, playing Zulu artist",
      ]);
  });

  it("shows one empty state when no station can be played", () => {
    const unavailable = row("archive", "Archive", false, 5);
    unavailable.ds.liveTrack = null;
    unavailable.ds.station.streamUrl = null;
    unavailable.ds.station.relayUrl = null;

    render(
      <MinimalRadioSurface
        rows={[unavailable]}
        preset="now"
      />,
    );

    fireEvent.click(screen.getByTestId("minimal-radio-cards-toggle"));
    expect(screen.queryByTestId("minimal-radio-card")).toBeNull();
    expect(screen.getByTestId("minimal-radio-no-candidates")).toBeTruthy();
  });
});