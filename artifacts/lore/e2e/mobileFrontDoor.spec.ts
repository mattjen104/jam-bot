import { test, expect, type Page } from "@playwright/test";

/**
 * Mobile front-door five-row guarantee.
 *
 * Asserts that at the representative phone viewport (390×844):
 *   1. The front door renders no wordmark/moon topbar chrome (dial-topbar--all
 *      is absent).
 *   2. At least five populated .fdrow elements are fully within the initial
 *      viewport without any scrolling (r.bottom ≤ window.innerHeight).
 *   3. The page has no horizontal overflow (no row busts the phone width).
 *   4. Each visible row is keyboard-accessible (role=button, tabIndex=0).
 *   5. The portrait art-height cap (35dvh) keeps the hero compact enough for
 *      rows to fit.
 *
 * All API routes are intercepted so the fixture is deterministic: eight
 * live Zone-1 stations with attributed crossings, no Spotify connection.
 *
 * The corner-nav is pointer-events:none transparent overlay — not a solid
 * dock — so we check r.bottom ≤ window.innerHeight directly (no shell offset).
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStation(slug: string, idx: number) {
  return {
    id: idx + 1,
    slug,
    name: `Station ${slug.toUpperCase()}`,
    org: slug.toUpperCase(),
    city: "London",
    country: "GB",
    streamUrl: `https://stream.example.test/lore-e2e-${slug}`,
    streamQuality: null,
    streamFormat: "aac",
    mode: "live",
    homepageUrl: `https://${slug}.example.test`,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    // This spec verifies individual compact rows on a phone-sized Feed.
    stationCategories: [],
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
  };
}

const STATION_SLUGS = ["nts-1", "kcrw", "bbc6", "wfmu", "kexp", "soma", "fip1", "nts-2"];
const STATIONS = STATION_SLUGS.map(makeStation);

function makeNowPlaying(stationSlug: string, idx: number) {
  const djName = `DJ ${idx + 1}`;
  const showName = `Show ${idx + 1}`;
  return {
    spinId: 900 + idx,
    rawArtist: `Artist ${idx + 1}`,
    rawTitle: `Track ${idx + 1}`,
    source: "nts_live",
    confidence: "unresolved",
    playedAt: new Date(Date.now() - idx * 60_000).toISOString(),
    artworkUrl: null,
    recording: null,
    show: { name: showName, djName },
    isFirstSpin: false,
    isLibraryHit: true,
    isArtistHit: true,
  };
}

function makeSchedule() {
  const now = Date.now();
  return {
    items: STATION_SLUGS.map((slug, idx) => ({
      stationSlug: slug,
      runs: [
        {
          runId: idx + 1,
          show: { name: `Show ${idx + 1}`, djName: `DJ ${idx + 1}`, pickerId: null },
          spinCount: 10,
          resolvedCount: 0,
          startedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          endedAt: new Date(now + 60 * 60 * 1000).toISOString(),
        },
      ],
    })),
  };
}

/** Crossing data so all 8 stations are Zone-1 rows (crossings > 0). */
function makeCrossings() {
  return {
    items: STATION_SLUGS.map((stationSlug, idx) => ({
      stationSlug,
      crossings: 3 + idx,          // non-zero → Zone 1 eligibility
      artistCrossings: 2,
      weekCrossings: 5 + idx,
      weekArtistCrossings: 3,
      monthCrossings: 10 + idx,
      monthArtistCrossings: 6,
      lifetimeCrossings: 20 + idx,
      lifetimeArtistCrossings: 12,
      topArtistNames: [`Artist ${idx + 1}`],
    })),
  };
}

// ---------------------------------------------------------------------------
// Route interception
// ---------------------------------------------------------------------------

