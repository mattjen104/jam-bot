import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end tests confirming the compact Stack band's interactive behaviors
 * in a real browser:
 *
 *   1. Unchecking an album moves it to .compact-stack__skipped-region (dimmed).
 *   2. The skip preference survives a page reload (localStorage "lore:stackSkipped").
 *   3. The Stack pager page count reflects active (non-skipped) albums only.
 *   4. Expanding a row shows .compact-stack__filmstrip sorted oldest→newest
 *      with the currently kept album highlighted.
 *   5. Tapping a filmstrip tile swaps the expanded header title and makes that
 *      tile aria-pressed=true.
 *
 * All API routes are intercepted so the tests are deterministic and carry no
 * live-data dependence.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLibraryItem(opts: {
  mbid: string;
  albumTitle: string;
  artist: string;
  releaseGroupMbid?: string;
  releaseYear?: number;
  addedAt?: string;
}) {
  return {
    mbid: opts.mbid,
    provenance: { kind: "keep" },
    addedAt: opts.addedAt ?? "2026-08-01T00:00:00Z",
    recording: {
      title: "Some Track",
      artist: opts.artist,
      artworkUrl: null,
      albumTitle: opts.albumTitle,
      releaseGroupMbid: opts.releaseGroupMbid ?? null,
      releaseYear: opts.releaseYear ?? null,
      spotifyUrl: null,
    },
  };
}

/**
 * 6 distinct albums → 2 stack pages (first 5 on page 1, last 1 on page 2).
 * Portishead's "Dummy" (mbid-1) carries a releaseGroupMbid and will be used
 * for the filmstrip tests.
 */
const SIX_ALBUMS = [
  makeLibraryItem({
    mbid: "mbid-1",
    albumTitle: "Dummy",
    artist: "Portishead",
    releaseGroupMbid: "rg-dummy",
    releaseYear: 1994,
    addedAt: "2026-08-06T00:00:00Z",
  }),
  makeLibraryItem({
    mbid: "mbid-2",
    albumTitle: "Blue Lines",
    artist: "Massive Attack",
    releaseYear: 1991,
    addedAt: "2026-08-05T00:00:00Z",
  }),
  makeLibraryItem({
    mbid: "mbid-3",
    albumTitle: "OK Computer",
    artist: "Radiohead",
    releaseYear: 1997,
    addedAt: "2026-08-04T00:00:00Z",
  }),
  makeLibraryItem({
    mbid: "mbid-4",
    albumTitle: "Loveless",
    artist: "My Bloody Valentine",
    releaseYear: 1991,
    addedAt: "2026-08-03T00:00:00Z",
  }),
  makeLibraryItem({
    mbid: "mbid-5",
    albumTitle: "Mezzanine",
    artist: "Massive Attack",
    releaseYear: 1998,
    addedAt: "2026-08-02T00:00:00Z",
  }),
  // This one lands on stack page 2 (index 5).
  makeLibraryItem({
    mbid: "mbid-6",
    albumTitle: "Third",
    artist: "Portishead",
    releaseGroupMbid: "rg-third",
    releaseYear: 2008,
    addedAt: "2026-08-01T00:00:00Z",
  }),
];

/**
 * Server returns releases newest-first; the filmstrip re-sorts oldest→newest.
 * Three Portishead studio albums, so the strip is visible (more than one
 * release found for the artist).
 */
const PORTISHEAD_RELEASES = [
  {
    releaseGroupMbid: "rg-third",
    title: "Third",
    primaryType: "Album",
    releaseYear: 2008,
    artworkUrl: null,
  },
  {
    releaseGroupMbid: "rg-portishead-self",
    title: "Portishead",
    primaryType: "Album",
    releaseYear: 1997,
    artworkUrl: null,
  },
  {
    releaseGroupMbid: "rg-dummy",
    title: "Dummy",
    primaryType: "Album",
    releaseYear: 1994,
    artworkUrl: null,
  },
];

