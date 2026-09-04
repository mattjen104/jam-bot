import { expect, test, type Page } from "@playwright/test";

const OFFICIAL_SCHEDULE_URL = "https://spinitron.com/WKNC/calendar";

const archiveFixture = (slug: string, name: string) => ({
  station: {
    id: slug === "wknc" ? 565 : 566,
    slug,
    name,
    org: null,
    city: null,
    region: null,
    country: "US",
    streamUrl: `https://${slug}.example/stream`,
    streamQuality: null,
    streamFormat: "mp3",
    mode: "live",
    homepageUrl: null,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 2,
  },
  runs: [],
  nextOffset: null,
});

const rotatingSchedule = {
  stationSlug: "wknc",
  shows: [],
  datedExceptions: [
    {
      showName: "The Local Beat",
      airDate: "2026-09-07",
      dayOfWeek: "Mon",
      startTime: "17:00",
      endTime: "18:00",
      djName: "DJ Aster",
      sourceUrl: OFFICIAL_SCHEDULE_URL,
      scrapedAt: "2026-09-01T12:00:00.000Z",
      extraction: "api",
    },
    {
      showName: "Oak City Move",
      airDate: "2026-09-14",
      dayOfWeek: "Mon",
      startTime: "17:00",
      endTime: "18:30",
      djName: "DJ Meridian",
      sourceUrl: OFFICIAL_SCHEDULE_URL,
      scrapedAt: "2026-09-01T12:00:00.000Z",
      extraction: "api",
    },
  ],
  lastScrapedAt: "2026-09-01T12:00:00.000Z",
  timezoneHint: "America/New_York",
};

const recurringSchedule = {
  stationSlug: "steady-fm",
  shows: [
    {
      showName: "Monday Signal",
      dayOfWeek: "Mon",
      startTime: "09:00",
      endTime: "10:00",
      djName: "Host Monday",
      sourceUrl: "https://steady.example/schedule",
      scrapedAt: "2026-09-01T12:00:00.000Z",
      extraction: "llm",
    },
  ],
  datedExceptions: [],
  lastScrapedAt: "2026-09-01T12:00:00.000Z",
  timezoneHint: "America/Chicago",
};

async function installRoutes(page: Page) {
  // Keep this browser regression independent of live services and database data.
  // Playwright resolves the most recently registered matching route first.
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/player/onair", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/stations/spins?**", (route) =>
    route.fulfill({
      json: {
        tracks: [],
        nextCursor: null,
        bounds: { oldestSpinAt: null, newestSpinAt: null, spinCount: 0 },
      },
    }),
  );
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ready\n\n",
    }),
  );

  for (const [slug, name, schedule] of [
    ["wknc", "WKNC", rotatingSchedule],
    ["steady-fm", "Steady FM", recurringSchedule],
  ] as const) {
    await page.route(`**/api/stations/${slug}/archive**`, (route) =>
      route.fulfill({ json: archiveFixture(slug, name) }),
    );
    await page.route(`**/api/stations/${slug}/overlaps/pickers`, (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    await page.route(`**/api/stations/${slug}/insights`, (route) =>
      route.fulfill({
        json: {
          station: { slug, name },
          insights: {
            genreBreakdown: null,
            discoveryScore: null,
            recentProfile: null,
            freshnessSignal: null,
            readinessTier: "unscored",
          },
        },
      }),
    );
    await page.route(`**/api/stations/${slug}/upcoming-schedule`, (route) =>
      route.fulfill({ json: schedule }),
    );
  }
}

test("preserves dated alternatives while recurring stations keep the weekly grid", async ({
  page,
}) => {
  await installRoutes(page);

  await page.goto("/lore/archive/stations/wknc");
  await page.getByRole("button", { name: /schedule/i }).click();

  await expect(page.getByText("Date-specific schedule")).toBeVisible();
  const alternatives = page.locator("li").filter({
    has: page.getByRole("link", { name: "Official schedule" }),
  });
  await expect(alternatives).toHaveCount(2);

  await expect(alternatives.nth(0)).toContainText("The Local Beat");
  await expect(alternatives.nth(0)).toContainText("Mon, Sep 7 · 17:00–18:00 · DJ Aster");
  await expect(alternatives.nth(1)).toContainText("Oak City Move");
  await expect(alternatives.nth(1)).toContainText(
    "Mon, Sep 14 · 17:00–18:30 · DJ Meridian",
  );
  for (const alternative of await alternatives.all()) {
    await expect(
      alternative.getByRole("link", { name: "Official schedule" }),
    ).toHaveAttribute("href", OFFICIAL_SCHEDULE_URL);
  }
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.goto("/lore/archive/stations/steady-fm");
  await page.getByRole("button", { name: /schedule/i }).click();

  await expect(page.getByText("Date-specific schedule")).toHaveCount(0);
  const grid = page.getByRole("table");
  await expect(grid).toBeVisible();
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    await expect(grid.getByRole("columnheader", { name: new RegExp(`^${day}`) })).toBeVisible();
  }
  await expect(grid.getByText("Monday Signal")).toBeVisible();
  await expect(grid.getByText("Host Monday")).toBeVisible();
  await expect(grid.getByText("9am–10am")).toBeVisible();
});