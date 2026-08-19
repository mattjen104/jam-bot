import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end tests confirming the compact Feed row grammar in a real browser.
 *
 * The compact row identity is ALWAYS `[NowPlayingArtist] · [Station]` — the
 * now-playing artist is never replaced by crossing artist names. Crossing
 * evidence renders as the ⬤ dot indicator after the station name
 * (.fdrow__crossing-dot) when the station has ≥1 crossing at the active
 * scope; tapping the dot toggles the inline scope detail
 * (.fdrow__crossing-detail).
 *
 * All API routes are intercepted so the tests are deterministic and carry
 * no live-data dependence.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStation(slug: string, name: string, streamUrl = "https://stream.example.test/lore-e2e") {
  return {
    id: 1,
    slug,
    name,
    org: slug.toUpperCase(),
    city: "Los Angeles",
    country: "US",
    streamUrl,
    streamQuality: null,
    streamFormat: "aac",
    mode: "live",
    homepageUrl: `https://${slug}.example.test`,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    // This fixture exercises the ungrouped compact-row grammar, not the
    // category-first home presentation.
    stationCategories: [],
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
  };
}

function makeNowPlaying(opts: {
  artist: string;
  isArtistHit: boolean;
  isLibraryHit?: boolean;
  djName?: string | null;
  showName?: string | null;
}) {
  return {
    spinId: 900,
    rawArtist: opts.artist,
    rawTitle: "Some Track",
    source: "icy",
    confidence: "unresolved",
    playedAt: new Date().toISOString(),
    artworkUrl: null,
    recording: null,
    show: {
      name: opts.showName ?? "The Morning Show",
      djName: opts.djName ?? "DJ Example",
    },
    isFirstSpin: false,
    isLibraryHit: opts.isLibraryHit ?? false,
    isArtistHit: opts.isArtistHit,
  };
}

