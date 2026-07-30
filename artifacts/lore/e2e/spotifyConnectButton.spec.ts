import { test, expect } from "@playwright/test";

/**
 * End-to-end tests for the LibraryPrompt "Connect" button (Task 598).
 *
 * Verifies that clicking Connect in data-testid="library-prompt":
 *   1. Does NOT cause a full-page navigation (page.url() stays on the same route).
 *   2. Calls the OAuth start endpoint POST /api/me/connect/spotify/start.
 *   3. Opens a new popup/tab rather than replacing the current page.
 *
 * All API routes are intercepted so the tests run without a real Spotify
 * connection or server.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimum stubs needed to make LibraryPrompt visible (no Spotify connection,
 *  no running import job). */
async function installPromptRoutes(page: import("@playwright/test").Page) {
  // No Spotify connection — LibraryPrompt renders.
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );

  // No existing import job — suppress ImportStrip and the job guard in LibraryPrompt.
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

  // Empty library — prevents unrelated data errors on the home page.
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
}

// ---------------------------------------------------------------------------
// Suite — Connect button behaviour
// ---------------------------------------------------------------------------

test.describe("LibraryPrompt Connect button", () => {
  test("clicking Connect does not navigate the main page", async ({ page, context }) => {
    await installPromptRoutes(page);

    // Stub the OAuth start endpoint so the async fetch resolves successfully.
    await page.route("**/api/me/connect/spotify/start", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          json: { url: "https://accounts.spotify.com/authorize?fake=1" },
        });
      }
      return route.continue();
    });

    await page.goto("/lore/");

    // Confirm LibraryPrompt is visible before we click anything.
    const prompt = page.getByTestId("library-prompt");
    await expect(prompt).toBeVisible({ timeout: 8_000 });

    // Record the current URL so we can assert it doesn't change.
    const urlBefore = page.url();

    // startSpotifyLibraryConnect calls window.open("", "_blank") synchronously,
    // so a popup may be opened. Register a listener so Playwright doesn't raise
    // an unhandled popup error; we don't need to interact with it.
    const popupPromise = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);

    await prompt.getByRole("button", { name: "Connect" }).click();

    // Wait a tick for the async fetch inside startSpotifyLibraryConnect to settle.
    await page.waitForTimeout(1_000);

    // ── Assertion 1: main page URL is unchanged ───────────────────────────
    expect(page.url()).toBe(urlBefore);

    // Silently resolve the popup promise (it may or may not have opened one).
    await popupPromise;
  });

  test("clicking Connect calls POST /api/me/connect/spotify/start", async ({
    page,
    context,
  }) => {
    await installPromptRoutes(page);

    let connectEndpointCalled = false;

    await page.route("**/api/me/connect/spotify/start", (route) => {
      if (route.request().method() === "POST") {
        connectEndpointCalled = true;
        return route.fulfill({
          status: 200,
          json: { url: "https://accounts.spotify.com/authorize?fake=1" },
        });
      }
      return route.continue();
    });

    await page.goto("/lore/");

    const prompt = page.getByTestId("library-prompt");
    await expect(prompt).toBeVisible({ timeout: 8_000 });

    // Absorb any popup so Playwright doesn't treat it as an error.
    context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);

    await prompt.getByRole("button", { name: "Connect" }).click();

    // Wait for the fetch to fire.
    await page.waitForTimeout(1_000);

    // ── Assertion 2: the start endpoint was called ─────────────────────────
    expect(connectEndpointCalled).toBe(true);
  });

  test("Connect opens a new tab, not a navigation of the current page", async ({
    page,
    context,
  }) => {
    await installPromptRoutes(page);

    // Return a fake OAuth URL so the popup has something to navigate to.
    await page.route("**/api/me/connect/spotify/start", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          json: { url: "https://accounts.spotify.com/authorize?fake=1" },
        });
      }
      return route.continue();
    });

    await page.goto("/lore/");

    const prompt = page.getByTestId("library-prompt");
    await expect(prompt).toBeVisible({ timeout: 8_000 });

    const urlBefore = page.url();

    // Listen for the new popup page opened by window.open("", "_blank").
    const popupPromise = context.waitForEvent("page", { timeout: 5_000 });

    await prompt.getByRole("button", { name: "Connect" }).click();

    // ── Assertion 3a: a popup was opened (not a same-page navigation) ──────
    const popup = await popupPromise;
    expect(popup).not.toBeNull();

    // ── Assertion 3b: the originating page is still on the same URL ────────
    await page.waitForTimeout(500);
    expect(page.url()).toBe(urlBefore);
  });

  test("Connect button is not visible when Spotify is already connected", async ({
    page,
  }) => {
    // Override connections to include Spotify — prompt must be hidden.
    await page.route("**/api/me/connections", (route) =>
      route.fulfill({
        json: {
          connections: [
            { service: "spotify", canWrite: true, connectedAt: "2025-01-01T00:00:00Z", lastImportAt: null },
          ],
        },
      }),
    );
    await page.route("**/api/me/library/import?**", (route) =>
      route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
    );
    await page.route("**/api/me/library/import", (route) =>
      route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
    );
    await page.route("**/api/me/library?**", (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    );

    await page.goto("/lore/");

    // The prompt must not appear when the user is already connected.
    const prompt = page.getByTestId("library-prompt");
    await expect(prompt).not.toBeVisible({ timeout: 5_000 });
  });
});
