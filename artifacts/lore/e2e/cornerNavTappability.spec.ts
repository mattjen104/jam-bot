import { test, expect, type Page } from "@playwright/test";

/**
 * Browser-geometry tests confirming the shell nav links ([lore] / [my library])
 * remain visible and tappable when the player dock is rendered on a small phone —
 * both portrait (360×640) and landscape (640×360).
 *
 * Spotify-style mobile shell contract: at phone widths
 * (`(orientation: portrait), (max-width: 720px)`) the floating corner links are
 * hidden and the menu links render as a `.bottom-nav` row inside the fixed
 * bottom shell (.bottom-shell-wrap), BELOW the mini player, at the very bottom
 * of the screen. --shell-h is the measured height of the whole stacked shell.
 *
 * All API routes are intercepted so the player dock renders deterministically
 * with a live station tuned in (the mini player is visible).
 *
 * Assertions per viewport:
 *   1. Both .bottom-nav__link elements are visible; the corner-nav is hidden.
 *   2. Both links accept a Playwright click() — which fails when an element is
 *      fully covered by another element (e.g. the mini player intercepting).
 *   3. Geometry: the nav row sits below the mini player and its links lie
 *      fully within the measured shell at the bottom of the viewport.
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
  shellTop: number;
  playerBarBottom: number;
  navTop: number;
  navBottom: number;
  cornerNavVisible: boolean;
  shellH: number;
  vh: number;
}

async function readShellNavGeometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLElement>(".bottom-nav__link"),
    );
    const loreLink = links.find((a) => a.dataset.section === "lore");
    const libraryLink = links.find((a) => a.dataset.section === "library");
    const nav = document.querySelector<HTMLElement>(".bottom-nav");
    const shell = document.querySelector<HTMLElement>(".bottom-shell-wrap");
    const playerBar = document.querySelector<HTMLElement>(".player-bar-row");
    const cornerNav = document.querySelector<HTMLElement>(".corner-nav");

    if (!loreLink) throw new Error(".bottom-nav__link[data-section=lore] not found");
    if (!libraryLink) throw new Error(".bottom-nav__link[data-section=library] not found");
    if (!nav) throw new Error(".bottom-nav not found");
    if (!shell) throw new Error(".bottom-shell-wrap not found");
    if (!playerBar) throw new Error(".player-bar-row not found");

    const lr = loreLink.getBoundingClientRect();
    const rr = libraryLink.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    const sr = shell.getBoundingClientRect();
    const pr = playerBar.getBoundingClientRect();
    const cornerNavVisible = !!(
      cornerNav && getComputedStyle(cornerNav).display !== "none"
    );
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
      shellTop: sr.top,
      playerBarBottom: pr.bottom,
      navTop: nr.top,
      navBottom: nr.bottom,
      cornerNavVisible,
      shellH,
      vh: window.innerHeight,
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Bottom nav tappability with player dock (mobile shell)", () => {
  for (const [label, width, height] of [
    ["portrait 360×640", 360, 640],
    ["landscape 640×360", 640, 360],
  ] as const) {
    test(`${label} — bottom-nav links visible and clickable below the mini player`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await installRoutes(page);
      await loadWithDock(page);

      const loreLink = page.locator(".bottom-nav__link[data-section='lore']");
      const libraryLink = page.locator(".bottom-nav__link[data-section='library']");

      // 1. Both bottom-nav links are visible in the viewport.
      await expect(loreLink).toBeVisible();
      await expect(libraryLink).toBeVisible();

      // 2. Both links accept clicks — Playwright throws when a click target is
      //    covered by another element (e.g. the mini player intercepting).
      await loreLink.click();
      // After clicking [lore] we land back on the dial; tune back in for the
      // library link check.
      const row = page.locator("[data-scrub-slug][role='button']").filter({
        hasText: new RegExp(`${DJ_NAME}.*${SHOW_NAME}`),
      }).first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();
      await expect(page.locator(".player-bar-row")).toBeVisible({ timeout: 10_000 });

      await libraryLink.click();
      // After clicking [my library] we navigate to /library — confirm the URL changed.
      await page.waitForURL("**/library", { timeout: 5_000 });

      // Navigate back to the dial and re-tune to verify geometry.
      await page.goto("/lore/");
      const row2 = page.locator("[data-scrub-slug][role='button']").filter({
        hasText: new RegExp(`${DJ_NAME}.*${SHOW_NAME}`),
      }).first();
      await expect(row2).toBeVisible({ timeout: 15_000 });
      await row2.click();
      await expect(page.locator(".player-bar-row")).toBeVisible({ timeout: 10_000 });

      // 3. Geometry: Spotify-style stack — mini player above, nav row below,
      //    everything inside the measured shell at the bottom of the screen.
      const g = await readShellNavGeometry(page);
      // Floating corner links are gone at phone widths.
      expect(g.cornerNavVisible).toBe(false);
      expect(g.loreLink.height).toBeGreaterThan(0);
      expect(g.libraryLink.height).toBeGreaterThan(0);
      // The shell is measured and positive when the player bar is rendered.
      expect(g.shellH).toBeGreaterThan(0);
      // The nav row sits below the mini player (no overlap).
      expect(g.navTop).toBeGreaterThanOrEqual(g.playerBarBottom - 1);
      // Links live inside the shell, at the bottom edge of the viewport.
      expect(g.loreLink.top).toBeGreaterThanOrEqual(g.shellTop);
      expect(g.libraryLink.top).toBeGreaterThanOrEqual(g.shellTop);
      expect(g.navBottom).toBeGreaterThan(g.vh - 40);
      expect(g.navBottom).toBeLessThanOrEqual(g.vh + 1);
    });
  }

  test("portrait 360×640 — tapping the mini player surface expands the now-playing sheet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await installRoutes(page);
    await loadWithDock(page);

    // Tap the bar surface (station text) — not a control button.
    await page.locator(".player-bar-info").click();
    const sheet = page.getByTestId("player-sheet");
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    // The sheet shows the now-playing view with full controls.
    await expect(page.getByTestId("player-sheet-controls")).toBeVisible();

    // Collapse returns to the mini player.
    await page.getByTestId("player-sheet-collapse").click();
    await expect(sheet).not.toBeVisible();
    await expect(page.locator(".player-bar-row")).toBeVisible();

    // Control buttons on the mini player do NOT expand: stop closes the player.
    await page.getByTestId("player-stop").click();
    await expect(page.getByTestId("player-sheet")).not.toBeVisible();
    await expect(page.locator(".player-bar-row")).not.toBeVisible();
  });
});
