import { test, expect } from "@playwright/test";

/**
 * End-to-end tests confirming the NTS "On air" badge renders correctly in the
 * live station view (NowPlaying.tsx, data-testid="on-air-show").
 *
 * The NTS adapter (parseNtsLive) populates a `show` field on each spin that
 * carries `name` (the show title) and an optional `djName` (the host).
 * logSpinIfChanged persists this as a showId on the spins row, which the
 * GET /api/stations/:slug/now-playing route joins back and returns as
 * `nowPlaying.show`.
 *
 * These tests use route interception to inject a controlled fixture for
 * /api/stations/nts-1/now-playing so the badge is always present regardless
 * of what NTS is actually broadcasting at test time.
 *
 * The NowPlaying aside uses xl:hidden, so all tests run at a 1024×768
 * viewport to keep it visible.
 */

const NTS_SLUG = "nts-1";
const SHOW_NAME = "Hessle Audio";
const DJ_NAME = "Ben UFO";

/** Minimal valid StationNowPlayingResponse fixture with a full show+DJ. */
function makeNowPlayingFixture(opts: {
  showName: string;
  djName: string | null;
}) {
  return {
    station: {
      slug: NTS_SLUG,
      name: "NTS 1",
      org: "NTS",
      country: "GB",
      streamUrl: "https://stream-relay-geo.ntslive.net/stream",
      streamQuality: null,
      streamFormat: "aac",
      mode: "live",
      homepageUrl: "https://www.nts.live",
      donateUrl: "https://www.nts.live/membership",
      logoUrl: null,
      attribution: true,
    },
    nowPlaying: {
      rawArtist: opts.djName ?? opts.showName,
      rawTitle: opts.showName,
      source: "nts_live",
      confidence: "unresolved",
      playedAt: new Date().toISOString(),
      artworkUrl: null,
      recording: null,
      show: {
        name: opts.showName,
        djName: opts.djName,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Intercept the per-station now-playing endpoint and serve a fixture.
 * Called before navigating so the route is in place for the first fetch.
 */
async function interceptNowPlaying(
  page: Parameters<Parameters<typeof test>[1]>[0],
  fixture: ReturnType<typeof makeNowPlayingFixture>,
) {
  await page.route(`**/api/stations/${NTS_SLUG}/now-playing`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("NTS 'On air' badge in the live station view", () => {
  test.use({
    viewport: { width: 1024, height: 768 },
  });

  test("badge is visible when the NTS spin carries show + DJ data", async ({
    page,
  }) => {
    const fixture = makeNowPlayingFixture({
      showName: SHOW_NAME,
      djName: DJ_NAME,
    });
    await interceptNowPlaying(page, fixture);

    await page.goto("/lore/");

    // Wait for the station list to load — NTS 1 must appear.
    const ntsCard = page.getByTestId(`station-${NTS_SLUG}`);
    await expect(ntsCard).toBeVisible({ timeout: 10_000 });

    // Select the NTS 1 station to load the NowPlaying sidebar.
    await ntsCard.click();

    // The "On air" badge must appear.
    const badge = page.getByTestId("on-air-show");
    await expect(badge).toBeVisible({ timeout: 10_000 });
  });

  test("show name appears inside the badge", async ({ page }) => {
    const fixture = makeNowPlayingFixture({
      showName: SHOW_NAME,
      djName: DJ_NAME,
    });
    await interceptNowPlaying(page, fixture);

    await page.goto("/lore/");

    const ntsCard = page.getByTestId(`station-${NTS_SLUG}`);
    await expect(ntsCard).toBeVisible({ timeout: 10_000 });
    await ntsCard.click();

    const badge = page.getByTestId("on-air-show");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toContainText(SHOW_NAME);
  });

  test("DJ name appears inside the badge when djName is set", async ({
    page,
  }) => {
    const fixture = makeNowPlayingFixture({
      showName: SHOW_NAME,
      djName: DJ_NAME,
    });
    await interceptNowPlaying(page, fixture);

    await page.goto("/lore/");

    const ntsCard = page.getByTestId(`station-${NTS_SLUG}`);
    await expect(ntsCard).toBeVisible({ timeout: 10_000 });
    await ntsCard.click();

    const badge = page.getByTestId("on-air-show");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toContainText(DJ_NAME);
  });

  test("Follow button renders inside the badge when djName is set", async ({
    page,
  }) => {
    const fixture = makeNowPlayingFixture({
      showName: SHOW_NAME,
      djName: DJ_NAME,
    });
    await interceptNowPlaying(page, fixture);

    await page.goto("/lore/");

    const ntsCard = page.getByTestId(`station-${NTS_SLUG}`);
    await expect(ntsCard).toBeVisible({ timeout: 10_000 });
    await ntsCard.click();

    const badge = page.getByTestId("on-air-show");
    await expect(badge).toBeVisible({ timeout: 10_000 });

    // The FollowButton renders a button with "Follow" (or "Following") text
    // inside the badge whenever djName is non-null.
    const followBtn = badge.getByRole("button", { name: /follow/i });
    await expect(followBtn).toBeVisible();
  });

  test("badge is absent when the spin has no show data", async ({ page }) => {
    // Return a fixture with show: null — the badge must not render.
    await page.route(`**/api/stations/${NTS_SLUG}/now-playing`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          station: makeNowPlayingFixture({ showName: SHOW_NAME, djName: DJ_NAME }).station,
          nowPlaying: {
            rawArtist: "Unknown",
            rawTitle: "Unknown track",
            source: "nts_live",
            confidence: "unresolved",
            playedAt: new Date().toISOString(),
            artworkUrl: null,
            recording: null,
            show: null,
          },
        }),
      });
    });

    await page.goto("/lore/");

    const ntsCard = page.getByTestId(`station-${NTS_SLUG}`);
    await expect(ntsCard).toBeVisible({ timeout: 10_000 });
    await ntsCard.click();

    // Wait for the NowPlaying panel to settle — title appears when np is set.
    await expect(page.getByTestId("now-playing-title")).toBeVisible({
      timeout: 10_000,
    });

    // The badge must not be present when there is no show.
    await expect(page.getByTestId("on-air-show")).not.toBeVisible();
  });

  test("badge renders with show name only when djName is null", async ({
    page,
  }) => {
    // A show without a named DJ — badge shows but no Follow button.
    const fixture = makeNowPlayingFixture({
      showName: SHOW_NAME,
      djName: null,
    });
    await interceptNowPlaying(page, fixture);

    await page.goto("/lore/");

    const ntsCard = page.getByTestId(`station-${NTS_SLUG}`);
    await expect(ntsCard).toBeVisible({ timeout: 10_000 });
    await ntsCard.click();

    const badge = page.getByTestId("on-air-show");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toContainText(SHOW_NAME);

    // Follow button must NOT appear when djName is absent.
    await expect(badge.getByRole("button", { name: /follow/i })).not.toBeVisible();
  });
});
