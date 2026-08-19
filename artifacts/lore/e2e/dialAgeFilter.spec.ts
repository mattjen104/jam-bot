import { test, expect } from "@playwright/test";

/**
 * End-to-end tests confirming that the Dial's First age-tier filter correctly
 * surfaces only premiere plays — a recording's first-ever Lore spin on or
 * before its release date — and excludes old-catalog first-spins and
 * non-premiere current tracks.
 *
 * All release dates and years are derived from the wall clock at module-load
 * time so the fixtures never go stale:
 *
 *   premiere-air     — isFirstSpin: true
 *                      releaseDate: Dec 31 two years from now
 *                      (always ≥ 16 months in the future → ageTier "first")
 *
 *   old-catalog-air  — isFirstSpin: true
 *                      releaseDate: 2010-06-15 (fixed; >60 months ago forever)
 *                      (playedAt always > releaseDate → not a premiere;
 *                       (now.year − 2010)*12 ≫ 60 → ageTier "deep")
 *
 *   current-air      — isFirstSpin: false
 *                      releaseYear: current calendar year
 *                      (0 months old → ageTier "current")
 *
 * All three stations carry the "anchor" category so they appear under the
 * default station-type filter (anchor/campus/public default-checked).
 * The default age-tier set is {first, current, catalog, deep}, so all three
 * stations are visible on load.
 *
 * Test coverage
 * ─────────────
 * 1. All three stations visible with default filters (sanity).
 * 2. Deactivating current/catalog/deep via CLI leaves only First active →
 *    only the premiere station remains visible.
 * 3. Deactivating the First tier via /first hides the premiere station while
 *    old-catalog and current stations remain visible.
 * 4. Track age dropdown at /lore/feed shows the "First" checkbox with the
 *    correct description text ("First Lore play of a brand-new release").
 * 5. Toggling the First checkbox directly in the dropdown mirrors the CLI.
 */

// ---------------------------------------------------------------------------
// Wall-clock-relative fixture dates — never go stale.
// ---------------------------------------------------------------------------

/** Calendar year at the moment the test module loads. */
const THIS_YEAR = new Date().getFullYear();

/**
 * A release date that is always well in the future (Dec 31, two years out).
 * A spin played "today" will always satisfy playedAt ≤ releaseEnd, so the
 * premiere-air station always gets ageTier "first" regardless of when the
 * test runs.
 */
const FUTURE_RELEASE_DATE = `${THIS_YEAR + 2}-12-31`;

/**
 * Release year = this year → approxMonths = 0 ≤ 18 → always "current".
 * The tier flips to "catalog" only when the track is ≥19 months old, i.e.
 * at least 19 months into NEXT year — well outside any reasonable test run.
 */
const CURRENT_RELEASE_YEAR = THIS_YEAR;

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

function makeStation(slug: string, name: string, idx: number) {
  return {
    id: 400 + idx,
    slug,
    name,
    org: name,
    city: "Testville",
    country: "US",
    // Unique stream URLs so audio requests can be aborted without colliding
    // with other specs that share the same test runner.
    streamUrl: `https://stream.lore-e2e-age.test/${slug}`,
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
    // All three stations carry "anchor" so they pass the default category
    // filter (anchor/campus/public) without any additional setup.
    // Age-tier commands are verified against the direct-row fallback so the
    // spec remains focused on filtering rather than category expansion.
    stationCategories: [],
  };
}

// premiere-air:    isFirstSpin=true + releaseDate in the future → "first"
// old-catalog-air: isFirstSpin=true + old releaseDate (2010)   → "deep"
// current-air:     isFirstSpin=false + recent releaseYear       → "current"
const STATIONS = [
  makeStation("premiere-air",    "Premiere Air",    0),
  makeStation("old-catalog-air", "Old Catalog Air", 1),
  makeStation("current-air",     "Current Air",     2),
];

function makeNowPlaying(
  slug: string,
  idx: number,
  isFirstSpin: boolean,
  releaseYear: number | null,
  releaseDate: string | null,
) {
  return {
    spinId: 800 + idx,
    rawArtist: `Artist ${idx + 1}`,
    rawTitle: `Track ${idx + 1}`,
    source: "nts_live",
    // "recording_id" confidence means the recording sub-object is present;
    // useDialData reads recording.releaseYear / recording.releaseDate to
    // derive the ageTier client-side via spinAgeTier().
    confidence: "recording_id",
    playedAt: new Date(Date.now() - idx * 30_000).toISOString(),
    artworkUrl: null,
    // NowPlayingRecording requires mbid, title, artist, and links.
    recording: {
      mbid: `00000000-0000-0000-0000-${String(idx).padStart(12, "0")}`,
      title: `Track ${idx + 1}`,
      artist: `Artist ${idx + 1}`,
      artistMbid: null,
      artworkUrl: null,
      links: [],
      genres: null,
      releaseYear,
      releaseDate,
    },
    show: { name: `Show ${idx + 1}`, djName: `DJ ${idx + 1}` },
    isFirstSpin,
    isLibraryHit: false,
    // isArtistHit:true so hasAnyCrossing("set") → true for every fixture
    // station; without it withReason.length===0 and the Zone1Placeholder
    // hides the feed with a skeleton, making station-name assertions fail.
    isArtistHit: true,
  };
}

