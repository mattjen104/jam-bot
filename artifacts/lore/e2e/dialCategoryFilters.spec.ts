import { test, expect } from "@playwright/test";

/**
 * End-to-end tests confirming that the /campus, /indie, and /discovery CLI
 * commands (and the matching DialFilterBar buttons) correctly narrow the dial
 * to stations whose server-supplied `stationCategories` array contains the
 * requested editorial label.
 *
 * All API routes are intercepted so the tests are fully deterministic:
 *
 *  - campus-wkrp   → stationCategories: ["campus"]
 *  - indie-fm      → stationCategories: ["indie"]
 *  - discovery-rb  → stationCategories: ["discovery"]
 *  - anchor-kexp   → stationCategories: ["anchor"]
 *
 * All four stations are live (recent now-playing) and carry enough crossings
 * to be Zone-1 rows in the feed, so the initial unfiltered state shows all
 * four rows. Categories are radio-style single-select: each selection then
 * shows exactly the matching stations, picking a new category REPLACES the
 * previous one (no union), and re-selecting the active category CLEARS the
 * filter back to the unfiltered dial.
 *
 * CLI mechanics:
 *   1. Press "/" globally — the DialCliBar listener intercepts it, focuses
 *      the invisible input, and sets its value to "/".
 *   2. Type the rest of the command ("campus", "indie", "discovery").
 *   3. Press Enter — executeCommand() dispatches the category toggle.
 *
 * Filter-bar mechanics:
 *   The DialFilterBar is now visible on the full DialView (/lore/feed), so
 *   its buttons can be clicked directly and their aria-pressed state
 *   validated against CLI-driven selections.
 */

// ---------------------------------------------------------------------------
// Station fixtures — unique stream URLs so audio requests are abortable.
// ---------------------------------------------------------------------------

function makeStation(
  slug: string,
  name: string,
  stationCategories: string[],
  idx: number,
) {
  return {
    id: idx + 1,
    slug,
    name,
    org: name,
    city: "Testville",
    country: "US",
    streamUrl: `https://stream.lore-e2e-filters.test/${slug}`,
    streamQuality: null,
    streamFormat: "mp3",
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
    tier: "flagship",
    qualityTier: "proven",
    automationClass: "human",
    nowPlayingSource: "nts_live",
    stationCategories,
  };
}

const STATIONS = [
  makeStation("campus-wkrp",  "Campus WKRP",  ["campus"],    0),
  makeStation("indie-fm",     "Indie FM",     ["indie"],     1),
  makeStation("discovery-rb", "Discovery RB", ["discovery"], 2),
  makeStation("anchor-kexp",  "Anchor KEXP",  ["anchor"],    3),
];

function makeNowPlaying(slug: string, idx: number) {
  return {
    spinId: 900 + idx,
    rawArtist: `Artist ${idx + 1}`,
    rawTitle: `Track ${idx + 1}`,
    source: "nts_live",
    confidence: "unresolved",
    playedAt: new Date(Date.now() - idx * 30_000).toISOString(),
    artworkUrl: null,
    recording: null,
    show: { name: `Show ${idx + 1}`, djName: `DJ ${idx + 1}` },
    isFirstSpin: false,
    isLibraryHit: true,
    isArtistHit: true,
  };
}

function makeSchedule() {
  const now = Date.now();
  return {
    items: STATIONS.map((s, idx) => ({
      stationSlug: s.slug,
      runs: [
        {
          runId: idx + 1,
          show: { name: `Show ${idx + 1}`, djName: `DJ ${idx + 1}`, pickerId: null },
          spinCount: 6,
          resolvedCount: 0,
          startedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          endedAt:   new Date(now + 60 * 60 * 1000).toISOString(),
        },
      ],
    })),
  };
}

function makeCrossings() {
  return {
    items: STATIONS.map((s, idx) => ({
      stationSlug: s.slug,
      crossings: 3 + idx,
      artistCrossings: 2,
      weekCrossings: 5 + idx,
      weekArtistCrossings: 3,
      monthCrossings: 10 + idx,
      monthArtistCrossings: 5,
      lifetimeCrossings: 20 + idx,
      lifetimeArtistCrossings: 12,
      topArtistNames: [`Artist ${idx + 1}`],
    })),
  };
}

// ---------------------------------------------------------------------------
// Route-interception helper
// ---------------------------------------------------------------------------

async function installRoutes(page: import("@playwright/test").Page) {
  // Block audio streams so they never actually connect.
  await page.route("https://stream.lore-e2e-filters.test/**", (route) =>
    route.abort(),
  );

  // Listener-specific endpoints — authenticated but effectively empty.
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: makeCrossings() }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({
      json: { names: ["Artist 1", "Artist 2"], hasLibrary: true, hasSeeds: true },
    }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  // Catch-all for remaining /api/me/* paths.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  // Station directory — the four test stations.
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
  );

  // Live pulse — all four stations are live.
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: STATIONS.map((s, idx) => ({
          slug: s.slug,
          nowPlaying: makeNowPlaying(s.slug, idx),
        })),
      },
    }),
  );

  // SSE stream — empty event stream so the REST pulse is the live source.
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );

  // Per-station now-playing (player dock).
  for (const [idx, s] of STATIONS.entries()) {
    await page.route(`**/api/stations/${s.slug}/now-playing`, (route) =>
      route.fulfill({
        json: { station: s, nowPlaying: makeNowPlaying(s.slug, idx) },
      }),
    );
  }

  // Schedule and recent-spins — just enough to hydrate the dial rows.
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
 * Send a CLI command by pressing "/" (focus + set value) then typing the
 * rest of the command and submitting with Enter.
 *
 * NOTE: we blur the active element first so the focus lands outside any
 * existing editable element (the DialCliBar listener only fires when the
 * active element is NOT an input / textarea / contenteditable).
 */
