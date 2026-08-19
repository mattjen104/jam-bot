import { expect, test, type Route } from "@playwright/test";

const ADMIN_TOKEN = "admin-health-browser-test-token";

const IDLE_REPROBE_STATUS = {
  running: false,
  total: 0,
  probed: 0,
  recovered: 0,
  stillBad: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

const RUNNING_REPROBE_STATUS = {
  running: true,
  total: 2,
  probed: 1,
  recovered: 1,
  stillBad: 0,
  startedAt: "2026-08-19T12:00:00.000Z",
  finishedAt: null,
  error: null,
};

const FINISHED_REPROBE_STATUS = {
  running: false,
  total: 2,
  probed: 2,
  recovered: 1,
  stillBad: 1,
  startedAt: "2026-08-19T12:00:00.000Z",
  finishedAt: "2026-08-19T12:00:10.000Z",
  error: null,
};

const SCOUT_REPORT = {
  available: true,
  stations: [
    {
      stationId: 3101,
      stationName: "Crossing Radio",
      samples: 4,
      recognitions: 3,
      crossings: 1,
      firstPlays: 0,
      lastSampledAt: "2026-08-19T11:58:00.000Z",
      flag: "promote",
    },
    {
      stationId: 3102,
      stationName: "No Signal FM",
      samples: 8,
      recognitions: 0,
      crossings: 0,
      firstPlays: 0,
      lastSampledAt: "2026-08-19T11:57:00.000Z",
      flag: "remove",
    },
    {
      stationId: 3103,
      stationName: "Learning Radio",
      samples: 3,
      recognitions: 1,
      crossings: 0,
      firstPlays: 1,
      lastSampledAt: "2026-08-19T11:56:00.000Z",
      flag: "scouting",
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    localStorage.setItem("lore_admin_token", token);
  }, ADMIN_TOKEN);
});

async function fulfillCoreHealth(route: Route): Promise<void> {
  const url = new URL(route.request().url()).pathname;
  if (url.endsWith("/feed-freshness-health")) {
    return route.fulfill({
      json: {
        monitoringSince: "2026-08-19T11:00:00.000Z",
        staleCount: 0,
        stations: [],
      },
    });
  }
  if (url.endsWith("/spinitron-web-health")) {
    return route.fulfill({ json: { staleCount: 0, stations: [] } });
  }
  if (url.endsWith("/release-year-health")) {
    return route.fulfill({
      json: {
        totalNull: 0,
        inQueue: 0,
        permMiss: 0,
        ineligible: 0,
        lastCheckedAt: null,
        datePending: 0,
        dateInQueue: 0,
        datePermMiss: 0,
        dateLastCheckedAt: null,
      },
    });
  }
  return route.fulfill({ status: 404, json: { error: `Unhandled health route: ${url}` } });
}

test.describe("Admin health recovery tools", () => {
  test("keeps polling an active re-probe after reload and shows its final result", async ({
    page,
  }) => {
    let started = false;
    let reloaded = false;
    let postCount = 0;
    let reloadStatusReads = 0;
    const adminHeaders: string[] = [];

    await page.route("**/api/admin/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url()).pathname;
      const token = request.headers()["x-admin-token"];
      if (token) adminHeaders.push(token);

      if (url.endsWith("/radio-browser/bulk-reprobe") && request.method() === "POST") {
        started = true;
        postCount += 1;
        return route.fulfill({
          status: 202,
          json: { started: true, status: RUNNING_REPROBE_STATUS },
        });
      }
      if (url.endsWith("/radio-browser/bulk-reprobe/status")) {
        if (!started) return route.fulfill({ json: IDLE_REPROBE_STATUS });
        if (!reloaded) return route.fulfill({ json: RUNNING_REPROBE_STATUS });
        reloadStatusReads += 1;
        return route.fulfill({
          json: reloadStatusReads === 1 ? RUNNING_REPROBE_STATUS : FINISHED_REPROBE_STATUS,
        });
      }
      if (url.endsWith("/fingerprint-scout/report")) {
        return route.fulfill({ json: SCOUT_REPORT });
      }
      return fulfillCoreHealth(route);
    });

    await page.goto("/lore/admin/health");

    const start = page.getByTestId("bulk-reprobe-start");
    await expect(start).toBeVisible();
    await start.click();
    await expect(start).toBeDisabled();
    await expect(start).toHaveText("Re-probing…");
    await expect(page.getByTestId("bulk-reprobe-summary")).toContainText(
      "1 of 2 probed · 1 recovered",
    );

    // The server-side run continues independently of this browser. On reload,
    // the initial status request must restore the in-progress UI and arm the
    // component's normal 5-second status poll.
    reloaded = true;
    await page.reload();
    await expect(start).toHaveText("Re-probing…");
    await expect(page.getByTestId("bulk-reprobe-summary")).toContainText(
      "1 of 2 probed · 1 recovered",
    );

    // The second reload-time status response arrives through the real interval
    // poll. If the reload path does not arm polling, this assertion times out.
    await expect(page.getByTestId("bulk-reprobe-summary")).toContainText(
      "Done: 2 probed · 1 recovered · 1 still unsupported",
      { timeout: 8_000 },
    );
    await expect(start).toHaveText("Re-probe all unsupported");
    await expect(start).not.toBeDisabled();

    expect(postCount).toBe(1);
    expect(reloadStatusReads).toBeGreaterThanOrEqual(2);
    expect(adminHeaders).toContain(ADMIN_TOKEN);
  });

  test("renders promote, remove, and still-scouting verdicts from the admin report", async ({
    page,
  }) => {
    await page.route("**/api/admin/**", async (route) => {
      const url = new URL(route.request().url()).pathname;
      if (url.endsWith("/radio-browser/bulk-reprobe/status")) {
        return route.fulfill({ json: IDLE_REPROBE_STATUS });
      }
      if (url.endsWith("/fingerprint-scout/report")) {
        return route.fulfill({ json: SCOUT_REPORT });
      }
      return fulfillCoreHealth(route);
    });

    await page.goto("/lore/admin/health");

    const report = page.getByTestId("scout-report-section");
    await expect(report).toBeVisible();
    await expect(page.getByTestId("scout-row-3101")).toContainText("Promote candidate");
    await expect(page.getByTestId("scout-row-3102")).toContainText("Remove candidate");
    await expect(page.getByTestId("scout-row-3103")).toContainText("Still scouting");
  });
});