const NOW_PLAYING_MAP: Record<string, ReturnType<typeof makeNowPlaying>> = {
  // playedAt (now) ≤ FUTURE_RELEASE_DATE (THIS_YEAR+2 Dec 31) → "first"
  "premiere-air": makeNowPlaying("premiere-air", 0, true, THIS_YEAR + 2, FUTURE_RELEASE_DATE),
  // playedAt (now) >> 2010-06-15; (THIS_YEAR − 2010)*12 >> 60 → "deep"
  "old-catalog-air": makeNowPlaying("old-catalog-air", 1, true, 2010, "2010-06-15"),
  // isFirstSpin=false; (THIS_YEAR − CURRENT_RELEASE_YEAR)*12 = 0 ≤ 18 → "current"
  "current-air": makeNowPlaying("current-air", 2, false, CURRENT_RELEASE_YEAR, null),
};

function makeSchedule() {
  const now = Date.now();
  return {
    items: STATIONS.map((s, idx) => ({
      stationSlug: s.slug,
      runs: [
        {
          runId: 400 + idx,
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
// Route interception
// ---------------------------------------------------------------------------

async function installRoutes(page: import("@playwright/test").Page) {
  // Abort audio streams — never let the fixture URLs actually connect.
  await page.route("https://stream.lore-e2e-age.test/**", (route) =>
    route.abort(),
  );

  // Listener endpoints — authenticated, effectively empty.
  // IMPORTANT: Playwright routes are matched last-registered-first, so the
  // broad catch-all must be registered BEFORE the specific handlers so the
  // specifics win at match time.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: makeCrossings() }),
  );
  // Return hasLibrary:true + hasSeeds:true so the app renders the normal
  // crossings feed instead of the first-run onboarding state, which would
  // suppress the station list and make station-name assertions impossible.
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

  // Station directory.
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
  );

  // Bulk now-playing pulse — all three stations are live.
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: STATIONS.map((s) => ({
          slug: s.slug,
          nowPlaying: NOW_PLAYING_MAP[s.slug],
        })),
      },
    }),
  );

  // SSE stream — empty keepalive so the REST pulse is the authoritative source.
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );

  // Per-station now-playing (player dock).
  for (const s of STATIONS) {
    await page.route(`**/api/stations/${s.slug}/now-playing`, (route) =>
      route.fulfill({
        json: { station: s, nowPlaying: NOW_PLAYING_MAP[s.slug] },
      }),
    );
  }

  // Schedule and supplementary endpoints.
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
 * Send any slash-command via the global DialCliBar listener.
 *
 * Blurs the active element first so the "/" keydown is not swallowed by an
 * existing focused input, then types the full command and presses Enter.
 */
async function sendCliCommand(
  page: import("@playwright/test").Page,
  cmd: string,
) {
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.keyboard.press("/");
  await page.keyboard.type(cmd.slice(1));
  await page.keyboard.press("Enter");
}

/**
 * Waits for all three fixture station names to appear somewhere in the feed
 * before applying any filter. Serves as a loaded-and-rendered gate.
 */
async function waitForAllStations(page: import("@playwright/test").Page) {
  for (const s of STATIONS) {
    await expect(page.getByText(s.name).first()).toBeVisible({ timeout: 20_000 });
  }
}

// ---------------------------------------------------------------------------
// CLI tests — run at the split homepage (/lore/)
// ---------------------------------------------------------------------------

test.describe("Dial age-tier filter — CLI (/first)", () => {
  test.beforeEach(async ({ page }) => {
    await installRoutes(page);
    await page.goto("/lore/");
    await waitForAllStations(page);
  });

  test("all three stations are visible with default filters (all age tiers active)", async ({
    page,
  }) => {
    // Sanity: the default active set {first, current, catalog, deep} lets every
    // tier through, so all fixture stations render without any user action.
    await expect(page.getByText("Premiere Air").first()).toBeVisible();
    await expect(page.getByText("Old Catalog Air").first()).toBeVisible();
    await expect(page.getByText("Current Air").first()).toBeVisible();
  });

  test("/first removes First tier: premiere track disappears, others stay", async ({
    page,
  }) => {
    // The default active set is {first, current, catalog, deep}.  Sending
    // /first toggles "first" out of the set → active = {current, catalog, deep}.
    // The premiere station's ageTier is "first" which is no longer active →
    // it must be hidden.  The other two stations pass their tiers.
    await sendCliCommand(page, "/first");

    await expect(page.getByText("Premiere Air")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Old Catalog Air").first()).toBeVisible();
    await expect(page.getByText("Current Air").first()).toBeVisible();
  });

  test("old-catalog first-spin is NOT a premiere: it falls through to a non-First tier", async ({
    page,
  }) => {
    // Deactivate current and first tiers → active = {catalog, deep}.
    // The old-catalog station (ageTier "deep") must still be visible; the
    // premiere station (ageTier "first") and the current station (ageTier
    // "current") must be hidden — confirming old catalog first-spins never
    // carry the "first" tier.
    await sendCliCommand(page, "/current");
    await sendCliCommand(page, "/first");

    await expect(page.getByText("Old Catalog Air").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Premiere Air")).not.toBeVisible();
    await expect(page.getByText("Current Air")).not.toBeVisible();
  });

  test("isolating First tier shows only the premiere station", async ({
    page,
  }) => {
    // Remove catalog, current, and deep from the active set so that only
    // "first" remains active.  Only the premiere station should be visible.
    await sendCliCommand(page, "/catalog");
    await sendCliCommand(page, "/current");
    await sendCliCommand(page, "/deep");

    await expect(page.getByText("Premiere Air").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Old Catalog Air")).not.toBeVisible();
    await expect(page.getByText("Current Air")).not.toBeVisible();
  });

  test("/first toggle is reversible: re-sending /first restores the premiere station", async ({
    page,
  }) => {
    // Deactivate /first (premiere hidden), then activate it again (premiere
    // returns).  Verifies the toggle is a true round-trip, not a one-way hide.
    await sendCliCommand(page, "/first");
    await expect(page.getByText("Premiere Air")).not.toBeVisible({ timeout: 10_000 });

    await sendCliCommand(page, "/first");
    await expect(page.getByText("Premiere Air").first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Filter-bar dropdown tests — run at /lore/feed (full DialView)
// ---------------------------------------------------------------------------

test.describe("Dial age-tier filter — Track age dropdown at /lore/feed", () => {
  test.beforeEach(async ({ page }) => {
    await installRoutes(page);
    await page.goto("/lore/feed");
    await waitForAllStations(page);
  });

  function trackAgeTrigger(page: import("@playwright/test").Page) {
    return page.getByRole("button", { name: /^Track age/ });
  }

  function tierCheckbox(page: import("@playwright/test").Page, name: string) {
    return page.getByRole("checkbox", { name });
  }

  test("Track age dropdown is present and shows all four tier options", async ({
    page,
  }) => {
    const trigger = trackAgeTrigger(page);
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(tierCheckbox(page, "First")).toBeVisible();
    await expect(tierCheckbox(page, "Current")).toBeVisible();
    await expect(tierCheckbox(page, "Catalog")).toBeVisible();
    await expect(tierCheckbox(page, "Deep")).toBeVisible();
  });

  test("First checkbox description reads 'First Lore play of a brand-new release'", async ({
    page,
  }) => {
    await trackAgeTrigger(page).click();

    // The FilterDropdownMenu renders each option description as a
    // .filter-dropdown__option-desc span alongside the label.
    const desc = page
      .locator(".filter-dropdown__option-desc")
      .filter({ hasText: "First Lore play of a brand-new release" });
    await expect(desc.first()).toBeVisible();
  });

  test("First checkbox starts checked (default) and unchecking hides premiere tracks", async ({
    page,
  }) => {
    await trackAgeTrigger(page).click();

    const firstBox = tierCheckbox(page, "First");
    // "first" is part of the default active set so the checkbox starts checked.
    await expect(firstBox).toBeChecked();

    // Uncheck it — premiere station should disappear.
    await firstBox.click();
    await expect(firstBox).not.toBeChecked();
    await expect(page.getByText("Premiere Air")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Old Catalog Air").first()).toBeVisible();
    await expect(page.getByText("Current Air").first()).toBeVisible();
  });

  test("Dropdown First checkbox reflects /first CLI toggle", async ({
    page,
  }) => {
    await trackAgeTrigger(page).click();

    // Initially checked (default).
    await expect(tierCheckbox(page, "First")).toBeChecked();

    // CLI removes "first" from the active set → checkbox unchecked.
    await sendCliCommand(page, "/first");
    await expect(tierCheckbox(page, "First")).not.toBeChecked();
    await expect(page.getByText("Premiere Air")).not.toBeVisible({ timeout: 10_000 });

    // CLI adds it back → checkbox re-checked, premiere station returns.
    await sendCliCommand(page, "/first");
    await expect(tierCheckbox(page, "First")).toBeChecked();
    await expect(page.getByText("Premiere Air").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Unchecking every tier shows all stations (empty set = no age filtering)", async ({
    page,
  }) => {
    await trackAgeTrigger(page).click();

    // Remove all four tiers.
    for (const label of ["First", "Current", "Catalog", "Deep"]) {
      await tierCheckbox(page, label).click();
    }

    // Empty active set → rowPassesAgeTierFilter returns true for every row.
    await expect(page.getByText("Premiere Air").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Old Catalog Air").first()).toBeVisible();
    await expect(page.getByText("Current Air").first()).toBeVisible();
  });

  test("Track age trigger badge shows active-count after toggling", async ({
    page,
  }) => {
    const trigger = trackAgeTrigger(page);
    // Default: all 4 tiers active → badge reads "· 4".
    await expect(trigger).toContainText("· 4");

    await trigger.click();
    await tierCheckbox(page, "First").click();

    // One tier removed → badge reads "· 3".
    await expect(trigger).toContainText("· 3");
    await expect(page.getByText("Premiere Air")).not.toBeVisible({ timeout: 10_000 });
  });
});
