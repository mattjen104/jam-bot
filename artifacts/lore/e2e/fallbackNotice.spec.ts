import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end tests for the "hear it in context" → fallback notice flow.
 *
 * Scenario: a user arrives at a Song page, clicks "Hear it in context" to
 * replay an archive run starting at that song, but the song's MBID is not
 * present in the run's resolved tracklist (e.g. the spin was unresolved or
 * the song was logged after the run was indexed). The app must show an amber
 * fallback notice explaining the situation and must hide it when the user
 * dismisses it.
 *
 * Both archive page kinds carry the same notice:
 *   - StationRun  (/archive/station-runs/:runId)
 *   - PickerRun   (/archive/selector-runs/:runId — the canonical route;
 *     /archive/picker-runs/:runId is a legacy redirect that DROPS the query
 *     string, so deep links with ?play=1&from= must use the canonical path)
 *
 * All API routes are intercepted with fixtures, so the spec has NO live-data
 * dependence: run IDs, MBIDs, and tracklists are fixed by construction and
 * cannot drift with the dev database.
 */

const REAL_MBID = "163a820c-e2a2-4219-aa90-8b528f31754d";
const OTHER_MBID = "9d7af8d4-1111-4a3b-9d11-000000000002";
const ABSENT_MBID = "nonexistent-mbid-xyz";
const STATION_RUN_ID = 4101;
const PICKER_RUN_ID = 4202;
const PICKER_HANDLE = "nts-floating-points";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const recordingFixture = {
  mbid: REAL_MBID,
  title: "Go Your Own Way",
  artist: "Fleetwood Mac",
  artistMbid: "bd13909f-1c29-4c27-a874-d4aaf27c5b1a",
  durationMs: 218000,
  artworkUrl: null,
  links: [],
};

const spinsFixture = {
  mbid: REAL_MBID,
  spins: [
    {
      playedAt: "2026-07-01T12:00:00.000Z",
      source: "spinitron",
      confidence: "recording_id",
      station: { name: "Test FM", slug: "test-fm" },
      show: { name: "Morning Drift", djName: "DJ Fixture" },
      runId: STATION_RUN_ID,
    },
  ],
};

const stationRunFixture = {
  station: { slug: "test-fm", name: "Test FM", stationClass: "community" },
  run: {
    runId: STATION_RUN_ID,
    date: "2026-07-01",
    show: { name: "Morning Drift", djName: "DJ Fixture" },
    spinCount: 2,
    resolvedCount: 2,
    sourceUrl: null,
    startedAt: "2026-07-01T12:00:00.000Z",
    endedAt: "2026-07-01T14:00:00.000Z",
  },
  tracks: [
    {
      position: 1,
      playedAt: "2026-07-01T12:00:00.000Z",
      rawArtist: "Fleetwood Mac",
      rawTitle: "Go Your Own Way",
      confidence: "recording_id",
      recording: {
        mbid: REAL_MBID,
        title: "Go Your Own Way",
        artist: "Fleetwood Mac",
        artworkUrl: null,
        links: [],
      },
    },
    {
      position: 2,
      playedAt: "2026-07-01T12:04:00.000Z",
      rawArtist: "Someone Else",
      rawTitle: "Another Song",
      confidence: "text",
      recording: null,
    },
  ],
};

const pickerRunFixture = {
  picker: { handle: PICKER_HANDLE, name: "Floating Points" },
  run: {
    runId: PICKER_RUN_ID,
    title: "Late Night Selections",
    pickedAt: "2026-07-02T22:00:00.000Z",
    sourceUrl: null,
  },
  tracks: [
    {
      position: 1,
      pickedAt: "2026-07-02T22:00:00.000Z",
      rawArtist: "Resolved Artist",
      rawTitle: "Resolved Pick",
      confidence: "recording_id",
      recording: {
        mbid: OTHER_MBID,
        title: "Resolved Pick",
        artist: "Resolved Artist",
        artworkUrl: null,
        links: [],
      },
    },
    {
      position: 2,
      pickedAt: "2026-07-02T22:05:00.000Z",
      rawArtist: "Unresolved Artist",
      rawTitle: "Unresolved Pick",
      confidence: "text",
      recording: null,
    },
  ],
};

const emptyInsights = (runId: number) => ({
  runId,
  insights: { genreBreakdown: null, discoveryScore: null },
});

// ---------------------------------------------------------------------------
// Route interception — most-recently-registered handler wins, so the broad
// catch-all goes FIRST and specific fixtures after it.
// ---------------------------------------------------------------------------

