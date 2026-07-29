import { test, expect } from "@playwright/test";

/**
 * End-to-end tests for the Library sync job lifecycle and receipt display.
 *
 * All API routes are intercepted so the tests run deterministically without
 * a real Spotify connection.  The fixtures mirror the shapes produced by
 * GET /api/me/library/sync and POST /api/me/library/sync in routes/me/index.ts.
 *
 * Scenarios:
 *   1. Receipt renders with correct counts when the server reports a done job.
 *   2. "Show details" toggle reveals / hides the unavailable-item list.
 *   3. Sync button triggers a job and the receipt appears once polling resolves.
 *   4. canWrite:false → static error message is shown; no crash.
 */

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CONNECTIONS_WITH_SPOTIFY = {
  connections: [
    {
      service: "spotify",
      canWrite: true,
      connectedAt: "2025-01-01T00:00:00.000Z",
      lastImportAt: null,
    },
  ],
};

/** A done sync job with 2 synced tracks and 1 unavailable track. */
const DONE_JOB = {
  jobId: 42,
  service: "spotify",
  status: "done",
  phase: null,
  total: 3,
  processed: 3,
  startedAt: "2025-01-01T12:00:00.000Z",
  finishedAt: "2025-01-01T12:00:05.000Z",
  error: null,
  results: {
    synced: 2,
    searchMatched: 0,
    alreadySaved: 0,
    unavailable: 1,
    unavailableItems: [
      {
        mbid: "test-mbid-none",
        title: "Unavailable Track",
        artist: "Obscure Artist",
        bandcampUrl:
          "https://bandcamp.com/search?q=Obscure%20Artist%20Unavailable%20Track",
      },
    ],
    searchMatchedItems: [],
  },
};

/** A done sync job with 1 search-matched item (shows the toggle). */
const DONE_JOB_WITH_SEARCH = {
  ...DONE_JOB,
  jobId: 43,
  results: {
    synced: 1,
    searchMatched: 1,
    alreadySaved: 0,
    unavailable: 0,
    unavailableItems: [],
    searchMatchedItems: [
      {
        mbid: "test-mbid-search",
        title: "Found By Search",
        artist: "Known Artist",
        spotifyUrl: "https://open.spotify.com/track/sp123",
      },
    ],
  },
};

/** A job currently in the "running / matching" phase. */
const RUNNING_JOB = {
  jobId: 44,
  service: "spotify",
  status: "running",
  phase: "matching",
  total: 3,
  processed: 1,
  startedAt: "2025-01-01T12:00:00.000Z",
  finishedAt: null,
  error: null,
  results: null,
};

/** An empty kept list (no items in the library yet). */
const EMPTY_LIBRARY = { items: [], cursor: null };

// ---------------------------------------------------------------------------
// Route-interception helpers
// ---------------------------------------------------------------------------

/**
 * Install the standard "authenticated Spotify user" stubs on every test page.
 * All individual tests may add additional route overrides on top of this base.
 */
async function installBaseRoutes(
  page: import("@playwright/test").Page,
  overrides: {
    syncGet?: unknown;
    syncPost?: { status: number; body: unknown };
  } = {},
) {
  // Connections — authenticated, has Spotify
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: CONNECTIONS_WITH_SPOTIFY }),
  );

  // Library — empty kept list (sync section always visible if hasSpotify)
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: EMPTY_LIBRARY }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: EMPTY_LIBRARY }),
  );

  // Import job — none
  await page.route("**/api/me/library/import", (route) =>
    route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
  );

  // Sync GET — latest job
  const syncGet = overrides.syncGet ?? DONE_JOB;
  await page.route("**/api/me/library/sync", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: syncGet });
    }
    // POST — handled below or by the override
    if (overrides.syncPost) {
      return route.fulfill({
        status: overrides.syncPost.status,
        json: overrides.syncPost.body,
      });
    }
    return route.fulfill({ json: { jobId: 42, status: "pending" } });
  });

  // Sync GET /:jobId — return the same done job
  await page.route("**/api/me/library/sync/**", (route) =>
    route.fulfill({ json: syncGet }),
  );
}

// ---------------------------------------------------------------------------
// Test suite 1 — Receipt renders from a pre-existing done job
// ---------------------------------------------------------------------------

