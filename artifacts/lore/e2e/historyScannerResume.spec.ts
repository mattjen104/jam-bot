import { test, expect, type Page } from "@playwright/test";

const SNAPSHOT = "2026-08-20T12:00:00.000Z";
const STATION_SLUG = "station-a";
const CATEGORY_KEY = "anchor,campus,public";

function makeStation() {
  return {
    id: 1,
    slug: STATION_SLUG,
    name: "Station A",
    org: "Station A",
    city: "Testville",
    country: "US",
    streamUrl: "https://history-scanner.example.test/stream",
    streamQuality: null,
    streamFormat: "mp3",
    mode: "live",
    homepageUrl: "https://history-scanner.example.test",
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
    stationCategories: ["anchor", "campus", "public"],
  };
}

function makeHistoryItem(id: number) {
  return {
    id,
    mbid: `history-mbid-${id}`,
    title: `First Play ${id}`,
    artist: "History Fixture",
    artworkUrl: null,
    playedAt: new Date(Date.UTC(2026, 7, 1, 0, id)).toISOString(),
    station: { slug: STATION_SLUG, name: "Station A" },
    show: null,
    isCrossing: true,
    isFirstPlay: true,
  };
}

const HISTORY_ITEMS = Array.from({ length: 42 }, (_, index) => makeHistoryItem(index + 1));

async function installRoutes(page: Page) {
  const station = makeStation();
  const historyRequests: URL[] = [];

  await page.route("https://history-scanner.example.test/**", (route) => route.abort());
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
    route.fulfill({ json: { stations: [station] } }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: [{
          slug: STATION_SLUG,
          nowPlaying: {
            spinId: 1,
            rawArtist: "Live Artist",
            rawTitle: "Live Track",
            source: "nts_live",
            confidence: "unresolved",
            playedAt: new Date().toISOString(),
            artworkUrl: null,
            recording: null,
            show: null,
            isFirstSpin: false,
            isLibraryHit: false,
            isArtistHit: false,
          },
        }],
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
  await page.route(`**/api/stations/${STATION_SLUG}/now-playing`, (route) =>
    route.fulfill({ json: { station, nowPlaying: null } }),
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

  // The scanner's read model is a stable, ascending keyset. Keep the same
  // response for the global UI scan and the explicit station API probe.
  await page.route("**/api/player/history**", async (route) => {
    const url = new URL(route.request().url());
    historyRequests.push(url);
    const beforeId = Number(url.searchParams.get("beforeId") ?? "0");
    const start = beforeId > 0 ? beforeId : 0;
    const items = HISTORY_ITEMS.slice(start, start + 40);
    const last = items.at(-1);
    await route.fulfill({
      json: {
        snapshot: SNAPSHOT,
        items,
        nextBefore: last && start + items.length < HISTORY_ITEMS.length ? last.playedAt : null,
        nextBeforeId: last && start + items.length < HISTORY_ITEMS.length ? last.id : null,
        partial: false,
        authenticated: false,
      },
    });
  });

  await page.route("**/api/recordings/*/preview", async (route) => {
    const mbid = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-2) ?? "");
    // Item 41 is deliberately unavailable. Item 42 only needs to resolve;
    // playback itself is not part of this regression.
    await route.fulfill({
      json: {
        previewUrl: mbid === "history-mbid-41" ? null : "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAACABAAZGF0YQAAAAA=",
        artworkUrl: null,
        source: mbid === "history-mbid-41" ? null : "fixture",
      },
    });
  });

  return { historyRequests };
}

test.describe("Dial history scanner resume", () => {
  test("keeps station/all-time/first-play cursors and resumes after a missing sample", async ({
    page,
  }) => {
    const { historyRequests } = await installRoutes(page);

    await page.goto("/lore/");

    // API-level guard: station + all-time + first plays must paginate with
    // the same snapshot, rather than silently restarting or borrowing scope.
    const firstResponse = await page.evaluate(async ({ station, categories }) => {
      const response = await fetch(
        `/api/player/history?scope=lifetime&filter=firstPlays&station=${station}&categories=${categories}&limit=40`,
      );
      return response.json();
    }, { station: STATION_SLUG, categories: CATEGORY_KEY });
    expect(firstResponse.snapshot).toBe(SNAPSHOT);
    expect(firstResponse.items).toHaveLength(40);
    expect(firstResponse.nextBeforeId).toBe(40);

    const secondResponse = await page.evaluate(async ({ station, categories, first }) => {
      const params = new URLSearchParams({
        scope: "lifetime",
        filter: "firstPlays",
        station,
        categories,
        limit: "40",
        snapshot: first.snapshot,
        before: first.nextBefore,
        beforeId: String(first.nextBeforeId),
      });
      const response = await fetch(`/api/player/history?${params}`);
      return response.json();
    }, { station: STATION_SLUG, categories: CATEGORY_KEY, first: firstResponse });
    expect(secondResponse.snapshot).toBe(firstResponse.snapshot);
    expect(secondResponse.items.map((item: { id: number }) => item.id)).toEqual([41, 42]);

    const scanner = page.getByTestId("dial-history-scanner");
    await expect(scanner.getByRole("button", { name: "History scan · all time" })).toBeVisible({
      timeout: 20_000,
    });
    await scanner.getByRole("button", { name: "History scan · all time" }).click();
    await scanner.getByRole("button", { name: "first plays" }).click();
    await expect(scanner.getByRole("button", { name: "Load more history" })).toBeVisible({
      timeout: 20_000,
    });
    await scanner.getByRole("button", { name: "Load more history" }).click();
    await expect(scanner).toContainText("42 tracks");

    // A station-specific entry must not be reused by the global scanner key.
    await page.evaluate(({ snapshot, categories, station }) => {
      localStorage.setItem("lore:historyScan:v1", JSON.stringify({
        [`lifetime|${categories}|${station}|firstPlays`]: {
          snapshot,
          furthest: 41,
          seen: [41],
          at: Date.now(),
        },
      }));
    }, { snapshot: SNAPSHOT, categories: CATEGORY_KEY, station: STATION_SLUG });

    // Reopen with the same snapshot. The global key has no saved progress, so
    // it starts at item 1 rather than borrowing station-a's item 42 position.
    await scanner.getByRole("button", { name: "History scan · all time" }).click();
    await scanner.getByRole("button", { name: "History scan · all time" }).click();
    await scanner.getByRole("button", { name: "Start history scan" }).click();

    await expect.poll(async () => page.evaluate(() => {
      const raw = localStorage.getItem("lore:historyScan:v1");
      return raw ? Object.keys(JSON.parse(raw)) : [];
    })).toContain(`lifetime|${CATEGORY_KEY}|*|firstPlays`);

    expect(historyRequests.some((url) =>
      url.searchParams.get("scope") === "lifetime"
      && url.searchParams.get("filter") === "firstPlays"
      && url.searchParams.get("beforeId") === "40",
    )).toBe(true);
    expect(historyRequests.some((url) =>
      url.searchParams.get("scope") === "lifetime"
      && url.searchParams.get("filter") === "firstPlays"
      && url.searchParams.get("station") === null,
    )).toBe(true);
  });
});