import { test, expect, type Page } from "@playwright/test";

/**
 * Browser coverage for the simplified SplitHome station dial.
 *
 * The front door presents a vertically scrollable stack of station cards.
 * This spec exercises that rendered stack with 16 live stations, so it catches
 * clipping and overflow regressions and proves a station beyond the initial
 * viewport remains reachable.
 */

const STATION_COUNT = 16;

function makeStation(index: number) {
  const ordinal = String(index + 1).padStart(2, "0");
  return {
    id: index + 1,
    slug: `micro-${ordinal}`,
    name: `Station ${ordinal}`,
    org: `STATION ${ordinal}`,
    city: "London",
    country: "GB",
    streamUrl: `https://stream.example.test/micro-${ordinal}`,
    streamQuality: null,
    streamFormat: "aac",
    mode: "live",
    homepageUrl: `https://station-${ordinal}.example.test`,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    stationCategories: [index % 2 === 0 ? "campus" : "anchor"],
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    crossings: 1,
    artistCrossings: 0,
    weekCrossings: 1,
    weekArtistCrossings: 0,
    monthCrossings: 1,
    monthArtistCrossings: 0,
    lifetimeCrossings: 1,
    lifetimeArtistCrossings: 0,
  };
}

function makeNowPlaying(index: number) {
  const ordinal = index + 1;
  return {
    spinId: 10_000 + ordinal,
    rawArtist: `Artist ${ordinal}`,
    rawTitle: `Track ${ordinal}`,
    source: "icy",
    confidence: "unresolved",
    playedAt: new Date(Date.now() - index * 30_000).toISOString(),
    artworkUrl: null,
    recording: null,
    show: null,
    isFirstSpin: false,
    isLibraryHit: true,
    isArtistHit: false,
  };
}

const STATIONS = Array.from({ length: STATION_COUNT }, (_, index) => makeStation(index));
const NOW_PLAYING = STATIONS.map((_, index) => makeNowPlaying(index));
const CROSSINGS = STATIONS.map((station) => ({
  stationSlug: station.slug,
  crossings: 1,
  artistCrossings: 0,
  firstPlayCrossings: 1,
  weekCrossings: 1,
  weekArtistCrossings: 0,
  weekFirstPlayCrossings: 2,
  monthCrossings: 1,
  monthArtistCrossings: 0,
  monthFirstPlayCrossings: 3,
  lifetimeCrossings: 1,
  lifetimeArtistCrossings: 0,
  lifetimeFirstPlayCrossings: 5,
  albumCrossings: [1, 2, 3, 4, 5].map((ordinal) => ({
    releaseGroupMbid: `${station.slug}-release-${ordinal}`,
    recordingMbid: `${station.slug}-recording-${ordinal}`,
    title: `Album ${ordinal}`,
    artist: `Artist ${ordinal}`,
    artworkUrl: `https://art.example.test/${station.slug}-${ordinal}.jpg`,
  })),
}));

