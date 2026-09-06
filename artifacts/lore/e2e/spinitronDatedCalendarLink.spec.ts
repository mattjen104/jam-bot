import { expect, test, type Page } from "@playwright/test";

const RUN_ID = 615001;
const CALLSIGN = "WXYC";
const RUN_DATE = "2026-09-04";
const PUBLIC_CALENDAR_URL =
  `https://spinitron.com/${CALLSIGN}/calendar/date/${RUN_DATE}`;

async function installRoutes(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === `/api/archive/station-runs/${RUN_ID}`) {
      return route.fulfill({
        json: {
          station: {
            slug: "wxyc",
            name: "WXYC",
            stationClass: "college",
          },
          run: {
            runId: RUN_ID,
            date: RUN_DATE,
            show: { name: "Friday Signal", djName: "Test DJ" },
            spinCount: 1,
            resolvedCount: 0,
            sourceUrl: PUBLIC_CALENDAR_URL,
            startedAt: `${RUN_DATE}T18:00:00.000Z`,
            endedAt: `${RUN_DATE}T18:03:00.000Z`,
          },
          tracks: [
            {
              position: 0,
              playedAt: `${RUN_DATE}T18:00:00.000Z`,
              rawArtist: "Fixture Artist",
              rawTitle: "Fixture Track",
              confidence: "text",
              recording: null,
            },
          ],
        },
      });
    }

    if (path === `/api/archive/station-runs/${RUN_ID}/insights`) {
      return route.fulfill({
        json: {
          insights: {
            genreBreakdown: null,
            discoveryScore: null,
          },
        },
      });
    }

    if (path === `/api/archive/station-runs/${RUN_ID}/playlist`) {
      return route.fulfill({ json: { tracks: [] } });
    }

    return route.fulfill({ status: 404, json: { error: "Not found" } });
  });

  await page.context().route(PUBLIC_CALENDAR_URL, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Public Spinitron calendar</title>",
    }),
  );
}

test("opens a no-key station run's dated public Spinitron calendar", async ({
  page,
}) => {
  await installRoutes(page);
  await page.goto(`/lore/archive/station-runs/${RUN_ID}`);

  const sourceLink = page.getByTestId("run-source-link");
  await expect(sourceLink).toBeVisible();
  await expect(sourceLink).toHaveAttribute("href", PUBLIC_CALENDAR_URL);

  const href = await sourceLink.getAttribute("href");
  expect(href).toContain(`/${CALLSIGN}/`);
  expect(href).toContain(`/date/${RUN_DATE}`);
  expect(href).not.toContain("/api/");
  expect(href).not.toContain("/lore/");

  const popupPromise = page.waitForEvent("popup");
  await sourceLink.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");

  expect(popup.url()).toBe(PUBLIC_CALENDAR_URL);
  await expect(popup).toHaveTitle("Public Spinitron calendar");
});