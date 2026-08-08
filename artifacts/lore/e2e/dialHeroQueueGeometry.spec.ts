import { test, expect, type Page } from "@playwright/test";

/**
 * Browser-geometry matrix for the Dial front-door hero: a POPULATED set queue
 * (opened from a live crossing row) must sit beside or below the album art —
 * never overlap it — at every desktop height and in portrait.
 *
 * All API routes are intercepted so the hero renders deterministically:
 *  - one live NTS station with an attributed schedule run
 *  - a long recent-spins set (120 artists) so the queue always overflows and
 *    scrolling is testable in every arrangement
 *
 * Assertions per viewport:
 *  1. data-queue-layout matches the mode chooseDialHeroQueueLayout would pick
 *     for the real viewport + measured --shell-h (inline copy of the helper).
 *  2. The album art is a square whose side equals the CSS --hero-art-size
 *     formula for the selected mode (landscape only).
 *  3. The queue panel is a DOM SIBLING of the art wrapper and its box never
 *     intersects the art box (side → strictly right; below → strictly under).
 *  4. The populated queue scrolls, and the album art still opens/closes the
 *     fullscreen overlay.
 */

const NTS_SLUG = "nts-1";
const SHOW_NAME = "Hessle Audio";
const DJ_NAME = "Ben UFO";
const SPIN_COUNT = 120;

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

/** Spins spread over the last two hours, newest last. */
function makeSpins() {
  const now = Date.now();
  const spins = [];
  for (let i = 0; i < SPIN_COUNT; i++) {
    spins.push({
      mbid: null,
      artistMbid: null,
      releaseGroupMbid: null,
      title: `Track ${i + 1}`,
      artist: `Queue Artist ${i + 1}`,
      playedAt: new Date(now - (SPIN_COUNT - i) * 60 * 1000).toISOString(),
      isFirstSpin: false,
      isLibraryHit: false,
      isArtistHit: false,
    });
  }
  return spins;
}

const SPINS = makeSpins();
const LATEST_SPIN = SPINS[SPINS.length - 1];

function makeNowPlaying() {
  return {
    spinId: 900,
    rawArtist: LATEST_SPIN.artist,
    rawTitle: LATEST_SPIN.title,
    source: "nts_live",
    confidence: "unresolved",
    playedAt: LATEST_SPIN.playedAt,
    artworkUrl: null,
    recording: null,
    show: { name: SHOW_NAME, djName: DJ_NAME },
    isFirstSpin: false,
    isLibraryHit: false,
    isArtistHit: false,
  };
}

/** One attributed run bracketing every fixture spin. */
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
            spinCount: SPIN_COUNT,
            resolvedCount: 0,
            startedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
            endedAt: new Date(now + 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    ],
  };
}

async function installDialRoutes(page: Page) {
  // Never hit the fake stream host.
  await page.route("https://stream.example.test/**", (route) => route.abort());

  // Soft-fetched listener endpoints — anonymous defaults.
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
    route.fulfill({ json: { items: [{ stationSlug: NTS_SLUG, spins: SPINS }] } }),
  );
  await page.route("**/api/stations/artist-frequency**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/pickers/**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Inline copy of chooseDialHeroQueueLayout (src/components/DialView.tsx) —
 * duplicated deliberately so the e2e gate catches drift between the helper
 * and the rendered CSS rather than agreeing with a shared bug. */
function expectedLayout(vw: number, vh: number, shellH: number): "side" | "below" {
  const queueWidth = Math.min(360, vw * 0.3);
  const queueHeight = 220;
  const dialColumnWidth = vw >= 1100 ? Math.min(540, Math.max(380, vw * 0.32)) : 300;
  const availableHeight = Math.max(0, vh - shellH);
  const artRegionWidth = Math.max(0, vw - dialColumnWidth);
  const sideSquare = Math.min(availableHeight, Math.max(0, artRegionWidth - queueWidth));
  const belowSquare = Math.min(artRegionWidth, Math.max(0, availableHeight - queueHeight));
  return sideSquare >= belowSquare ? "side" : "below";
}

/** The CSS --hero-art-size formula for the selected mode (landscape only). */
function expectedArtSize(mode: "side" | "below", vw: number, vh: number, shellH: number): number {
  const queueW = Math.min(360, vw * 0.3);
  const dialColW = vw >= 1100 ? Math.min(540, Math.max(380, vw * 0.32)) : 300;
  return mode === "side"
    ? Math.min(vh - shellH, vw - dialColW - queueW)
    : Math.min(vh - shellH - 220, vw - dialColW);
}

interface Box { x: number; y: number; width: number; height: number }

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 1 &&
    b.x < a.x + a.width - 1 &&
    a.y < b.y + b.height - 1 &&
    b.y < a.y + a.height - 1
  );
}