/** Track payload returned when the user taps the "Third (2008)" filmstrip tile. */
const THIRD_TRACKS = {
  rgMbid: "rg-third",
  rgTitle: "Third",
  rgType: "Album",
  releaseYear: 2008,
  artworkUrl: null,
  tracks: [
    { mbid: "t-silence", title: "Silence", artist: "Portishead" },
    { mbid: "t-hunter", title: "Hunter", artist: "Portishead" },
  ],
};

// ---------------------------------------------------------------------------
// Route interception
// ---------------------------------------------------------------------------

async function installBaseRoutes(
  page: Page,
  library: ReturnType<typeof makeLibraryItem>[] = SIX_ALBUMS,
) {
  // Never fire real audio.
  await page.route("https://stream.example.test/**", (route) => route.abort());

  // Playwright evaluates routes LIFO (last-registered = first-checked).
  // Register the /api/me catch-all FIRST so that the specific routes
  // registered after it are checked first and take precedence.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  // No Spotify connection.
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );

  // No crossings / taste data.
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: [], computing: false, failed: false } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [], hasLibrary: true, hasSeeds: false } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );

  // Import job — none.
  await page.route("**/api/me/library/import?**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/library/import", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  // Library — the Stack's data source. Registered last so it wins over the
  // catch-all above. The hook uses nextCursor (not cursor) as the page param.
  const libraryPayload = { items: library, nextCursor: null };
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: libraryPayload }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: libraryPayload }),
  );

  // Stations — empty so the dial band stays quiet.
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({ json: { items: [] } }),
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

  // Artist-releases and release-group tracks: register wildcard catch-alls
  // FIRST so that with Playwright's LIFO evaluation the specific routes
  // registered LAST are checked first and win.

  // Wildcard catch-alls (registered first → checked last with LIFO).
  await page.route("**/api/recordings/*/artist-releases", (route) =>
    route.fulfill({ json: { artistName: "Artist", releases: [] } }),
  );
  await page.route("**/api/release-groups/*/tracks", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  // Specific routes (registered last → checked first with LIFO).
  // Portishead (mbid-1) → 3 studio albums → filmstrip is shown (> 1 release).
  await page.route("**/api/recordings/mbid-1/artist-releases", (route) =>
    route.fulfill({
      json: { artistName: "Portishead", releases: PORTISHEAD_RELEASES },
    }),
  );
  // rg-third tracks — needed when the user taps the "Third (2008)" tile.
  await page.route("**/api/release-groups/rg-third/tracks", (route) =>
    route.fulfill({ json: THIRD_TRACKS }),
  );
}

/** Suppress the first-run modal that blocks interactions on a fresh session. */
async function suppressFirstRun(page: Page) {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("lore:first-run-prompted", "1");
    } catch {
      /* storage unavailable — ignore */
    }
  });
}

/**
 * Navigate to the split home and wait until at least one Stack row is visible.
 */