async function interceptApi(page: Page): Promise<void> {
  // Catch-all: any API endpoint not explicitly fixtured returns an empty
  // object so no request ever escapes to the live server.
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));

  // PlayerProvider polls the webplayer on-air read model and dereferences
  // `.items`, so the catch-all's `{}` would crash the whole app shell.
  await page.route("**/api/player/onair", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  // ReplayPlaylistPanel dereferences `.targets` from the replay
  // playlist-targets read model.
  await page.route("**/api/replay/*/playlist-targets", (route) =>
    route.fulfill({ json: { targets: [] } }),
  );

  // Song page endpoints
  await page.route(`**/api/recordings/${REAL_MBID}`, (route) =>
    route.fulfill({ json: recordingFixture }),
  );
  await page.route(`**/api/recordings/${REAL_MBID}/spins`, (route) =>
    route.fulfill({ json: spinsFixture }),
  );
  await page.route(`**/api/recordings/${REAL_MBID}/segues`, (route) =>
    route.fulfill({ json: { mbid: REAL_MBID, next: [] } }),
  );
  await page.route(`**/api/recordings/${REAL_MBID}/picks`, (route) =>
    route.fulfill({ json: { mbid: REAL_MBID, picks: [] } }),
  );
  // EntryLadder dereferences `entry.picks`, so the catch-all `{}` would crash
  // the Song page before spin-replay links render.
  await page.route(`**/api/recordings/${REAL_MBID}/entry**`, (route) =>
    route.fulfill({
      json: { rung: "empty", framing: null, picks: [], invitation: null },
    }),
  );
  await page.route(`**/api/recordings/${REAL_MBID}/knowledge`, (route) =>
    route.fulfill({ json: { knowledge: null, album: null, claims: [] } }),
  );
  await page.route(`**/api/recordings/${REAL_MBID}/preview`, (route) =>
    route.fulfill({
      json: { mbid: REAL_MBID, previewUrl: null, artworkUrl: null, source: null },
    }),
  );

  // StationRun archive page
  await page.route(
    `**/api/archive/station-runs/${STATION_RUN_ID}`,
    (route) => route.fulfill({ json: stationRunFixture }),
  );
  await page.route(
    `**/api/archive/station-runs/${STATION_RUN_ID}/insights`,
    (route) => route.fulfill({ json: emptyInsights(STATION_RUN_ID) }),
  );

  // PickerRun archive page
  await page.route(`**/api/archive/picker-runs/${PICKER_RUN_ID}`, (route) =>
    route.fulfill({ json: pickerRunFixture }),
  );
  await page.route(
    `**/api/archive/picker-runs/${PICKER_RUN_ID}/insights`,
    (route) => route.fulfill({ json: emptyInsights(PICKER_RUN_ID) }),
  );
}

test.beforeEach(async ({ page }) => {
  await interceptApi(page);
});

// ---------------------------------------------------------------------------
// Integrated flow: Song page → deep link with absent MBID → fallback notice
// ---------------------------------------------------------------------------

test.describe("Song page → 'Hear it in context' → fallback notice (integrated flow)", () => {
  test(
    "discovers run URL from Song page link, navigates with absent from= MBID, " +
      "sees fallback notice, dismisses it",
    async ({ page }) => {
      // Step 1: Land on the Song page for the fixtured recording
      await page.goto(`/lore/song/${REAL_MBID}`);

      // Wait for the "Hear it in context" link in the spin history section
      const spinReplayLink = page.getByTestId("spin-replay-0");
      await expect(spinReplayLink).toBeVisible({ timeout: 10_000 });

      // Step 2: Read the href the Song page generated — it encodes the run ID
      const href = await spinReplayLink.getAttribute("href");
      expect(href).toMatch(/\/archive\/station-runs\/\d+/);
      expect(href).toContain(`from=${REAL_MBID}`);

      // Step 3: Navigate to the SAME run but swap the from= MBID for one that
      // is guaranteed absent from any run's resolved tracklist.  This is the
      // scenario where the song was unresolved and the link would have led here.
      const runPath = href!.replace(`from=${REAL_MBID}`, `from=${ABSENT_MBID}`);
      await page.goto(runPath);

      // Wait for the archive run page to finish loading
      await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

      // Step 4: Assert the amber fallback notice is visible with the right text
      const notice = page.getByTestId("from-fallback-notice");
      await expect(notice).toBeVisible({ timeout: 5_000 });
      await expect(notice).toContainText(
        "isn't in this run's resolved tracklist",
      );

      // Step 5: Dismiss the notice and confirm it disappears
      await page.getByRole("button", { name: "Dismiss" }).click();
      await expect(notice).not.toBeVisible();
    },
  );
});

