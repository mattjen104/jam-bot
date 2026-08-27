import { test, expect } from "@playwright/test";

const recording = (
  mbid: string,
  title: string,
  artist: string,
  releaseGroupMbid: string | null,
  addedAt: string,
  provenance: Record<string, unknown>,
) => ({
  mbid,
  addedAt,
  provenance,
  recording: {
    title,
    artist,
    artistMbid: null,
    artworkUrl: null,
    albumTitle: releaseGroupMbid ? `${artist} Album` : null,
    releaseGroupMbid,
    releaseYear: 2024,
    spotifyUrl: null,
  },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("lore:first-run-prompted", "1"));
  await page.route("**/api/me/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/me/library/release-stats?**", (route) =>
    route.fulfill({ json: { stats: { "rg-alpha": { heard: 2, total: 7 } } } }),
  );
  await page.route("**/api/me/taste-seeds/catalog?**", (route) =>
    route.fulfill({
      json: {
        artists: {
          alpha: { artistMbid: null, releases: [] },
          beta: { artistMbid: null, releases: [] },
        },
      },
    }),
  );
  await page.route("**/api/me/taste-seeds", (route) =>
    route.fulfill({ json: { artists: ["Beta", "Alpha"] } }),
  );
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({
      json: {
        items: [
          recording("resolved", "Caught Song", "Zulu Artist", "rg-alpha", "2026-08-26T12:00:00Z", {
            kind: "keep",
            stationName: "WFMU",
            pickerName: "The Lot",
          }),
          recording("unresolved", "Loose Song", "Loose Artist", null, "2025-06-01T12:00:00Z", {
            kind: "import",
            service: "spotify",
            sourceKeepDate: true,
          }),
        ],
        nextCursor: null,
        total: 2,
        keepCount: 2,
        softCount: 0,
        criticCount: 0,
      },
    }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
});

test("renders the honest fanned release crate and preserves controls", async ({ page }) => {
  await page.goto("/lore/library");

  await expect(page.getByRole("heading", { name: "Kept" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Added" })).toBeVisible();
  await expect(page.getByText("Release unknown — no group resolved")).toBeVisible();
  await expect(page.getByText(/Heard 0 of/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play Caught Song" })).toBeVisible();

  const cards = page.locator(".library-crate__card");
  await expect(cards).toHaveCount(4);
  const firstTilt = await cards.nth(0).evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).getPropertyValue("--crate-tilt")),
  );
  const secondTilt = await cards.nth(1).evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).getPropertyValue("--crate-tilt")),
  );
  expect(firstTilt).toBeLessThan(0);
  expect(secondTilt).toBeGreaterThan(0);
  expect(Math.abs(firstTilt)).toBeGreaterThanOrEqual(5);
  expect(Math.abs(firstTilt)).toBeLessThanOrEqual(12);

  await page.getByTestId("library-sort-title").click();
  await expect(page).toHaveURL(/sort=title/);
  await expect(page.getByText("Alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("Beta", { exact: true })).toBeVisible();

  await page.getByTestId("library-unopened-toggle").click();
  await expect(page).toHaveURL(/unopened=1/);
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(page).not.toHaveURL(/unopened=1/);
});