async function installRoutes(
  page: Page,
  listenerArchiveNavEnabled = false,
  libraryItems: unknown[] = [],
) {
  // Avoid reaching external radio streams; the player still commits the tuned
  // station before the browser reports that this fixture stream is unavailable.
  await page.route("https://stream.example.test/**", (route) => route.abort());
  await page.route("**/api/art?src=**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: "<svg xmlns='http://www.w3.org/2000/svg' width='152' height='152'><rect width='152' height='152' fill='#7e6a9c'/></svg>",
    }),
  );

  // Register the broad route first: Playwright evaluates later routes first.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  let tasteSeeds: string[] = [];
  await page.route("**/api/me/taste-seeds", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { artists: string[] };
      tasteSeeds = body.artists;
    }
    await route.fulfill({ json: { artists: tasteSeeds } });
  });
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: CROSSINGS, computing: false, failed: false } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [], hasLibrary: true, hasSeeds: true } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: { items: libraryItems, nextCursor: null } }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: { items: libraryItems, nextCursor: null } }),
  );

  await page.route("**/api/stations?**", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
  );
  await page.route("**/api/stations/now-playing?**", (route) =>
    route.fulfill({
      json: {
        items: STATIONS.map((station, index) => ({
          slug: station.slug,
          nowPlaying: NOW_PLAYING[index],
        })),
      },
    }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: STATIONS.map((station, index) => ({
          slug: station.slug,
          nowPlaying: NOW_PLAYING[index],
        })),
      },
    }),
  );
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/stations/recent-spins**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/player/history?**", (route) => {
    const url = new URL(route.request().url());
    const stationSlug = url.searchParams.get("station") ?? "";
    const filter = url.searchParams.get("filter");
    const station = STATIONS.find((candidate) => candidate.slug === stationSlug);
    const requestedCategories = new Set(
      (url.searchParams.get("categories") ?? "").split(",").filter(Boolean),
    );
    const globalStations = STATIONS
      .filter((candidate) => (
        requestedCategories.size === 0
        || candidate.stationCategories.some((category) => requestedCategories.has(category))
      ))
      .slice(0, 10);
    const historyStations = station ? [station] : globalStations;
    return route.fulfill({
      json: {
        items: historyStations.flatMap((historyStation) => {
          const count = station ? 5 : 1;
          return Array.from({ length: count }, (_, itemIndex) => {
            const ordinal = itemIndex + 1;
            return {
              id: historyStation.id * 100 + ordinal,
              mbid: `${historyStation.slug}-${filter}-${ordinal}`,
              title: filter === "crossings" ? `Crossing ${ordinal}` : `First Play ${ordinal}`,
              artist: filter === "crossings" ? `Known Artist ${ordinal}` : `New Artist ${ordinal}`,
              artworkUrl: `https://art.example.test/${historyStation.slug}-${filter}-${ordinal}.jpg`,
              playedAt: new Date(Date.UTC(2026, 7, 31, 12, 30 - ordinal)).toISOString(),
              station: { slug: historyStation.slug, name: historyStation.name },
            };
          });
        }),
      },
    });
  });
  await page.route("**/api/stations/artist-frequency**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/pickers/**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        spotifyImportEnabled: false,
        listenerArchiveNavEnabled,
        appleMusic: { configured: false, developerToken: null, appName: "Lore", storefront: "us" },
      },
    }),
  );
}

