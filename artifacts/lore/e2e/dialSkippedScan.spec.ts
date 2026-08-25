import { test, expect, type Page } from "@playwright/test";

/**
 * The homepage and full Feed share lore:dialSkipped. This browser regression
 * proves that a skipped live station is rendered after included stations and
 * is never handed to either scan mode's preview path.
 */

const STATIONS = [
  ["included-alpha", "Included Alpha"],
  ["included-beta", "Included Beta"],
  ["skipped-station", "Skipped Station"],
] as const;

function makeStation([slug, name]: (typeof STATIONS)[number], index: number) {
  return {
    id: index + 1,
    slug,
    name,
    org: name.toUpperCase(),
    city: "London",
    country: "GB",
    streamUrl: `https://stream.example.test/${slug}`,
    streamQuality: null,
    streamFormat: "aac",
    mode: "live",
    homepageUrl: `https://${slug}.example.test`,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    stationCategories: ["anchor"],
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
  };
}

const stations = STATIONS.map(makeStation);

function nowPlaying(index: number) {
  return {
    spinId: 20_000 + index,
    rawArtist: `Artist ${index + 1}`,
    rawTitle: `Track ${index + 1}`,
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

async function installRoutes(page: Page) {
  await page.route("https://stream.example.test/**", (route) => route.abort());

  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [], hasLibrary: true, hasSeeds: true } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/stations?**", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations } }),
  );
  await page.route("**/api/stations/now-playing?**", (route) =>
    route.fulfill({
      json: {
        items: stations.map((station, index) => ({
          slug: station.slug,
          nowPlaying: nowPlaying(index),
        })),
      },
    }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: stations.map((station, index) => ({
          slug: station.slug,
          nowPlaying: nowPlaying(index),
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
  for (const [index, station] of stations.entries()) {
    await page.route(`**/api/stations/${station.slug}/now-playing`, (route) =>
      route.fulfill({
        json: { station, nowPlaying: nowPlaying(index) },
      }),
    );
  }
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

test.describe("shared skipped-station preference", () => {
  test("keeps skipped stations excluded and ordered last across Feed navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("lore:dialSkipped", JSON.stringify(["skipped-station"]));
      localStorage.setItem("lore:radioMode", "true");
    });

    const previews: string[] = [];
    page.on("request", (request) => {
      const match = /^https:\/\/stream\.example\.test\/([^/?#]+)/.exec(request.url());
      if (match) previews.push(match[1]);
    });

    await installRoutes(page);
    await page.goto("/lore/");

    const category = page.getByTestId("compact-category-tab-anchor");
    await expect(category).toBeVisible({ timeout: 20_000 });
    await category.click();
    const categoryFeed = page.getByTestId("compact-category-anchor-now-feed");
    const skippedInclude = categoryFeed.getByRole("checkbox", {
      name: "Include Skipped Station in scan",
    });
    await expect(skippedInclude).not.toBeChecked();

    const names = await categoryFeed
      .locator(".compact-category-dial__feed-tune")
      .allTextContents();
    expect(names.map((name) => name.match(/(Included Alpha|Included Beta|Skipped Station)/)?.[1]))
      .toEqual(["Included Alpha", "Included Beta", "Skipped Station"]);

    // The simplified front door no longer auto-previews a page/all scan.
    // Merely opening the category keeps the excluded station silent.
    expect(previews).not.toContain("skipped-station");

    await page.reload();
    await expect(page.getByTestId("compact-category-tab-anchor")).toBeVisible({
      timeout: 20_000,
    });
    await page.goto("/lore/feed");
    await expect(page.locator("#dial-feed-rows")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("lore:dialSkipped")))
      .toBe(JSON.stringify(["skipped-station"]));

    const feedSlugs = await page
      .locator("#dial-feed-rows [data-station-slug]")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-station-slug")));
    expect(feedSlugs.indexOf("skipped-station")).toBeGreaterThan(
      feedSlugs.indexOf("included-alpha"),
    );
    expect(feedSlugs.indexOf("skipped-station")).toBeGreaterThan(
      feedSlugs.indexOf("included-beta"),
    );
    expect(previews).not.toContain("skipped-station");
  });
});