async function loadAndWaitForStack(page: Page) {
  await page.goto("/lore/");
  // "Expand Dummy · Portishead" is the topmost row (newest addedAt) and is
  // always present with SIX_ALBUMS — wait for it as the readiness signal.
  await expect(
    page.getByRole("button", { name: "Expand Dummy · Portishead" }),
  ).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Test suite 1 — Album checkboxes: skip / include
// ---------------------------------------------------------------------------

test.describe("CompactStack — album checkboxes", () => {
  test.beforeEach(async ({ page }) => {
    await suppressFirstRun(page);
  });

  test("unchecking an album moves it to the skipped region and dims it", async ({
    page,
  }) => {
    await installBaseRoutes(page);
    await loadAndWaitForStack(page);

    // The skipped region must not exist before any checkbox is clicked.
    await expect(page.locator(".compact-stack__skipped-region")).toHaveCount(0);

    // Uncheck "Dummy · Portishead".
    const skipCheckbox = page.getByRole("checkbox", {
      name: "Skip Dummy · Portishead in the Stack window",
    });
    await expect(skipCheckbox).toBeVisible();
    await skipCheckbox.click();

    // The skipped region appears and contains the dimmed row.
    const skippedRegion = page.locator(".compact-stack__skipped-region");
    await expect(skippedRegion).toBeVisible({ timeout: 5_000 });
    const skippedRow = skippedRegion.locator(".compact-stack__row--skipped");
    await expect(skippedRow).toContainText("Dummy");

    // The expand button for Dummy lives only inside the skipped region now —
    // it must not appear among the main active rows.
    await expect(
      page.locator(".compact-stack__skipped-region").getByRole("button", {
        name: "Expand Dummy · Portishead",
      }),
    ).toHaveCount(1);
    // Exactly 5 active rows remain (the 6th album is still on page 2).
    await expect(
      page.locator(".compact-stack__row:not(.compact-stack__row--skipped)"),
    ).toHaveCount(5);
    // Blue Lines is still in the active window.
    await expect(
      page.getByRole("button", { name: "Expand Blue Lines · Massive Attack" }),
    ).toBeVisible();
  });

  test("re-including a skipped album from the skipped region removes it from there", async ({
    page,
  }) => {
    await installBaseRoutes(page);
    await loadAndWaitForStack(page);

    // Skip "Blue Lines · Massive Attack".
    await page.getByRole("checkbox", {
      name: "Skip Blue Lines · Massive Attack in the Stack window",
    }).click();
    await expect(page.locator(".compact-stack__skipped-region")).toBeVisible({
      timeout: 5_000,
    });

    // The skipped region now shows an "Include" checkbox for re-inclusion.
    const reincludeCheckbox = page.getByRole("checkbox", {
      name: "Include Blue Lines · Massive Attack in the Stack window",
    });
    await expect(reincludeCheckbox).toBeVisible();
    await reincludeCheckbox.click();

    // After re-inclusion the skipped region disappears (no skipped items).
    await expect(page.locator(".compact-stack__skipped-region")).toHaveCount(0);
    // The row is back among the active rows.
    await expect(
      page.getByRole("button", { name: "Expand Blue Lines · Massive Attack" }),
    ).toBeVisible();
  });

  test("skip preference survives a page reload via localStorage", async ({
    page,
  }) => {
    await installBaseRoutes(page);
    await loadAndWaitForStack(page);

    // Skip "Blue Lines · Massive Attack".
    await page.getByRole("checkbox", {
      name: "Skip Blue Lines · Massive Attack in the Stack window",
    }).click();
    await expect(page.locator(".compact-stack__skipped-region")).toBeVisible({
      timeout: 5_000,
    });

    // Reload the page. "load" hangs on this dev-server page (pre-existing);
    // domcontentloaded + the 20s skipped-region wait below is sufficient.
    await page.reload({ waitUntil: "domcontentloaded" });

    // After reload the skipped album must still appear in the skipped region.
    const skippedRegion = page.locator(".compact-stack__skipped-region");
    await expect(skippedRegion).toBeVisible({ timeout: 20_000 });
    await expect(
      skippedRegion.locator(".compact-stack__row--skipped"),
    ).toContainText("Blue Lines");

    // The "Include" checkbox is present (preference was persisted).
    await expect(
      page.getByRole("checkbox", {
        name: "Include Blue Lines · Massive Attack in the Stack window",
      }),
    ).toBeVisible();
  });

  test("pager page count reflects active albums only after skipping", async ({
    page,
  }) => {
    await installBaseRoutes(page);
    await loadAndWaitForStack(page);

    // 6 albums → 2 pages initially.
    await expect(
      page.getByRole("button", { name: "stack page 1" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "stack page 2" }),
    ).toBeVisible();
    // No third page.
    await expect(
      page.getByRole("button", { name: "stack page 3" }),
    ).toHaveCount(0);

    // Skip 2 albums so only 4 remain active → 1 page.
    await page.getByRole("checkbox", {
      name: "Skip Dummy · Portishead in the Stack window",
    }).click();
    await page.getByRole("checkbox", {
      name: "Skip Blue Lines · Massive Attack in the Stack window",
    }).click();

    // With 4 active albums there is exactly 1 page.
    await expect(
      page.getByRole("button", { name: "stack page 1" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: "stack page 2" }),
    ).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Test suite 2 — Artist release filmstrip in the expanded view
// ---------------------------------------------------------------------------

test.describe("CompactStack — artist release filmstrip", () => {
  test.beforeEach(async ({ page }) => {
    await suppressFirstRun(page);
  });

  test("filmstrip appears sorted oldest→newest with the kept album highlighted", async ({
    page,
  }) => {
    await installBaseRoutes(page);
    await loadAndWaitForStack(page);

    // Expand "Dummy · Portishead" (mbid-1 → 3 artist releases).
    await page.getByRole("button", { name: "Expand Dummy · Portishead" }).click();

    // The filmstrip must appear.
    const filmstrip = page.getByRole("group", { name: "More by Portishead" });
    await expect(filmstrip).toBeVisible({ timeout: 10_000 });

    // Tiles must be in chronological ascending order: 1994 → 1997 → 2008.
    const yearLabels = filmstrip.locator(".compact-stack__filmstrip-year");
    await expect(yearLabels).toHaveCount(3);
    await expect(yearLabels.nth(0)).toHaveText("1994");
    await expect(yearLabels.nth(1)).toHaveText("1997");
    await expect(yearLabels.nth(2)).toHaveText("2008");

    // The kept album (Dummy, 1994) is the highlighted active tile.
    const activeTile = filmstrip.locator(".compact-stack__filmstrip-tile--active");
    await expect(activeTile).toHaveCount(1);
    await expect(activeTile).toHaveAttribute("aria-label", "View Dummy (1994)");
    // aria-pressed reflects the active state.
    await expect(activeTile).toHaveAttribute("aria-pressed", "true");
  });

  test("tapping a filmstrip tile swaps the expanded header title", async ({
    page,
  }) => {
    await installBaseRoutes(page);
    await loadAndWaitForStack(page);

    // Expand "Dummy · Portishead".
    await page.getByRole("button", { name: "Expand Dummy · Portishead" }).click();

    // Wait for the filmstrip to load.
    const filmstrip = page.getByRole("group", { name: "More by Portishead" });
    await expect(filmstrip).toBeVisible({ timeout: 10_000 });

    // Tap the "Third (2008)" tile.
    const thirdTile = filmstrip.getByRole("button", { name: "View Third (2008)" });
    await expect(thirdTile).toBeVisible();
    await thirdTile.click();

    // The expanded header must swap from "Dummy" to "Third".
    await expect(
      page.getByRole("button", { name: "Collapse Third" }),
    ).toBeVisible({ timeout: 5_000 });

    // The tapped tile becomes the active (highlighted) one.
    await expect(thirdTile).toHaveAttribute("aria-pressed", "true");

    // The Dummy tile is no longer active.
    const dummyTile = filmstrip.getByRole("button", { name: "View Dummy (1994)" });
    await expect(dummyTile).toHaveAttribute("aria-pressed", "false");
  });

  test("filmstrip is absent when the artist has only one known release", async ({
    page,
  }) => {
    // Use just Blue Lines (mbid-2) — it resolves to an empty artist-releases
    // response (caught by the wildcard route), so the filmstrip is suppressed.
    await installBaseRoutes(page, [
      makeLibraryItem({
        mbid: "mbid-2",
        albumTitle: "Blue Lines",
        artist: "Massive Attack",
        releaseYear: 1991,
        addedAt: "2026-08-01T00:00:00Z",
      }),
    ]);
    await page.goto("/lore/");
    await expect(
      page.getByRole("button", { name: "Expand Blue Lines · Massive Attack" }),
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Expand Blue Lines · Massive Attack" }).click();

    // Notes section appears (even if empty), but no filmstrip.
    await expect(
      page.getByRole("button", { name: "Collapse Blue Lines" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".compact-stack__filmstrip")).toHaveCount(0);
  });
});
