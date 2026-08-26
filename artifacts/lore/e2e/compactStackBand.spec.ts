import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for the home Stack's minimal listening surface.
 * Full Stack management (skip/include and album investigation) belongs on
 * /library; the split home keeps only direct replay cards.
 */

function makeLibraryItem(index: number) {
  const number = String(index + 1).padStart(2, "0");
  return {
    mbid: `home-stack-mbid-${number}`,
    provenance: { kind: "keep" },
    addedAt: `2026-08-${String(20 - index).padStart(2, "0")}T00:00:00Z`,
    recording: {
      title: `Track ${number}`,
      artist: `Home Artist ${number}`,
      artworkUrl: `/lore/e2e-art/home-${number}.svg`,
      albumTitle: `Home Album ${number}`,
      releaseGroupMbid: null,
      releaseYear: 1980 + index,
      spotifyUrl: null,
    },
  };
}

const HOME_LIBRARY = Array.from({ length: 12 }, (_, index) =>
  makeLibraryItem(index),
);

async function installRoutes(page: Page) {
  await page.route("https://stream.example.test/**", (route) => route.abort());
  await page.route("**/lore/e2e-art/*.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#6750a4"/></svg>',
    }),
  );
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/me/library")) {
      return route.fulfill({ json: { items: HOME_LIBRARY, nextCursor: null } });
    }
    if (path.startsWith("/api/stations/now-playing")) {
      return route.fulfill({ json: { items: [] } });
    }
    if (path === "/api/stations") {
      return route.fulfill({ json: { stations: [] } });
    }
    if (path.startsWith("/api/me/crossings")) {
      return route.fulfill({
        json: { items: [], computing: false, failed: false },
      });
    }
    if (path === "/api/me/picker-names") {
      return route.fulfill({
        json: { names: [], hasLibrary: true, hasSeeds: false },
      });
    }
    return route.fulfill({ status: 404, json: { error: "Not found" } });
  });
}

async function loadHomeStack(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("lore:first-run-prompted", "1");
  });
  await installRoutes(page);
  await page.goto("/lore/");
}

function homeGrid(page: Page) {
  return page.locator(".split-home__band--stack .compact-stack--home");
}

async function expectRadioBeforeStack(page: Page) {
  await expect(page.locator(".split-home__band")).toHaveCount(2);
  const bandLabels = await page.locator(".split-home__band").evaluateAll((bands) =>
    bands.map((band) => band.getAttribute("aria-label")),
  );
  expect(bandLabels).toEqual(["Live stations", "Recent keeps"]);
}

test.describe("CompactStack — home rail", () => {
  test("shows twelve direct-replay album cards in a one-row rail", async ({
    page,
  }) => {
    await loadHomeStack(page);

    await expectRadioBeforeStack(page);
    const grid = homeGrid(page);
    const cards = grid.locator(".compact-stack__row");
    await expect(cards).toHaveCount(12, { timeout: 20_000 });
    await expect(cards.locator(".compact-stack__tile-art")).toHaveCount(12);
    await expect(grid.locator(".compact-stack__album")).toHaveCount(0);
    await expect(grid.locator(".compact-stack__artist")).toHaveCount(12);
    await expect(grid.locator(".compact-play-btn")).toHaveCount(0);
    await expect(grid.getByRole("checkbox")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Play Home Album 01 · Home Artist 01",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Play Home Album 12 · Home Artist 12",
      }),
    ).toBeVisible();
    const railMetrics = await grid.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        display: styles.display,
        flexWrap: styles.flexWrap,
      };
    });
    expect(railMetrics.display).toBe("flex");
    expect(railMetrics.flexWrap).toBe("nowrap");

    await cards.first().click();
    await expect(
      page.getByRole("button", { name: /Collapse Home Album 01/ }),
    ).toHaveCount(0);
  });

  test("uses a swipeable one-row rail with taller square cards on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await loadHomeStack(page);

    await expectRadioBeforeStack(page);
    const grid = homeGrid(page);
    await expect(grid.locator(".compact-stack__row")).toHaveCount(12, {
      timeout: 20_000,
    });
    const railMetrics = await grid.evaluate((element) => {
      const firstCard = element.querySelector<HTMLElement>(".compact-stack__row");
      const firstArt = element.querySelector<HTMLElement>(".compact-stack__art-tile");
      return {
        overflowX: getComputedStyle(element).overflowX,
        scrollable: element.scrollWidth > element.clientWidth,
        visibleColumnWidths: firstCard
          ? element.clientWidth / firstCard.getBoundingClientRect().width
          : 0,
        artWidthRatio: firstCard && firstArt
          ? firstArt.getBoundingClientRect().width / firstCard.getBoundingClientRect().width
          : 0,
        artIsSquare: firstArt
          ? Math.abs(
            firstArt.getBoundingClientRect().width
            - firstArt.getBoundingClientRect().height,
          ) < 2
          : false,
      };
    });
    expect(railMetrics.overflowX).toBe("auto");
    expect(railMetrics.scrollable).toBe(true);
    expect(railMetrics.visibleColumnWidths).toBeGreaterThan(2);
    expect(railMetrics.visibleColumnWidths).toBeLessThan(4);
    expect(railMetrics.artWidthRatio).toBeGreaterThan(0.9);
    expect(railMetrics.artIsSquare).toBe(true);
  });
});