async function loadStationDial(
  page: Page,
  listenerArchiveNavEnabled = false,
  libraryItems: unknown[] = [],
) {
  await installRoutes(page, listenerArchiveNavEnabled, libraryItems);
  await page.goto("/lore/");
  await expect(page.getByTestId("minimal-radio-surface")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("minimal-radio-cards-toggle").click();

  const cards = page.getByTestId("minimal-radio-card");
  await expect(cards).toHaveCount(STATION_COUNT);
  const fullyVisibleRows = await cards.evaluateAll((nodes) => {
    const viewport = nodes[0]?.closest<HTMLElement>("[data-testid='minimal-radio-hero']");
    if (!viewport) return 0;
    const viewportRect = viewport.getBoundingClientRect();
    return nodes.filter((node) => {
      const rowRect = node.getBoundingClientRect();
      return rowRect.top >= viewportRect.top - 1 && rowRect.bottom <= viewportRect.bottom + 1;
    }).length;
  });
  expect(fullyVisibleRows).toBeGreaterThanOrEqual(4);
}

test.describe("Minimal Radio remote — real browser navigation", () => {
  test("architect preview swaps onboarding and post-import front-door states", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await page.goto("/lore/");

    await expect(page.getByTestId("front-door-architect-toggle")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your records are on the radio right now." }))
      .toBeVisible();

    await page.getByTestId("front-door-experience-post-import").click();
    await expect(page.getByTestId("front-door-post-import")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your records are on the radio right now." }))
      .toHaveCount(0);
    await expect(page.getByTestId("front-door-post-import-add-artists")).toBeVisible();

    await page.getByTestId("front-door-experience-onboarding").click();
    await expect(page.getByRole("heading", { name: "Your records are on the radio right now." }))
      .toBeVisible();
  });

  test("category overview groups live stations and scopes global history", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await page.goto("/lore/");

    await expect(page.getByTestId("minimal-radio-overview")).toBeVisible();
    await expect(page.getByTestId("overview-category-campus")).toContainText("Campus Radio");
    await expect(page.getByTestId("overview-category-anchor")).toContainText("Anchor Stations");
    await expect(page.getByTestId("overview-category-campus")).toContainText("Artist 1");
    await expect(page.getByTestId("overview-category-campus")).not.toContainText("Track 1");
    await expect(page.getByTestId("overview-history-crossings-item")).toHaveCount(10);
    await expect(page.getByTestId("overview-history-firstPlays-item")).toHaveCount(10);

    await page.getByTestId("minimal-radio-remote-category-campus").click();

    await expect(page.getByTestId("overview-category-campus")).toBeVisible();
    await expect(page.getByTestId("overview-category-anchor")).toHaveCount(0);
    await expect(page.getByTestId("overview-history-crossings-item")).toHaveCount(8);
    await expect(page.getByTestId("overview-history-firstPlays-item")).toHaveCount(8);
    await expect(page.getByTestId("overview-history-crossings")).toContainText("Filtered stations");

    await page.getByRole("button", { name: "View Campus Radio cards" }).click();
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(8);
    await expect(page.getByTestId("minimal-radio-hero-card-micro-01")).toContainText("Station 01");
  });

  test("390×844: keeps the card stack reachable and selects stations without playing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStationDial(page);

    await expect(page.getByTestId("minimal-radio-hero-card-micro-01")).toContainText("Station 01");
    const hero = page.getByTestId("minimal-radio-hero");
    await hero.focus();
    await hero.press("End");
    await expect(page.getByTestId("minimal-radio-hero-card-micro-16")).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByTestId("minimal-radio-hero-card-micro-16")).toContainText("Station 16");
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(STATION_COUNT);
    await expect(page.locator(".player-bar-row")).toHaveCount(0);
    await expect(page.locator("body")).toHaveCSS("overflow-x", /^(visible|clip|hidden)$/);
  });

  test("grid control opens the compact station remote on the floating-control plane", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStationDial(page);

    const toggle = page.getByTestId("minimal-radio-remote-toggle");
    const filter = page.locator(".minimal-radio__floating-filter").first();
    const toggleBox = await toggle.boundingBox();
    const filterBox = await filter.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(filterBox).not.toBeNull();
    expect(Math.abs(
      (toggleBox!.y + toggleBox!.height) - (filterBox!.y + filterBox!.height),
    )).toBeLessThanOrEqual(1);
    expect(toggleBox!.x).toBeLessThan(filterBox!.x);

    await expect(page.getByTestId("minimal-radio-remote-view")).toBeVisible();
    await expect(page.getByTestId("minimal-radio-remote-view"))
      .toHaveAttribute("aria-label", "Compact station preview");
    await expect(page.getByTestId("minimal-radio-remote-station")).toHaveCount(6);
    await expect(page.getByTestId("minimal-radio-remote-category-all")).toBeVisible();
    await expect(page.getByTestId("minimal-radio-remote-category-campus")).toBeVisible();

    await toggle.click();

    await expect(page.getByTestId("minimal-radio-remote-view")).toBeVisible();
    await expect(page.getByTestId("minimal-radio-remote-view"))
      .toHaveAttribute("aria-label", "Expanded compact station remote");
    await expect(page.getByTestId("minimal-radio-remote-station")).toHaveCount(STATION_COUNT);
    const remoteColumns = await page.getByTestId("minimal-radio-remote-view").evaluate((node) =>
      getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length
    );
    expect(remoteColumns).toBe(2);
    await expect(page.getByTestId("minimal-radio-remote-station").first())
      .toContainText("Station 01");
    await expect(page.getByTestId("minimal-radio-remote-station").first())
      .toContainText("Artist 1");
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(0);

    await page.getByTestId("minimal-radio-remote-station").first().click();
    await expect(page.getByTestId("minimal-radio-remote-station").first())
      .toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("minimal-radio-remote-category-campus").click();
    await expect(page.getByTestId("minimal-radio-remote-station")).toHaveCount(STATION_COUNT / 2);
    await expect(page.getByTestId("minimal-radio-remote-station").first())
      .toContainText("Station 01");

    await page.getByTestId("minimal-radio-remote-category-all").click();
    await expect(page.getByTestId("minimal-radio-remote-station")).toHaveCount(STATION_COUNT);
    await expect(page.getByTestId("minimal-radio-remote-category-all"))
      .toHaveAttribute("aria-pressed", "true");
  });

  test("latest crossing cover expands into a lifetime grid", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStationDial(page);

    const card = page.getByTestId("minimal-radio-card").first();
    await expect(page.getByTestId("minimal-radio-sheet-header")).toContainText("Crossing");
    await expect(page.getByTestId("minimal-radio-sheet-header")).toContainText("Premiere");
    const collapsed = await card.evaluate((node) => {
      const cardRect = node.getBoundingClientRect();
      const albumsRect = node.querySelector<HTMLElement>(".minimal-radio-card__albums")?.getBoundingClientRect();
      const albumGridRect = node.querySelector<HTMLElement>(".minimal-radio-card__album-grid")?.getBoundingClientRect();
      const albumsColumnsRect = node.querySelector<HTMLElement>(".minimal-radio-card__albums-columns")?.getBoundingClientRect();
      const albumNodes = [...node.querySelectorAll<HTMLElement>(".minimal-radio-card__album-column--crossings .minimal-radio-card__album")];
      const imageRect = node.querySelector<HTMLImageElement>(".minimal-radio-card__album-column--crossings .minimal-radio-card__album img")?.getBoundingClientRect();
      return {
        cardHeight: cardRect.height,
        albumsHeight: albumsRect?.height,
        albumsWidth: albumsRect?.width,
        albumGridWidth: albumGridRect?.width,
        albumsColumnsWidth: albumsColumnsRect?.width,
        albumWidths: albumNodes.map((album) => album.getBoundingClientRect().width),
        imageHeight: imageRect?.height,
        imageWidth: imageRect?.width,
      };
    });
    expect(collapsed.imageWidth).toBeGreaterThan(80);
    expect(collapsed.imageHeight).toBe(collapsed.imageWidth);
    expect(collapsed.albumsHeight).toBe(collapsed.imageHeight);
    expect(collapsed.albumGridWidth).toBeGreaterThan(80);
    expect(collapsed.albumGridWidth).toBe(collapsed.albumsWidth);
    expect(collapsed.albumsColumnsWidth).toBeGreaterThanOrEqual(168);
    expect(collapsed.albumWidths).toHaveLength(1);
    expect(collapsed.albumWidths[0]).toBeGreaterThan(80);
    expect(collapsed.cardHeight).toBe(84);
    await expect(card.locator(".minimal-radio-card__album-column--crossings .minimal-radio-card__album")).toHaveCount(1);
    await expect(card.locator(".minimal-radio-card__album-column--crossings .minimal-radio-card__album").first()).toHaveCSS("border-radius", "0px");
    await expect(card.locator(".minimal-radio-card__album-column--crossings .minimal-radio-card__album img").first()).toHaveCSS("border-radius", "0px");
    await expect(card.locator(".minimal-radio-card__albums-columns")).toHaveCSS("border-left-width", "1px");
    await expect(card.locator(".minimal-radio-card__album-column + .minimal-radio-card__album-column"))
      .toHaveCSS("border-left-width", "1px");
    await expect(card.locator(".minimal-radio-card__station-copy"))
      .toHaveCSS("border-bottom-width", "1px");
    await expect(card.locator(".minimal-radio-card__insights-heading")).toHaveCount(0);
    await expect(card.getByTestId("minimal-radio-crossing"))
      .toHaveCSS("border-radius", "3px");
    await expect(card.getByTestId("minimal-radio-first-plays"))
      .toHaveCSS("border-radius", "3px");
    await expect(card.getByTestId("minimal-radio-crossing").locator("strong"))
      .toHaveText("1");
    await expect(card.getByTestId("minimal-radio-first-plays").locator("strong"))
      .toHaveText("5");
    await expect(card.getByTestId("minimal-radio-crossing")).not.toContainText("crossing");
    await expect(card.getByTestId("minimal-radio-first-plays")).not.toContainText("premieres");
    await expect(card.getByTestId("minimal-radio-crossing")).toHaveCSS("position", "absolute");
    await expect(card.getByTestId("minimal-radio-crossing")).toHaveCSS("top", "4px");
    await expect(card.getByTestId("minimal-radio-crossing")).toHaveCSS("right", "4px");

    const artworkRows = page.locator(
      ".minimal-radio-card__album-column--crossings .minimal-radio-card__album img",
    );
    const firstArtwork = await artworkRows.nth(0).boundingBox();
    const secondArtwork = await artworkRows.nth(1).boundingBox();
    expect(firstArtwork).not.toBeNull();
    expect(secondArtwork).not.toBeNull();
    expect(Math.abs((firstArtwork!.y + firstArtwork!.height) - secondArtwork!.y))
      .toBeLessThanOrEqual(1);

    await card.getByTestId("minimal-radio-crossing").click();
    await expect(card).toHaveClass(/is-expanded/);
    await expect(card.locator(".minimal-radio-card__album-column--crossings .minimal-radio-card__album")).toHaveCount(5);
    const expanded = await card.evaluate((node) => {
         const crossingColumn = node.querySelector<HTMLElement>(".minimal-radio-card__album-column--crossings");
         const albums = crossingColumn?.querySelector<HTMLElement>(".minimal-radio-card__albums");
         const grid = crossingColumn?.querySelector<HTMLElement>(".minimal-radio-card__album-grid");
         const image = crossingColumn?.querySelector<HTMLImageElement>(".minimal-radio-card__album img");
      return {
        albumsHeight: albums?.getBoundingClientRect().height,
        gridHeight: grid?.getBoundingClientRect().height,
        albumsWidth: albums?.getBoundingClientRect().width,
        gridWidth: grid?.getBoundingClientRect().width,
        imageHeight: image?.getBoundingClientRect().height,
        imageWidth: image?.getBoundingClientRect().width,
        gridDisplay: grid ? getComputedStyle(grid).display : null,
        gridTemplateColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
        gridGap: grid ? getComputedStyle(grid).gap : null,
        gridPaddingRight: grid ? getComputedStyle(grid).paddingRight : null,
        gridOverflowY: grid ? getComputedStyle(grid).overflowY : null,
        gridTouchAction: grid ? getComputedStyle(grid).touchAction : null,
      };
    });
    expect(expanded.albumsHeight).toBeGreaterThan(152);
    expect(expanded.gridHeight).toBeLessThanOrEqual(expanded.albumsHeight!);
    expect(expanded.gridWidth).toBe(expanded.albumsWidth);
    expect(expanded.imageHeight).toBeGreaterThan(80);
    expect(expanded.imageWidth).toBe(expanded.imageHeight);
    expect(expanded.gridDisplay).toBe("grid");
     expect(expanded.gridTemplateColumns?.split(" ")).toHaveLength(1);
    expect(expanded.gridGap).toBe("0px");
    expect(expanded.gridPaddingRight).toBe("0px");
    expect(expanded.gridOverflowY).toBe("auto");
    expect(expanded.gridTouchAction).toBe("pan-y");
    await expect(card.locator(".minimal-radio-card__station-line")).toHaveCSS("border-bottom-width", "0px");
    await expect(card.locator(".minimal-radio-card__now")).toHaveCSS("border-top-width", "0px");
    await expect(card.locator(".minimal-radio-card__now")).toHaveCSS("border-bottom-width", "0px");
  });

  test("1280×900: presets and keyboard navigation change the active card", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loadStationDial(page);
    await page.getByTestId("radio-preset-lifetime").click();
    await expect(page.getByTestId("radio-preset-lifetime")).toHaveAttribute("aria-pressed", "true");
    const hero = page.getByTestId("minimal-radio-hero");
    await hero.focus();
    await hero.press("ArrowDown");
    await expect(page.getByTestId("minimal-radio-hero-card-micro-02")).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(STATION_COUNT);
    await expect(page.locator(".fdrow__crossing-dot")).toHaveCount(0);
  });

  test("CLI artist entry and Library mode work while archive links follow the admin reveal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loadStationDial(page, true, [{
      mbid: "real-kept-track",
      addedAt: "2026-08-30T12:00:00.000Z",
      provenance: { kind: "keep", stationName: "WFMU" },
      recording: {
        title: "Caught Song",
        artist: "A Tribe Called Quest",
        artistMbid: null,
        artworkUrl: null,
        albumTitle: "Real Album",
        releaseGroupMbid: "real-release-group",
        releaseYear: 2025,
        spotifyUrl: null,
      },
    }]);

    const input = page.getByRole("textbox", { name: "Dial command" });
    await input.fill("A Tribe Called Quest");
    await input.press("Enter");
    await expect(page.getByTestId("front-door-cli").getByRole("status"))
      .toContainText("A Tribe Called Quest added");

    await expect(page.getByRole("link", { name: "Heard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Index" })).toBeVisible();
    await page.getByTestId("front-door-library-mode").click();
    await expect(page.getByTestId("front-door-library")).toBeVisible();
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(0);
    await expect(page.getByText("Caught Song", { exact: true })).toBeVisible();
  });
});