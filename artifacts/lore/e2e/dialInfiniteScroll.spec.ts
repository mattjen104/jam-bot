/**
 * Dial infinite scroll — confirms IntersectionObserver sentinel wiring works
 * in a real browser (Chromium).
 *
 * jsdom stubs IntersectionObserver as a no-op, so the sentinel-triggered
 * reveal is never exercised by Vitest. A regression (e.g. wrong root, sentinel
 * never observed, threshold bug) would ship silently — users would see the
 * first fold but scrolling would never load the rest.
 *
 * Two sentinels are tested:
 *
 *   .zone2-sentinel  — Zone2Lane (ghost stations "missed while away").
 *                      ZONE2_INITIAL = 6; test mocks 12 ghost stations.
 *
 *   .dial-feed-sentinel — DialFeedLane (unified live station feed).
 *                         FEED_INITIAL = 12; test mocks 20 live stations.
 *
 * All API routes are intercepted so the fixtures are deterministic.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Station factories
// ---------------------------------------------------------------------------

function makeLiveStation(slug: string, idx: number) {
  return {
    id: idx + 1,
    slug,
    name: `Live ${slug.toUpperCase()}`,
    org: slug.toUpperCase(),
    city: "London",
    country: "GB",
    streamUrl: `https://stream.example.test/e2e-${slug}`,
    streamQuality: null,
    streamFormat: "aac",
    mode: "live",
    homepageUrl: `https://${slug}.example.test`,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    stationCategories: ["anchor"],
  };
}

function makeNowPlaying(stationSlug: string, idx: number) {
  return {
    spinId: 900 + idx,
    rawArtist: `Artist ${idx + 1}`,
    rawTitle: `Track ${idx + 1}`,
    source: "nts_live",
    confidence: "unresolved",
    playedAt: new Date(Date.now() - idx * 60_000).toISOString(),
    artworkUrl: null,
    recording: null,
    show: { name: `Show ${idx + 1}`, djName: `DJ ${idx + 1}` },
    isFirstSpin: false,
    isLibraryHit: false,
    isArtistHit: false,
  };
}

/** 12 ghost stations — more than ZONE2_INITIAL (6) so the sentinel renders. */
const GHOST_SLUGS = Array.from({ length: 12 }, (_, i) => `ghost-${i + 1}`);

function makeGhostStation(slug: string, idx: number) {
  return {
    stationId: 100 + idx,
    slug,
    name: `Ghost Station ${idx + 1}`,
    streamUrl: `https://stream.example.test/ghost-${idx}`,
    streamFormat: "aac",
    mode: "live",
    attribution: true,
    artistName: `Ghost Artist ${idx + 1}`,
    playedAt: new Date(Date.now() - (idx + 1) * 3_600_000).toISOString(),
    day: "2026-08-11",
    showName: `Ghost Show ${idx + 1}`,
    djName: `Ghost DJ ${idx + 1}`,
    runId: 200 + idx,
  };
}

/** 4 minimal live stations used as backdrop for the ghost-row test. */
const BACKDROP_SLUGS = ["nts-1", "kcrw", "bbc6", "wfmu"];

/** 20 live stations — more than FEED_INITIAL (12) so the sentinel renders. */
const MANY_LIVE_SLUGS = Array.from({ length: 20 }, (_, i) => `live-${i + 1}`);

// ---------------------------------------------------------------------------
// Route installer
// ---------------------------------------------------------------------------

/**
 * Install all API routes needed to load the front door with the given live
 * stations. The caller may register additional `page.route()` calls AFTER this
 * function to override or add routes; Playwright's last-registered-wins order
 * means later calls take precedence over the /api/me/** catch-all registered
 * here.
 */
