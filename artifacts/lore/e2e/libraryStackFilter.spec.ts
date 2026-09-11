import { expect, test, type Page } from "@playwright/test";

function libraryItem(
  mbid: string,
  title: string,
  artist: string,
  albumTitle: string,
  addedAt: string,
) {
  return {
    mbid,
    addedAt,
    provenance: { kind: "keep" },
    recording: {
      title,
      artist,
      artistMbid: null,
      artworkUrl: null,
      albumTitle,
      releaseGroupMbid: null,
      releaseYear: 2026,
      spotifyUrl: null,
    },
  };
}

async function installRoutes(page: Page) {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { spotifyImportEnabled: false, demoSurface: false } }),
  );
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/taste-seeds", (route) =>
    route.fulfill({ json: { artists: [] } }),
  );
  await page.route("**/api/me/taste-seeds/catalog?**", (route) =>
    route.fulfill({ json: { artists: {} } }),
  );
  await page.route("**/api/me/library/release-stats?**", (route) =>
    route.fulfill({ json: { stats: {} } }),
  );

  let releaseSecondPage!: () => void;
  const secondPageReleased = new Promise<void>((resolve) => {
    releaseSecondPage = resolve;
  });
  let secondPageRequested!: () => void;
  const secondPageRequest = new Promise<void>((resolve) => {
    secondPageRequested = resolve;
  });

  await page.route("**/api/me/library?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("cursor")) {
      secondPageRequested();
      await secondPageReleased;
      await route.fulfill({
        json: {
          items: [
            libraryItem(
              "stack-filter-page-two",
              "Pagination Anthem",
              "Faraway Ensemble",
              "Late Arrival",
              "2026-09-09T12:00:00Z",
            ),
          ],
          nextCursor: null,
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        items: [
          libraryItem(
            "stack-filter-alpha",
            "Needle Song",
            "Signal Choir",
            "Midnight Atlas",
            "2026-09-11T12:00:00Z",
          ),
          libraryItem(
            "stack-filter-beta",
            "Copper Wire",
            "Harbor Static",
            "Daylight Manual",
            "2026-09-10T12:00:00Z",
          ),
        ],
        nextCursor: "page-2",
        total: 3,
        keepCount: 3,
        softCount: 0,
        criticCount: 0,
      },
    });
  });

  return { secondPageRequest, releaseSecondPage };
}

test("filters Stack albums, clears the query, shows no matches, and keeps paging", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("lore:first-run-prompted", "1");
  });
  const { secondPageRequest, releaseSecondPage } = await installRoutes(page);

  await page.goto("/lore/library?view=songs");
  const filter = page.getByTestId("library-stack-filter");
  const rows = page.getByTestId("library-crate-track");

  await expect(rows).toHaveCount(2);
  await secondPageRequest;

  await filter.fill("Midnight Atlas");
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("Needle Song", { exact: true })).toBeVisible();

  await filter.fill("Harbor Static");
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("Copper Wire", { exact: true })).toBeVisible();

  await filter.fill("Pagination Anthem");
  await expect(rows).toHaveCount(0);
  releaseSecondPage();
  await expect(page.getByText("Pagination Anthem", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(1);

  await page.getByRole("button", { name: "Clear Stack filter" }).click();
  await expect(filter).toHaveValue("");
  await expect(rows).toHaveCount(3);

  await filter.fill("No Such Album");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("No albums match “No Such Album”.")).toBeVisible();
});