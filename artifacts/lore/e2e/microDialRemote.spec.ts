import { test, expect, type Page } from "@playwright/test";

/**
 * Browser coverage for the SplitHome Micro remote.
 *
 * The unit suite owns page slicing and ordinal arithmetic. This spec exercises
 * the actual rendered grid with 16 live stations, so it catches layout
 * regressions that only surface once the fifteen-key page is constrained by a
 * real browser viewport.
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

  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
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

async function loadMicroRemote(page: Page) {
  await installRoutes(page);
  await page.goto("/lore/");

  // Cycle normal → compact → micro through the control a listener uses.
  const scanCommands = page.getByRole("group", { name: "Scan commands" });
  await scanCommands.getByRole("button", { name: /Show more scan controls/ }).click();
  const normalDensity = scanCommands.getByRole("button", {
    name: "density 5 rows — switch to 10",
  });
  await expect(normalDensity).toBeVisible({ timeout: 20_000 });
  await normalDensity.click();

  const compactDensity = scanCommands.getByRole("button", {
    name: "density 10 rows — switch to 15",
  });
  await expect(compactDensity).toBeVisible();
  await compactDensity.click();

  await expect(page.getByRole("group", { name: "Station keypad" })).toBeVisible();
}

interface KeypadGeometry {
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  bodyScrollWidth: number;
  viewportWidth: number;
  buttonCount: number;
  buttonsEscapeKeypad: boolean;
}

async function readKeypadGeometry(page: Page): Promise<KeypadGeometry> {
  return page.evaluate(() => {
    const keypad = document.querySelector<HTMLElement>(".compact-dial__micro-grid");
    if (!keypad) throw new Error("Micro keypad did not render");
    const keypadRect = keypad.getBoundingClientRect();
    const buttons = Array.from(
      keypad.querySelectorAll<HTMLElement>(".compact-dial__micro-btn"),
    );
    return {
      clientWidth: keypad.clientWidth,
      clientHeight: keypad.clientHeight,
      scrollWidth: keypad.scrollWidth,
      scrollHeight: keypad.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      buttonCount: buttons.length,
      buttonsEscapeKeypad: buttons.some((button) => {
        const rect = button.getBoundingClientRect();
        return (
          rect.left < keypadRect.left - 1 ||
          rect.right > keypadRect.right + 1 ||
          rect.top < keypadRect.top - 1 ||
          rect.bottom > keypadRect.bottom + 1
        );
      }),
    };
  });
}

test.describe("Micro station remote — real browser paging", () => {
  test("390×844: renders 15 keys, two pages, and tunes page two", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadMicroRemote(page);

    const keypad = page.getByRole("group", { name: "Station keypad" });
    const pageSelectors = page
      .getByRole("group", { name: "Scan commands" })
      .locator(".home-cli-strip__page-selectors");
    await expect(keypad.getByRole("button")).toHaveCount(15);
    await expect(pageSelectors.getByRole("button")).toHaveCount(2);
    await expect(pageSelectors.getByRole("button", { name: "page 1 /scan1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await pageSelectors.getByRole("button", { name: "page 2 /scan2" }).click();
    const sixteenthKey = keypad.getByRole("button", {
      name: "16. Artist 16 on Station 16 — tune in",
    });
    await expect(keypad.getByRole("button")).toHaveCount(1);
    await expect(sixteenthKey).toBeVisible();
    await expect(pageSelectors.getByRole("button", { name: "page 2 /scan2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await sixteenthKey.click();
    await expect(sixteenthKey).toHaveClass(/compact-dial__micro-btn--active/);
    await expect(page.locator(".player-bar-row")).toBeVisible();

    const geometry = await readKeypadGeometry(page);
    expect(geometry.buttonCount).toBe(1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight + 1);
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.buttonsEscapeKeypad).toBe(false);
  });

  test("1280×900: first fifteen-key page stays entirely within its dial band", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loadMicroRemote(page);

    const keypad = page.getByRole("group", { name: "Station keypad" });
    const pageSelectors = page
      .getByRole("group", { name: "Scan commands" })
      .locator(".home-cli-strip__page-selectors");
    await expect(keypad.getByRole("button")).toHaveCount(15);
    await expect(pageSelectors.getByRole("button")).toHaveCount(2);

    const geometry = await readKeypadGeometry(page);
    expect(geometry.buttonCount).toBe(15);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight + 1);
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.buttonsEscapeKeypad).toBe(false);
  });
});