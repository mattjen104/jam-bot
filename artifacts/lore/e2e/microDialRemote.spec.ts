import { test, expect, type Page } from "@playwright/test";

/**
 * Browser coverage for the simplified SplitHome station dial.
 *
 * The front door now presents one scrollable station list instead of the old
 * density-switching keypad. This spec exercises that rendered list with 16
 * live stations, so it catches clipping and overflow regressions and proves a
 * station beyond the initial five-row fold remains reachable.
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
    isLibraryHit: false,
    isArtistHit: false,
  };
}

const STATIONS = Array.from({ length: STATION_COUNT }, (_, index) => makeStation(index));
const NOW_PLAYING = STATIONS.map((_, index) => makeNowPlaying(index));

async function installRoutes(page: Page) {
  // Avoid reaching external radio streams; the player still commits the tuned
  // station before the browser reports that this fixture stream is unavailable.
  await page.route("https://stream.example.test/**", (route) => route.abort());

  // Register the broad route first: Playwright evaluates later routes first.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: [], computing: false, failed: false } }),
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
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
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
}

async function loadStationDial(page: Page) {
  await installRoutes(page);
  await page.goto("/lore/");
  await expect(page.getByRole("region", { name: "Live stations" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".compact-dial__row")).toHaveCount(STATION_COUNT);
}

interface DialGeometry {
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  bodyScrollWidth: number;
  viewportWidth: number;
  rowCount: number;
  rowsEscapeHorizontally: boolean;
}

async function readDialGeometry(page: Page): Promise<DialGeometry> {
  return page.evaluate(() => {
    const dial = document.querySelector<HTMLElement>(".compact-dial");
    if (!dial) throw new Error("Station dial did not render");
    const dialRect = dial.getBoundingClientRect();
    const rows = Array.from(
      dial.querySelectorAll<HTMLElement>(".compact-dial__row"),
    );
    return {
      clientWidth: dial.clientWidth,
      clientHeight: dial.clientHeight,
      scrollWidth: dial.scrollWidth,
      scrollHeight: dial.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      rowCount: rows.length,
      rowsEscapeHorizontally: rows.some((row) => {
        const rect = row.getBoundingClientRect();
        return (
          rect.left < dialRect.left - 1 ||
          rect.right > dialRect.right + 1
        );
      }),
    };
  });
}

test.describe("Station dial — real browser scrolling", () => {
  test("390×844: renders all stations and tunes beyond the initial fold", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStationDial(page);

    const stationRows = page.locator(".compact-dial__row");
    await expect(stationRows).toHaveCount(16);
    const sixteenthRow = stationRows.nth(15);
    await sixteenthRow.scrollIntoViewIfNeeded();
    await expect(sixteenthRow).toContainText("Station 16");
    await sixteenthRow.getByRole("button", { name: "Play Station 16" }).click();
    await expect(sixteenthRow.locator(".fdrow")).toHaveClass(/fdrow--playing/);
    await expect(page.locator(".player-bar-row")).toBeVisible();

    const geometry = await readDialGeometry(page);
    expect(geometry.rowCount).toBe(16);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.scrollHeight).toBeGreaterThanOrEqual(geometry.clientHeight);
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.rowsEscapeHorizontally).toBe(false);
  });

  test("1280×900: station list stays entirely within its dial band", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loadStationDial(page);

    const geometry = await readDialGeometry(page);
    expect(geometry.rowCount).toBe(16);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.scrollHeight).toBeGreaterThanOrEqual(geometry.clientHeight);
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.rowsEscapeHorizontally).toBe(false);
  });
});