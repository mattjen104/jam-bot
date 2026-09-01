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
    // Micro-key paging is independent of the category-first card view.
    stationCategories: [],
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
  weekCrossings: 1,
  weekArtistCrossings: 0,
  monthCrossings: 1,
  monthArtistCrossings: 0,
  lifetimeCrossings: 1,
  lifetimeArtistCrossings: 0,
  albumCrossings: [1, 2].map((ordinal) => ({
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

  test("latest crossing cover expands into a vertical lifetime stack", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStationDial(page);

    const card = page.getByTestId("minimal-radio-card").first();
    const collapsed = await card.evaluate((node) => {
      const cardRect = node.getBoundingClientRect();
      const albumsRect = node.querySelector<HTMLElement>(".minimal-radio-card__albums")?.getBoundingClientRect();
      const albumGridRect = node.querySelector<HTMLElement>(".minimal-radio-card__album-grid")?.getBoundingClientRect();
      const albumNodes = [...node.querySelectorAll<HTMLElement>(".minimal-radio-card__album")];
      const imageRect = node.querySelector<HTMLImageElement>(".minimal-radio-card__album img")?.getBoundingClientRect();
      return {
        cardHeight: cardRect.height,
        albumsHeight: albumsRect?.height,
        albumsWidth: albumsRect?.width,
        albumGridWidth: albumGridRect?.width,
        albumWidths: albumNodes.map((album) => album.getBoundingClientRect().width),
        imageHeight: imageRect?.height,
        imageWidth: imageRect?.width,
      };
    });
    expect(collapsed.imageWidth).toBeGreaterThan(152);
    expect(collapsed.imageHeight).toBe(collapsed.imageWidth);
    expect(collapsed.albumsHeight).toBeLessThan(collapsed.imageHeight!);
    expect(collapsed.albumGridWidth).toBeGreaterThan(300);
    expect(collapsed.albumGridWidth).toBe(collapsed.albumsWidth);
    expect(collapsed.albumWidths).toHaveLength(1);
    expect(collapsed.cardHeight).toBeLessThan(180);
    await expect(card.locator(".minimal-radio-card__album")).toHaveCount(1);

    await card.getByTestId("minimal-radio-crossing").click();
    await expect(card).toHaveClass(/is-expanded/);
    await expect(card.locator(".minimal-radio-card__album")).toHaveCount(2);
    const expanded = await card.evaluate((node) => {
      const albums = node.querySelector<HTMLElement>(".minimal-radio-card__albums");
      const grid = node.querySelector<HTMLElement>(".minimal-radio-card__album-grid");
      const image = node.querySelector<HTMLImageElement>(".minimal-radio-card__album img");
      return {
        albumsHeight: albums?.getBoundingClientRect().height,
        gridHeight: grid?.getBoundingClientRect().height,
        imageHeight: image?.getBoundingClientRect().height,
        gridOverflowY: grid ? getComputedStyle(grid).overflowY : null,
        gridDirection: grid ? getComputedStyle(grid).flexDirection : null,
      };
    });
    expect(expanded.albumsHeight).toBeGreaterThan(152);
    expect(expanded.gridHeight).toBe(expanded.albumsHeight);
    expect(expanded.imageHeight).toBeGreaterThan(152);
    expect(expanded.gridOverflowY).toBe("auto");
    expect(expanded.gridDirection).toBe("column");
    await expect(card.locator(".minimal-radio-card__station-line")).toHaveCSS("border-bottom-width", "1px");
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