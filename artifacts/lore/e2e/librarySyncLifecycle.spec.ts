import { test, expect } from "@playwright/test";

// The Library page auto-opens the ManualImportModal for first-run users
// (empty library + no seeds + no avatar). All fixtures here stub an EMPTY
// library, so without this flag the modal's backdrop covers the page and
// intercepts every click (sync button, receipt toggle). Seed the
// once-per-session sessionStorage flag so the prompt never fires.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("lore:first-run-prompted", "1");
    } catch {
      /* ignore */
    }
  });
});

/**
 * End-to-end tests for the Library sync (export keeps → Spotify) lifecycle,
 * rewritten for the dial-style Library redesign (SyncBar in pages/Library.tsx).
 *
 * All API routes are intercepted so the tests run deterministically without
 * a real Spotify connection. The fixtures mirror the shapes produced by
 * GET /api/me/library/sync and POST /api/me/library/sync.
 *
 * NOTE: the sync/export section only renders on non-Stack lenses — the default
 * album Stack is a chrome-free full-screen list — so these tests mount with
 * ?lens=recent.
 *
 * Scenarios:
 *   1. SyncBar renders a done job: "Synced …" label + "N saved" count.
 *   2. Receipt toggle ("Show match details") reveals / hides unavailable and
 *      search-matched rows.
 *   3. "Sync now" starts a job and the done state appears once polling resolves.
 *   4. canWrite:false 403 → library-sync-error with Reconnect Spotify button.
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

/** A done sync job with 1 search-matched item (also shows the toggle). */
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
 * Individual tests may add additional route overrides on top of this base
 * (later registrations win in Playwright).
 */
async function installBaseRoutes(
  page: import("@playwright/test").Page,
  overrides: {
    syncGet?: unknown;
    syncGetStatus?: number;
  } = {},
) {
  // Connections — authenticated, has Spotify.
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: CONNECTIONS_WITH_SPOTIFY }),
  );

  // Library — empty kept list (SyncBar is visible whenever hasSpotify).
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: EMPTY_LIBRARY }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: EMPTY_LIBRARY }),
  );

  // Import job — none (suppresses the import strip).
  await page.route("**/api/me/library/import?**", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 404, json: { error: "No import jobs found" } });
    }
    return route.continue();
  });
  await page.route("**/api/me/library/import", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 404, json: { error: "No import jobs found" } });
    }
    return route.continue();
  });

  // Sync — latest job (GET), acknowledge start (POST).
  const syncGet = overrides.syncGet ?? DONE_JOB;
  const syncGetStatus = overrides.syncGetStatus ?? 200;
  const syncHandler = (route: import("@playwright/test").Route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: syncGetStatus, json: syncGet });
    }
    return route.fulfill({ status: 202, json: { jobId: 42, status: "pending" } });
  };
  // POST goes to /sync?service=spotify — register both glob variants.
  await page.route("**/api/me/library/sync", syncHandler);
  await page.route("**/api/me/library/sync?**", syncHandler);
  await page.route("**/api/me/library/sync/**", (route) =>
    route.fulfill({ status: syncGetStatus, json: syncGet }),
  );
}

// ---------------------------------------------------------------------------
// Test suite 1 — SyncBar renders a pre-existing done job
// ---------------------------------------------------------------------------

