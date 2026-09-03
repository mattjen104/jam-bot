import { test, expect, type Page } from "@playwright/test";

/**
 * Browser coverage for the simplified SplitHome station dial.
 *
 * The front door presents a vertically scrollable stack of station cards.
 * This spec exercises that rendered stack with 16 live stations, so it catches
 * clipping and overflow regressions and proves a station beyond the initial
 * viewport remains reachable.
 */

const STATION_COUNT = 16;

function makeStation(index: number) {
  const ordinal = String(index + 1).padStart(2, "0");
  return {
    id: index + 1,
    slug: `micro-${ordinal}`,
    name: `Station ${ordinal}`,
    org: `STATION ${ordinal}`,
    city: "London",
    country: "GB",
    streamUrl: `https://stream.example.test/micro-${ordinal}`,
    streamQuality: null,
    streamFormat: "aac",
    mode: "live",
    homepageUrl: `https://station-${ordinal}.example.test`,
    homepageBlurb: `Station ${ordinal} broadcasts adventurous music from London.`,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    stationCategories: [index % 2 === 0 ? "campus" : "anchor"],
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    crossings: 1,
    artistCrossings: 0,
    weekCrossings: 1,
    weekArtistCrossings: 0,
    monthCrossings: 1,
    monthArtistCrossings: 0,
    lifetimeCrossings: 1,
    lifetimeArtistCrossings: 0,
  };
}

function makeNowPlaying(index: number) {
  const ordinal = index + 1;
  return {
    spinId: 10_000 + ordinal,
    rawArtist: `Artist ${ordinal}`,
    rawTitle: `Track ${ordinal}`,
    source: "icy",
    confidence: "unresolved",
    playedAt: new Date(Date.now() - index * 30_000).toISOString(),
    artworkUrl: null,
    recording: null,
    show: null,
    isFirstSpin: false,
    isLibraryHit: true,
    isArtistHit: false,
  };
}

const STATIONS = Array.from({ length: STATION_COUNT }, (_, index) => makeStation(index));
const NOW_PLAYING = STATIONS.map((_, index) => makeNowPlaying(index));
const CROSSINGS = STATIONS.map((station) => ({
  stationSlug: station.slug,
  crossings: 1,
  artistCrossings: 0,
  firstPlayCrossings: 1,
  weekCrossings: 1,
  weekArtistCrossings: 0,
  weekFirstPlayCrossings: 2,
  monthCrossings: 1,
  monthArtistCrossings: 0,
  monthFirstPlayCrossings: 3,
  lifetimeCrossings: 1,
  lifetimeArtistCrossings: 0,
  lifetimeFirstPlayCrossings: 5,
  albumCrossings: [1, 2, 3, 4, 5].map((ordinal) => ({
    releaseGroupMbid: `${station.slug}-release-${ordinal}`,
    recordingMbid: `${station.slug}-recording-${ordinal}`,
    title: `Album ${ordinal}`,
    artist: `Artist ${ordinal}`,
    artworkUrl: `https://art.example.test/${station.slug}-${ordinal}.jpg`,
  })),
}));

interface AudioProbeEvent {
  kind: "construct" | "src" | "load" | "play" | "pause" | "clear";
  id: number;
  value: string;
}

async function installAudioProbe(page: Page) {
  await page.addInitScript(() => {
    const win = window as typeof window & {
      __radioAudioEvents?: AudioProbeEvent[];
    };
    const events: AudioProbeEvent[] = [];
    let nextId = 0;
    const OriginalAudio = win.Audio;

    win.__radioAudioEvents = events;
    win.Audio = function ProbedAudio(...args: ConstructorParameters<typeof Audio>) {
      const target = new OriginalAudio(...args);
      const id = nextId++;
      let source = args[0] ?? "";
      const record = (kind: AudioProbeEvent["kind"], value = source) => {
        events.push({ kind, id, value });
      };
      record("construct");
      return new Proxy(target, {
        get(current, property) {
          if (property === "src") return source;
          if (property === "load") {
            return () => {
              record("load");
            };
          }
          if (property === "play") {
            return () => {
              record("play");
              // Keep this test focused on gesture ordering. The stream itself
              // is intentionally not played or decoded in the browser check.
              return Promise.resolve();
            };
          }
          if (property === "pause") {
            return () => {
              record("pause");
              current.pause();
            };
          }
          if (property === "removeAttribute") {
            return (name: string) => {
              if (name === "src") {
                source = "";
                record("clear", "");
                return;
              }
              current.removeAttribute(name);
            };
          }
          const value = Reflect.get(current, property, current);
          return typeof value === "function" ? value.bind(current) : value;
        },
        set(current, property, value) {
          if (property === "src") {
            source = String(value);
            record("src");
            return true;
          }
          return Reflect.set(current, property, value);
        },
      });
    } as typeof Audio;
  });
}

