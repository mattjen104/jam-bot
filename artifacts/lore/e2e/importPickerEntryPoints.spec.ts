import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end tests for the service-picker screen in ManualImportModal.
 *
 * There are four entry points that open the modal:
 *   1. Library empty-state CTA  (data-testid="library-import-cta")
 *   2. Stats-bar "Add music"    (data-testid="library-import-open", always visible in hero)
 *   3. Reconnect prompt         (data-testid="library-reconnect-prompt" → library-import-open)
 *   4. ImportStrip "Add more +" (data-testid="import-strip-done" → aria-label="Add more music")
 *
 * After each trigger the test verifies:
 *   - data-testid="service-picker" is visible
 *   - All six service tiles are present: spotify, applemusic, youtubemusic, lastfm,
 *     listenbrainz, typeorpaste
 *   - The "come back later" callout text is visible
 *
 * All API routes are intercepted so the tests run without a real server.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONNECTIONS_EMPTY = { connections: [] };

const LIBRARY_EMPTY = { items: [], cursor: null, keepCount: 0 };

/** Minimal library item — enough for the UI to render a non-empty list. */
const LIBRARY_ITEM = {
  mbid: "test-mbid-picker-001",
  spotifyId: "sp001",
  addedAt: "2025-01-01T00:00:00.000Z",
  kept: true,
  recording: {
    mbid: "test-mbid-picker-001",
    title: "Test Track",
    artist: "Test Artist",
    albumTitle: "Test Album",
    artworkUrl: null,
    releaseDate: null,
  },
  provenance: {
    kind: "import",
    pickerHandle: null,
  },
};

const LIBRARY_WITH_ITEMS = {
  items: [LIBRARY_ITEM],
  cursor: null,
  keepCount: 1,
  softCount: 0,
};

/** A completed import job — triggers the ImportStrip "done" state. */
const DONE_IMPORT_JOB = {
  jobId: 555,
  service: "spotify",
  status: "done",
  phase: null,
  total: 120,
  resolved: 118,
  resumedFrom: null,
  error: null,
};

const SERVICE_TILE_IDS = [
  "spotify",
  "applemusic",
  "youtubemusic",
  "lastfm",
  "listenbrainz",
  "typeorpaste",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function installRoutes(
  page: Page,
  opts: {
    library?: typeof LIBRARY_EMPTY | typeof LIBRARY_WITH_ITEMS;
    importJob?: typeof DONE_IMPORT_JOB | null;
  } = {},
) {
  const { library = LIBRARY_EMPTY, importJob = null } = opts;

  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: CONNECTIONS_EMPTY }),
  );

  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: library }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: library }),
  );

  if (importJob) {
    await page.route("**/api/me/library/import?**", (route) =>
      route.fulfill({ json: importJob }),
    );
    await page.route("**/api/me/library/import", (route) =>
      route.fulfill({ json: importJob }),
    );
  } else {
    await page.route("**/api/me/library/import?**", (route) =>
      route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
    );
    await page.route("**/api/me/library/import", (route) =>
      route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
    );
  }

  // Sync — none active
  await page.route("**/api/me/library/sync**", (route) =>
    route.fulfill({ status: 404, json: { error: "No sync jobs found" } }),
  );
}

/**
 * Assert that the service-picker screen is showing with all six tiles and
 * the "come back later" callout.
 */
async function assertServicePicker(page: Page) {
  const picker = page.getByTestId("service-picker");
  await expect(picker).toBeVisible({ timeout: 10_000 });

  for (const id of SERVICE_TILE_IDS) {
    await expect(
      page.getByTestId(`service-tile-${id}`),
      `service tile "${id}" should be visible`,
    ).toBeVisible();
  }

  // "Come back later" callout — partial match on the distinctive phrase
  await expect(
    page.getByText("Imports run in the background", { exact: false }),
  ).toBeVisible();
}

// ---------------------------------------------------------------------------
// Entry point 1 — Library empty-state CTA
// ---------------------------------------------------------------------------

test.describe("import picker entry point: empty-state CTA", () => {
  test("clicks library-import-cta and shows service picker", async ({ page }) => {
    await installRoutes(page, { library: LIBRARY_EMPTY });
    await page.goto("/lore/library");

    const cta = page.getByTestId("library-import-cta");
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await cta.click();

    await assertServicePicker(page);
  });
});

// ---------------------------------------------------------------------------
// Entry point 2 — Stats-bar "Add music" link (always visible in hero)
// ---------------------------------------------------------------------------

test.describe("import picker entry point: stats-bar Add music", () => {
  test("clicks stats-bar library-import-open and shows service picker", async ({ page }) => {
    // Works with any library state — the button is always rendered in the hero.
    await installRoutes(page, { library: LIBRARY_WITH_ITEMS });
    await page.goto("/lore/library");

    // The stat-bar button shares data-testid with the reconnect prompt button;
    // use first() to target the one in the hero stats row.
    const statBtn = page.getByTestId("library-import-open").first();
    await expect(statBtn).toBeVisible({ timeout: 15_000 });
    await statBtn.click();

    await assertServicePicker(page);
  });
});

// ---------------------------------------------------------------------------
// Entry point 3 — Reconnect prompt "Add music" button
// ---------------------------------------------------------------------------

test.describe("import picker entry point: reconnect prompt", () => {
  test("reconnect prompt appears and its Add music button shows service picker", async ({
    page,
  }) => {
    // showReconnectPrompt = isAuthenticated && !hasSpotify && !isEmpty
    // → connections empty (no Spotify) + library has items
    await installRoutes(page, { library: LIBRARY_WITH_ITEMS });
    await page.goto("/lore/library");

    const prompt = page.getByTestId("library-reconnect-prompt");
    await expect(prompt).toBeVisible({ timeout: 15_000 });

    // Click the "Add music" button scoped inside the reconnect prompt
    await prompt.getByTestId("library-import-open").click();

    await assertServicePicker(page);
  });
});

// ---------------------------------------------------------------------------
// Entry point 4 — ImportStrip "Add more +" link
// ---------------------------------------------------------------------------

test.describe("import picker entry point: ImportStrip Add more +", () => {
  test("done import strip Add more + button shows service picker", async ({ page }) => {
    await installRoutes(page, { library: LIBRARY_WITH_ITEMS, importJob: DONE_IMPORT_JOB });
    await page.goto("/lore/library");

    // The strip is rendered by AppLayout above every page; wait for it.
    const strip = page.getByTestId("import-strip-done");
    await expect(strip).toBeVisible({ timeout: 15_000 });

    // "Add more +" fires lore:open-import-modal which Library.tsx listens to.
    await strip.getByRole("button", { name: "Add more music" }).click();

    await assertServicePicker(page);
  });
});