function makeSchedule(stationSlug: string, opts: { djName: string | null; showName?: string }) {
  const now = Date.now();
  return {
    items: [
      {
        stationSlug,
        runs: [
          {
            runId: 1,
            show: {
              name: opts.showName ?? "The Morning Show",
              djName: opts.djName,
              pickerId: null,
            },
            spinCount: 6,
            resolvedCount: 0,
            startedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
            endedAt: new Date(now + 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    ],
  };
}

/**
 * Spins for the set-crossing case: artists within the run window with isArtistHit=true.
 *
 * useDialData sorts spins oldest-first before iterating them in topArtistsFromSpins.
 * topArtistsFromSpins groups by count (most-frequent first), breaking ties by
 * Map insertion order (= oldest-spin order). To get artists[0] first in the output,
 * assign it the oldest timestamp so it is inserted first into the counts Map and
 * stays first after the stable sort on equal counts.
 */
function makeRecentSpins(stationSlug: string, artists: string[]) {
  const now = Date.now();
  return {
    items: [
      {
        stationSlug,
        spins: artists.map((artist, i) => ({
          mbid: `mbid-${i + 1}`,
          artistMbid: null,
          title: `Track ${i + 1}`,
          artist,
          // artists[0] gets the oldest timestamp so it appears first after
          // oldest-first sort and is inserted first into the counts Map.
          playedAt: new Date(now - (artists.length - i) * 15 * 60_000).toISOString(),
          isLibraryHit: false,
          isArtistHit: true,
          isFirstSpin: false,
          releaseYear: null,
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route-interception helper
// ---------------------------------------------------------------------------

async function installRoutes(
  page: Page,
  opts: {
    station: ReturnType<typeof makeStation>;
    nowPlaying: ReturnType<typeof makeNowPlaying>;
    schedule: ReturnType<typeof makeSchedule>;
    recentSpins?: ReturnType<typeof makeRecentSpins>;
    crossings?: { artistCrossings: number; topArtistNames: string[] };
  },
) {
  // Abort actual stream fetches — we never play audio in these tests.
  await page.route("https://stream.example.test/**", (route) => route.abort());

  // Anonymous listener endpoints.
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) => {
    const cx = opts.crossings ?? { artistCrossings: 0, topArtistNames: [] };
    return route.fulfill({
      json: {
        items: [
          {
            stationSlug: opts.station.slug,
            crossings: 0,
            artistCrossings: cx.artistCrossings,
            weekCrossings: 0,
            weekArtistCrossings: 0,
            monthCrossings: 0,
            monthArtistCrossings: 0,
            lifetimeCrossings: 0,
            lifetimeArtistCrossings: 0,
            topArtistNames: cx.topArtistNames,
          },
        ],
      },
    });
  });
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: ["Wet Leg", "Deftones"], hasLibrary: true, hasSeeds: true } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  // Catch-all for any remaining /api/me/* paths.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  // Station directory.
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: [opts.station] } }),
  );

  // Live pulse — a single station is live.
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: [{ slug: opts.station.slug, nowPlaying: opts.nowPlaying }],
      },
    }),
  );

  // SSE stream — empty event-stream so the client doesn't hang.
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );

  // Per-station now-playing (player dock / active station).
  await page.route(`**/api/stations/${opts.station.slug}/now-playing`, (route) =>
    route.fulfill({
      json: { station: opts.station, nowPlaying: opts.nowPlaying },
    }),
  );

  // Schedule.
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({ json: opts.schedule }),
  );

  // Recent spins — carry artist-hit flags for set-crossing derivation.
  await page.route("**/api/stations/recent-spins**", (route) =>
    route.fulfill({
      json: opts.recentSpins ?? { items: [] },
    }),
  );

  // Artist frequency — not needed for these specs.
  await page.route("**/api/stations/artist-frequency**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  // Picker endpoints.
  await page.route("**/api/pickers/**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Compact Feed row — ⬤ crossing dot & plain identity in a real browser", () => {
  test("live artist hit keeps 'Artist · Station' identity and shows the ⬤ dot with tap-to-detail", async ({
    page,
  }) => {
    const station = makeStation("kcrw", "KCRW");
    const DJ_NAME = "Liza Richardson";
    const SHOW_NAME = "Morning Becomes Eclectic";

    await installRoutes(page, {
      station,
      nowPlaying: makeNowPlaying({
        artist: "Wet Leg",
        isArtistHit: true,
        djName: DJ_NAME,
        showName: SHOW_NAME,
      }),
      schedule: makeSchedule("kcrw", { djName: DJ_NAME, showName: SHOW_NAME }),
    });
    // Crossing-dot tests need the crossings-on feed; radio mode (crossings
    // off) is the default now.
    await page.addInitScript(() => {
      window.localStorage.setItem("lore:radioMode", "false");
      window.localStorage.setItem("lore:crossingScope", "set");
    });
    await page.goto("/lore/");

    const row = page.locator(".fdrow").first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Identity is the plain now-playing sentence — no ", now" words.
    await expect(row.locator(".fdrow__compact-artist")).toHaveText("Wet Leg");
    await expect(row.locator(".fdrow__compact-station")).toHaveText("KCRW");
    await expect(row).toHaveAttribute("aria-label", "Wet Leg · KCRW");
    await expect(page.locator(".fdrow__compact-crossing")).toHaveCount(0);

    // The ⬤ dot marks the crossing; tapping toggles the inline detail.
    const dot = row.locator(".fdrow__crossing-dot");
    await expect(dot).toBeVisible();
    await dot.click();
    const detail = page.locator(".fdrow__crossing-detail").first();
    await expect(detail).toBeVisible();
    await expect(detail.locator(".fdrow__crossing-detail-scope")).toHaveText("this set");
    await expect(detail).toContainText("Wet Leg");
    await dot.click();
    await expect(page.locator(".fdrow__crossing-detail")).toHaveCount(0);

    // The DJ name and show name must not appear in the collapsed row.
    await expect(row.getByText(DJ_NAME)).not.toBeVisible();
    await expect(row.getByText(SHOW_NAME)).not.toBeVisible();
  });

  test("set crossing never replaces the now-playing artist; the dot carries the meaning", async ({
    page,
  }) => {
    const station = makeStation("kexp", "KEXP");
    const DJ_NAME = "John Richards";
    const SHOW_NAME = "Morning Show";

    await installRoutes(page, {
      station,
      nowPlaying: makeNowPlaying({
        artist: "Someone Else",
        isArtistHit: false,
        djName: DJ_NAME,
        showName: SHOW_NAME,
      }),
      schedule: makeSchedule("kexp", { djName: DJ_NAME, showName: SHOW_NAME }),
      recentSpins: makeRecentSpins("kexp", ["Wet Leg", "Deftones"]),
    });
    // Crossing-dot tests need the crossings-on feed; radio mode (crossings
    // off) is the default now.
    await page.addInitScript(() => {
      window.localStorage.setItem("lore:radioMode", "false");
      window.localStorage.setItem("lore:crossingScope", "set");
    });
    await page.goto("/lore/");

    const row = page.locator(".fdrow").first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // The now-playing artist stays primary; no crossing sentence anywhere.
    await expect(row).toHaveAttribute("aria-label", "Someone Else · KEXP");
    await expect(page.locator(".fdrow__compact-crossing")).toHaveCount(0);
    await expect(row).not.toContainText("this set");

    // The set-level crossing renders as the ⬤ dot.
    await expect(row.locator(".fdrow__crossing-dot")).toBeVisible();

    // DJ/show absent from the collapsed row.
    await expect(row.getByText(DJ_NAME)).not.toBeVisible();
    await expect(row.getByText(SHOW_NAME)).not.toBeVisible();
  });

  test("scope pill next to the crossings control cycles this set → 24h", async ({ page }) => {
    const station = makeStation("kexp", "KEXP");
    await installRoutes(page, {
      station,
      nowPlaying: makeNowPlaying({ artist: "Someone Else", isArtistHit: false }),
      schedule: makeSchedule("kexp", { djName: "John Richards" }),
      recentSpins: makeRecentSpins("kexp", ["Wet Leg"]),
    });
    // The scope pill is a crossings-on control; radio mode (crossings off)
    // is the default now.
    await page.addInitScript(() => {
      window.localStorage.setItem("lore:radioMode", "false");
      window.localStorage.setItem("lore:crossingScope", "set");
    });
    await page.goto("/lore/");

    const pill = page.locator(".crossing-scope-pill").first();
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await expect(pill).toBeEnabled();
    await expect(pill).toContainText("this set");
    await pill.click();
    await expect(pill).toContainText("24h");
  });

  test("crossings off (/radio): plain artist · station, no dot, no filter", async ({
    page,
  }) => {
    const station = makeStation("nts-1", "NTS 1");

    await installRoutes(page, {
      station,
      nowPlaying: makeNowPlaying({
        artist: "Burial",
        isArtistHit: false,
        isLibraryHit: false,
        djName: "Kode9",
        showName: "Hyperdub Special",
      }),
      schedule: makeSchedule("nts-1", { djName: "Kode9", showName: "Hyperdub Special" }),
    });
    // Crossings off — otherwise the crossing-positive filter would hide this
    // zero-crossing station entirely.
    await page.addInitScript(() => {
      window.localStorage.setItem("lore:radioMode", "true");
    });
    await page.goto("/lore/");

    const row = page.locator(".fdrow").first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // No crossing sentence, no dot, and the scope pill is inert.
    await expect(page.locator(".fdrow__compact-crossing")).toHaveCount(0);
    await expect(page.locator(".fdrow__crossing-dot")).toHaveCount(0);
    await expect(row.locator(".fdrow__compact-station")).toHaveText("NTS 1");
    await expect(row).toHaveAttribute("aria-label", "Burial · NTS 1");
    await expect(page.locator(".crossing-scope-pill").first()).toBeDisabled();
  });
});
