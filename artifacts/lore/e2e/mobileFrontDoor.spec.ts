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
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    stationCategories: ["anchor"],
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

  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
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
  await page.goto("/lore/");
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

    // 1. No front-door wordmark / moon topbar element.
    expect(g.hasTopbarAll).toBe(false);

    // 2. At least five .fdrow elements fully within the viewport (no scroll).
    //    The corner-nav is pointer-events:none transparent — not a solid dock —
    //    so we check against the full window.innerHeight.
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

  test("portrait art cap: artwrap ≤ 35dvh and hero leaves room for five rows", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await loadFrontDoor(page);

    const hero = await page.evaluate(() => {
      const artwrap = document.querySelector<HTMLElement>(".dial-hero__artwrap");
      const panel = document.querySelector<HTMLElement>(".dial-hero__setpanel");
      const artwrapH = artwrap ? artwrap.getBoundingClientRect().height : 0;
      const panelH = panel ? panel.getBoundingClientRect().height : 0;
      return {
        artwrapH,
        panelH,
        heroH: artwrapH + panelH,
        hasTopbarAll: !!document.querySelector(".dial-topbar--all"),
      };
    });

    // Artwrap must be capped by the portrait rule (35dvh ≈ 295px at 844px).
    // Allow 20px tolerance for font/padding rounding.
    const max35dvh = Math.ceil(0.35 * 844) + 20;
    expect(hero.artwrapH).toBeLessThanOrEqual(max35dvh);

    // Hero (art + queue panel) must leave ≥ 200px for rows (5 × 40px minimum).
    expect(hero.heroH).toBeLessThanOrEqual(844 - 200);

    expect(hero.hasTopbarAll).toBe(false);
  });
});
