import { test, expect } from "@playwright/test";

/**
 * End-to-end spec: a first-time visitor (no seeds, no library) sees the
 * FirstRunSidebar — station sentences ordered by provenance rung — and NOT
 * the old chip-based Zone1Placeholder.
 *
 * All API routes are intercepted so the test is deterministic and carries no
 * dependency on live radio data.
 *
 * Assertions
 * ----------
 *  1. At least one `.frb__block` element is visible (sentences rendered).
 *  2. No `.z1-placeholder__seedchip` elements exist (chips absent).
 *  3. `data-rung` attributes on rendered blocks are in non-decreasing order.
 */

// ---------------------------------------------------------------------------
// Fixtures — three live stations covering rungs 1, 2, and 4
// ---------------------------------------------------------------------------

function makeStation(
  id: number,
  slug: string,
  name: string,
  opts: { automationClass?: string | null; isPickerShow?: boolean } = {},
) {
  return {
    id,
    slug,
    name,
    org: null,
    city: "Test City",
    country: "US",
    streamUrl: `https://stream.example/${slug}`,
    streamQuality: null,
    streamFormat: "mp3",
    mode: "live",
    homepageUrl: null,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    stationCategories: ["anchor"],
    mayHaveAds: false,
    automationClass: opts.automationClass ?? null,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
  };
}

const STATION_PICKER = makeStation(1, "wfmu", "WFMU");          // rung 1 — picker show
const STATION_HUMAN = makeStation(2, "dublab", "Dublab");        // rung 2 — human, no picker name
const STATION_AUTO = makeStation(3, "auto-fm", "Auto FM", {     // rung 4 — automated
  automationClass: "automated",
});

const STATIONS = [STATION_PICKER, STATION_HUMAN, STATION_AUTO];

function makeNowPlaying(slug: string, artist: string) {
  return {
    spinId: Math.floor(Math.random() * 1_000_000),
    rawArtist: artist,
    rawTitle: "Test Track",
    source: "spinitron",
    confidence: "recording_id",
    playedAt: new Date().toISOString(),
    artworkUrl: null,
    recording: null,
    show: null,
    isFirstSpin: false,
    isLibraryHit: false,
    isArtistHit: false,
  };
}