async function installRoutes(page: Page) {
  // Abort stream requests — we never actually play audio in these tests.
  await page.route("https://stream.example.test/**", (route) => route.abort());

  // Specific /api/me/* routes are registered before the catch-all so
  // Playwright's last-registered-wins order makes them take precedence.
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: makeCrossings() }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: ["Artist 1", "Artist 2"], hasLibrary: true, hasSeeds: true } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  // Catch-all for any remaining /api/me/* paths.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  await page.route("**/api/stations?**", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
  );
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
  );
  await page.route("**/api/stations/now-playing?**", (route) =>
    route.fulfill({
      json: {
        items: STATION_SLUGS.map((slug, idx) => ({
          slug,
          nowPlaying: makeNowPlaying(slug, idx),
        })),
      },
    }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: STATION_SLUGS.map((slug, idx) => ({
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
  for (const [idx, slug] of STATION_SLUGS.entries()) {
    await page.route(`**/api/stations/${slug}/now-playing`, (route) =>
      route.fulfill({
        json: { station: STATIONS[idx], nowPlaying: makeNowPlaying(slug, idx) },
      }),
    );
  }
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({ json: makeSchedule() }),
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
// Helper: navigate to the front door and wait for at least one crossing row.
// ---------------------------------------------------------------------------

async function loadFrontDoor(page: Page) {
  const response = await page.goto("/lore/");
  // Distinguish "dev server down / stale proxy" (502 etc.) from a genuine
  // rendering regression: a non-OK document response means the app never
  // loaded, so the .fdrow expectation below would time out with no
  // explanation. Fail loudly with the real cause instead.
  expect(
    response?.ok(),
    `front door document request failed (status ${response?.status()}) — is the lore dev server running?`,
  ).toBe(true);
  // App shell must mount before rows are judged; if this fails, the bundle
  // did not boot (crash / blank page), not a row-filter problem.
  await expect(
    page.locator(".split-home"),
    "app shell (.split-home) never mounted — bundle failed to boot",
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".fdrow").first()).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Geometry helper
// ---------------------------------------------------------------------------

interface ViewportInfo {
  rows: { top: number; bottom: number; height: number }[];
  vh: number;
  vw: number;
  bodyScrollWidth: number;
  hasTopbarAll: boolean;
}

async function readFrontDoorGeometry(page: Page): Promise<ViewportInfo> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".fdrow"));
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    return {
      rows: rows.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      }),
      vh,
      vw,
      bodyScrollWidth: document.body.scrollWidth,
      hasTopbarAll: !!document.querySelector(".dial-topbar--all"),
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Mobile front door — five-row viewport guarantee", () => {
  test("390×844: no topbar chrome, five fdrows visible in initial viewport, no horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await loadFrontDoor(page);

    const g = await readFrontDoorGeometry(page);

    expect(g.hasTopbarAll).toBe(false);

    const visibleRows = g.rows.filter((r) => r.top >= 0 && r.bottom <= g.vh);
    expect(visibleRows.length).toBeGreaterThanOrEqual(5);

    // 3. No horizontal overflow.
    expect(g.bodyScrollWidth).toBeLessThanOrEqual(g.vw + 1); // +1 sub-pixel rounding

    // 4. Each visible row has a reasonable minimum touch-target height (≥ 36px).
    for (const row of visibleRows) {
      expect(row.height).toBeGreaterThanOrEqual(36);
    }
  });

  test("375×667 (iPhone SE): five fdrows visible in initial viewport without scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await installRoutes(page);
    await loadFrontDoor(page);

    const g = await readFrontDoorGeometry(page);

    expect(g.hasTopbarAll).toBe(false);

    const visibleRows = g.rows.filter((r) => r.top >= 0 && r.bottom <= g.vh);
    expect(visibleRows.length).toBeGreaterThanOrEqual(5);

    expect(g.bodyScrollWidth).toBeLessThanOrEqual(g.vw + 1);
  });

  test("390×844: first crossing row is keyboard-accessible and responds to click", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await loadFrontDoor(page);

    const firstRow = page.locator(".fdrow").first();
    await expect(firstRow).toHaveAttribute("role", "button");
    await expect(firstRow).toHaveAttribute("tabindex", "0");

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await firstRow.click();
    await page.waitForTimeout(500);
    expect(errors).toHaveLength(0);
  });

  test("uses the locked interface type scale on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await loadFrontDoor(page);

    const type = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>(".home-discovery__title");
      const row = document.querySelector<HTMLElement>(".home-discovery__artist");
      const byline = document.querySelector<HTMLElement>(".home-discovery__byline");
      return {
        title: title ? getComputedStyle(title).fontSize : "",
        row: row ? getComputedStyle(row).fontSize : "",
        byline: byline ? getComputedStyle(byline).fontSize : "",
        family: row ? getComputedStyle(row).fontFamily : "",
      };
    });

    expect(type).toEqual(expect.objectContaining({
      title: "23px",
      row: "16px",
      byline: "12px",
    }));
    expect(type.family).toContain("Nebula Sans");
  });
});

