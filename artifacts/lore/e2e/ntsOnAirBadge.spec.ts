import { test, expect } from "@playwright/test";

/**
 * End-to-end tests confirming on-air show + DJ attribution renders on the
 * dial front door (DialView.tsx), the surface that replaced the old
 * StationList / NowPlaying sidebar.
 *
 * A station is "live" when GET /api/stations/now-playing reports a recent
 * spin for it (useDialData liveBySlug). The current schedule run's
 * show.name / show.djName drive the attribution sentence rendered in the
 * "DJs on air" band ("<DJ> · <Show>" / "<DJ> is on air").
 *
 * All API routes are intercepted so the tests run deterministically
 * regardless of what NTS is actually broadcasting at test time.
 */

const NTS_SLUG = "nts-1";
const SHOW_NAME = "Hessle Audio";
const DJ_NAME = "Ben UFO";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATION = {
  id: 1,
  slug: NTS_SLUG,
  name: "NTS 1",
  org: "NTS",
  city: "London",
  country: "GB",
  streamUrl: "https://stream-relay-geo.ntslive.net/stream",
  streamQuality: null,
  streamFormat: "aac",
  mode: "live",
  homepageUrl: "https://www.nts.live",
  donateUrl: "https://www.nts.live/membership",
  logoUrl: null,
  attribution: true,
  tags: null,
  mayHaveAds: false,
  votes: 0,
  clickcount: 0,
  upcomingShowCount: 0,
};

/** A fresh unresolved spin — makes the station count as live on the dial. */
function makeNowPlaying() {
  return {
    spinId: 900,
    rawArtist: "Some Artist",
    rawTitle: "Some Track",
    source: "nts_live",
    confidence: "unresolved",
    playedAt: new Date().toISOString(),
    artworkUrl: null,
    recording: null,
    show: { name: SHOW_NAME, djName: DJ_NAME },
    isFirstSpin: false,
    isLibraryHit: false,
    isArtistHit: false,
  };
}

/** Today's schedule: one run bracketing "now", attributed to show + DJ. */
function makeSchedule(opts: { djName: string | null; showName?: string }) {
  const now = Date.now();
  return {
    items: [
      {
        stationSlug: NTS_SLUG,
        runs: [
          {
            runId: 1,
            show: {
              name: opts.showName ?? SHOW_NAME,
              djName: opts.djName,
              pickerId: null,
            },
            spinCount: 4,
            resolvedCount: 0,
            startedAt: new Date(now - 60 * 60 * 1000).toISOString(),
            endedAt: new Date(now + 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route-interception helper
// ---------------------------------------------------------------------------

async function installDialRoutes(
  page: import("@playwright/test").Page,
  opts: {
    /** Live pulse for the station (null → station is not live). */
    live: boolean;
    /** Schedule fixture (null → empty schedule, no attribution). */
    schedule: ReturnType<typeof makeSchedule> | null;
  },
) {
  // Soft-fetched listener endpoints — anonymous defaults.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [], hasLibrary: false, hasSeeds: false } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  // Station directory — a single NTS station.
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: [STATION] } }),
  );

  // Live pulse list — drives liveBySlug.
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: { items: opts.live ? [{ slug: NTS_SLUG, nowPlaying: makeNowPlaying() }] : [] },
    }),
  );

  // SSE stream — fulfill with an empty event stream (REST pulse is enough).
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );

  // Per-station now-playing (player dock / active station).
  await page.route(`**/api/stations/${NTS_SLUG}/now-playing`, (route) =>
    route.fulfill({
      json: { station: STATION, nowPlaying: opts.live ? makeNowPlaying() : null },
    }),
  );

  // Schedule (today + yesterday) — the attribution source.
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({ json: opts.schedule ?? { items: [] } }),
  );

  // Recent spins / artist frequency — empty is safe.
  await page.route("**/api/stations/recent-spins**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/stations/artist-frequency**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  // Anything else under /api — harmless empty.
  await page.route("**/api/pickers/**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("On-air show + DJ attribution on the dial front door", () => {
  test("live station with attributed show renders in the DJs-on-air band", async ({
    page,
  }) => {
    await installDialRoutes(page, {
      live: true,
      schedule: makeSchedule({ djName: DJ_NAME }),
    });
    await page.goto("/lore/");

    // The DJs-on-air zone label must appear (attributed live show, no crossings).
    await expect(page.getByText("DJs on air")).toBeVisible({ timeout: 15_000 });

    // The row carries the DJ credit and the show name in one sentence
    // ("Ben UFO selected … on Hessle Audio").
    const row = page.getByRole("button", { name: new RegExp(`${DJ_NAME}.*${SHOW_NAME}`) });
    await expect(row).toBeVisible();
  });

  test("DJ credit is absent when the schedule has no attribution", async ({
    page,
  }) => {
    await installDialRoutes(page, { live: true, schedule: null });
    await page.goto("/lore/");

    // Dial settles into the first-run sidebar (no library, no seeds): the
    // live station renders as an onboarding sentence. (The old "Know who
    // you're looking for?" manual-entry section was removed from the Dial.)
    await expect(
      page.getByText(STATION.name, { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // …and with no schedule attribution there is no DJ credit.
    await expect(page.getByText(DJ_NAME)).not.toBeVisible();
    await expect(page.getByText("DJs on air")).not.toBeVisible();
  });

  test("offline station never claims an on-air DJ", async ({ page }) => {
    // Schedule attributes the show, but the station has no live pulse.
    await installDialRoutes(page, {
      live: false,
      schedule: makeSchedule({ djName: DJ_NAME }),
    });
    await page.goto("/lore/");

    // With no live pulse the first-run sidebar reports an empty dial. (The
    // old "Know who you're looking for?" manual-entry section was removed.)
    await expect(
      page.getByText("No stations on air right now.", { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // No live pulse → no DJs-on-air band, no live DJ credit.
    await expect(page.getByText("DJs on air")).not.toBeVisible();
    await expect(page.getByText(DJ_NAME)).not.toBeVisible();
  });
});