test.describe("Library sync — done job on page load", () => {
  test("SyncBar shows Synced label and saved count", async ({ page }) => {
    await installBaseRoutes(page, { syncGet: DONE_JOB });
    await page.goto("/lore/library?lens=recent");

    // Sync section must be present (isAuthenticated + hasSpotify).
    const syncSection = page.getByTestId("library-sync");
    await expect(syncSection).toBeVisible({ timeout: 10_000 });

    // Done-job summary renders in the bar: "Synced <date>" + "2 saved".
    await expect(syncSection).toContainText("Synced");
    await expect(syncSection).toContainText("2 saved");

    // Idle button is enabled and labelled "Sync now".
    const syncButton = page.getByTestId("library-sync-button");
    await expect(syncButton).toBeVisible();
    await expect(syncButton).toContainText("Sync now");
    await expect(syncButton).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Test suite 2 — receipt toggle reveals match details
// ---------------------------------------------------------------------------

test.describe("Library sync receipt — details toggle", () => {
  test("toggle shows and hides the unavailable track list", async ({ page }) => {
    await installBaseRoutes(page, { syncGet: DONE_JOB });
    await page.goto("/lore/library?lens=recent");

    // Toggle button appears because unavailableItems.length > 0.
    const toggle = page.getByTestId("library-sync-receipt-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toContainText("Show match details");

    // Click to open — the "Not on Spotify" receipt rows render.
    await toggle.click();
    await expect(toggle).toContainText("Hide details");
    const row = page.getByTestId("library-unavailable-row");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Unavailable Track");
    await expect(row).toContainText("Obscure Artist");
    await expect(page.getByText("Not on Spotify")).toBeVisible();

    // Click to collapse.
    await toggle.click();
    await expect(toggle).toContainText("Show match details");
    await expect(row).not.toBeVisible();
  });

  test("toggle shows the search-matched item list", async ({ page }) => {
    await installBaseRoutes(page, { syncGet: DONE_JOB_WITH_SEARCH });
    await page.goto("/lore/library?lens=recent");

    const toggle = page.getByTestId("library-sync-receipt-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();

    await expect(page.getByText("Matched by search")).toBeVisible();
    await expect(page.getByText("Found By Search")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test suite 3 — Sync button triggers a job; done state appears after polling
// ---------------------------------------------------------------------------

test.describe("Library sync — button triggers job", () => {
  test("clicking Sync now starts a job and the done state renders", async ({
    page,
  }) => {
    let postSeen = false;

    await page.route("**/api/me/connections", (route) =>
      route.fulfill({ json: CONNECTIONS_WITH_SPOTIFY }),
    );
    await page.route("**/api/me/library?**", (route) =>
      route.fulfill({ json: EMPTY_LIBRARY }),
    );
    await page.route("**/api/me/library", (route) =>
      route.fulfill({ json: EMPTY_LIBRARY }),
    );
    await page.route("**/api/me/library/import?**", (route) =>
      route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
    );
    await page.route("**/api/me/library/import", (route) =>
      route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
    );

    // GET before POST → 404 (no job yet); after POST → done job.
    const syncHandler = (route: import("@playwright/test").Route) => {
      if (route.request().method() === "POST") {
        postSeen = true;
        return route.fulfill({ status: 202, json: { jobId: 42, status: "pending" } });
      }
      if (!postSeen) {
        return route.fulfill({ status: 404, json: { error: "No sync jobs found" } });
      }
      return route.fulfill({ json: DONE_JOB });
    };
    await page.route("**/api/me/library/sync", syncHandler);
    await page.route("**/api/me/library/sync?**", syncHandler);
    await page.route("**/api/me/library/sync/**", (route) =>
      route.fulfill({ json: DONE_JOB }),
    );

    await page.goto("/lore/library?lens=recent");

    const syncButton = page.getByTestId("library-sync-button");
    await expect(syncButton).toBeVisible({ timeout: 10_000 });
    await expect(syncButton).toContainText("Sync now");
    await expect(syncButton).not.toBeDisabled();

    // Idle label before any job exists.
    await expect(page.getByTestId("library-sync")).toContainText(
      "Export keeps → Spotify",
    );

    // Trigger the sync — the done state must appear after refetch.
    await syncButton.click();
    await expect(page.getByTestId("library-sync")).toContainText("Synced", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("library-sync")).toContainText("2 saved");
  });

  test("running job disables the button and shows the phase label", async ({
    page,
  }) => {
    await installBaseRoutes(page, { syncGet: RUNNING_JOB });
    await page.goto("/lore/library?lens=recent");

    const syncSection = page.getByTestId("library-sync");
    await expect(syncSection).toBeVisible({ timeout: 10_000 });

    // Phase label for "matching" renders in the bar.
    await expect(syncSection).toContainText("Matching on Spotify…");

    // The sync button must be disabled while running.
    const syncButton = page.getByTestId("library-sync-button");
    await expect(syncButton).toBeDisabled();
    await expect(syncButton).toContainText("Syncing…");
  });
});

// ---------------------------------------------------------------------------
// Test suite 4 — canWrite:false 403 path
// ---------------------------------------------------------------------------

test.describe("Library sync — canWrite:false error handling", () => {
  test("shows reconnect error after 403 and does not crash", async ({ page }) => {
    await installBaseRoutes(page);

    // Override sync routes: no existing job, POST → 403.
    const syncHandler = (route: import("@playwright/test").Route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 404, json: { error: "No sync jobs found" } });
      }
      return route.fulfill({
        status: 403,
        json: {
          error: "canWrite:false",
          message:
            "Your Spotify connection doesn't have write access. Reconnect Spotify to grant it.",
          reAuthUrl: null,
        },
      });
    };
    await page.route("**/api/me/library/sync", syncHandler);
    await page.route("**/api/me/library/sync?**", syncHandler);
    await page.route("**/api/me/library/sync/**", (route) =>
      route.fulfill({ status: 404, json: { error: "No sync jobs found" } }),
    );

    await page.goto("/lore/library?lens=recent");

    const syncButton = page.getByTestId("library-sync-button");
    await expect(syncButton).toBeVisible({ timeout: 10_000 });
    await expect(syncButton).toContainText("Sync now");

    // Trigger the sync — error branch must render.
    await syncButton.click();
    const errorMsg = page.getByTestId("library-sync-error");
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });
    await expect(errorMsg).toContainText("write access");

    // The reconnect affordance is offered.
    await expect(page.getByTestId("library-reconnect-spotify")).toBeVisible();

    // Page still functional — sync section rendered, no receipt toggle.
    await expect(page.getByTestId("library-sync")).toBeVisible();
    await expect(page.getByTestId("library-sync-receipt-toggle")).not.toBeVisible();
  });
});