async function openPopulatedQueue(page: Page) {
  await page.goto("/lore/");
  // The attributed live row renders in the DJs-on-air band.
  const row = page.getByRole("button", { name: new RegExp(`${DJ_NAME}.*${SHOW_NAME}`) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  // Clicking tunes in AND opens the set tab — the queue populates with the
  // full spin-derived artist list.
  await expect(page.locator(".set-queue__artist").first()).toBeVisible({ timeout: 15_000 });
  expect(await page.locator(".set-queue__artist").count()).toBe(SPIN_COUNT);
}

async function readGeometry(page: Page) {
  return page.evaluate(() => {
    const hero = document.querySelector(".dial-hero");
    const artwrap = document.querySelector(".dial-hero__artwrap");
    const art = document.querySelector(".dial-hero__art");
    const panel = document.querySelector(".dial-hero__setpanel");
    if (!hero || !artwrap || !art || !panel) throw new Error("hero geometry nodes missing");
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      layout: hero.getAttribute("data-queue-layout"),
      artBox: box(art),
      panelBox: box(panel),
      // Sibling contract: the queue is a sibling REGION of the art wrapper,
      // never a node inside it (i.e. never an overlay on the artwork).
      panelInsideArtwrap: artwrap.contains(panel),
      sameParent: panel.parentElement === artwrap.parentElement,
      shellH:
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--shell-h"),
        ) || 0,
      vw: window.innerWidth,
      vh: window.innerHeight,
      panelScrollable: panel.scrollHeight > panel.clientHeight,
    };
  });
}

async function assertQueueScrollsAndFullscreenWorks(page: Page) {
  // Queue scrolling: 120 artists always overflow every arrangement.
  const scrolled = await page.evaluate(() => {
    const panel = document.querySelector(".dial-hero__setpanel") as HTMLElement;
    panel.scrollTop = 150;
    return panel.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);

  // Album art still opens the fullscreen overlay and Escape closes it.
  await page.locator(".dial-hero__art").click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".dial-art-fullscreen")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".dial-art-fullscreen")).not.toBeVisible();
}

async function assertLandscapeGeometry(page: Page) {
  const g = await readGeometry(page);

  expect(g.panelInsideArtwrap).toBe(false);
  expect(g.sameParent).toBe(true);

  // The mode marker matches the pure helper's decision for this viewport.
  const expected = expectedLayout(g.vw, g.vh, g.shellH);
  expect(g.layout).toBe(expected);

  // Album art is a square of the CSS formula's size (±2px for rounding).
  const size = expectedArtSize(expected, g.vw, g.vh, g.shellH);
  expect(Math.abs(g.artBox.width - g.artBox.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(g.artBox.width - size)).toBeLessThanOrEqual(2);

  // No overlap, and the panel sits on the correct side of the art.
  expect(intersects(g.artBox, g.panelBox)).toBe(false);
  if (expected === "side") {
    expect(g.panelBox.x).toBeGreaterThanOrEqual(g.artBox.x + g.artBox.width - 1);
    // Queue column matches --hero-queue-w: min(360px, 30vw).
    expect(Math.abs(g.panelBox.width - Math.min(360, g.vw * 0.3))).toBeLessThanOrEqual(2);
  } else {
    expect(g.panelBox.y).toBeGreaterThanOrEqual(g.artBox.y + g.artBox.height - 1);
    // Queue band matches --hero-queue-h: 220px and spans the art width.
    expect(Math.abs(g.panelBox.height - 220)).toBeLessThanOrEqual(2);
  }

  expect(g.panelScrollable).toBe(true);
  await assertQueueScrollsAndFullscreenWorks(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Dial hero queue geometry with a populated crossing", () => {
  test("short desktop viewport (1280×620) — queue beside or below, never over art", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 620 });
    await installDialRoutes(page);
    await openPopulatedQueue(page);
    await assertLandscapeGeometry(page);
  });

  test("tall desktop viewport (1280×1024) — queue beside or below, never over art", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1024 });
    await installDialRoutes(page);
    await openPopulatedQueue(page);
    await assertLandscapeGeometry(page);
  });

  test("portrait viewport (900×1200) — full-width square art, queue stacked below", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1200 });
    await installDialRoutes(page);
    await openPopulatedQueue(page);

    const g = await readGeometry(page);
    expect(g.panelInsideArtwrap).toBe(false);
    expect(g.sameParent).toBe(true);

    // Portrait keeps the stacked format: art is a full-width square at the
    // top and the queue is a band strictly below it.
    expect(Math.abs(g.artBox.width - g.vw)).toBeLessThanOrEqual(2);
    expect(Math.abs(g.artBox.width - g.artBox.height)).toBeLessThanOrEqual(2);
    expect(intersects(g.artBox, g.panelBox)).toBe(false);
    expect(g.panelBox.y).toBeGreaterThanOrEqual(g.artBox.y + g.artBox.height - 1);
    // Queue band respects its portrait cap: min(36dvh, 280px).
    expect(g.panelBox.height).toBeLessThanOrEqual(Math.min(0.36 * g.vh, 280) + 2);

    expect(g.panelScrollable).toBe(true);
    await assertQueueScrollsAndFullscreenWorks(page);
  });
});