async function readAudioProbe(page: Page): Promise<AudioProbeEvent[]> {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __radioAudioEvents?: AudioProbeEvent[];
    };
    return [...(win.__radioAudioEvents ?? [])];
  });
}

async function clearAudioProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __radioAudioEvents?: AudioProbeEvent[];
    };
    win.__radioAudioEvents?.splice(0);
  });
}

async function installRoutes(
  page: Page,
  listenerArchiveNavEnabled = false,
  libraryItems: unknown[] = [],
) {
  // Avoid reaching external radio streams; the player still commits the tuned
  // station before the browser reports that this fixture stream is unavailable.
  await page.route("https://stream.example.test/**", (route) => route.abort());
  await page.route("**/api/art?src=**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: "<svg xmlns='http://www.w3.org/2000/svg' width='152' height='152'><rect width='152' height='152' fill='#7e6a9c'/></svg>",
    }),
  );

  // Register the broad route first: Playwright evaluates later routes first.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  let tasteSeeds: string[] = [];
  await page.route("**/api/me/taste-seeds", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { artists: string[] };
      tasteSeeds = body.artists;
    }
    await route.fulfill({ json: { artists: tasteSeeds } });
  });
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: CROSSINGS, computing: false, failed: false } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [], hasLibrary: true, hasSeeds: true } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  await page.route("**/api/me/library?**", (route) =>
    route.fulfill({ json: { items: libraryItems, nextCursor: null } }),
  );
  await page.route("**/api/me/library", (route) =>
    route.fulfill({ json: { items: libraryItems, nextCursor: null } }),
  );

  await page.route("**/api/stations?**", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: STATIONS } }),
  );
  await page.route("**/api/stations/now-playing?**", (route) =>
    route.fulfill({
      json: {
        items: STATIONS.map((station, index) => ({
          slug: station.slug,
          nowPlaying: NOW_PLAYING[index],
        })),
      },
    }),
  );
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: STATIONS.map((station, index) => ({
          slug: station.slug,
          nowPlaying: NOW_PLAYING[index],
        })),
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
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/stations/recent-spins**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/player/history?**", (route) => {
    const url = new URL(route.request().url());
    const stationSlug = url.searchParams.get("station") ?? "";
    const filter = url.searchParams.get("filter");
    const station = STATIONS.find((candidate) => candidate.slug === stationSlug);
    const requestedCategories = new Set(
      (url.searchParams.get("categories") ?? "").split(",").filter(Boolean),
    );
    const globalStations = STATIONS
      .filter((candidate) => (
        requestedCategories.size === 0
        || candidate.stationCategories.some((category) => requestedCategories.has(category))
      ))
      .slice(0, 10);
    const historyStations = station ? [station] : globalStations;
    return route.fulfill({
      json: {
        items: historyStations.flatMap((historyStation) => {
          const count = station ? 5 : 1;
          return Array.from({ length: count }, (_, itemIndex) => {
            const ordinal = itemIndex + 1;
            return {
              id: historyStation.id * 100 + ordinal,
              mbid: `${historyStation.slug}-${filter}-${ordinal}`,
              title: filter === "crossings" ? `Crossing ${ordinal}` : `First Play ${ordinal}`,
              artist: filter === "crossings" ? `Known Artist ${ordinal}` : `New Artist ${ordinal}`,
              artworkUrl: `https://art.example.test/${historyStation.slug}-${filter}-${ordinal}.jpg`,
              playedAt: new Date(Date.UTC(2026, 7, 31, 12, 30 - ordinal)).toISOString(),
              station: { slug: historyStation.slug, name: historyStation.name },
            };
          });
        }),
      },
    });
  });
  await page.route("**/api/stations/artist-frequency**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/pickers/**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        spotifyImportEnabled: false,
        listenerArchiveNavEnabled,
        appleMusic: { configured: false, developerToken: null, appName: "Lore", storefront: "us" },
      },
    }),
  );
}

