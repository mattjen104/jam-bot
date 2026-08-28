import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("lore:first-run-prompted", "1"));
});

test("shows confirmed spins chronologically and keeps attendance separate", async ({ page }) => {
  await page.route("**/api/me/attendance/heard?**", (route) =>
    route.fulfill({
      json: {
        day: "2026-08-28",
        timezone: "America/Los_Angeles",
        dayStart: "2026-08-28T07:00:00.000Z",
        dayEnd: "2026-08-29T07:00:00.000Z",
        partial: false,
        items: [
          {
            attendanceId: 1,
            spinId: 11,
            heardAt: "2026-08-28T15:00:00.000Z",
            rawTitle: "Earlier song",
            rawArtist: "Earlier artist",
            dwellSeconds: 45,
            recording: {
              mbid: "recording-1",
              title: "Earlier song",
              artist: "Earlier artist",
              artistMbid: "artist-1",
              artworkUrl: null,
              durationMs: null,
            },
            station: { id: 1, slug: "station-one", name: "Station One" },
            show: { id: 1, name: "Afternoon Set", djName: null },
          },
          {
            attendanceId: 2,
            spinId: 12,
            heardAt: "2026-08-28T17:30:00.000Z",
            rawTitle: "Later song",
            rawArtist: "Later artist",
            dwellSeconds: 60,
            recording: null,
            station: null,
            show: null,
          },
        ],
      },
    }),
  );

  await page.goto("/lore/heard");
  await expect(page.getByRole("heading", { name: "Heard today" })).toBeVisible();
  const primary = page.getByRole("navigation", { name: "Primary" });
  await expect(primary.getByRole("link", { name: "Feed" })).toBeVisible();
  await expect(primary.getByRole("link", { name: "Heard" })).toHaveAttribute("aria-current", "page");
  await expect(primary.getByRole("link", { name: "Stack" })).toBeVisible();
  await expect(page.getByTestId("heard-row")).toHaveCount(2);
  await expect(page.locator(".heard-row__title").nth(0)).toContainText("Earlier song");
  await expect(page.locator(".heard-row__title").nth(1)).toContainText("Later song");
  await expect(page.getByText("Station One")).toBeVisible();
  await expect(page.getByText("Station unavailable")).toBeVisible();
  await expect(page.getByTestId("heard-intent-note")).toContainText("never saves");
  await expect(page.getByTestId("heard-row").nth(1).getByTestId("heard-play")).toHaveCount(0);
});

test("shows an honest empty state", async ({ page }) => {
  await page.route("**/api/me/attendance/heard?**", (route) =>
    route.fulfill({
      json: {
        day: "2026-08-28",
        timezone: "UTC",
        dayStart: "2026-08-28T00:00:00.000Z",
        dayEnd: "2026-08-29T00:00:00.000Z",
        partial: false,
        items: [],
      },
    }),
  );

  await page.goto("/lore/heard");
  await expect(page.getByTestId("heard-empty")).toContainText("Nothing confirmed today.");
  await expect(page.getByTestId("heard-empty")).toContainText("attendance threshold");
  await expect(page.getByTestId("heard-row")).toHaveCount(0);
});