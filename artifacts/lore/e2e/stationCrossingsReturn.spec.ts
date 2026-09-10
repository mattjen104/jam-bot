import { expect, test, type Page } from "@playwright/test";

const station = {
  id: 673,
  slug: "return-radio",
  name: "Return Radio",
  org: "Return Radio",
  city: "Testville",
  country: "US",
  streamUrl: "https://stream.station-crossings-return.test/live",
  streamQuality: null,
  streamFormat: "mp3",
  mode: "live",
  homepageUrl: "https://return-radio.example.test",
  donateUrl: null,
  logoUrl: null,
  attribution: true,
  tags: null,
  mayHaveAds: false,
  votes: 0,
  clickcount: 0,
  upcomingShowCount: 0,
  tier: "flagship",
  qualityTier: "proven",
  automationClass: "human",
  nowPlayingSource: "nts_live",
  stationCategories: ["indie"],
};

const nowPlaying = {
  spinId: 6730,
  artist: "Broadcast",
  title: "Come On Let's Go",
  rawArtist: "Broadcast",
  rawTitle: "Come On Let's Go",
  source: "nts_live",
  confidence: "unresolved",
  playedAt: "2026-09-10T12:00:00.000Z",
  artworkUrl: null,
  recording: null,
  show: { name: "Test Transmission", djName: "DJ Return" },
  isFirstSpin: false,
  isLibraryHit: true,
  isArtistHit: true,
};

async function installRoutes(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__mediaPlayCalls", {
      configurable: true,
      value: 0,
      writable: true,
    });
    HTMLMediaElement.prototype.play = function () {
      window.__mediaPlayCalls += 1;
      return Promise.resolve();
    };
  });

  await page.route("https://stream.station-crossings-return.test/**", (route) =>
    route.abort(),
  );
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { spotifyImportEnabled: false, demoSurface: true },
    }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({
      json: { names: ["Broadcast"], hasLibrary: true, hasSeeds: true },
    }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({
      json: {
        items: [{
          stationSlug: station.slug,
          crossings: 4,
          artistCrossings: 3,
          firstPlayCrossings: 1,
          weekCrossings: 2,
          weekArtistCrossings: 2,
          weekFirstPlayCrossings: 0,
          monthCrossings: 3,
          monthArtistCrossings: 2,
          monthFirstPlayCrossings: 1,
          lifetimeCrossings: 4,
          lifetimeArtistCrossings: 3,
          lifetimeFirstPlayCrossings: 1,
          topArtistNames: ["Broadcast"],
        }],
        computing: false,
        failed: false,
      },
    }),
  );
  await page.route("**/api/me/stations/return-radio/crossings**", (route) =>
    route.fulfill({
      json: {
        stationSlug: station.slug,
        exact: [{
          spinId: 6731,
          title: "Come On Let's Go",
          artist: "Broadcast",
          albumTitle: "The Noise Made by People",
          exactMatchKind: "song",
          playedAt: "2026-09-09T18:30:00.000Z",
        }],
        artistOnly: [],
        generatedAt: "2026-09-10T12:01:00.000Z",
        nextCursor: null,
      },
    }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  await page.route("**/api/me/library**", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null, total: 0, keepCount: 0 } }),
  );

  await page.route("**/api/stations?**", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: [station] } }),
  );
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );
  await page.route("**/api/stations/now-playing**", (route) =>
    route.fulfill({
      json: { items: [{ slug: station.slug, nowPlaying }] },
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

declare global {
  interface Window {
    __mediaPlayCalls: number;
  }
}

test("station crossing history returns to the focused and sorted Radio view", async ({
  page,
}) => {
  await installRoutes(page);
  await page.goto("/lore/library?focus=Broadcast&stationSort=name");

  await expect(page.getByText("Stations that play Broadcast")).toBeVisible();
  await expect(page.getByLabel("Sort stations")).toHaveValue("name");

  await page.getByRole("button", {
    name: "Open every crossing for Return Radio",
  }).click();

  await expect(page).toHaveURL(
    /\/lore\/library\?focus=Broadcast&stationSort=name&stationCrossings=return-radio$/,
  );
  await expect(page.getByRole("region", {
    name: "Crossings for Return Radio",
  })).toContainText("Come On Let's Go");
  await expect.poll(() =>
    page.evaluate(() => window.__mediaPlayCalls),
  ).toBe(0);

  await page.getByRole("button", { name: "Back to Radio" }).click();

  await expect(page).toHaveURL(
    /\/lore\/library\?focus=Broadcast&stationSort=name$/,
  );
  await expect(page.getByText("Stations that play Broadcast")).toBeVisible();
  await expect(page.getByLabel("Sort stations")).toHaveValue("name");
});