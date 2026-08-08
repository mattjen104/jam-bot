import { test, expect, type Page } from "@playwright/test";

/**
 * Browser-geometry tests confirming the corner nav links ([lore] / [my library])
 * remain visible and tappable when the player dock is rendered on a small phone —
 * both portrait (360×640) and landscape (640×360).
 *
 * The critical CSS contract: `.corner-nav` is fixed at
 *   `bottom: calc(var(--shell-h, 0px) + 8px)`
 * where --shell-h is the measured height of .bottom-shell-wrap (set by App.tsx).
 * This positions the links strictly above the player dock, so the dock's
 * touch surface never intercepts taps meant for the nav links.
 *
 * All API routes are intercepted so the player dock renders deterministically
 * with a live station tuned in (the dock is visible and full-height).
 *
 * Assertions per viewport:
 *   1. Both .corner-nav__link elements are visible (in the viewport).
 *   2. Both links accept a Playwright click() — which fails when an element is
 *      fully covered by another element.
 *   3. The bottom edge of each link lies above the top edge of the player dock
 *      (no geometric overlap between links and the dock).
 */

const NTS_SLUG = "nts-1";
const DJ_NAME = "Ben UFO";
const SHOW_NAME = "Hessle Audio";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATION = {
  id: 1,
  slug: NTS_SLUG,
  name: "NTS 1",
  org: "NTS",
  city: "London",
  country: "GB",
  streamUrl: "https://stream.example.test/lore-e2e-silence",
  streamQuality: null,
  streamFormat: "aac",
  mode: "live",
  homepageUrl: "https://www.nts.live",
  donateUrl: null,
  logoUrl: null,
  attribution: true,
  tags: null,
  mayHaveAds: false,
  votes: 0,
  clickcount: 0,
  upcomingShowCount: 0,
};

function makeNowPlaying() {
  return {
    spinId: 900,
    rawArtist: "Some Artist",
    rawTitle: "Some Track",
    source: "nts_live",
    confidence: "unresolved",
    playedAt: new Date().toISOString(),
    artworkUrl: null,
    recording: null,
    show: { name: SHOW_NAME, djName: DJ_NAME },
    isFirstSpin: false,
    isLibraryHit: false,
    isArtistHit: false,
  };
}