test.describe("Library sync receipt — done job on page load", () => {
  test("receipt section is visible with correct synced and unavailable counts", async ({
    page,
  }) => {
    await installBaseRoutes(page, { syncGet: DONE_JOB });
    await page.goto("/lore/library");

    // Sync section must be present (isAuthenticated + hasSpotify).
    const syncSection = page.getByTestId("library-sync");
    await expect(syncSection).toBeVisible({ timeout: 10_000 });

    // Receipt must render automatically — no click needed.
    const receipt = page.getByTestId("library-sync-receipt");
    await expect(receipt).toBeVisible({ timeout: 5_000 });

    // Count labels are in the receipt.
    await expect(receipt).toContainText("2");
    await expect(receipt).toContainText("synced");
    await expect(receipt).toContainText("1");
    await expect(receipt).toContainText("not on Spotify");
  });

  test("receipt section shows alreadySaved count when non-zero", async ({
    page,
  }) => {
    const jobWithSaved = {
      ...DONE_JOB,
      results: { ...DONE_JOB.results, synced: 1, alreadySaved: 2 },
    };
    await installBaseRoutes(page, { syncGet: jobWithSaved });
    await page.goto("/lore/library");

    const receipt = page.getByTestId("library-sync-receipt");
    await expect(receipt).toBeVisible({ timeout: 10_000 });
    await expect(receipt).toContainText("already saved");
  });
});

// ---------------------------------------------------------------------------
// Test suite 2 — "Show details" toggle reveals unavailable-item list
// ---------------------------------------------------------------------------

