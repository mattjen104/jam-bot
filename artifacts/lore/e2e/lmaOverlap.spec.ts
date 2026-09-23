import { expect, test } from "@playwright/test";

test("Library reads a session-scoped Live Music Archive report without changing albums", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/me/library/lma-overlap", async (route) => {
    requests++;
    await route.fulfill({
      json: {
        checkedAt: "2026-09-23T12:00:00.000Z",
        artistsTotal: 3, artistsChecked: 3, matchedArtists: 2,
        concerts: 5, evaluationConcerts: 2, partial: true,
        artists: [
          { name: "Grateful Dead", artistMbid: "artist-id", committed: true, evaluation: false, status: "matched", concerts: 5, truncated: true, url: "https://archive.org/search?query=Grateful", },
          { name: "Evaluation Band", artistMbid: null, committed: false, evaluation: true, status: "matched", concerts: 2, truncated: false, url: "https://archive.org/search?query=Evaluation", },
          { name: "Other Band", artistMbid: null, committed: false, evaluation: true, status: "unavailable", concerts: 0, truncated: true, url: "https://archive.org/search?query=Other", },
        ],
      },
    });
  });
  await page.goto("/lore/library?section=lma");
  await expect(page.getByTestId("lma-report")).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Check my artists" }).click();
  await expect(page.getByText("5 unique playable concert items")).toBeVisible();
  await expect(page.getByText("2 more from evaluation-only artists.")).toBeVisible();
  await expect(page.getByText("Partial estimate:", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Evaluation Band" })).toHaveAttribute("href", /archive\.org/);
  expect(requests).toBe(1);
});