function makeSchedule() {
  const now = Date.now();
  return {
    items: [
      {
        stationSlug: NTS_SLUG,
        runs: [
          {
            runId: 1,
            show: { name: SHOW_NAME, djName: DJ_NAME, pickerId: null },
            spinCount: 4,
            resolvedCount: 0,
            startedAt: new Date(now - 60 * 60 * 1000).toISOString(),
            endedAt: new Date(now + 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route interception
// ---------------------------------------------------------------------------

async function installRoutes(page: Page) {
  // Never actually connect to the fake stream.
  await page.route("https://stream.example.test/**", (route) => route.abort());

  // Listener endpoints — anonymous defaults.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [], hasLibrary: false, hasSeeds: false } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: [STATION] } }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: { items: [{ slug: NTS_SLUG, nowPlaying: makeNowPlaying() }] },
    }),
  );
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );
  await page.route(`**/api/stations/${NTS_SLUG}/now-playing`, (route) =>
    route.fulfill({ json: { station: STATION, nowPlaying: makeNowPlaying() } }),
  );
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the dial front door and tune in to the live station so the
 * player dock (bottom-shell-wrap > bottom-shell > player-bar-block) is shown.
 */
async function loadWithDock(page: Page) {
  await page.goto("/lore/");

  // Wait for the DJs-on-air band: the live station with an attributed show.
  const row = page.getByRole("button", {
    name: new RegExp(`${DJ_NAME}.*${SHOW_NAME}`),
  });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Click the row to tune in — this mounts the player bar inside .bottom-shell.
  await row.click();

  // The player bar becomes visible once the station is active.
  await expect(page.locator(".player-bar-row")).toBeVisible({ timeout: 10_000 });
}

interface Geometry {
  loreLink: { bottom: number; top: number; left: number; width: number; height: number };
  libraryLink: { bottom: number; top: number; right: number; width: number; height: number };
  dockTop: number;
  shellH: number;
}

async function readCornerNavGeometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const loreLink = document.querySelector<HTMLElement>(
      ".corner-nav__link--left",
    );
    const libraryLink = document.querySelector<HTMLElement>(
      ".corner-nav__link--right",
    );
    const dock = document.querySelector<HTMLElement>(".bottom-shell-wrap");

    if (!loreLink) throw new Error(".corner-nav__link--left not found");
    if (!libraryLink) throw new Error(".corner-nav__link--right not found");
    if (!dock) throw new Error(".bottom-shell-wrap not found");

    const lr = loreLink.getBoundingClientRect();
    const rr = libraryLink.getBoundingClientRect();
    const dr = dock.getBoundingClientRect();
    const shellH =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--shell-h"),
      ) || 0;

    return {
      loreLink: {
        bottom: lr.bottom,
        top: lr.top,
        left: lr.left,
        width: lr.width,
        height: lr.height,
      },
      libraryLink: {
        bottom: rr.bottom,
        top: rr.top,
        right: rr.right,
        width: rr.width,
        height: rr.height,
      },
      dockTop: dr.top,
      shellH,
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Corner nav tappability over player dock", () => {
  test("portrait 360×640 — both links visible and clickable above the player dock", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await installRoutes(page);
    await loadWithDock(page);

    const loreLink = page.locator(".corner-nav__link--left");
    const libraryLink = page.locator(".corner-nav__link--right");

    // 1. Both links are visible in the viewport.
    await expect(loreLink).toBeVisible();
    await expect(libraryLink).toBeVisible();

    // 2. Both links accept clicks — Playwright throws when a click target is
    //    covered by another element (e.g. the player dock intercepting the tap).
    await loreLink.click();
    // After clicking [lore] we land back on the dial; tune back in for the
    // library link check.
    const row = page.getByRole("button", {
      name: new RegExp(`${DJ_NAME}.*${SHOW_NAME}`),
    });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await expect(page.locator(".player-bar-row")).toBeVisible({ timeout: 10_000 });

    await libraryLink.click();
    // After clicking [my library] we navigate to /library — confirm the URL changed.
    await page.waitForURL("**/library", { timeout: 5_000 });

    // Navigate back to the dial and re-tune to verify geometry.
    await page.goto("/lore/");
    const row2 = page.getByRole("button", {
      name: new RegExp(`${DJ_NAME}.*${SHOW_NAME}`),
    });
    await expect(row2).toBeVisible({ timeout: 15_000 });
    await row2.click();
    await expect(page.locator(".player-bar-row")).toBeVisible({ timeout: 10_000 });

    // 3. Geometric non-overlap: link bottoms sit above the dock top edge.
    const g = await readCornerNavGeometry(page);
    expect(g.loreLink.height).toBeGreaterThan(0);
    expect(g.libraryLink.height).toBeGreaterThan(0);
    // The shell is measured and positive when the player bar is rendered.
    expect(g.shellH).toBeGreaterThan(0);
    // Both link bottom edges are above the dock top edge (≥8px gap by CSS).
    expect(g.loreLink.bottom).toBeLessThanOrEqual(g.dockTop);
    expect(g.libraryLink.bottom).toBeLessThanOrEqual(g.dockTop);
  });

  test("landscape 640×360 — both links visible and clickable above the player dock", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await installRoutes(page);
    await loadWithDock(page);

    const loreLink = page.locator(".corner-nav__link--left");
    const libraryLink = page.locator(".corner-nav__link--right");

    // 1. Both links are visible.
    await expect(loreLink).toBeVisible();
    await expect(libraryLink).toBeVisible();

    // 2. Both links accept clicks without being blocked by the dock or hero art.
    await loreLink.click();
    const row = page.getByRole("button", {
      name: new RegExp(`${DJ_NAME}.*${SHOW_NAME}`),
    });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await expect(page.locator(".player-bar-row")).toBeVisible({ timeout: 10_000 });

    await libraryLink.click();
    await page.waitForURL("**/library", { timeout: 5_000 });

    // Navigate back and re-tune for geometry check.
    await page.goto("/lore/");
    const row2 = page.getByRole("button", {
      name: new RegExp(`${DJ_NAME}.*${SHOW_NAME}`),
    });
    await expect(row2).toBeVisible({ timeout: 15_000 });
    await row2.click();
    await expect(page.locator(".player-bar-row")).toBeVisible({ timeout: 10_000 });

    // 3. Geometric non-overlap.
    const g = await readCornerNavGeometry(page);
    expect(g.loreLink.height).toBeGreaterThan(0);
    expect(g.libraryLink.height).toBeGreaterThan(0);
    expect(g.shellH).toBeGreaterThan(0);
    expect(g.loreLink.bottom).toBeLessThanOrEqual(g.dockTop);
    expect(g.libraryLink.bottom).toBeLessThanOrEqual(g.dockTop);
  });
});
