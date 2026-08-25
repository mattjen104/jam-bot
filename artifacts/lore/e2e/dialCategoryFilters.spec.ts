import { test, expect } from "@playwright/test";

/**
 * End-to-end tests confirming that the /campus, /indie, and /discovery CLI
 * commands on the full feed and the matching category controls on the split
 * home correctly narrow the dial to stations in the requested editorial
 * category.
 *
 * All API routes are intercepted so the tests are fully deterministic:
 *
 *  - campus-wkrp   → stationCategories: ["campus"]
 *  - indie-fm      → stationCategories: ["indie"]
 *  - discovery-rb  → stationCategories: ["discovery"]
 *  - anchor-kexp   → stationCategories: ["anchor"]
 *
 * All four stations are live (recent now-playing) and carry enough crossings
 * to be Zone-1 rows in the feed. Categories are an additive multi-select:
 * each checked category shows its matching stations and checking a second
 * category UNIONS it with the first.
 *
 * CLI mechanics:
 *   1. Press "/" globally — the DialCliBar listener intercepts it, focuses
 *      the invisible input, and sets its value to "/".
 *   2. Type the rest of the command ("campus", "indie", "discovery").
 *   3. Press Enter — executeCommand() dispatches the category toggle.
 *
 * Split-home mechanics:
 *   The category tab strip exposes an "Include <category>" checkbox beside
 *   each tab. Checked categories contribute cards to All; clicking an
 *   excluded category tab re-includes it and opens its focused station feed.
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

// Category-first home cards group by the primary category only, so fixtures
// deliberately carry one category each. This makes every filtering assertion
// verify the category it names rather than relying on a secondary-tag alias.
const STATIONS = [
  makeStation("campus-wkrp",  "Campus WKRP",  ["campus"],    0),
  makeStation("indie-fm",     "Indie FM",     ["indie"],     1),
  makeStation("discovery-rb", "Discovery RB", ["discovery"], 2),
  makeStation("anchor-kexp",  "Anchor KEXP",  ["anchor"],    3),
];

function makeNowPlaying(slug: string, idx: number) {
  return {
    spinId: 900 + idx,
    artist: `Artist ${idx + 1}`,
    title: `Track ${idx + 1}`,
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
      firstPlayCrossings: 1 + idx,
      weekCrossings: 5 + idx,
      weekArtistCrossings: 3,
      weekFirstPlayCrossings: 2 + idx,
      monthCrossings: 10 + idx,
      monthArtistCrossings: 5,
      monthFirstPlayCrossings: 4 + idx,
      lifetimeCrossings: 20 + idx,
      lifetimeArtistCrossings: 12,
      lifetimeFirstPlayCrossings: 6 + idx,
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
  // Register this after the broad listener fallback so it wins for the
  // query-string form used by the SplitHome crossings hook.
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: makeCrossings() }),
  );

  // The split-home also fetches sleep/era-genre mode pools as query-string
  // variants (/api/stations?mode=sleep etc.) — a bare path glob does not match
  // query-carrying requests, so without this the real dev server leaks its
  // stations into the dial and crowds out the fixtures.
  await page.route("**/api/stations?**", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );

  // Station directory — the four test stations.
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
  );

  // Live pulse — all four stations are live.
  await page.route("**/api/stations/now-playing**", (route) =>
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
 * Waits for the full feed's default category selection (Anchor, Campus, and
 * Public) to settle. The two opt-in fixtures must remain absent.
 */
async function waitForDefaultFeed(page: import("@playwright/test").Page) {
  await expect(page.getByText("Campus WKRP").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Anchor KEXP").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Indie FM")).toHaveCount(0);
  await expect(page.getByText("Discovery RB")).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// CLI tests — run against /lore/feed, the current surface that mounts
// DialCliBar and wires its global "/" keyboard listener.
// ---------------------------------------------------------------------------