test.describe("Library sync receipt — details toggle", () => {
  test("toggle shows and hides unavailable track list", async ({ page }) => {
    await installBaseRoutes(page, { syncGet: DONE_JOB });
    await page.goto("/lore/library");

    const receipt = page.getByTestId("library-sync-receipt");
    await expect(receipt).toBeVisible({ timeout: 10_000 });

    // Toggle button must be present (unavailableItems.length > 0).
    const toggle = page.getByTestId("library-sync-receipt-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("Show details");

    // Click to open.
    await toggle.click();
    await expect(toggle).toContainText("Hide details");
    // The unavailable track should now be visible.
    await expect(receipt).toContainText("Unavailable Track");
    await expect(receipt).toContainText("Obscure Artist");

    // Click to collapse.
    await toggle.click();
    await expect(toggle).toContainText("Show details");
    await expect(receipt).not.toContainText("Unavailable Track");
  });

  test("toggle shows search-matched item list", async ({ page }) => {
    await installBaseRoutes(page, { syncGet: DONE_JOB_WITH_SEARCH });
    await page.goto("/lore/library");

    const receipt = page.getByTestId("library-sync-receipt");
    await expect(receipt).toBeVisible({ timeout: 10_000 });
    await expect(receipt).toContainText("1");
    await expect(receipt).toContainText("matched by search");

    const toggle = page.getByTestId("library-sync-receipt-toggle");
    await toggle.click();
    await expect(receipt).toContainText("Found By Search");
  });
});

// ---------------------------------------------------------------------------
// Test suite 3 — Sync button triggers a job; receipt appears after polling
// ---------------------------------------------------------------------------

test.describe("Library sync — button triggers job and receipt appears", () => {
  test("clicking Sync now starts a job and the receipt renders once done", async ({
    page,
  }) => {
    // Initial state: no sync job yet.
    let syncGetCallCount = 0;

    await page.route("**/api/me/connections", (route) =>
      route.fulfill({ json: CONNECTIONS_WITH_SPOTIFY }),
    );
    await page.route("**/api/me/library?**", (route) =>
      route.fulfill({ json: EMPTY_LIBRARY }),
    );
    await page.route("**/api/me/library", (route) =>
      route.fulfill({ json: EMPTY_LIBRARY }),
    );
    await page.route("**/api/me/library/import", (route) =>
      route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
    );

    // GET /api/me/library/sync — first call returns 404 (no job yet),
    // subsequent calls return the done job (simulating worker completion).
    await page.route("**/api/me/library/sync", async (route) => {
      if (route.request().method() === "POST") {
        // Acknowledge the sync start.
        return route.fulfill({
          status: 202,
          json: { jobId: 42, status: "pending" },
        });
      }
      syncGetCallCount++;
      if (syncGetCallCount <= 1) {
        return route.fulfill({
          status: 404,
          json: { error: "No sync jobs found" },
        });
      }
      return route.fulfill({ json: DONE_JOB });
    });

    await page.route("**/api/me/library/sync/**", (route) =>
      route.fulfill({ json: DONE_JOB }),
    );

    await page.goto("/lore/library");

    // Sync section and button must be visible.
    const syncButton = page.getByTestId("library-sync-button");
    await expect(syncButton).toBeVisible({ timeout: 10_000 });
    await expect(syncButton).toContainText("Sync now");
    await expect(syncButton).not.toBeDisabled();

    // Trigger the sync.
    await syncButton.click();

    // Receipt must appear within a reasonable timeout after React Query refetches.
    const receipt = page.getByTestId("library-sync-receipt");
    await expect(receipt).toBeVisible({ timeout: 10_000 });
    await expect(receipt).toContainText("synced");
  });

  test("progress bar and phase label are shown while job is running", async ({
    page,
  }) => {
    await installBaseRoutes(page, { syncGet: RUNNING_JOB });
    await page.goto("/lore/library");

    const syncSection = page.getByTestId("library-sync");
    await expect(syncSection).toBeVisible({ timeout: 10_000 });

    // Progress section must be visible when status=running.
    const progress = page.getByTestId("library-sync-progress");
    await expect(progress).toBeVisible({ timeout: 5_000 });
    // Phase label for "matching".
    await expect(progress).toContainText("Matching");

    // The sync button must be disabled while running.
    const syncButton = page.getByTestId("library-sync-button");
    await expect(syncButton).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Test suite 4 — canWrite:false 403 path
// ---------------------------------------------------------------------------

test.describe("Library sync — canWrite:false error handling", () => {
  test("shows reconnect error message after 403 and does not crash", async ({
    page,
  }) => {
    await installBaseRoutes(page, {
      // No existing sync job.
      syncGet: { status: 404, error: "No sync jobs found" } as unknown,
      syncPost: {
        status: 403,
        body: {
          error: "canWrite:false",
          message:
            "Your Spotify connection doesn't have write access. Reconnect Spotify to grant it.",
          reAuthUrl: null,
        },
      },
    });

    // Override the GET to actually return 404 (installBaseRoutes uses the object directly)
    await page.route("**/api/me/library/sync", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 404,
          json: { error: "No sync jobs found" },
        });
      }
      // POST → 403
      return route.fulfill({
        status: 403,
        json: {
          error: "canWrite:false",
          message:
            "Your Spotify connection doesn't have write access. Reconnect Spotify to grant it.",
          reAuthUrl: null,
        },
      });
    });

    await page.goto("/lore/library");

    const syncButton = page.getByTestId("library-sync-button");
    await expect(syncButton).toBeVisible({ timeout: 10_000 });
    await expect(syncButton).toContainText("Sync now");

    // Trigger the sync.
    await syncButton.click();

    // Error message must appear — see Library.tsx handleSync error branch.
    const errorMsg = page.getByTestId("library-sync-error");
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });
    await expect(errorMsg).toContainText("Reconnect Spotify");

    // No receipt must be shown — the job was never created.
    await expect(page.getByTestId("library-sync-receipt")).not.toBeVisible();

    // Page must still be functional (no crash — sync section still rendered).
    await expect(page.getByTestId("library-sync")).toBeVisible();
  });

  test("error message is cleared on a subsequent successful sync attempt", async ({
    page,
  }) => {
    let postCallCount = 0;

    await page.route("**/api/me/connections", (route) =>
      route.fulfill({ json: CONNECTIONS_WITH_SPOTIFY }),
    );
    await page.route("**/api/me/library?**", (route) =>
      route.fulfill({ json: EMPTY_LIBRARY }),
    );
    await page.route("**/api/me/library", (route) =>
      route.fulfill({ json: EMPTY_LIBRARY }),
    );
    await page.route("**/api/me/library/import", (route) =>
      route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
    );

    // First POST → 403; second POST → 202.
    await page.route("**/api/me/library/sync", async (route) => {
      if (route.request().method() === "POST") {
        postCallCount++;
        if (postCallCount === 1) {
          return route.fulfill({
            status: 403,
            json: { error: "canWrite:false", message: "No write access", reAuthUrl: null },
          });
        }
        return route.fulfill({ status: 202, json: { jobId: 42, status: "pending" } });
      }
      // GET — return done job on second attempt, 404 on first.
      return route.fulfill(
        postCallCount >= 2
          ? { json: DONE_JOB }
          : { status: 404, json: { error: "No sync jobs found" } },
      );
    });
    await page.route("**/api/me/library/sync/**", (route) =>
      route.fulfill({ json: DONE_JOB }),
    );

    await page.goto("/lore/library");

    const syncButton = page.getByTestId("library-sync-button");
    await expect(syncButton).toBeVisible({ timeout: 10_000 });

    // First click — fail.
    await syncButton.click();
    const errorMsg = page.getByTestId("library-sync-error");
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });

    // Second click — succeed; error must disappear.
    await syncButton.click();
    await expect(errorMsg).not.toBeVisible();
    await expect(page.getByTestId("library-sync-receipt")).toBeVisible({
      timeout: 10_000,
    });
  });
});