async function sendCliCommand(
  page: import("@playwright/test").Page,
  cmd: "/campus" | "/indie" | "/discovery" | "/anchor",
) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("/");
  // After "/" the input is focused and value is "/"; type the rest.
  await page.keyboard.type(cmd.slice(1));
  await page.keyboard.press("Enter");
}

/**
 * Waits for the initial dial to be populated (all four test station names
 * visible as text somewhere in the feed) before any filter is applied.
 */
async function waitForAllStations(page: import("@playwright/test").Page) {
  for (const s of STATIONS) {
    await expect(page.getByText(s.name).first()).toBeVisible({ timeout: 20_000 });
  }
}

// ---------------------------------------------------------------------------
// CLI tests — run against /lore/ (the split homepage, which surfaces the CLI
// strip and applies the same stationCategories filter to its station list).
// ---------------------------------------------------------------------------

test.describe("Dial category filters — CLI commands", () => {
  test.beforeEach(async ({ page }) => {
    await installRoutes(page);
    await page.goto("/lore/");
    await waitForAllStations(page);
  });

  test("/campus shows only campus-labeled stations", async ({ page }) => {
    await sendCliCommand(page, "/campus");

    await expect(page.getByText("Campus WKRP").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Indie FM")).not.toBeVisible();
    await expect(page.getByText("Discovery RB")).not.toBeVisible();
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible();
  });

  test("/indie shows only indie-labeled stations", async ({ page }) => {
    await sendCliCommand(page, "/indie");

    await expect(page.getByText("Indie FM").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP")).not.toBeVisible();
    await expect(page.getByText("Discovery RB")).not.toBeVisible();
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible();
  });

  test("/discovery shows only discovery-labeled stations", async ({ page }) => {
    await sendCliCommand(page, "/discovery");

    await expect(page.getByText("Discovery RB").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP")).not.toBeVisible();
    await expect(page.getByText("Indie FM")).not.toBeVisible();
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible();
  });

  test("/campus then /indie replaces the selection (single-select, no union)", async ({
    page,
  }) => {
    await sendCliCommand(page, "/campus");
    await expect(page.getByText("Campus WKRP").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Indie FM")).not.toBeVisible();

    await sendCliCommand(page, "/indie");

    await expect(page.getByText("Indie FM").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP")).not.toBeVisible();
    await expect(page.getByText("Discovery RB")).not.toBeVisible();
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Filter bar button tests — run against /lore/feed (the full DialView), which
// renders the now-visible DialFilterBar with aria-pressed toggle buttons.
// A CLI command activates a category → the corresponding DialFilterBar button
// must switch to aria-pressed="true"; selecting a different category must
// revert it to "false" (single-select), and re-selecting the active category
// clears the filter (back to the unfiltered dial).
// ---------------------------------------------------------------------------

test.describe("Dial category filters — filter bar button wiring at /lore/feed", () => {
  test.beforeEach(async ({ page }) => {
    await installRoutes(page);
    await page.goto("/lore/feed");
    await waitForAllStations(page);
  });

  test("Campus filter bar button reflects aria-pressed after /campus CLI", async ({
    page,
  }) => {
    const campusBtn = page
      .locator(".dial-filter-bar__btn", { hasText: "Campus Radio" })
      .first();
    await expect(campusBtn).toHaveAttribute("aria-pressed", "false");

    await sendCliCommand(page, "/campus");
    await expect(page.getByText("Campus WKRP").first()).toBeVisible({ timeout: 10_000 });
    await expect(campusBtn).toHaveAttribute("aria-pressed", "true");

    // Re-selecting the active category clears the filter — back to all stations.
    await sendCliCommand(page, "/campus");
    await expect(campusBtn).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Indie FM").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Selecting a new category replaces the old one (single-select)", async ({
    page,
  }) => {
    const campusBtn = page
      .locator(".dial-filter-bar__btn", { hasText: "Campus Radio" })
      .first();
    const indieBtn = page
      .locator(".dial-filter-bar__btn", { hasText: "Independent DJ" })
      .first();

    await sendCliCommand(page, "/campus");
    await expect(campusBtn).toHaveAttribute("aria-pressed", "true");

    await sendCliCommand(page, "/indie");
    await expect(indieBtn).toHaveAttribute("aria-pressed", "true");
    await expect(campusBtn).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Indie FM").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP")).not.toBeVisible();
  });

  test("Discovery filter bar button can be clicked directly (visible bar)", async ({
    page,
  }) => {
    const discoveryBtn = page
      .locator(".dial-filter-bar__btn", { hasText: "Discovery" })
      .first();
    await expect(discoveryBtn).toBeVisible();
    await expect(discoveryBtn).toHaveAttribute("aria-pressed", "false");

    await discoveryBtn.click();
    await expect(discoveryBtn).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Discovery RB").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP")).not.toBeVisible();
    await expect(page.getByText("Indie FM")).not.toBeVisible();
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible();
  });
});
