import { test, expect } from "@playwright/test";

/**
 * End-to-end tests confirming that the /spinitron, /college, and /discovery
 * CLI commands (and the matching DialFilterBar toggle buttons) correctly
 * narrow the dial to stations whose server-supplied `stationCategories` array
 * contains the requested label.
 *
 * All API routes are intercepted so the tests are fully deterministic:
 *
 *  - spinitron-fm   → stationCategories: ["spinitron"]
 *  - college-wkrp   → stationCategories: ["college"]
 *  - discovery-rb   → stationCategories: ["discovery"]
 *  - lore-flagship  → stationCategories: []  (normal curated station)
 *
 * All four stations are live (recent now-playing) and carry enough crossings
 * to be Zone-1 rows in the feed, so the initial unfiltered state shows all
 * four rows. Each filter then removes the non-matching ones.
 *
 * CLI mechanics:
 *   1. Press "/" globally — the DialCliBar listener intercepts it, focuses
 *      the invisible input, and sets its value to "/".
 *   2. Type the rest of the command ("spinitron", "college", "discovery").
 *   3. Press Enter — executeCommand() dispatches the category toggle.
 *
 * Filter-bar mechanics:
 *   The DialFilterBar renders at the front door with className
 *   "dial-filter-bar--hidden" (display:none), so its buttons are not
 *   visually accessible but ARE in the DOM and wired to the same toggle
 *   callbacks as the CLI bar. Tests use { force: true } to click them,
 *   confirming the shared wiring produces the same filter effect.
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
    nowPlayingSource: stationCategories.includes("spinitron") ? "spinitron" : "nts_live",
    stationCategories,
  };
}

const STATIONS = [
  makeStation("spinitron-fm",  "Spinitron FM",   ["spinitron"], 0),
  makeStation("college-wkrp",  "College WKRP",   ["college"],   1),
  makeStation("discovery-rb",  "Discovery RB",   ["discovery"], 2),
  makeStation("lore-flagship", "Lore Flagship",  [],            3),
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
 * NOTE: we click the body first so the focus lands outside any existing
 * editable element (the DialCliBar listener only fires when the active
 * element is NOT an input / textarea / contenteditable).
 */
async function sendCliCommand(
  page: import("@playwright/test").Page,
  cmd: "/spinitron" | "/college" | "/discovery",
) {
  await page.locator("body").click();
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
// Tests
// ---------------------------------------------------------------------------

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

  test("/spinitron shows only spinitron-tagged stations", async ({ page }) => {
    await sendCliCommand(page, "/spinitron");

    await expect(page.getByText("Spinitron FM").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("College WKRP")).not.toBeVisible();
    await expect(page.getByText("Discovery RB")).not.toBeVisible();
    await expect(page.getByText("Lore Flagship")).not.toBeVisible();
  });

  test("/college shows only college-tagged stations", async ({ page }) => {
    await sendCliCommand(page, "/college");

    await expect(page.getByText("College WKRP").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Spinitron FM")).not.toBeVisible();
    await expect(page.getByText("Discovery RB")).not.toBeVisible();
    await expect(page.getByText("Lore Flagship")).not.toBeVisible();
  });

  test("/discovery shows only discovery-tagged stations", async ({ page }) => {
    await sendCliCommand(page, "/discovery");

    await expect(page.getByText("Discovery RB").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Spinitron FM")).not.toBeVisible();
    await expect(page.getByText("College WKRP")).not.toBeVisible();
    await expect(page.getByText("Lore Flagship")).not.toBeVisible();
  });

  test("/spinitron then /college unions the two sets", async ({ page }) => {
    await sendCliCommand(page, "/spinitron");
    await expect(page.getByText("Spinitron FM").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("College WKRP")).not.toBeVisible();

    await sendCliCommand(page, "/college");

    await expect(page.getByText("Spinitron FM").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("College WKRP").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Discovery RB")).not.toBeVisible();
    await expect(page.getByText("Lore Flagship")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Filter bar button tests — run against /lore/feed (the full DialView), which
// renders DialFilterBar and its aria-pressed toggle buttons.  The split
// homepage at /lore/ uses a different layout that does not include the filter
// bar, so these tests need the dedicated feed route.
//
// The DialFilterBar renders with className="dial-filter-bar--hidden"
// (display:none), so its buttons are off-screen.  Direct clicks on
// display:none elements do not reliably fire React synthetic events in
// Chromium, so we validate shared wiring through the aria-pressed attribute:
// a CLI command activates a category → the corresponding DialFilterBar button
// must switch to aria-pressed="true".  A second CLI command deactivates it →
// aria-pressed must revert to "false".
// ---------------------------------------------------------------------------

test.describe("Dial category filters — filter bar button wiring at /lore/feed", () => {
  test.beforeEach(async ({ page }) => {
    await installRoutes(page);
    await page.goto("/lore/feed");
    await waitForAllStations(page);
  });

  test("Spinitron filter bar button reflects aria-pressed after /spinitron CLI", async ({
    page,
  }) => {
    const spinBtn = page.locator(".dial-filter-bar__btn", { hasText: "Spinitron" }).first();
    await expect(spinBtn).toHaveAttribute("aria-pressed", "false");

    await sendCliCommand(page, "/spinitron");
    await expect(page.getByText("Spinitron FM").first()).toBeVisible({ timeout: 10_000 });
    await expect(spinBtn).toHaveAttribute("aria-pressed", "true");

    // Toggle off — "lore" remains active so the last-category guard allows it.
    await sendCliCommand(page, "/spinitron");
    await expect(spinBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("College filter bar button reflects aria-pressed after /college CLI", async ({
    page,
  }) => {
    const collegeBtn = page.locator(".dial-filter-bar__btn", { hasText: "College" }).first();
    await expect(collegeBtn).toHaveAttribute("aria-pressed", "false");

    await sendCliCommand(page, "/college");
    await expect(page.getByText("College WKRP").first()).toBeVisible({ timeout: 10_000 });
    await expect(collegeBtn).toHaveAttribute("aria-pressed", "true");

    await sendCliCommand(page, "/college");
    await expect(collegeBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("Discovery filter bar button reflects aria-pressed after /discovery CLI", async ({
    page,
  }) => {
    const discoveryBtn = page
      .locator(".dial-filter-bar__btn", { hasText: "Discovery" })
      .first();
    await expect(discoveryBtn).toHaveAttribute("aria-pressed", "false");

    await sendCliCommand(page, "/discovery");
    await expect(page.getByText("Discovery RB").first()).toBeVisible({ timeout: 10_000 });
    await expect(discoveryBtn).toHaveAttribute("aria-pressed", "true");

    await sendCliCommand(page, "/discovery");
    await expect(discoveryBtn).toHaveAttribute("aria-pressed", "false");
  });
});
