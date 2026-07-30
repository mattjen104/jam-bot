import { test, expect } from "@playwright/test";

/**
 * End-to-end tests for the Spotify library-connect callback flow (Task 587).
 *
 * These tests verify that:
 *   1. Landing on any page with ?library=connected strips the param and kicks
 *      off the import without navigating away.
 *   2. ImportStrip becomes visible once the import job is running.
 *   3. The user stays on the originating route — no redirect to /taste-map.
 *   4. Any deep-linked /taste-map URL redirects to / (home).
 *
 * All API routes are intercepted so the tests run without a real Spotify
 * connection or server.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUNNING_IMPORT_JOB = {
  jobId: 99,
  service: "spotify",
  status: "running",
  phase: "fetching",
  total: 500,
  resolved: 12,
  startedAt: "2025-01-01T12:00:00.000Z",
  finishedAt: null,
  error: null,
};

// ---------------------------------------------------------------------------
// Route-interception helper
// ---------------------------------------------------------------------------

/**
 * Install the minimal stubs needed for the callback flow:
 *   - /api/me/connections → no Spotify (unauthenticated baseline)
 *   - GET /api/me/library/import → 404 until the POST fires, then running job
 *   - POST /api/me/library/import → acknowledge, returns pending job
 *
 * Any extra per-test overrides are applied after this call via page.route()
 * (Playwright uses the most-recently-registered handler that matches).
 */
async function installCallbackRoutes(page: import("@playwright/test").Page) {
  // No Spotify connection — LibraryPrompt would normally be shown, but it
  // doesn't affect LibraryConnectRedirect which only looks at the URL param.
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );

  // No library items.
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: { items: [], cursor: null } }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: { items: [], cursor: null } }),
  );

  // Track whether the import POST has been called.
  let importStarted = false;

  // POST /api/me/library/import?service=spotify — start the job.
  await page.route("**/api/me/library/import?**", async (route) => {
    if (route.request().method() === "POST") {
      importStarted = true;
      return route.fulfill({
        status: 202,
        json: { jobId: 99, status: "pending" },
      });
    }
    // GET — return 404 until the POST fires, then return the running job.
    if (importStarted) {
      return route.fulfill({ json: RUNNING_IMPORT_JOB });
    }
    return route.fulfill({
      status: 404,
      json: { error: "No import jobs found" },
    });
  });

  // Bare GET /api/me/library/import (no query string) — same logic.
  await page.route("**/api/me/library/import", async (route) => {
    if (route.request().method() === "POST") {
      importStarted = true;
      return route.fulfill({
        status: 202,
        json: { jobId: 99, status: "pending" },
      });
    }
    if (importStarted) {
      return route.fulfill({ json: RUNNING_IMPORT_JOB });
    }
    return route.fulfill({
      status: 404,
      json: { error: "No import jobs found" },
    });
  });
}

// ---------------------------------------------------------------------------
// Suite 1 — ?library=connected callback on the home page
// ---------------------------------------------------------------------------

test.describe("?library=connected callback — home page", () => {
  test("strips ?library=connected from the URL without navigating away", async ({
    page,
  }) => {
    await installCallbackRoutes(page);
    await page.goto("/lore/?library=connected");

    // The query param must be gone almost immediately (effect fires on mount).
    await expect(page).not.toHaveURL(/library=connected/, { timeout: 5_000 });

    // We must still be on the home route, not on /taste-map or anywhere else.
    const url = new URL(page.url());
    expect(url.pathname).toMatch(/^\/lore\/?$/);
  });

  test("ImportStrip becomes visible after the callback triggers the import", async ({
    page,
  }) => {
    await installCallbackRoutes(page);
    await page.goto("/lore/?library=connected");

    // ImportStrip renders when the job status is "running" or "pending".
    const strip = page.getByTestId("import-strip");
    await expect(strip).toBeVisible({ timeout: 10_000 });
  });

  test("URL contains no extra query params after the strip", async ({
    page,
  }) => {
    await installCallbackRoutes(page);
    // Navigate with an extra benign param alongside library=connected.
    await page.goto("/lore/?foo=bar&library=connected");

    await expect(page).not.toHaveURL(/library=connected/, { timeout: 5_000 });

    // The unrelated param should survive the strip.
    await expect(page).toHaveURL(/foo=bar/);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — ?library=connected callback on a non-home page
// ---------------------------------------------------------------------------

test.describe("?library=connected callback — archive page", () => {
  test("stays on /archive and strips the param", async ({ page }) => {
    await installCallbackRoutes(page);
    await page.goto("/lore/archive?library=connected");

    await expect(page).not.toHaveURL(/library=connected/, { timeout: 5_000 });

    const url = new URL(page.url());
    expect(url.pathname).toContain("/archive");
  });

  test("ImportStrip is visible on the archive page after callback", async ({
    page,
  }) => {
    await installCallbackRoutes(page);
    await page.goto("/lore/archive?library=connected");

    const strip = page.getByTestId("import-strip");
    await expect(strip).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — /taste-map redirects to home
// ---------------------------------------------------------------------------

test.describe("/taste-map redirect", () => {
  test("navigating to /taste-map redirects to /", async ({ page }) => {
    await installCallbackRoutes(page);
    await page.goto("/lore/taste-map");

    // The wouter Redirect renders immediately — should arrive at home.
    await expect(page).toHaveURL(/\/lore\/?$/, { timeout: 5_000 });

    const url = new URL(page.url());
    expect(url.pathname).not.toContain("taste-map");
  });

  test("navigating to /taste-map does not land on a 404", async ({ page }) => {
    await installCallbackRoutes(page);
    await page.goto("/lore/taste-map");

    await expect(page).toHaveURL(/\/lore\/?$/, { timeout: 5_000 });

    // The NotFound component renders an h1 "404" — it must not be present.
    await expect(page.locator("h1").filter({ hasText: "404" })).not.toBeVisible();
  });
});
