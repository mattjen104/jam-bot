import { expect, test, type Page, type Route } from "@playwright/test";

const SONG_COUNT = 2_500;
const PREVIEW_INDEX = 1_900;
const MISSING_ART_INDEX = 2_300;

function makeSong(index: number) {
  const ordinal = String(index + 1).padStart(4, "0");
  return {
    mbid: `large-library-${ordinal}`,
    addedAt: new Date(Date.UTC(2026, 8, 10, 0, 0, SONG_COUNT - index)).toISOString(),
    provenance: { kind: "keep", stationName: "Fixture Radio" },
    recording: {
      title: `Fixture Song ${ordinal}`,
      artist: `Fixture Artist ${ordinal}`,
      artistMbid: null,
      artworkUrl: index === MISSING_ART_INDEX
        ? null
        : `https://large-library-art.test/${ordinal}.jpg`,
      albumTitle: `Fixture Album ${ordinal}`,
      releaseGroupMbid: null,
      releaseYear: 2026,
      spotifyUrl: null,
    },
  };
}

const SONGS = Array.from({ length: SONG_COUNT }, (_, index) => makeSong(index));

async function installFixture(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("lore:first-run-prompted", "1");
    HTMLMediaElement.prototype.play = function () {
      return Promise.resolve();
    };
  });

  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { spotifyImportEnabled: false, demoSurface: true } }),
  );
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({
      json: {
        items: SONGS,
        nextCursor: null,
        total: SONG_COUNT,
        keepCount: SONG_COUNT,
        softCount: 0,
        criticCount: 0,
      },
    }),
  );
  await page.route("**/api/stations**", (route) =>
    route.fulfill({ json: { stations: [], items: [] } }),
  );
  await page.route("**/api/me/taste-seeds", (route) =>
    route.fulfill({ json: { artists: [] } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [], hasLibrary: true, hasSeeds: false } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: [], computing: false, failed: false } }),
  );
}

test("defers offscreen artwork in the large visual Songs remote", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installFixture(page);

  const requestedArtwork = new Set<string>();
  await page.route("**/api/art?src=**", async (route) => {
    const source = new URL(route.request().url()).searchParams.get("src");
    if (source) requestedArtwork.add(source);
    await route.fulfill({
      contentType: "image/svg+xml",
      body: "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='#6d6680'/></svg>",
    });
  });

  let announcePreviewRequest: ((route: Route) => void) | undefined;
  let releasePreviewResponse: (() => void) | undefined;
  const previewRequest = new Promise<Route>((resolve) => {
    announcePreviewRequest = resolve;
  });
  const previewResponseReleased = new Promise<void>((resolve) => {
    releasePreviewResponse = resolve;
  });
  await page.route(`**/api/recordings/${SONGS[PREVIEW_INDEX].mbid}/preview`, async (route) => {
    announcePreviewRequest?.(route);
    await previewResponseReleased;
    await route.fulfill({
      json: {
        previewUrl: "https://large-library-preview.test/preview.m4a",
        artworkUrl: null,
        source: "itunes",
      },
    });
  });

  await page.goto("/lore/library?view=songs&layout=grid");

  const remote = page.getByRole("region", { name: "Song remote" });
  const tiles = page.getByTestId("demo-song-remote-tile");
  await expect(remote).toBeVisible({ timeout: 20_000 });
  await expect(tiles).toHaveCount(SONG_COUNT);
  await expect(page.getByRole("button", { name: "Show detailed list" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".library-crate__track, .demo-library__song-row")).toHaveCount(0);

  await expect(tiles.first()).toHaveCSS("content-visibility", "auto");
  await expect(tiles.first()).toHaveCSS("contain-intrinsic-size", /66px/);
  await expect.poll(() => requestedArtwork.size).toBeGreaterThan(0);
  expect(requestedArtwork.size).toBeLessThan(SONG_COUNT / 4);
  expect(requestedArtwork.has(SONGS[PREVIEW_INDEX].recording.artworkUrl!)).toBe(false);

  const previewTile = tiles.nth(PREVIEW_INDEX);
  await previewTile.focus();
  await expect(previewTile).toBeFocused();
  await expect(previewTile).toBeInViewport();
  await previewTile.press("Enter");

  await previewRequest;
  await expect(previewTile).toHaveClass(/is-loading/);
  await expect(previewTile).toHaveAccessibleName(
    `Loading preview of ${SONGS[PREVIEW_INDEX].recording.title} by ${SONGS[PREVIEW_INDEX].recording.artist}`,
  );
  releasePreviewResponse?.();
  await expect(previewTile).toHaveClass(/is-selected/);
  await expect(previewTile).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() =>
    requestedArtwork.has(SONGS[PREVIEW_INDEX].recording.artworkUrl!),
  ).toBe(true);

  const missingArtTile = tiles.nth(MISSING_ART_INDEX);
  await missingArtTile.focus();
  await expect(missingArtTile).toBeFocused();
  await expect(missingArtTile).toBeInViewport();
  await expect(missingArtTile.locator(".demo-library-remote__fallback")).toContainText(
    SONGS[MISSING_ART_INDEX].recording.title,
  );
  await expect(missingArtTile.locator("img")).toHaveCount(0);
});