test.describe("Dial category filters — CLI commands", () => {
  test.beforeEach(async ({ page }) => {
    await installRoutes(page);
    await page.goto("/lore/feed");
    await waitForDefaultFeed(page);
  });

  // Default-checked categories: anchor, campus, public. Category CLI
  // commands TOGGLE membership in that set, so a command for a default
  // category unchecks it, and a command for an opt-in category adds it.

  test("/campus unchecks the default campus category, hiding campus-only stations", async ({
    page,
  }) => {
    await sendCliCommand(page, "/campus");

    // campus-wkrp only carries campus, so it drops out; anchor remains.
    await expect(page.getByText("Campus WKRP")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Anchor KEXP").first()).toBeVisible();
    await expect(page.getByText("Indie FM")).not.toBeVisible();
    await expect(page.getByText("Discovery RB")).not.toBeVisible();
  });

  test("/anchor unchecks anchor, leaving only campus-covered stations", async ({
    page,
  }) => {
    await sendCliCommand(page, "/anchor");

    // Active set is now {campus, public}: only campus-wkrp matches.
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP").first()).toBeVisible();
    await expect(page.getByText("Indie FM")).not.toBeVisible();
    await expect(page.getByText("Discovery RB")).not.toBeVisible();
  });

  test("/anchor then /indie unions indie back into the narrowed selection", async ({
    page,
  }) => {
    await sendCliCommand(page, "/anchor");
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP").first()).toBeVisible();

    await sendCliCommand(page, "/indie");

    // Active set is now {campus, public, indie}: campus + indie stations
    // render, anchor-only and discovery stations stay hidden.
    await expect(page.getByText("Indie FM").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP").first()).toBeVisible();
    await expect(page.getByText("Discovery RB")).not.toBeVisible();
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible();

    // Unchecking /indie removes only those stations from the union.
    await sendCliCommand(page, "/indie");
    await expect(page.getByText("Indie FM")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP").first()).toBeVisible();
  });

  test("/anchor then /discovery shows discovery alongside campus", async ({
    page,
  }) => {
    await sendCliCommand(page, "/anchor");
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible({ timeout: 10_000 });

    await sendCliCommand(page, "/discovery");

    // Active set is now {campus, public, discovery}.
    await expect(page.getByText("Discovery RB").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP").first()).toBeVisible();
    await expect(page.getByText("Indie FM")).not.toBeVisible();
    await expect(page.getByText("Anchor KEXP")).not.toBeVisible();
  });
});

test.describe("Split-home category tabs — cards and drill-down", () => {
  test("renders the tab strip and opens a category's station list from its card", async ({
    page,
  }) => {
    await installRoutes(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("lore:radioMode", "false");
    });
    await page.goto("/lore/");

    // The tab strip leads with All, then the short category labels.
    const strip = page.getByRole("tablist", { name: "Station categories" });
    await expect(strip).toBeVisible({ timeout: 20_000 });
    const allTab = page.getByRole("tab", { name: "All", exact: true });
    const campusTab = page.getByTestId("compact-category-tab-campus");
    await expect(allTab).toHaveAttribute("aria-selected", "true");
    await expect(campusTab).toHaveAttribute("aria-selected", "false");
    await expect(page.getByTestId("compact-category-tab-specialist")).toContainText("Specialist");

    // All shows one flat feed of the checked categories' stations; each row
    // leads with the station's current now-playing artist.
    const allFeed = page.getByTestId("compact-category-all-feed");
    await expect(allFeed).toBeVisible();
    const campusStation = page.getByTestId("compact-category-station-campus-wkrp");
    await expect(campusStation).toBeVisible();
    await expect(campusStation).toContainText("Artist 1");
    await expect(campusStation).toHaveAccessibleName("Play Campus WKRP");
    await expect(page.getByTestId("compact-category-campus-now-feed")).toHaveCount(0);

    // The category tab is keyboard reachable and opens the drill-down (a
    // single station list).
    await campusTab.focus();
    await expect(campusTab).toBeFocused();
    await page.keyboard.press("Enter");

    const campusFeed = page.getByTestId("compact-category-campus-now-feed");
    await expect(campusFeed).toBeVisible();
    await expect(campusFeed).toHaveAccessibleName("Campus now-playing feed");
    await expect(campusTab).toHaveAttribute("aria-selected", "true");
    await expect(allTab).toHaveAttribute("aria-selected", "false");
    await expect(
      campusFeed.getByRole("button", {
        name: "Artist 1 — Track 1 · Campus WKRP — tune in",
      }),
    ).toBeVisible();
    await expect(campusFeed.getByRole("button", { name: "Play Campus WKRP" })).toBeVisible();

    // The focused list replaces the All overview instead of stacking.
    await expect(allFeed).toHaveCount(0);

    // Selecting a different category tab focuses that category instead.
    await page.getByTestId("compact-category-tab-anchor").click();
    await expect(page.getByTestId("compact-category-anchor-now-feed")).toBeVisible();
    await expect(campusFeed).toHaveCount(0);

    // All returns to the flat overview feed.
    await allTab.click();
    await expect(allFeed).toBeVisible();
    await expect(page.getByTestId("compact-category-anchor-now-feed")).toHaveCount(0);
  });

  test("plays the card's now-playing station in place and keeps the retired metrics hidden", async ({
    page,
  }) => {
    await installRoutes(page);
    await page.addInitScript(() => {
      // Keep this browser check independent of persisted state from other
      // front-door specs and put one category station outside the scan.
      window.localStorage.setItem("lore:radioMode", "false");
      window.localStorage.setItem("lore:crossingScope", "lifetime");
      window.localStorage.setItem("lore:dialSkipped", JSON.stringify(["campus-wkrp"]));
    });
    await page.goto("/lore/");

    const dial = page.getByTestId("compact-category-dial");
    // The skipped station still renders in the overview, but the retired
    // crossings/first-play badges and age pie no longer render.
    await expect(page.getByTestId("compact-category-station-campus-wkrp")).toBeVisible({ timeout: 20_000 });
    await expect(dial).not.toContainText("crossings");
    await expect(dial).not.toContainText("first plays");
    await expect(dial.locator(".dial-age-badge")).toHaveCount(0);

    // The complete station card is the play control (the inline triangle is
    // its cue), so no small far-left play button competes with station art.
    const stationCard = page.getByTestId("compact-category-station-campus-wkrp");
    await expect(stationCard).toBeVisible();
    await expect(stationCard).toHaveAccessibleName("Play Campus WKRP");
    await stationCard.click();
    await expect(page.getByTestId("compact-category-campus-now-feed")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "All", exact: true }))
      .toHaveAttribute("aria-selected", "true");

    // Drilling in keeps per-station deselection working for scan selection
    // without deleting the station from Lore.
    await page.getByTestId("compact-category-tab-campus").click();
    const campusFeed = page.getByTestId("compact-category-campus-now-feed");
    await expect(campusFeed).toBeVisible();
    const includeBox = campusFeed.getByRole("checkbox", { name: "Include Campus WKRP in scan" });
    await expect(includeBox).toBeVisible();
    await expect(includeBox).not.toBeChecked();

    // Advanced crossing controls now live on the full Feed. The split-home
    // keeps that chrome out of both its overview and drill-down.
    await expect(page.locator(".crossing-scope-pill")).toHaveCount(0);
    await expect(campusFeed).toBeVisible();
    await expect(page.getByTestId("compact-category-all-feed")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Category-control tests — the retired Station type dropdown's current
// equivalent is the split-home tab strip. Its include checkboxes control All
// overview membership, and an excluded tab is also the category's re-entry
// point.
// ---------------------------------------------------------------------------

test.describe("Dial category filters — split-home include controls", () => {
  test.beforeEach(async ({ page }) => {
    await installRoutes(page);
    await page.goto("/lore/");
    await expect(
      page.getByRole("tablist", { name: "Station categories" }),
    ).toBeVisible({ timeout: 20_000 });
    // The All overview is one flat feed of the checked categories' stations;
    // opt-in Discovery stays out until checked.
    await expect(page.getByTestId("compact-category-station-campus-wkrp")).toBeVisible();
    await expect(page.getByTestId("compact-category-station-anchor-kexp")).toBeVisible();
    await expect(page.getByTestId("compact-category-station-indie-fm")).toBeVisible();
    await expect(page.getByTestId("compact-category-station-discovery-rb")).toHaveCount(0);
  });

  function categoryCheckbox(
    page: import("@playwright/test").Page,
    name: string,
  ) {
    return page.getByRole("checkbox", { name: `Include ${name}` });
  }

  test("Campus include checkbox starts checked and toggles its overview station", async ({
    page,
  }) => {
    const campusBox = categoryCheckbox(page, "Campus");
    await expect(campusBox).toBeChecked();

    await campusBox.click();
    await expect(campusBox).not.toBeChecked();
    await expect(page.getByTestId("compact-category-station-campus-wkrp")).toHaveCount(0);
    await expect(page.getByTestId("compact-category-station-anchor-kexp")).toBeVisible();

    await campusBox.click();
    await expect(campusBox).toBeChecked();
    await expect(page.getByTestId("compact-category-station-campus-wkrp")).toBeVisible();
  });

  test("Checking an opt-in category unions it with the defaults (additive multi-select)", async ({
    page,
  }) => {
    const campusBox = categoryCheckbox(page, "Campus");
    const discoveryBox = categoryCheckbox(page, "Discovery");

    // Split-home defaults include Campus and Indie; Discovery is opt-in.
    await expect(campusBox).toBeChecked();
    await expect(discoveryBox).not.toBeChecked();

    await discoveryBox.click();
    await expect(discoveryBox).toBeChecked();
    await expect(campusBox).toBeChecked();
    await expect(page.getByTestId("compact-category-station-discovery-rb")).toBeVisible();
    await expect(page.getByTestId("compact-category-station-campus-wkrp")).toBeVisible();
    await expect(page.getByTestId("compact-category-station-indie-fm")).toBeVisible();
  });

  test("Discovery checkbox can be toggled directly from the tab strip", async ({
    page,
  }) => {
    const discoveryBox = categoryCheckbox(page, "Discovery");
    await expect(discoveryBox).toBeVisible();
    await expect(discoveryBox).not.toBeChecked();

    await discoveryBox.click();
    await expect(discoveryBox).toBeChecked();
    await expect(page.getByTestId("compact-category-station-discovery-rb")).toBeVisible();
    await expect(page.getByTestId("compact-category-station-campus-wkrp")).toBeVisible();

    await discoveryBox.click();
    await expect(discoveryBox).not.toBeChecked();
    await expect(page.getByTestId("compact-category-station-discovery-rb")).toHaveCount(0);
    await expect(page.getByTestId("compact-category-station-campus-wkrp")).toBeVisible();
  });

  test("an excluded category tab re-includes it and opens its station feed", async ({
    page,
  }) => {
    const campusBox = categoryCheckbox(page, "Campus");
    const campusTab = page.getByTestId("compact-category-tab-campus");
    await campusBox.focus();
    await page.keyboard.press("Space");
    await expect(campusBox).not.toBeChecked();
    await expect(page.getByTestId("compact-category-station-campus-wkrp")).toHaveCount(0);

    await campusTab.click();
    await expect(campusBox).toBeChecked();
    await expect(campusTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("compact-category-campus-now-feed")).toBeVisible();
    await expect(page.getByTestId("compact-category-all-feed")).toHaveCount(0);
  });
});