async function loadStationDial(
  page: Page,
  listenerArchiveNavEnabled = false,
  libraryItems: unknown[] = [],
) {
  await installRoutes(page, listenerArchiveNavEnabled, libraryItems);
  await page.goto("/lore/");
  await expect(page.getByTestId("minimal-radio-surface")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("minimal-radio-cards-toggle").click();

  const cards = page.getByTestId("minimal-radio-card");
  await expect(cards).toHaveCount(STATION_COUNT);
  const fullyVisibleRows = await cards.evaluateAll((nodes) => {
    const viewport = nodes[0]?.closest<HTMLElement>("[data-testid='minimal-radio-hero']");
    if (!viewport) return 0;
    const viewportRect = viewport.getBoundingClientRect();
    return nodes.filter((node) => {
      const rowRect = node.getBoundingClientRect();
      return rowRect.top >= viewportRect.top - 1 && rowRect.bottom <= viewportRect.bottom + 1;
    }).length;
  });
  expect(fullyVisibleRows).toBeGreaterThanOrEqual(4);
}

test.describe.skip("Retired density modes — superseded by adaptive Now", () => {
  test("category overview groups live stations and scopes global history", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await page.goto("/lore/");

    await expect(page.getByTestId("minimal-radio-overview")).toBeVisible();
    await expect(page.getByTestId("overview-category-campus")).toContainText("Campus Radio");
    await expect(page.getByTestId("overview-category-anchor")).toContainText("Core Stations");
    await expect(page.getByTestId("overview-category-campus")).toContainText("Artist 1");
    await expect(page.getByTestId("overview-category-campus")).not.toContainText("Track 1");
    await expect(page.getByTestId("overview-history-crossings-item")).toHaveCount(10);
    await expect(page.getByTestId("overview-history-firstPlays-item")).toHaveCount(10);

    await page.getByTestId("minimal-radio-remote-category-campus").click();

    await expect(page.getByTestId("overview-category-campus")).toBeVisible();
    await expect(page.getByTestId("overview-category-anchor")).toHaveCount(0);
    await expect(page.getByTestId("overview-history-crossings-item")).toHaveCount(8);
    await expect(page.getByTestId("overview-history-firstPlays-item")).toHaveCount(8);
    await expect(page.getByTestId("overview-history-crossings")).toContainText("Filtered stations");

    await page.getByRole("button", { name: "View Campus Radio cards" }).click();
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(8);
    await expect(page.getByTestId("minimal-radio-hero-card-micro-01")).toContainText("Station 01");
  });

  test("390×844: keeps the card stack reachable and selects stations without playing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStationDial(page);

    await expect(page.getByTestId("minimal-radio-hero-card-micro-01")).toContainText("Station 01");
    const hero = page.getByTestId("minimal-radio-hero");
    await hero.focus();
    await hero.press("End");
    await expect(page.getByTestId("minimal-radio-hero-card-micro-16")).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByTestId("minimal-radio-hero-card-micro-16")).toContainText("Station 16");
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(STATION_COUNT);
    await expect(page.locator(".player-bar-row")).toHaveCount(0);
    await expect(page.locator("body")).toHaveCSS("overflow-x", /^(visible|clip|hidden)$/);
  });

  test("grid control opens the compact station remote on the floating-control plane", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStationDial(page);

    const toggle = page.getByTestId("minimal-radio-remote-toggle");
    const filter = page.locator(".minimal-radio__floating-filter").first();
    const toggleBox = await toggle.boundingBox();
    const filterBox = await filter.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(filterBox).not.toBeNull();
    expect(Math.abs(
      (toggleBox!.y + toggleBox!.height) - (filterBox!.y + filterBox!.height),
    )).toBeLessThanOrEqual(1);
    expect(toggleBox!.x).toBeLessThan(filterBox!.x);

    await expect(page.getByTestId("minimal-radio-remote-view")).toHaveCount(0);
    await expect(page.getByTestId("minimal-radio-remote-count"))
      .toHaveText("16 stations selected");

    await toggle.click();

    await expect(page.getByTestId("minimal-radio-remote-view"))
      .toHaveAttribute("aria-label", "Expanded compact station remote");
    await expect(page.getByTestId("minimal-radio-remote-station")).toHaveCount(STATION_COUNT);
    const compactScroll = await page.getByTestId("minimal-radio-remote-view").evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(compactScroll.scrollWidth).toBeLessThanOrEqual(compactScroll.clientWidth + 1);
    expect(compactScroll.overflowY).toBe("auto");
    expect(compactScroll.scrollHeight).toBeGreaterThanOrEqual(compactScroll.clientHeight);
    await expect(page.getByTestId("minimal-radio-remote-category-all")).toBeVisible();
    await expect(page.getByTestId("minimal-radio-remote-category-campus")).toBeVisible();
    const stationButton = page.getByTestId("minimal-radio-remote-station").first();
    const stationMark = stationButton.locator(".minimal-radio__remote-mark");
    const stationBox = await stationButton.boundingBox();
    const markBox = await stationMark.boundingBox();
    expect(stationBox).not.toBeNull();
    expect(markBox).not.toBeNull();
    expect(stationBox!.height).toBeLessThan(60);
    expect(Math.abs(stationBox!.height - markBox!.height)).toBeLessThanOrEqual(2);

    const remoteColumns = await page.getByTestId("minimal-radio-remote-page").first().evaluate((node) =>
      getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length
    );
    expect(remoteColumns).toBe(2);
    const remoteScroll = await page.getByTestId("minimal-radio-remote-view").evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(remoteScroll.scrollWidth).toBeLessThanOrEqual(remoteScroll.clientWidth + 1);
    expect(remoteScroll.overflowY).toBe("auto");
    expect(remoteScroll.scrollHeight).toBeGreaterThanOrEqual(remoteScroll.clientHeight);
    await expect(page.getByTestId("minimal-radio-remote-station").first())
      .toContainText("Station 01");
    await expect(page.getByTestId("minimal-radio-remote-station").first())
      .toContainText("Artist 1");
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(0);

    await page.getByTestId("minimal-radio-remote-station").first().click();
    await expect(page.getByTestId("minimal-radio-remote-station").first())
      .toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("minimal-radio-remote-category-campus").click();
    await expect(page.getByTestId("minimal-radio-remote-station")).toHaveCount(STATION_COUNT / 2);
    await expect(page.getByTestId("minimal-radio-remote-count")).toHaveText("8 stations selected");
    await expect(page.getByTestId("minimal-radio-remote-station").first())
      .toContainText("Station 01");

    await page.getByTestId("minimal-radio-remote-category-all").click();
    await expect(page.getByTestId("minimal-radio-remote-station")).toHaveCount(STATION_COUNT);
    await expect(page.getByTestId("minimal-radio-remote-category-all"))
      .toHaveAttribute("aria-pressed", "true");
  });

  test("station sentences replace the crossing and premiere card columns", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadStationDial(page);

    const card = page.getByTestId("minimal-radio-card").first();
    await expect(card.getByTestId("minimal-radio-card-blurb"))
      .toContainText("Station 01 broadcasts adventurous music from London.");
    await expect(page.getByTestId("minimal-radio-sheet-header")).toHaveCount(0);
    await expect(card.locator(".minimal-radio-card__albums-columns")).toHaveCount(0);
    await expect(card.locator(".minimal-radio-card__album-column--crossings")).toHaveCount(0);
    await expect(card.locator(".minimal-radio-card__album-column--first-plays")).toHaveCount(0);
    await expect(card.getByTestId("minimal-radio-crossing")).toHaveCount(0);
    await expect(card.getByTestId("minimal-radio-first-plays")).toHaveCount(0);
    await expect(card.locator(".minimal-radio-card__station-blurb"))
      .toHaveCSS("border-left-width", "1px");

    const layout = await card.evaluate((node) => {
      const cardRect = node.getBoundingClientRect();
      const copyRect = node.querySelector<HTMLElement>(".minimal-radio-card__station-copy")?.getBoundingClientRect();
      const blurbRect = node.querySelector<HTMLElement>(".minimal-radio-card__station-blurb")?.getBoundingClientRect();
      return {
        cardHeight: cardRect.height,
        copyWidth: copyRect?.width ?? 0,
        blurbWidth: blurbRect?.width ?? 0,
      };
    });
    expect(layout.cardHeight).toBe(84);
    expect(layout.copyWidth).toBeGreaterThan(120);
    expect(layout.blurbWidth).toBeGreaterThan(120);
    expect(Math.abs(layout.copyWidth - layout.blurbWidth)).toBeLessThanOrEqual(1);
    await expect(card.locator(".minimal-radio-card__station-copy"))
      .toHaveCSS("border-bottom-width", "1px");
    await expect(card.locator(".minimal-radio-card__now")).toHaveCSS("border-top-width", "0px");
    await expect(card.locator(".minimal-radio-card__now")).toHaveCSS("border-bottom-width", "0px");
  });

  test("1280×900: keyboard navigation changes the active card", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loadStationDial(page);
    await expect(page.getByTestId("radio-preset-lifetime")).toHaveCount(0);
    const hero = page.getByTestId("minimal-radio-hero");
    await hero.focus();
    await hero.press("ArrowDown");
    await expect(page.getByTestId("minimal-radio-hero-card-micro-02")).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(STATION_COUNT);
    await expect(page.locator(".fdrow__crossing-dot")).toHaveCount(0);
  });

  test("CLI artist entry and Library mode work while archive links follow the admin reveal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loadStationDial(page, true, [{
      mbid: "real-kept-track",
      addedAt: "2026-08-30T12:00:00.000Z",
      provenance: { kind: "keep", stationName: "WFMU" },
      recording: {
        title: "Caught Song",
        artist: "A Tribe Called Quest",
        artistMbid: null,
        artworkUrl: null,
        albumTitle: "Real Album",
        releaseGroupMbid: "real-release-group",
        releaseYear: 2025,
        spotifyUrl: null,
      },
    }]);

    const input = page.getByRole("textbox", { name: "Dial command" });
    await input.fill("A Tribe Called Quest");
    await input.press("Enter");
    await expect(page.getByTestId("front-door-cli").getByRole("status"))
      .toContainText("A Tribe Called Quest added");

    await expect(page.getByRole("link", { name: "Heard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Index" })).toBeVisible();
    await page.getByTestId("front-door-library-mode").click();
    await expect(page.getByTestId("front-door-library")).toBeVisible();
    await expect(page.getByTestId("minimal-radio-card")).toHaveCount(0);
    await expect(page.getByText("Caught Song", { exact: true })).toBeVisible();
  });
});

