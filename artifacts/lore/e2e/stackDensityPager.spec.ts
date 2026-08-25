import { test, expect, type Page } from "@playwright/test";

/**
 * Real-browser coverage for the simplified Stack band's fixed home window.
 * This deliberately supplies far more than five albums to prove the surface
 * remains a concise newest-first preview rather than leaking overflow rows.
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

/** 42 unique album groups, of which the simplified home Stack shows five. */
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

  await page.route("**/api/stations?**", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );
  await page.route("**/api/stations/now-playing?**", (route) =>
    route.fulfill({ json: { items: [] } }),
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

test.describe("Simplified Stack window", () => {
  test("shows the five newest albums with stable row artwork across reload", async ({
    page,
  }) => {
    await suppressFirstRun(page);
    await installRoutes(page);
    await page.goto("/lore/");

    // The current home Stack deliberately uses one fixed five-row window;
    // density, paging, shuffle, and decorative pager artwork live outside the
    // simplified home surface.
    await expect(stackRows(page)).toHaveCount(5, { timeout: 20_000 });
    const albums = stackRows(page).locator(".compact-stack__album");
    await expect(albums).toHaveText([
      "Density Album 01",
      "Density Album 02",
      "Density Album 03",
      "Density Album 04",
      "Density Album 05",
    ]);
    const rowArt = stackRows(page).locator(".compact-stack__spine-art");
    await expect(rowArt).toHaveCount(5);
    await expect(rowArt.first()).toHaveAttribute(
      "src",
      /\/lore\/e2e-art\/album-01\.svg$/,
    );
    await expect(page.locator(".stack-pager-bar")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(stackRows(page)).toHaveCount(5, { timeout: 20_000 });
    await expect(stackRows(page).locator(".compact-stack__album")).toHaveText([
      "Density Album 01",
      "Density Album 02",
      "Density Album 03",
      "Density Album 04",
      "Density Album 05",
    ]);
    await expect(stackRows(page).locator(".compact-stack__spine-art").first()).toHaveAttribute(
      "src",
      /\/lore\/e2e-art\/album-01\.svg$/,
    );
  });
});