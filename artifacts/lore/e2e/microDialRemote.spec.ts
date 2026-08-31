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

async function installRoutes(page: Page, listenerArchiveNavEnabled = false) {
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
  let tasteSeeds: string[] = [];
  await page.route("**/api/me/taste-seeds", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { artists: string[] };
      tasteSeeds = body.artists;
    }
    await route.fulfill({ json: { artists: tasteSeeds } });
  });
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

async function loadStationDial(page: Page, listenerArchiveNavEnabled = false) {
  await installRoutes(page, listenerArchiveNavEnabled);
  await page.goto("/lore/");
  await expect(page.getByTestId("minimal-radio-surface")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("minimal-radio-card")).toHaveCount(1);
}

test.describe("Minimal Radio remote — real browser navigation", () => {
  test("390×844: keeps one card visible and selects stations without playing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStationDial(page);

    await expect(page.getByTestId("minimal-radio-card")).toContainText("Station 01");
    await page.getByTitle("Select Station 16").click();
    await expect(page.getByTestId("minimal-radio-card")).toContainText("Station 16");
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(1);
    await expect(page.locator(".player-bar-row")).toHaveCount(0);
    await expect(page.locator("body")).toHaveCSS("overflow-x", /^(visible|clip|hidden)$/);
  });

  test("1280×900: presets and next navigation replace the single active card", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loadStationDial(page);
    await page.getByTestId("radio-preset-lifetime").click();
    await expect(page.getByTestId("radio-preset-lifetime")).toHaveAttribute("aria-pressed", "true");
    const before = await page.getByTestId("minimal-radio-card").textContent();
    await page.getByRole("button", { name: "Next station" }).click();
    await expect(page.getByTestId("minimal-radio-card")).not.toHaveText(before ?? "");
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(1);
    await expect(page.locator(".fdrow__crossing-dot")).toHaveCount(0);
  });

  test("CLI artist entry and Library mode work while archive links follow the admin reveal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loadStationDial(page, true);

    const input = page.getByRole("textbox", { name: "Dial command" });
    await input.fill("A Tribe Called Quest");
    await input.press("Enter");
    await expect(page.getByRole("status")).toContainText("A Tribe Called Quest added");

    await expect(page.getByRole("link", { name: "Heard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Index" })).toBeVisible();
    await page.getByTestId("front-door-library-mode").click();
    await expect(page.getByTestId("front-door-library")).toBeVisible();
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(0);
  });
});