/** Schedule that puts each station in the correct provenance rung. */
function makeSchedule() {
  const now = Date.now();
  return {
    items: [
      {
        stationSlug: STATION_PICKER.slug,
        runs: [
          {
            runId: 1,
            show: {
              name: "Morning Selects",
              djName: "Alex Selector",
              pickerId: 99,   // non-null pickerId → isPickerShow in the dial
            },
            spinCount: 6,
            resolvedCount: 4,
            startedAt: new Date(now - 60 * 60 * 1000).toISOString(),
            endedAt: new Date(now + 60 * 60 * 1000).toISOString(),
          },
        ],
      },
      {
        stationSlug: STATION_HUMAN.slug,
        runs: [
          {
            runId: 2,
            show: {
              name: "Afternoon Session",
              djName: null,
              pickerId: null,
            },
            spinCount: 3,
            resolvedCount: 0,
            startedAt: new Date(now - 60 * 60 * 1000).toISOString(),
            endedAt: new Date(now + 60 * 60 * 1000).toISOString(),
          },
        ],
      },
      {
        stationSlug: STATION_AUTO.slug,
        runs: [
          {
            runId: 3,
            show: {
              name: "Auto Rotation",
              djName: null,
              pickerId: null,
            },
            spinCount: 10,
            resolvedCount: 8,
            startedAt: new Date(now - 60 * 60 * 1000).toISOString(),
            endedAt: new Date(now + 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route-interception helper
// ---------------------------------------------------------------------------

async function installFirstRunRoutes(page: import("@playwright/test").Page) {
  // Listener endpoints — anonymous user: no seeds, no library.
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({
      json: { names: [], hasLibrary: false, hasSeeds: false },
    }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: [], computing: false } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  // Station directory.
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
  );

  // Live pulse — all three stations are live.
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: [
          { slug: STATION_PICKER.slug, nowPlaying: makeNowPlaying(STATION_PICKER.slug, "Floating Points") },
          { slug: STATION_HUMAN.slug, nowPlaying: makeNowPlaying(STATION_HUMAN.slug, "Laraaji") },
          { slug: STATION_AUTO.slug, nowPlaying: makeNowPlaying(STATION_AUTO.slug, "Brian Eno") },
        ],
      },
    }),
  );

  // SSE stream — empty event stream (REST pulse is the primary source).
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );

  // Per-station now-playing (player dock).
  for (const station of STATIONS) {
    await page.route(`**/api/stations/${station.slug}/now-playing`, (route) =>
      route.fulfill({
        json: {
          station,
          nowPlaying: makeNowPlaying(station.slug, "Test Artist"),
        },
      }),
    );
  }

  // Schedule — drives rung derivation.
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({ json: makeSchedule() }),
  );

  // Recent spins / artist frequency — empty is safe.
  await page.route("**/api/stations/recent-spins**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/stations/artist-frequency**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  // Pickers directory — empty.
  await page.route("**/api/pickers/**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("First-run sidebar — station sentences for new visitors", () => {
  test("shows .frb__block sentences, not .z1-placeholder__seedchip chips", async ({
    page,
  }) => {
    await installFirstRunRoutes(page);
    // The first-run sidebar is a crossings-feed surface; radio mode
    // (crossings off) is the default now, so pin crossings on.
    await page.addInitScript(() => {
      window.localStorage.setItem("lore:radioMode", "false");
    });
    await page.goto("/lore/feed");

    // Wait for the first sentence block to appear — indicates FirstRunSidebar
    // has rendered and the station data has loaded.
    await expect(page.locator(".frb__block").first()).toBeVisible({
      timeout: 20_000,
    });

    // At least one block must be visible.
    const blocks = page.locator(".frb__block");
    await expect(blocks.first()).toBeVisible();

    // No chip elements must be present anywhere in the DOM.
    await expect(page.locator(".z1-placeholder__seedchip")).toHaveCount(0);
  });

  test("station blocks appear in non-decreasing data-rung DOM order", async ({
    page,
  }) => {
    await installFirstRunRoutes(page);
    // The first-run sidebar is a crossings-feed surface; radio mode
    // (crossings off) is the default now, so pin crossings on.
    await page.addInitScript(() => {
      window.localStorage.setItem("lore:radioMode", "false");
    });
    await page.goto("/lore/feed");

    // Wait for blocks to settle.
    await expect(page.locator(".frb__block").first()).toBeVisible({
      timeout: 20_000,
    });

    // Collect all data-rung values from the DOM.
    const rungs = await page.locator(".frb__block").evaluateAll((els) =>
      els.map((el) => parseInt(el.getAttribute("data-rung") ?? "0", 10)),
    );

    expect(rungs.length).toBeGreaterThan(0);

    // Verify non-decreasing order.
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]).toBeGreaterThanOrEqual(rungs[i - 1]);
    }
  });

  test("no chip elements exist even when many stations are live", async ({
    page,
  }) => {
    await installFirstRunRoutes(page);
    // The first-run sidebar is a crossings-feed surface; radio mode
    // (crossings off) is the default now, so pin crossings on.
    await page.addInitScript(() => {
      window.localStorage.setItem("lore:radioMode", "false");
    });
    await page.goto("/lore/feed");

    await expect(page.locator(".frb__block").first()).toBeVisible({
      timeout: 20_000,
    });

    // The old chip UI must never appear for a first-time visitor.
    await expect(page.locator(".z1-placeholder__seedchip")).toHaveCount(0);

    // The sidebar root must be present (confirms it's the FRB surface, not a
    // different zone-1 branch).
    await expect(page.locator(".frb")).toBeVisible();
  });
});