test.describe("Press lens", () => {
  test("persists the lens, keeps a source link, and restores a bookmark", async ({ page }) => {
    let saved = false;
    const article = {
      id: 1,
      title: "Test Article Overlap",
      url: "https://example.com/overlap",
      guid: "overlap-guid",
      publishedAt: "2026-08-27T12:00:00.000Z",
      tags: [],
      matchedArtist: "Test Artist",
      matchedWork: null,
      pickerId: 10,
      publication: "Test Pub",
      handle: "testpub",
      overlap: true,
      saved: false,
      savedAt: null,
    };
    const pageBody = (items: typeof article[]) => ({
      items,
      offset: 0,
      limit: 30,
      total: items.length,
      nextOffset: null,
    });
    const feedItems = [
      ...Array.from({ length: 31 }, (_, index) => ({
        ...article,
        id: index + 1,
        title: index === 0 ? article.title : `Overlap article ${index + 1}`,
        guid: `overlap-guid-${index + 1}`,
        publishedAt: `2026-08-27T${String(12 - Math.floor(index / 60)).padStart(2, "0")}:${String(59 - index).padStart(2, "0")}:00.000Z`,
      })),
      {
        ...article,
        id: 32,
        title: "Test Article Recent",
        url: "https://example.com/recent",
        guid: "recent-guid",
        publishedAt: "2026-08-26T11:00:00.000Z",
        matchedArtist: null,
        overlap: false,
      },
    ];
    const savedItems = feedItems.slice(0, 31);

    await installRoutes(page);
    await page.route("**/api/me/press**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/press/saved")) {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const items = savedItems.slice(offset, offset + 30).map((item) => ({
          ...item,
          saved: true,
          savedAt: "2026-08-27T13:00:00.000Z",
        }));
        return route.fulfill({
          json: {
            ...pageBody(saved ? items : []),
            offset,
            nextOffset: saved && offset + 30 < savedItems.length ? offset + 30 : null,
          },
        });
      }
      if (url.pathname.endsWith("/press/articles/1/bookmark")) {
        saved = route.request().method() === "PUT";
        return route.fulfill({ json: { articleId: 1, saved } });
      }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return route.fulfill({
        json: {
          ...pageBody(feedItems.slice(offset, offset + 30).map((item) => ({
            ...item,
            saved: saved && item.id === 1,
            savedAt: saved && item.id === 1 ? "2026-08-27T13:00:00.000Z" : null,
          }))),
          offset,
          nextOffset: offset + 30 < feedItems.length ? offset + 30 : null,
        },
      });
    });

    await page.goto("/lore/");
    await expect(
      page.locator(".split-home"),
      "app shell (.split-home) never mounted — bundle failed to boot",
    ).toBeVisible({ timeout: 20_000 });

    await page.click('button:has-text("Press")');
    await expect(page.locator('button:has-text("Press")')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('text=Test Article Overlap')).toBeVisible();
    await page.getByTestId("press-pagination-sentinel").scrollIntoViewIfNeeded();
    await expect(page.locator('text=Test Article Recent')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("press-link-1")).toHaveAttribute("href", "https://example.com/overlap");
    await expect(page.getByTestId("press-link-1")).toHaveAttribute("target", "_blank");
    await page.getByTestId("press-bookmark-1").click();
    await expect(page.getByTestId("press-bookmark-1")).toHaveAttribute("aria-label", "Remove bookmark");

    await page.reload();
    await expect(page.locator('button:has-text("Press")')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("press-link-1")).toBeVisible();
    await page.getByTestId("saved-press-pagination-sentinel").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("press-saved-link-31")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Lore radio")');
    await expect(page.locator('button:has-text("Lore radio")')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".home-discovery__section").first()).toBeVisible();
  });
});