async function installRoutes(
  page: Page,
  stations: ReturnType<typeof makeLiveStation>[],
) {
  // Abort stream audio connections.
  await page.route("https://stream.example.test/**", (route) => route.abort());

  // Specific /api/me/* routes before the catch-all so they win.
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    // No crossings → all live stations land in the rest band; feed still renders.
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({
      json: { names: ["Ghost Artist 1"], hasLibrary: true, hasSeeds: true },
    }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  // catch-all — must come last among /api/me/* registrations.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  const slugs = stations.map((s) => s.slug);

  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations } }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: slugs.map((slug, idx) => ({
          slug,
          nowPlaying: makeNowPlaying(slug, idx),
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
  for (const [idx, slug] of slugs.entries()) {
    await page.route(`**/api/stations/${slug}/now-playing`, (route) =>
      route.fulfill({
        json: { station: stations[idx], nowPlaying: makeNowPlaying(slug, idx) },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Dial infinite scroll — sentinel triggers row reveal on scroll", () => {
  test("Zone2Lane: scrolling to the .zone2-sentinel reveals all 12 ghost rows (ZONE2_INITIAL = 6)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // 4 live backdrop stations (different slugs from ghosts so none are filtered).
    const backdrop = BACKDROP_SLUGS.map(makeLiveStation);
    await installRoutes(page, backdrop);

    // 12 ghost stations — registered after installRoutes so last-registered-wins
    // takes precedence over the /api/me/** catch-all.
    const ghosts = GHOST_SLUGS.map(makeGhostStation);
    await page.route("**/api/me/ghost/missed", (route) =>
      route.fulfill({ json: { stations: ghosts } }),
    );

    await page.goto("/lore/feed");

    // Wait for at least one ghost row to render.
    await expect(page.locator(".ghost-row").first()).toBeVisible({ timeout: 20_000 });

    // Initial fold: exactly ZONE2_INITIAL (6) rows shown, sentinel is present.
    const countBefore = await page.locator(".ghost-row").count();
    expect(countBefore).toBeGreaterThanOrEqual(6);
    await expect(page.locator(".zone2-sentinel")).toBeAttached({ timeout: 5_000 });

    // Scroll the sentinel into view — fires IntersectionObserver.
    await page.locator(".zone2-sentinel").scrollIntoViewIfNeeded();

    // After scroll: all 12 ghost rows should mount (6 initial + 6 next page).
    await expect(page.locator(".ghost-row")).toHaveCount(ghosts.length, {
      timeout: 5_000,
    });

    const countAfter = await page.locator(".ghost-row").count();
    expect(countAfter).toBeGreaterThan(countBefore);
    expect(countAfter).toBe(ghosts.length);
  });

  test("DialFeedLane: scrolling to the .dial-feed-sentinel reveals all 20 live feed rows (FEED_INITIAL = 12)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // 20 live stations — exceed FEED_INITIAL (12) so the sentinel renders.
    const stations = MANY_LIVE_SLUGS.map(makeLiveStation);
    await installRoutes(page, stations);

    // No ghost stations — keeps Zone2Lane hidden so .fdrow count is unambiguous.
    await page.route("**/api/me/ghost/missed", (route) =>
      route.fulfill({ json: { stations: [] } }),
    );

    await page.goto("/lore/feed");

    // Wait for at least one live feed row.
    await expect(page.locator(".fdrow").first()).toBeVisible({ timeout: 20_000 });

    // Initial fold: at least FEED_INITIAL (12) rows.
    const countBefore = await page.locator(".fdrow").count();
    expect(countBefore).toBeGreaterThanOrEqual(12);

    // Since the album-art hero was removed, the feed is full-height and the
    // sentinel can already sit inside the initial viewport — in that case the
    // IntersectionObserver reveals the remaining rows immediately and unmounts
    // the sentinel before we can scroll to it. Scroll if it's still attached;
    // either path must end with every row mounted.
    const sentinel = page.locator(".dial-feed-sentinel");
    try {
      await sentinel.scrollIntoViewIfNeeded({ timeout: 2_000 });
    } catch {
      // Sentinel already consumed — rows were revealed without a scroll.
    }

    // All 20 live rows mount.
    await expect(page.locator(".fdrow")).toHaveCount(stations.length, {
      timeout: 5_000,
    });
  });
});
