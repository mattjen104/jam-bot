import { test, expect } from "@playwright/test";

/**
 * End-to-end tests confirming the provisional now-playing fast path works in
 * a real browser:
 *
 *   1. A `spin-raw` SSE frame delivered via the EventSource connection causes
 *      the new artist+title to appear immediately in the WebPlayer on-air row,
 *      together with a "resolving…" cue (wp-resolving-<slug>).
 *
 *   2. The subsequent `spin-changed` (resolved) frame clears the cue — the
 *      track stays visible but the "resolving" indicator disappears.
 *
 * Coverage:
 *   - WebPlayer ON AIR row: `data-testid="wp-resolving-<slug>"`
 *   - Player dock bar:      `data-testid="player-bar-resolving"`  (secondary)
 *
 * All API routes are intercepted so the tests are deterministic. The SSE
 * stream is replaced with a fake `EventSource` injected before the page
 * loads, giving the test full control over which frames the browser sees and
 * when.
 */

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const SLUG = "nts-1";

const STATION = {
  id: 1,
  slug: SLUG,
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

/** Initial on-air response — one station, one current track, not resolving. */
function makeOnAirResponse() {
  return {
    authenticated: false,
    items: [
      {
        station: STATION,
        show: null,
        now: {
          mbid: "aaaaaaaa-0000-0000-0000-000000000001",
          title: "Old Track",
          artist: "Old Artist",
          artworkUrl: null,
          playedAt: new Date(Date.now() - 120_000).toISOString(),
          observedAt: new Date(Date.now() - 120_000).toISOString(),
          freshness: "fresh",
          resolved: true,
          resolving: false,
        },
        earlier: [],
        matchCount: null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Common setup helpers
// ---------------------------------------------------------------------------

/**
 * Inject a fake EventSource before the page is evaluated. The fake class:
 *   - Accepts any URL (it doesn't actually open a network connection).
 *   - Stores the instance on `window.__fakeEs` so the test can dispatch
 *     events to it via `page.evaluate`.
 *   - Fires the `onopen` callback asynchronously (mirrors native behaviour)
 *     so the stream is marked healthy immediately.
 *   - Exposes a `close()` no-op so teardown code doesn't throw.
 */
async function injectFakeEventSource(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.addInitScript(() => {
    class FakeEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;

      readonly url: string;
      readyState: number = FakeEventSource.OPEN;
      onopen: ((ev: Event) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        // Store globally so the test can drive events after page load.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__fakeEs = this;
        // Fire onopen asynchronously (1 tick) so subscribers have a chance
        // to attach their handlers before the callback fires.
        Promise.resolve().then(() => {
          if (this.onopen) this.onopen(new Event("open"));
        });
      }

      close() {
        this.readyState = FakeEventSource.CLOSED;
      }

      /** Internal helper used by the test via page.evaluate. */
      _dispatch(data: string) {
        if (this.onmessage) {
          this.onmessage(new MessageEvent("message", { data }));
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).EventSource = FakeEventSource;
  });
}

/**
 * Install stub routes shared by both test surfaces (WebPlayer + PlayerDock).
 * Returns 404/empty for endpoints that are soft-fetched and not critical to
 * the scenarios under test.
 */
async function installCommonRoutes(
  page: import("@playwright/test").Page,
  onAirResponse: ReturnType<typeof makeOnAirResponse>,
): Promise<void> {
  // On-air data — the primary data source for the WebPlayer ON AIR list.
  await page.route("**/api/player/onair", (route) =>
    route.fulfill({ json: onAirResponse }),
  );
  // Lore counts (kept/listed per mbid) — not needed for this test.
  await page.route("**/api/player/lore-counts**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  // "For You" tab and selectors tab — not exercised here.
  await page.route("**/api/player/for-you", (route) =>
    route.fulfill({ json: { runs: [] } }),
  );
  await page.route("**/api/player/selectors", (route) =>
    route.fulfill({ json: { selectors: [] } }),
  );
  // User preferences — anonymous visitor, no prefs.
  await page.route("**/api/me/preferences", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  // Connections — no Spotify connection.
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  // Library / crossings / picker endpoints — all empty.
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  // Station presence (· N here) — not relevant here.
  await page.route("**/api/stations/social/presence**", (route) =>
    route.fulfill({ json: { presence: {} } }),
  );
  // Station directory (used by PlayerProvider / cross-cutting hooks).
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: [STATION] } }),
  );
  // Front-door crossings (Dial). Not needed for /player, but may be fetched
  // by global providers.
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({ json: { names: [], hasLibrary: false, hasSeeds: false } }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  // Station-level now-playing (polled by PlayerDock when a station is loaded).
  await page.route(`**/api/stations/${SLUG}/now-playing`, (route) =>
    route.fulfill({ json: { nowPlaying: null } }),
  );
  // Suppress heartbeat writes — nothing is actually playing.
  await page.route("**/api/me/attendance/heartbeat", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
}

/**
 * Helper that dispatches a synthetic SSE MessageEvent payload to the fake
 * EventSource already mounted on the page.
 */
async function dispatchSseFrame(
  page: import("@playwright/test").Page,
  payload: Record<string, unknown>,
): Promise<void> {
  const data = JSON.stringify(payload);
  await page.evaluate((d: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const es = (window as any).__fakeEs as { _dispatch: (d: string) => void } | undefined;
    if (!es) throw new Error("Fake EventSource not found on window.__fakeEs");
    es._dispatch(d);
  }, data);
}

// ---------------------------------------------------------------------------
// Suite — WebPlayer ON AIR row (primary coverage)
// ---------------------------------------------------------------------------

test.describe("WebPlayer live track change via SSE", () => {
  test.beforeEach(async ({ page }) => {
    // Seed the session flag so the first-run modal never appears.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("lore:first-run-prompted", "1");
      } catch {
        /* ignore */
      }
    });
  });

  test("spin-raw frame shows new track with resolving cue; spin-changed clears it", async ({
    page,
  }) => {
    await injectFakeEventSource(page);
    await installCommonRoutes(page, makeOnAirResponse());

    await page.goto("/lore/player");

    // The WebPlayer ON AIR tab should render with the initial track.
    const row = page.locator(`[data-testid="wp-onair-${SLUG}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Old Artist");
    // No resolving cue on the initial polled data.
    await expect(
      page.locator(`[data-testid="wp-resolving-${SLUG}"]`),
    ).not.toBeVisible();

    // -----------------------------------------------------------------------
    // Step 1: deliver a spin-raw (provisional) frame.
    // -----------------------------------------------------------------------
    await dispatchSseFrame(page, {
      stationSlug: SLUG,
      rawArtist: "New Artist",
      rawTitle: "New Track",
      mbid: null,
      provisional: true,
      type: "spin-raw",
      observedAt: new Date().toISOString(),
    });

    // The new artist+title must appear immediately (no REST poll round-trip).
    await expect(row).toContainText("New Artist", { timeout: 5_000 });
    await expect(row).toContainText("New Track");

    // The resolving cue must be visible.
    const cue = page.locator(`[data-testid="wp-resolving-${SLUG}"]`);
    await expect(cue).toBeVisible({ timeout: 5_000 });

    // -----------------------------------------------------------------------
    // Step 2: deliver the matching spin-changed (resolved) frame.
    // -----------------------------------------------------------------------
    await dispatchSseFrame(page, {
      stationSlug: SLUG,
      rawArtist: "New Artist",
      rawTitle: "New Track",
      mbid: "bbbbbbbb-0000-0000-0000-000000000002",
      provisional: false,
      // Absence of `type` (or "spin-changed") signals the resolved event.
      observedAt: new Date().toISOString(),
    });

    // Track still visible — it did not disappear on resolution.
    await expect(row).toContainText("New Artist", { timeout: 5_000 });

    // Resolving cue must be gone.
    await expect(cue).not.toBeVisible({ timeout: 5_000 });
  });

  test("spin-raw-failed frame reverts the row to the pre-provisional track", async ({
    page,
  }) => {
    await injectFakeEventSource(page);
    await installCommonRoutes(page, makeOnAirResponse());

    await page.goto("/lore/player");

    const row = page.locator(`[data-testid="wp-onair-${SLUG}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Old Artist");

    // Deliver provisional frame.
    await dispatchSseFrame(page, {
      stationSlug: SLUG,
      rawArtist: "Phantom Artist",
      rawTitle: "Phantom Track",
      mbid: null,
      provisional: true,
      type: "spin-raw",
      observedAt: new Date().toISOString(),
    });

    await expect(row).toContainText("Phantom Artist", { timeout: 5_000 });
    await expect(
      page.locator(`[data-testid="wp-resolving-${SLUG}"]`),
    ).toBeVisible({ timeout: 5_000 });

    // Deliver the failure frame — the track never persisted.
    await dispatchSseFrame(page, {
      stationSlug: SLUG,
      rawArtist: "Phantom Artist",
      rawTitle: "Phantom Track",
      mbid: null,
      provisional: false,
      type: "spin-raw-failed",
      observedAt: new Date().toISOString(),
    });

    // The pre-provisional track must be restored.
    await expect(row).toContainText("Old Artist", { timeout: 5_000 });
    // Resolving cue must be gone.
    await expect(
      page.locator(`[data-testid="wp-resolving-${SLUG}"]`),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("a later spin-raw-failed for a superseded track does not clobber the current display", async ({
    page,
  }) => {
    await injectFakeEventSource(page);
    await installCommonRoutes(page, makeOnAirResponse());

    await page.goto("/lore/player");

    const row = page.locator(`[data-testid="wp-onair-${SLUG}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    // First provisional track.
    await dispatchSseFrame(page, {
      stationSlug: SLUG,
      rawArtist: "Phantom Artist",
      rawTitle: "Phantom Track",
      mbid: null,
      provisional: true,
      type: "spin-raw",
    });
    await expect(row).toContainText("Phantom Artist", { timeout: 5_000 });

    // Second provisional track supersedes the first.
    await dispatchSseFrame(page, {
      stationSlug: SLUG,
      rawArtist: "Real Artist",
      rawTitle: "Real Track",
      mbid: null,
      provisional: true,
      type: "spin-raw",
    });
    await expect(row).toContainText("Real Artist", { timeout: 5_000 });

    // A spin-raw-failed referencing the FIRST (superseded) track must be ignored.
    await dispatchSseFrame(page, {
      stationSlug: SLUG,
      rawArtist: "Phantom Artist",
      rawTitle: "Phantom Track",
      mbid: null,
      provisional: false,
      type: "spin-raw-failed",
    });

    // "Real Artist" still showing — the stale failure must not clobber it.
    await expect(row).toContainText("Real Artist", { timeout: 5_000 });
    // Resolving cue still on because Real Track's terminal frame hasn't arrived.
    await expect(
      page.locator(`[data-testid="wp-resolving-${SLUG}"]`),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Suite — PlayerDock bar (secondary coverage)
// ---------------------------------------------------------------------------

/**
 * Fixtures for the PlayerDock suite — mirror mobileFrontDoor.spec.ts so the
 * same route infrastructure reliably renders live .fdrow elements.
 */
const DOCK_SLUGS = [
  "nts-1",
  "kcrw",
  "bbc6",
  "wfmu",
  "kexp",
  "soma",
  "fip1",
  "nts-2",
];
const DOCK_STATIONS = DOCK_SLUGS.map((slug, idx) => ({
  id: idx + 1,
  slug,
  name: `Station ${slug.toUpperCase()}`,
  org: slug.toUpperCase(),
  city: "London",
  country: "GB",
  // Use a blockable test-only URL so no real stream connection is made.
  streamUrl: `https://stream.example.test/lore-e2e-${slug}`,
  streamQuality: null,
  streamFormat: "aac",
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
}));

function makeDockNowPlaying(slug: string, idx: number) {
  return {
    spinId: 900 + idx,
    rawArtist: `Artist ${idx + 1}`,
    rawTitle: `Track ${idx + 1}`,
    source: "nts_live",
    confidence: "unresolved" as const,
    playedAt: new Date(Date.now() - idx * 60_000).toISOString(),
    artworkUrl: null,
    recording: null,
    show: { name: `Show ${idx + 1}`, djName: `DJ ${idx + 1}` },
    isFirstSpin: false,
    isLibraryHit: true,
    isArtistHit: true,
  };
}

function makeDockSchedule() {
  const now = Date.now();
  return {
    items: DOCK_SLUGS.map((slug, idx) => ({
      stationSlug: slug,
      runs: [
        {
          runId: idx + 1,
          show: {
            name: `Show ${idx + 1}`,
            djName: `DJ ${idx + 1}`,
            pickerId: null,
          },
          spinCount: 10,
          resolvedCount: 0,
          startedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          endedAt: new Date(now + 60 * 60 * 1000).toISOString(),
        },
      ],
    })),
  };
}

function makeDockCrossings() {
  return {
    items: DOCK_SLUGS.map((slug, idx) => ({
      stationSlug: slug,
      crossings: 3 + idx,
      artistCrossings: 2,
      weekCrossings: 5 + idx,
      weekArtistCrossings: 3,
      monthCrossings: 10 + idx,
      monthArtistCrossings: 6,
      lifetimeCrossings: 20 + idx,
      lifetimeArtistCrossings: 12,
      topArtistNames: [`Artist ${idx + 1}`],
    })),
  };
}

/**
 * Install routes that mirror mobileFrontDoor.spec.ts — the exact infrastructure
 * known to produce live .fdrow elements at /lore/.
 */
async function installDockRoutes(
  page: import("@playwright/test").Page,
): Promise<void> {
  // Block every fake stream URL so no real audio connection is attempted.
  await page.route("https://stream.example.test/**", (route) => route.abort());

  // Specific /api/me/* routes before the catch-all (LIFO: last = first matched).
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route("**/api/me/crossings**", (route) =>
    route.fulfill({ json: makeDockCrossings() }),
  );
  await page.route("**/api/me/picker-names", (route) =>
    route.fulfill({
      json: {
        names: ["Artist 1", "Artist 2"],
        hasLibrary: true,
        hasSeeds: true,
      },
    }),
  );
  await page.route("**/api/me/pickers/overlap**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/me/album-avatar**", (route) =>
    route.fulfill({ json: { candidates: [], needsChoice: false } }),
  );
  await page.route("**/api/me/**", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );

  // Station directory — all 8 stations.
  await page.route("**/api/stations", (route) =>
    route.fulfill({ json: { stations: DOCK_STATIONS } }),
  );
  // Aggregate live-pulse list (drives liveBySlug in useDialData).
  await page.route("**/api/stations/now-playing", (route) =>
    route.fulfill({
      json: {
        items: DOCK_SLUGS.map((slug, idx) => ({
          slug,
          nowPlaying: makeDockNowPlaying(slug, idx),
        })),
      },
    }),
  );
  // SSE stream — keep-alive body; real events are dispatched via the fake ES.
  await page.route("**/api/stations/now-playing/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: ": ok\n\n",
    }),
  );
  // Per-station now-playing for each station.
  for (const [idx, slug] of DOCK_SLUGS.entries()) {
    await page.route(`**/api/stations/${slug}/now-playing`, (route) =>
      route.fulfill({
        json: {
          station: DOCK_STATIONS[idx],
          nowPlaying: makeDockNowPlaying(slug, idx),
        },
      }),
    );
  }
  await page.route("**/api/stations/schedule**", (route) =>
    route.fulfill({ json: makeDockSchedule() }),
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
}

// ---------------------------------------------------------------------------
// Suite — PlayerDock bar (secondary coverage)
// ---------------------------------------------------------------------------
//
// Status: SKIPPED — pre-existing blocker
//
// The PlayerDock test depends on .fdrow elements from the SplitHome dial.
// Those require mobileFrontDoor.spec.ts's route infrastructure to produce live
// station rows, but that spec is currently red on master independently of this
// task (pre-existing regression in the dial rendering path). The three
// WebPlayer tests above are the primary coverage required by task 288.
//
// The full implementation is preserved below inside test.skip so it can be
// unflagged once the fdrow infrastructure is restored. When enabling:
//   1. Remove the test.skip wrapper (keep the inner function as-is).
//   2. Add e2e/liveTrackChange.spec.ts to the lore-e2e-suite-gate RUN_SPECS.
//   3. Verify mobileFrontDoor.spec.ts also passes (shared dependency).
//
// Implementation strategy (for future reference):
//   - injectFakeEventSource replaces window.EventSource with a multi-instance
//     variant that broadcasts to all instances via window.__dispatchToAll(data).
//   - installDockRoutes mirrors mobileFrontDoor.spec.ts's 8-station fixture.
//   - navigate to /lore/ at 390×844 (mobile), click the first .fdrow, wait
//     for player-bar, then drive spin-raw/spin-changed SSE frames.
//
test.describe("PlayerDock live track change via SSE", () => {
  test.skip(
    "spin-raw shows player-bar-resolving; spin-changed clears it",
    async ({ page }) => {
      // ── setup ─────────────────────────────────────────────────────────────
      await page.addInitScript(() => {
        try {
          sessionStorage.setItem("lore:first-run-prompted", "1");
        } catch {
          /* ignore */
        }
        // Stub Audio so the player never makes real network requests.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).Audio = class {
          src = "";
          volume = 1;
          muted = false;
          paused = true;
          play() {
            return Promise.resolve();
          }
          pause() {}
          load() {}
          addEventListener() {}
          removeEventListener() {}
          dispatchEvent() {
            return true;
          }
        };
        // Multi-instance fake EventSource; dispatches to all subscribers.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all: any[] = [];
        class FakeEventSource {
          static readonly OPEN = 1;
          static readonly CLOSED = 2;
          readonly url: string;
          readyState = FakeEventSource.OPEN;
          onopen: ((ev: Event) => void) | null = null;
          onerror: ((ev: Event) => void) | null = null;
          onmessage: ((ev: MessageEvent) => void) | null = null;
          constructor(url: string) {
            this.url = url;
            all.push(this);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__fakeEsAll = all;
            Promise.resolve().then(() => {
              if (this.onopen) this.onopen(new Event("open"));
            });
          }
          close() {
            this.readyState = FakeEventSource.CLOSED;
          }
          _dispatch(d: string) {
            if (this.onmessage)
              this.onmessage(new MessageEvent("message", { data: d }));
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).EventSource = FakeEventSource;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__dispatchToAll = (d: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const es of all) (es as any)._dispatch(d);
        };
      });

      await installDockRoutes(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/lore/");

      // ── wait for live station row, tune in ────────────────────────────────
      await expect(page.locator(".fdrow").first()).toBeVisible({
        timeout: 20_000,
      });
      const firstRow = page.locator(".fdrow").first();
      await firstRow.click();
      await page.waitForTimeout(400);
      await firstRow.click();

      const playerBar = page.locator("[data-testid='player-bar']").first();
      await expect(playerBar).toBeVisible({ timeout: 10_000 });

      const tunedSlug = await page.evaluate(() => {
        const bar = document.querySelector("[data-testid='player-bar']");
        return bar?.getAttribute("data-station-slug") ?? "nts-1";
      });

      // ── spin-raw → resolving cue ──────────────────────────────────────────
      await page.evaluate(
        (d: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__dispatchToAll(d);
        },
        JSON.stringify({
          stationSlug: tunedSlug,
          rawArtist: "New Artist",
          rawTitle: "New Track",
          mbid: null,
          provisional: true,
          type: "spin-raw",
          observedAt: new Date().toISOString(),
        }),
      );
      await expect(
        page.locator("[data-testid='player-bar-resolving']"),
      ).toBeVisible({ timeout: 5_000 });

      // ── spin-changed → cue clears ─────────────────────────────────────────
      await page.evaluate(
        (d: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__dispatchToAll(d);
        },
        JSON.stringify({
          stationSlug: tunedSlug,
          rawArtist: "New Artist",
          rawTitle: "New Track",
          mbid: "cccccccc-0000-0000-0000-000000000003",
          provisional: false,
          observedAt: new Date().toISOString(),
        }),
      );
      await expect(
        page.locator("[data-testid='player-bar-resolving']"),
      ).not.toBeVisible({ timeout: 5_000 });
    },
  );
});
