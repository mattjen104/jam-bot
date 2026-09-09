import { test, expect, type Page } from "@playwright/test";

const STATION = {
  id: 901,
  slug: "scan-context",
  name: "Scan Context FM",
  org: "Scan Context FM",
  city: "Testville",
  country: "US",
  streamUrl: "https://scan-context.example.test/stream",
  streamQuality: null,
  streamFormat: "mp3",
  mode: "live",
  homepageUrl: "https://scan-context.example.test",
  donateUrl: null,
  logoUrl: null,
  attribution: true,
  tags: null,
  stationCategories: ["anchor"],
  mayHaveAds: false,
  votes: 0,
  clickcount: 0,
  upcomingShowCount: 0,
};

function nowPlaying() {
  return {
    spinId: 901,
    rawArtist: "Scan Artist",
    rawTitle: "Scan Track",
    source: "icy",
    confidence: "unresolved",
    playedAt: new Date().toISOString(),
    artworkUrl: null,
    recording: null,
    show: null,
    isFirstSpin: false,
    isLibraryHit: false,
    isArtistHit: false,
  };
}

function historyItem() {
  return {
    id: 901,
    mbid: "scan-history-mbid",
    title: "Archive Track",
    artist: "Archive Artist",
    artworkUrl: null,
    playedAt: new Date(Date.now() - 60_000).toISOString(),
    station: { slug: STATION.slug, name: STATION.name },
    show: null,
    isCrossing: true,
    isFirstPlay: true,
  };
}

async function installRoutes(page: Page) {
  const historyRequests: URL[] = [];

  await page.route("https://scan-context.example.test/**", (route) => route.abort());
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [], hasLibrary: true, hasSeeds: true } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: [STATION] } }),
  );
  await page.route("**/api/stations?**", (route) =>
    route.fulfill({ json: { stations: [STATION] } }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({ json: { items: [{ slug: STATION.slug, nowPlaying: nowPlaying() }] } }),
  );
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );
  await page.route(`**/api/stations/${STATION.slug}/now-playing`, (route) =>
    route.fulfill({ json: { station: STATION, nowPlaying: nowPlaying() } }),
  );
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/stations/recent-spins**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/stations/artist-frequency**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/pickers/**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/player/latest-sets**", (route) =>
    route.fulfill({
      json: {
        items: {
          [STATION.slug]: {
            startedAt: new Date(Date.now() - 3_600_000).toISOString(),
            endedAt: new Date(Date.now() - 1_800_000).toISOString(),
            spinCount: 1,
          },
        },
      },
    }),
  );
  await page.route("**/api/player/history**", async (route) => {
    historyRequests.push(new URL(route.request().url()));
    await route.fulfill({
      json: {
        snapshot: "scan-snapshot",
        items: [historyItem()],
        nextBefore: null,
        nextBeforeId: null,
      },
    });
  });

  return { historyRequests };
}

test.describe("unified Scan session", () => {
  test("Feed reaches archive history through the universal Scan session", async ({
    page,
  }) => {
    const { historyRequests } = await installRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/lore/feed");

    const scanLens = page.getByRole("button", { name: "Scan live" });
    await expect(scanLens).toBeVisible();
    await scanLens.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Scan" });
    await expect(dialog.getByTestId("scan-selection-summary")).toContainText("Archive");
    const history = dialog.getByTestId("dial-history-scanner");
    await history.getByRole("button", { name: "History scan · all time" }).focus();
    await page.keyboard.press("Enter");
    await expect(history).toContainText("Archive Track");
    expect(historyRequests.at(-1)?.searchParams.get("station")).toBeNull();
  });

  test("Feed opens Scan, supports source/filter choices, Escape, and live transport by keyboard", async ({
    page,
  }) => {
    await installRoutes(page);
    await page.goto("/lore/feed");

    const scanLens = page.getByRole("button", { name: "Scan live" });
    await expect(scanLens).toBeVisible();
    await scanLens.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Scan" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Live stations" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByTestId("scan-selection-summary")).toContainText("Live");
    await expect(dialog.getByTestId("scan-selection-summary")).not.toContainText("Archive");
    await expect(dialog.getByRole("group", { name: "Archive filter" })).toBeHidden();
    const liveToggle = dialog.getByRole("button", { name: "Start live scan" });
    await liveToggle.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Stop live scan" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await dialog.getByRole("button", { name: "Archive" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("group", { name: "Archive filter" })).toBeVisible();
    await expect(dialog.getByRole("group", { name: "Live scan controls" })).toBeHidden();
    await dialog.getByRole("button", { name: "First plays" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByTestId("scan-selection-summary")).toContainText("Archive");
    await expect(dialog.getByTestId("scan-selection-summary")).toContainText("First plays");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Scan choices are session-local: closing the sheet must not reset them,
    // but they are intentionally not persisted beyond the mounted page.
    await scanLens.focus();
    await page.keyboard.press("Enter");
    const reopenedDialog = page.getByRole("dialog", { name: "Scan" });
    await expect(reopenedDialog.getByTestId("scan-selection-summary")).toContainText("Archive");
    await expect(reopenedDialog.getByTestId("scan-selection-summary")).toContainText("First plays");
    await expect(reopenedDialog.getByRole("button", { name: "Archive" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(reopenedDialog.getByRole("button", { name: "First plays" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});