import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for the Stack band's density pager. This deliberately
 * uses more than one API page worth of albums so a density change exercises
 * the page selector math as well as the rendered row window.
 */

function makeLibraryItem(index: number) {
  const number = String(index + 1).padStart(2, "0");
  return {
    mbid: `stack-density-mbid-${number}`,
    provenance: { kind: "keep" },
    addedAt: `2026-08-${String(42 - index).padStart(2, "0")}T00:00:00Z`,
    recording: {
      title: `Track ${number}`,
      artist: `Density Artist ${number}`,
      artworkUrl: `/lore/e2e-art/album-${number}.svg`,
      albumTitle: `Density Album ${number}`,
      releaseGroupMbid: null,
      releaseYear: 1980 + index,
      spotifyUrl: null,
    },
  };
}

/** 42 unique album groups: 9 normal pages, 5 compact pages, 3 micro pages. */
const DENSITY_LIBRARY = Array.from({ length: 42 }, (_, index) =>
  makeLibraryItem(index),
);

async function installRoutes(page: Page) {
  // The pager's artwork is intentionally local, so it can load without
  // touching the art proxy or a third-party image host.
  await page.route("**/lore/e2e-art/*.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#6750a4"/></svg>',
    }),
  );

  // Keep all data deterministic and prevent a real audio connection.
  await page.route("https://stream.example.test/**", (route) => route.abort());

  // Register general routes before specific ones: Playwright checks routes in
  // last-in-first-out order.
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
    route.fulfill({ json: { names: [], hasLibrary: true, hasSeeds: false } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  await page.route("**/api/me/library/import?**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/library/import", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  const libraryPayload = { items: DENSITY_LIBRARY, nextCursor: null };
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: libraryPayload }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: libraryPayload }),
  );

  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({ json: { items: [] } }),
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

async function suppressFirstRun(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("lore:first-run-prompted", "1");
  });
}

function stackRows(page: Page) {
  return page.locator(
    ".split-home__band--stack .compact-stack__row:not(.compact-stack__row--skipped)",
  );
}

function stackPageSelectors(page: Page) {
  return page.locator(
    ".stack-pager-bar .home-cli-strip__page-selectors button",
  );
}

test.describe("Stack density pager", () => {
  test("cycles 5 → 10 → 15, persists on reload, and changes the page artwork", async ({
    page,
  }) => {
    await suppressFirstRun(page);
    await installRoutes(page);
    await page.goto("/lore/");

    const pager = page.locator(".stack-pager-bar");
    const count = pager.locator(".home-cli-strip__station-count");
    const backdrop = pager.locator(".stack-pager-bar__backdrop-art");

    await expect(stackRows(page)).toHaveCount(5, { timeout: 20_000 });
    await expect(stackPageSelectors(page)).toHaveCount(9);
    await expect(count).toHaveText("42 albums");
    await expect(backdrop).toBeVisible();
    const firstPageArt = await backdrop.getAttribute("src");
    expect(firstPageArt).toContain("/lore/e2e-art/album-01.svg");

    await pager
      .getByRole("button", { name: "density 5 rows — switch to 10" })
      .click();
    await expect(stackRows(page)).toHaveCount(10);
    await expect(stackPageSelectors(page)).toHaveCount(5);
    await expect(count).toHaveText("42 albums");

    await pager
      .getByRole("button", { name: "density 10 rows — switch to 15" })
      .click();
    await expect(stackRows(page)).toHaveCount(15);
    await expect(stackPageSelectors(page)).toHaveCount(3);
    await expect(count).toHaveText("42 albums");

    // The second micro page begins at album 16, so its keyed backdrop image
    // must replace the page-one art behind the same pager controls.
    await page
      .getByRole("button", {
        name: "stack page 2: Density Album 16, +14 more",
      })
      .click();
    await expect(backdrop).toBeVisible();
    await expect(backdrop).toHaveAttribute(
      "src",
      /\/lore\/e2e-art\/album-16\.svg$/,
    );
    expect(await backdrop.getAttribute("src")).not.toBe(firstPageArt);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      pager.getByRole("button", { name: "density 15 rows — switch to 5" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(stackRows(page)).toHaveCount(15);
    await expect(stackPageSelectors(page)).toHaveCount(3);
    await expect(pager.locator(".home-cli-strip__station-count")).toHaveText(
      "42 albums",
    );
  });
});