test.describe("Adaptive Now — listening jobs in a real browser", () => {
  test("shows a bounded station decision surface and opens the full station picker", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await page.addInitScript(() => {
      localStorage.setItem("lore:firstRunStationInteraction", "1");
    });
    await page.goto("/lore/");

    await expect(page.getByTestId("adaptive-now")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("adaptive-now-row")).toHaveCount(6);
    await expect(page.getByTestId("minimal-radio-overview-toggle")).toHaveCount(0);
    await expect(page.getByTestId("minimal-radio-cards-toggle")).toHaveCount(0);

    await page.getByRole("button", { name: "Switch station" }).click();
    const picker = page.getByRole("dialog", { name: "Switch live station" });
    await expect(picker).toBeVisible();
    await expect(picker.locator(".adaptive-now__picker-list > button")).toHaveCount(STATION_COUNT);
  });

  test("keeps Explore and Stack as explicit route destinations", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await page.addInitScript(() => {
      localStorage.setItem("lore:firstRunStationInteraction", "1");
    });
    await page.goto("/lore/");

    await expect(page.getByRole("link", { name: "Explore" })).toHaveAttribute("href", "/feed");
    await expect(page.getByRole("link", { name: "Stack" })).toHaveAttribute("href", "/library");
  });
});

test.describe("touch press-to-play warmup", () => {
  test("station picker stays silent until a touch commits a station", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await installAudioProbe(page);
    let liveStreamRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("stream.example.test")) {
        liveStreamRequests++;
      }
    });
    await page.addInitScript(() => {
      localStorage.setItem("lore:firstRunStationInteraction", "1");
    });
    await page.goto("/lore/");

    await expect(page.getByTestId("adaptive-now")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("adaptive-now-row")).toHaveCount(6);
    await clearAudioProbe(page);

    await page.getByRole("button", { name: "Switch station" }).click();
    const picker = page.getByRole("dialog", { name: "Switch live station" });
    await expect(picker).toBeVisible();
    const pickerStations = picker.locator(".adaptive-now__picker-list > button");
    await expect(pickerStations).toHaveCount(STATION_COUNT);
    expect(liveStreamRequests).toBe(0);
    expect((await readAudioProbe(page)).filter((event) => event.kind === "play")).toHaveLength(0);

    const cancelledStation = pickerStations.nth(0);
    await clearAudioProbe(page);
    await cancelledStation.dispatchEvent("pointerdown", {
      bubbles: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    });
    await cancelledStation.dispatchEvent("pointercancel", {
      bubbles: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    });
    await expect
      .poll(async () => (await readAudioProbe(page)).filter((event) => event.kind === "clear").length)
      .toBe(1);
    expect((await readAudioProbe(page)).filter((event) => event.kind === "play")).toHaveLength(0);

    const releasedStation = pickerStations.nth(1);
    await clearAudioProbe(page);
    await releasedStation.dispatchEvent("pointerdown", {
      bubbles: true,
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
    });
    await releasedStation.dispatchEvent("pointerup", {
      bubbles: true,
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
    });
    expect((await readAudioProbe(page)).filter((event) => event.kind === "play")).toHaveLength(0);
    await expect
      .poll(
        async () => (await readAudioProbe(page)).filter((event) => event.kind === "clear").length,
        { timeout: 1_500 },
      )
      .toBe(1);

    const committedStation = pickerStations.nth(0);
    await clearAudioProbe(page);
    await committedStation.dispatchEvent("pointerdown", {
      bubbles: true,
      pointerId: 3,
      pointerType: "touch",
      isPrimary: true,
    });
    await committedStation.dispatchEvent("pointerup", {
      bubbles: true,
      pointerId: 3,
      pointerType: "touch",
      isPrimary: true,
    });
    expect((await readAudioProbe(page)).filter((event) => event.kind === "play")).toHaveLength(0);
    await committedStation.dispatchEvent("click", { bubbles: true });
    await expect
      .poll(async () => (await readAudioProbe(page)).filter((event) => event.kind === "play"))
      .toHaveLength(1);
    await expect(picker).toHaveCount(0);
  });

  test("keeps a touch warm source through click, but cancels abandoned gestures", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRoutes(page);
    await installAudioProbe(page);
    await page.addInitScript(() => {
      localStorage.setItem("lore:firstRunStationInteraction", "1");
    });
    await page.goto("/lore/");

    await expect(page.getByTestId("adaptive-now")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("adaptive-now-row")).toHaveCount(6);

    const firstTune = page.getByRole("button", {
      name: "Tune in to Station 01",
    });
    await clearAudioProbe(page);
    await firstTune.dispatchEvent("pointerdown", {
      bubbles: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    });
    await firstTune.dispatchEvent("pointerleave", {
      bubbles: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    });
    await firstTune.dispatchEvent("pointerup", {
      bubbles: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    });

    // Touch pointerleave must not throw away the prepared source, and no
    // audio playback is allowed until the click has been committed.
    await expect
      .poll(async () => (await readAudioProbe(page)).filter((event) => event.kind === "load").length)
      .toBeGreaterThanOrEqual(1);
    expect((await readAudioProbe(page)).filter((event) => event.kind === "play")).toHaveLength(0);

    await firstTune.dispatchEvent("click", { bubbles: true });
    await expect
      .poll(async () => (await readAudioProbe(page)).filter((event) => event.kind === "play"))
      .toHaveLength(1);
    const committedEvents = await readAudioProbe(page);
    const preparedId = committedEvents.find((event) => event.kind === "construct")?.id;
    const playId = committedEvents.find((event) => event.kind === "play")?.id;
    expect(preparedId).toBeDefined();
    expect(playId).toBe(preparedId);

    const cancelledTune = page.getByRole("button", {
      name: "Tune in to Station 02",
    });
    await clearAudioProbe(page);
    await cancelledTune.dispatchEvent("pointerdown", {
      bubbles: true,
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
    });
    await cancelledTune.dispatchEvent("pointercancel", {
      bubbles: true,
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
    });
    await expect
      .poll(async () => (await readAudioProbe(page)).filter((event) => event.kind === "clear").length)
      .toBe(1);
    expect((await readAudioProbe(page)).filter((event) => event.kind === "play")).toHaveLength(0);

    const releasedTune = page.getByRole("button", {
      name: "Tune in to Station 03",
    });
    await clearAudioProbe(page);
    await releasedTune.dispatchEvent("pointerdown", {
      bubbles: true,
      pointerId: 3,
      pointerType: "touch",
      isPrimary: true,
    });
    await releasedTune.dispatchEvent("pointerup", {
      bubbles: true,
      pointerId: 3,
      pointerType: "touch",
      isPrimary: true,
    });
    await expect
      .poll(
        async () => (await readAudioProbe(page)).filter((event) => event.kind === "clear").length,
        { timeout: 1_500 },
      )
      .toBe(1);
    expect((await readAudioProbe(page)).filter((event) => event.kind === "play")).toHaveLength(0);
  });
});
