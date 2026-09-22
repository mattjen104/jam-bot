import { expect, test, type Page } from "@playwright/test";

const station = {
  id: 848,
  slug: "set-sidebar-radio",
  name: "Set Sidebar Radio",
  org: "Set Sidebar Radio",
  city: "Testville",
  country: "US",
  streamUrl: "https://stream.station-set-sidebar.test/live",
  streamQuality: null,
  streamFormat: "mp3",
  mode: "live",
  homepageUrl: "https://set-sidebar-radio.example.test",
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
  stationCategories: ["anchor"],
};

const nowPlaying = {
  spinId: 903,
  artist: "Slint",
  title: "Good Morning, Captain",
  rawArtist: "Slint",
  rawTitle: "Good Morning, Captain",
  source: "nts_live",
  confidence: "recording_id",
  playedAt: new Date().toISOString(),
  artworkUrl: null,
  recording: {
    mbid: "00000000-0000-0000-0000-000000000903",
    title: "Good Morning, Captain",
    artist: "Slint",
    artistMbid: null,
    artworkUrl: null,
    links: [],
    genres: null,
    releaseYear: 1991,
    releaseDate: "1991-03-27",
  },
  show: { name: "Overnight", djName: "Diane K" },
  isFirstSpin: false,
  isLibraryHit: false,
  isArtistHit: true,
};

const initialSpins = [
  {
    spinId: 903,
    mbid: "00000000-0000-0000-0000-000000000903",
    artistMbid: null,
    releaseGroupMbid: null,
    albumTitle: "Spiderland",
    title: "Good Morning, Captain",
    artist: "Slint",
    playedAt: "2026-09-22T06:35:00.000Z",
    showName: "Overnight",
    djName: "Diane K",
  },
  {
    spinId: 902,
    mbid: "00000000-0000-0000-0000-000000000902",
    artistMbid: null,
    releaseGroupMbid: null,
    albumTitle: "Don Caballero 2",
    title: "The Peter Criss Jazz",
    artist: "Don Caballero",
    playedAt: "2026-09-22T06:24:00.000Z",
    showName: "Overnight",
    djName: "Diane K",
  },
  {
    spinId: 901,
    mbid: null,
    artistMbid: null,
    releaseGroupMbid: null,
    albumTitle: null,
    title: "",
    artist: "",
    playedAt: "2026-09-22T06:18:00.000Z",
    showName: "Overnight",
    djName: "Diane K",
  },
];

function currentSet(spins = initialSpins) {
  return {
    station: {
      slug: station.slug,
      name: station.name,
      stationClass: "curated",
    },
    ianaTimezone: "America/New_York",
    runId: 900,
    startedAt: "2026-09-22T05:58:00.000Z",
    showName: "Overnight",
    djName: "Diane K",
    spins,
  };
}

async function installRoutes(page: Page) {
  let setRequestCount = 0;
  const keepBodies: unknown[] = [];

  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => undefined;
  });

  await page.route("https://stream.station-set-sidebar.test/**", (route) =>
    route.abort(),
  );
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { spotifyImportEnabled: false, demoSurface: false } }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({
      json: { names: ["Slint"], hasLibrary: true, hasSeeds: true },
    }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({
      json: {
        items: [{
          stationSlug: station.slug,
          crossings: 3,
          artistCrossings: 3,
          weekCrossings: 1,
          weekArtistCrossings: 1,
          monthCrossings: 2,
          monthArtistCrossings: 2,
          lifetimeCrossings: 3,
          lifetimeArtistCrossings: 3,
          resolvedTracks24h: 1,
          resolvedTracks7d: 2,
          resolvedTracks30d: 3,
          resolvedTracksLifetime: 3,
          scoreVersion: 3,
          score24h: 0.75,
          score7d: 0.75,
          score30d: 0.75,
          scoreLifetime: 0.75,
          topArtistNames: ["Slint"],
          albumCrossings: [{
            releaseGroupMbid: "00000000-0000-0000-0000-000000000848",
            recordingMbid: nowPlaying.recording.mbid,
            title: "Good Morning, Captain",
            artist: "Slint",
            artworkUrl: null,
          }],
        }],
        computing: false,
        failed: false,
      },
    }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  await page.route("**/api/me/keep/status**", (route) =>
    route.fulfill({ json: { kept: [] } }),
  );
  await page.route("**/api/me/keep/pending-status**", (route) =>
    route.fulfill({ json: { savedSpinIds: [], pendingSpinIds: [] } }),
  );
  await page.route("**/api/me/keep", async (route) => {
    keepBodies.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        keptToLore: true,
        mirroredToSpotify: false,
        mirrors: [],
        showRecoveryHint: false,
      },
    });
  });

  await page.route("**/api/stations?**", (route) =>
    route.fulfill({ json: { stations: [station] } }),
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
  await page.route(`**/api/stations/${station.slug}/current-set`, (route) => {
    setRequestCount += 1;
    const spins = setRequestCount === 1
      ? initialSpins
      : [
          {
            ...initialSpins[0],
            spinId: 904,
            mbid: "00000000-0000-0000-0000-000000000904",
            title: "Breadcrumb Trail",
            playedAt: "2026-09-22T06:42:00.000Z",
          },
          ...initialSpins,
        ];
    return route.fulfill({ json: currentSet(spins) });
  });
  await page.route(`**/api/stations/${station.slug}/now-playing`, (route) =>
    route.fulfill({ json: { station, nowPlaying } }),
  );
  await page.route("**/api/player/station/*/now", (route) =>
    route.fulfill({
      json: {
        serverTime: new Date().toISOString(),
        station: { slug: station.slug, name: station.name },
        now: null,
        refreshTriggered: false,
        confirmed: false,
      },
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

  return {
    keepBodies,
    getSetRequestCount: () => setRequestCount,
  };
}

test("the tuned station set sidebar follows landscape, keeps tracks, and polls in place", async ({
  page,
}) => {
  test.setTimeout(70_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const routes = await installRoutes(page);
  await page.goto("/lore/feed");

  await page.getByRole("button", {
    name: `Tune in to ${station.name}`,
    exact: true,
  }).click();

  const sidebar = page.getByRole("complementary", {
    name: `On air on ${station.name}`,
  });
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toContainText("Good Morning, Captain");
  await expect(sidebar).toContainText("Earlier this set");

  const earlierKeep = page.getByTestId("setrow-902").getByTestId("keep-button");
  await earlierKeep.click();
  await expect(earlierKeep).toHaveAttribute("aria-pressed", "true");
  expect(routes.keepBodies).toContainEqual(expect.objectContaining({
    mbid: initialSpins[1].mbid,
    spinId: 902,
    provenance: expect.objectContaining({
      source: "set_sidebar",
      stationSlug: station.slug,
    }),
  }));

  await page.setViewportSize({ width: 720, height: 1280 });
  await expect(sidebar).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(sidebar).toBeVisible();
  await expect.poll(routes.getSetRequestCount).toBe(1);

  const earlierRows = sidebar.locator(".setrow");
  await expect.poll(() =>
    earlierRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid"))),
  ).toEqual(["setrow-902", "setrow-901"]);

  await expect.poll(routes.getSetRequestCount, { timeout: 35_000 }).toBe(2);
  await expect(sidebar).toContainText("Breadcrumb Trail");
  await expect.poll(() =>
    earlierRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid"))),
  ).toEqual(["setrow-903", "setrow-902", "setrow-901"]);
});