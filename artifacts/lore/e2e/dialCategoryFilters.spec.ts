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
 * four rows. Categories are an additive multi-select: each checked category
 * shows its matching stations, checking a second category UNIONS it with the
 * first, and unchecking every category reverts to the unfiltered dial.
 *
 * CLI mechanics:
 *   1. Press "/" globally — the DialCliBar listener intercepts it, focuses
 *      the invisible input, and sets its value to "/".
 *   2. Type the rest of the command ("campus", "indie", "discovery").
 *   3. Press Enter — executeCommand() dispatches the category toggle.
 *
 * Filter-bar mechanics:
 *   The DialFilterBar on the full DialView (/lore/feed) exposes one dropdown
 *   per filter family. Opening the "Station type" trigger reveals one
 *   checkbox per category; the checked state validates against CLI-driven
 *   selections.
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

// Each station carries its primary editorial category plus one of the three
// default-checked categories (anchor/campus/public) so all four are visible
// when the app loads with default filters. Without the extra tag, stations
// whose primary category is not in the default set (indie, discovery) would
// be hidden on load, breaking waitForAllStations.
const STATIONS = [
  makeStation("campus-wkrp",  "Campus WKRP",  ["campus"],           0),
  makeStation("indie-fm",     "Indie FM",     ["indie", "anchor"],  1),
  makeStation("discovery-rb", "Discovery RB", ["discovery", "anchor"], 2),
  makeStation("anchor-kexp",  "Anchor KEXP",  ["anchor"],           3),
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

  // Default-checked categories: anchor, campus, public. Category CLI
  // commands TOGGLE membership in that set, so a command for a default
  // category unchecks it, and a command for an opt-in category adds it.

  test("/campus unchecks the default campus category, hiding campus-only stations", async ({
    page,
  }) => {
    await sendCliCommand(page, "/campus");

    // campus-wkrp only carries campus, so it drops out; the other three
    // remain visible through the still-checked anchor category.
    await expect(page.getByText("Campus WKRP")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Indie FM").first()).toBeVisible();
    await expect(page.getByText("Discovery RB").first()).toBeVisible();
    await expect(page.getByText("Anchor KEXP").first()).toBeVisible();
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

// ---------------------------------------------------------------------------
// Filter bar dropdown tests — run against /lore/feed (the full DialView),
// whose DialFilterBar carries one dropdown per filter family. Opening the
// "Station type" trigger reveals one checkbox per category; a CLI command
// that checks a category must flip the matching checkbox, checking a second
// category must leave the first checked (additive), and unchecking every
// category reverts to the unfiltered dial.
// ---------------------------------------------------------------------------

test.describe("Dial category filters — filter bar dropdown wiring at /lore/feed", () => {
  test.beforeEach(async ({ page }) => {
    await installRoutes(page);
    await page.goto("/lore/feed");
    await waitForAllStations(page);
  });

  function stationTypeTrigger(page: import("@playwright/test").Page) {
    return page.getByRole("button", { name: /^Station type/ });
  }

  function categoryCheckbox(
    page: import("@playwright/test").Page,
    name: string,
  ) {
    return page.getByRole("checkbox", { name });
  }

  test("Campus checkbox starts checked (default) and reflects /campus CLI toggles", async ({
    page,
  }) => {
    await stationTypeTrigger(page).click();
    const campusBox = categoryCheckbox(page, "Campus Radio");
    // Campus is one of the three default-checked categories.
    await expect(campusBox).toBeChecked();

    // /campus unchecks it — the campus-only station drops out.
    await sendCliCommand(page, "/campus");
    await expect(campusBox).not.toBeChecked();
    await expect(page.getByText("Campus WKRP")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Anchor KEXP").first()).toBeVisible();

    // /campus again re-checks it — the campus station returns.
    await sendCliCommand(page, "/campus");
    await expect(campusBox).toBeChecked();
    await expect(page.getByText("Campus WKRP").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Checking an opt-in category unions it with the defaults (additive multi-select)", async ({
    page,
  }) => {
    await stationTypeTrigger(page).click();
    const campusBox = categoryCheckbox(page, "Campus Radio");
    const indieBox = categoryCheckbox(page, "Independent DJ");

    // Defaults: campus checked, indie unchecked.
    await expect(campusBox).toBeChecked();
    await expect(indieBox).not.toBeChecked();

    await sendCliCommand(page, "/indie");
    await expect(indieBox).toBeChecked();
    await expect(campusBox).toBeChecked();
    await expect(page.getByText("Indie FM").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP").first()).toBeVisible();
  });

  test("Discovery checkbox can be toggled directly from the dropdown", async ({
    page,
  }) => {
    await stationTypeTrigger(page).click();
    const discoveryBox = categoryCheckbox(page, "Discovery");
    await expect(discoveryBox).toBeVisible();
    // Discovery is opt-in — not part of the default-checked set.
    await expect(discoveryBox).not.toBeChecked();

    await discoveryBox.click();
    await expect(discoveryBox).toBeChecked();
    // Discovery unions with the still-checked defaults, so every fixture
    // station is visible (discovery-rb also carries anchor).
    await expect(page.getByText("Discovery RB").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Campus WKRP").first()).toBeVisible();

    // Unchecking reverts to the default three categories.
    await discoveryBox.click();
    await expect(discoveryBox).not.toBeChecked();
    await expect(page.getByText("Campus WKRP").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Escape closes the dropdown and the trigger shows an active-count badge", async ({
    page,
  }) => {
    const trigger = stationTypeTrigger(page);
    // Three default-checked categories → the badge starts at 3.
    await expect(trigger).toContainText("· 3");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Unchecking Campus drops the count to 2.
    await categoryCheckbox(page, "Campus Radio").click();
    await expect(page.getByText("Campus WKRP")).not.toBeVisible({ timeout: 10_000 });
    await expect(trigger).toContainText("· 2");

    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    // The panel stays mounted but hidden.
    await expect(categoryCheckbox(page, "Campus Radio")).toBeHidden();
  });
});
