import { test, expect } from "@playwright/test";

/**
 * End-to-end tests for the LibraryPrompt "Connect your Spotify library" banner
 * (Task 599).
 *
 * The banner lives in AppLayout and is controlled purely by the
 * /api/me/connections response:
 *   - When a Spotify connection is present → banner must NOT appear.
 *   - When no connections exist            → banner MUST appear.
 *
 * All API routes are intercepted so the tests run without a real server or
 * Spotify credentials.
 */

// ---------------------------------------------------------------------------
// Fixtures
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

const CONNECTIONS_EMPTY = { connections: [] };

// ---------------------------------------------------------------------------
// Route-interception helper
// ---------------------------------------------------------------------------

/**
 * Install the minimal stubs needed for LibraryPrompt visibility tests.
 * The `connectionsPayload` argument controls whether Spotify appears connected.
 */
async function installRoutes(
  page: import("@playwright/test").Page,
  connectionsPayload: typeof CONNECTIONS_WITH_SPOTIFY | typeof CONNECTIONS_EMPTY,
) {
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: connectionsPayload }),
  );

  // No in-progress import job — keeps LibraryPrompt visible when there is no
  // Spotify connection (an active job also suppresses the banner).
  await page.route("**/api/me/library/import?**", (route) =>
    route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
  );
  await page.route("**/api/me/library/import", (route) =>
    route.fulfill({ status: 404, json: { error: "No import jobs found" } }),
  );

  // Empty library list — prevents unrelated errors on the library page.
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: { items: [], cursor: null } }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: { items: [], cursor: null } }),
  );
}

// ---------------------------------------------------------------------------
// Suite — LibraryPrompt suppression
// ---------------------------------------------------------------------------

test.describe("LibraryPrompt banner — suppression when Spotify is linked", () => {
  test("banner is NOT visible when /api/me/connections includes Spotify", async ({
    page,
  }) => {
    await installRoutes(page, CONNECTIONS_WITH_SPOTIFY);
    await page.goto("/lore/");

    // The component returns null when a Spotify connection is found, so the
    // element should never be in the DOM (or at least not visible).
    const prompt = page.getByTestId("library-prompt");
    await expect(prompt).not.toBeVisible({ timeout: 10_000 });
  });

  test("banner IS visible when /api/me/connections has no entries", async ({
    page,
  }) => {
    await installRoutes(page, CONNECTIONS_EMPTY);
    await page.goto("/lore/");

    const prompt = page.getByTestId("library-prompt");
    await expect(prompt).toBeVisible({ timeout: 10_000 });
  });
});