// ---------------------------------------------------------------------------
// Song page — verify the "Hear it in context" links are well-formed
// ---------------------------------------------------------------------------

test.describe("Song page — 'Hear it in context' links", () => {
  test("station spin link points at the correct archive run with ?play=1&from=<mbid>", async ({
    page,
  }) => {
    await page.goto(`/lore/song/${REAL_MBID}`);

    // Wait for the spin history section to appear
    const spinReplayLink = page.getByTestId("spin-replay-0");
    await expect(spinReplayLink).toBeVisible({ timeout: 10_000 });

    const href = await spinReplayLink.getAttribute("href");
    expect(href).toMatch(
      new RegExp(`/archive/station-runs/${STATION_RUN_ID}`),
    );
    expect(href).toContain("play=1");
    expect(href).toContain(`from=${REAL_MBID}`);
  });
});

// ---------------------------------------------------------------------------
// StationRun — fallback notice when ?from= MBID is not in the resolved list
// ---------------------------------------------------------------------------

test.describe("StationRun — fallback notice via 'hear it in context' deep link", () => {
  test("shows the amber fallback notice when the song MBID is absent from the run", async ({
    page,
  }) => {
    // Navigate directly to the run URL with a non-existent from= MBID —
    // exactly what the Song page link does when that song was unresolved.
    await page.goto(
      `/lore/archive/station-runs/${STATION_RUN_ID}?play=1&from=${ABSENT_MBID}`,
    );

    // Wait for the page to finish loading — the run heading is unique
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    // The amber fallback notice must be present
    const notice = page.getByTestId("from-fallback-notice");
    await expect(notice).toBeVisible({ timeout: 5_000 });
    await expect(notice).toContainText(
      "isn't in this run's resolved tracklist",
    );
  });

  test("hides the fallback notice after the user clicks Dismiss", async ({
    page,
  }) => {
    await page.goto(
      `/lore/archive/station-runs/${STATION_RUN_ID}?play=1&from=${ABSENT_MBID}`,
    );

    // Wait for the notice to appear
    const notice = page.getByTestId("from-fallback-notice");
    await expect(notice).toBeVisible({ timeout: 10_000 });

    // Click the dismiss button
    await page.getByRole("button", { name: "Dismiss" }).click();

    // The notice must no longer be in the DOM
    await expect(notice).not.toBeVisible();
  });

  test("does NOT show the fallback notice when the song MBID is present in the run", async ({
    page,
  }) => {
    // REAL_MBID is a resolved track in the fixtured run, so no fallback.
    await page.goto(
      `/lore/archive/station-runs/${STATION_RUN_ID}?play=1&from=${REAL_MBID}`,
    );

    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("from-fallback-notice"),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// PickerRun — fallback notice when ?from= MBID is not in the resolved picks
// ---------------------------------------------------------------------------

test.describe("PickerRun — fallback notice via 'hear it in context' deep link", () => {
  test("shows the amber fallback notice when the song MBID is absent from the run's picks", async ({
    page,
  }) => {
    // Navigate directly to a picker run with a from= MBID that is not in the
    // run's resolved picks — the picker-run counterpart of the station flow.
    await page.goto(
      `/lore/archive/selector-runs/${PICKER_RUN_ID}?play=1&from=${ABSENT_MBID}`,
    );

    // Wait for the run page to finish loading — the run heading is unique
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    // The amber fallback notice must be present with the right text
    const notice = page.getByTestId("from-fallback-notice");
    await expect(notice).toBeVisible({ timeout: 5_000 });
    await expect(notice).toContainText(
      "isn't in this run's resolved tracklist",
    );
  });

  test("hides the fallback notice after the user clicks Dismiss", async ({
    page,
  }) => {
    await page.goto(
      `/lore/archive/selector-runs/${PICKER_RUN_ID}?play=1&from=${ABSENT_MBID}`,
    );

    // Wait for the notice to appear
    const notice = page.getByTestId("from-fallback-notice");
    await expect(notice).toBeVisible({ timeout: 10_000 });

    // Click the dismiss button
    await page.getByRole("button", { name: "Dismiss" }).click();

    // The notice must no longer be in the DOM
    await expect(notice).not.toBeVisible();
  });

  test("does NOT show the fallback notice when the song MBID is present in the run's picks", async ({
    page,
  }) => {
    // OTHER_MBID is a resolved pick in the fixtured run, so no fallback.
    await page.goto(
      `/lore/archive/selector-runs/${PICKER_RUN_ID}?play=1&from=${OTHER_MBID}`,
    );

    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("from-fallback-notice"),
    ).not.toBeVisible();
  });
});
