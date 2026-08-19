import { test, expect, type Page } from "@playwright/test";

/**
 * Browser coverage for the admin-only station removal context menu.
 *
 * The component's jsdom tests stub both right-click and window.confirm. These
 * checks use Chromium's real context-menu event and dialog plumbing, while
 * intercepting the station APIs so the refetch after DELETE is deterministic.
 */

const ADMIN_TOKEN = "e2e-admin-token";
const TARGET_SLUG = "lore-target";
const TARGET_NAME = "Lore Target";
const TARGET_ARTIST = "Target Artist";
const BACKUP_SLUG = "lore-backup";
const BACKUP_NAME = "Lore Backup";

function makeStation(slug: string, name: string, id: number) {
  return {
    id,
    slug,
    name,
    org: name,
    city: "Testville",
    country: "US",
    streamUrl: `https://stream.lore-admin-removal.test/${slug}`,
    streamQuality: null,
    streamFormat: "mp3",
    mode: "live",
    homepageUrl: `https://${slug}.example.test`,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    tier: "flagship",
    qualityTier: "proven",
    automationClass: "human",
    nowPlayingSource: "nts_live",
    stationCategories: ["anchor"],
  };
}

const TARGET = makeStation(TARGET_SLUG, TARGET_NAME, 701);
const BACKUP = makeStation(BACKUP_SLUG, BACKUP_NAME, 702);

function makeNowPlaying(stationSlug: string, spinId: number, artist: string) {
  return {
    spinId,
    rawArtist: artist,
    rawTitle: `${artist} Track`,
    source: "nts_live",
    confidence: "recording_id",
    playedAt: new Date().toISOString(),
    artworkUrl: null,
    recording: {
      mbid: `00000000-0000-0000-0000-${String(spinId).padStart(12, "0")}`,
      title: `${artist} Track`,
      artist,
      artistMbid: null,
      artworkUrl: null,
      links: [],
      genres: null,
      releaseYear: new Date().getFullYear(),
      releaseDate: null,
    },
    show: { name: `${artist} Show`, djName: "DJ Test" },
    isFirstSpin: false,
    isLibraryHit: false,
    isArtistHit: true,
    slug: stationSlug,
  };
}

async function installRoutes(page: Page, withAdminToken: boolean) {
  await page.addInitScript((adminToken) => {
    try {
      sessionStorage.setItem("lore:first-run-prompted", "1");
      localStorage.setItem("lore:radioMode", "true");
      if (adminToken) localStorage.setItem("lore_admin_token", adminToken);
    } catch {
      /* ignore */
    }
  }, withAdminToken ? ADMIN_TOKEN : "");

  let stations = [TARGET, BACKUP];

  // Abort stream audio connections and provide anonymous listener data.
  await page.route("https://stream.lore-admin-removal.test/**", (route) =>
    route.abort(),
  );
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({
      json: {
        items: [TARGET, BACKUP].map((station, index) => ({
          stationSlug: station.slug,
          crossings: 3 + index,
          artistCrossings: 2,
          weekCrossings: 5 + index,
          weekArtistCrossings: 3,
          monthCrossings: 10 + index,
          monthArtistCrossings: 5,
          lifetimeCrossings: 20 + index,
          lifetimeArtistCrossings: 12,
          topArtistNames: [station.name],
        })),
      },
    }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [TARGET_ARTIST], hasLibrary: true, hasSeeds: true } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );

  // The mutable response models the parent refetch after a successful DELETE.
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations } }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            slug: TARGET_SLUG,
            nowPlaying: makeNowPlaying(TARGET_SLUG, 1701, TARGET_ARTIST),
          },
          {
            slug: BACKUP_SLUG,
            nowPlaying: makeNowPlaying(BACKUP_SLUG, 1702, "Backup Artist"),
          },
        ],
      },
    }),
  );
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );
  for (const station of [TARGET, BACKUP]) {
    await page.route(`**/api/stations/${station.slug}/now-playing`, (route) =>
      route.fulfill({
        json: {
          station,
          nowPlaying:
            station.slug === TARGET_SLUG
              ? makeNowPlaying(TARGET_SLUG, 1701, TARGET_ARTIST)
              : makeNowPlaying(BACKUP_SLUG, 1702, "Backup Artist"),
        },
      }),
    );
  }
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({
      json: {
        items: [TARGET, BACKUP].map((station, index) => ({
          stationSlug: station.slug,
          runs: [
            {
              runId: 1800 + index,
              show: { name: `${station.name} Show`, djName: "DJ Test", pickerId: null },
              spinCount: 1,
              resolvedCount: 0,
              startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
              endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
            },
          ],
        })),
      },
    }),
  );
  await page.route("**/api/stations/recent-spins**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/stations/artist-frequency**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  await page.route(
    `**/api/admin/stations/${TARGET.id}/removal-preview`,
    (route) =>
      route.fulfill({
        json: {
          id: TARGET.id,
          name: TARGET_NAME,
          slug: TARGET_SLUG,
          source: "radio_browser",
          curated: false,
          spinCount: 7,
        },
      }),
  );
  await page.route(`**/api/admin/stations/${TARGET.id}/permanent`, async (route) => {
    stations = stations.filter((station) => station.id !== TARGET.id);
    await route.fulfill({ status: 204, body: "" });
  });
}

function targetRow(page: Page) {
  return page
    .locator(".fdrow")
    .filter({ hasText: TARGET_NAME })
    .first();
}

test.describe("admin station removal context menu", () => {
  test("does not add a context menu without the admin token", async ({ page }) => {
    await installRoutes(page, false);
    await page.goto("/lore/feed");

    const row = targetRow(page);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click({ button: "right" });

    await expect(
      page.getByRole("menuitem", { name: "Remove from Lore…" }),
    ).toHaveCount(0);
  });

  test("removes the station after preview, confirmation, and DELETE", async ({
    page,
  }) => {
    await installRoutes(page, true);
    await page.goto("/lore/feed");

    const row = targetRow(page);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click({ button: "right" });

    const removeItem = page.getByRole("menuitem", {
      name: "Remove from Lore…",
    });
    await expect(removeItem).toBeVisible();

    const previewRequest = page.waitForRequest(
      (request) =>
        request.url().includes(`/api/admin/stations/${TARGET.id}/removal-preview`) &&
        request.method() === "GET",
    );
    const dialogPromise = page.waitForEvent("dialog");
    const deleteRequest = page.waitForRequest(
      (request) =>
        request.url().includes(`/api/admin/stations/${TARGET.id}/permanent`) &&
        request.method() === "DELETE",
    );
    const menuClick = removeItem.click();
    const preview = await previewRequest;
    expect(preview.headers()["x-admin-token"]).toBe(ADMIN_TOKEN);
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain(`Permanently remove "${TARGET_NAME}" from Lore?`);
    expect(dialog.message()).toContain("7 logged spins will be deleted with it.");
    await dialog.accept();
    await menuClick;

    const deletion = await deleteRequest;
    expect(deletion.headers()["x-admin-token"]).toBe(ADMIN_TOKEN);

    await expect(targetRow(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.locator(".fdrow").filter({ hasText: BACKUP_NAME }),
    ).toBeVisible();
  });
});