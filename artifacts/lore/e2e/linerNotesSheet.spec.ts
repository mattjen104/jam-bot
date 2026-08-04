import { test, expect } from "@playwright/test";

/**
 * End-to-end tests for the liner notes sheet gesture chain:
 *
 *   long-press nav sleeve → peek card appears → tap album art → sheet slides up
 *
 * The tests run deterministically by:
 *   1. Seeding localStorage with a radio section-memory record containing a
 *      track MBID so the peek card has a track identity to display.
 *   2. Intercepting the recording-knowledge API to return credits so the
 *      album-art button is rendered as tappable (hasKnowledge = true).
 *   3. Stubbing all other API calls the page makes at boot so no real network
 *      traffic is needed.
 *
 * The long-press gesture is replicated via Playwright's mouse API:
 *   mouse.move → mouse.down → waitForTimeout(600ms) → mouse.up
 * (HOLD_MS in RecordPeekNav is 480 ms.)
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_MBID = "aaaabbbb-cccc-dddd-eeee-liner0001test";
const TEST_TITLE = "Liner Notes Test Track";
const TEST_ARTIST = "Liner Notes Test Artist";

/** Section memory written into localStorage before each test. */
const SECTION_MEMORY = {
  version: 1,
  radio: {
    kind: "radio",
    station: {
      id: 1,
      slug: "test-station",
      name: "Test Radio Station",
      streamUrl: "http://example.invalid/stream.mp3",
      streamFormat: "mp3",
      logoUrl: null,
    },
    lastTrack: {
      artworkUrl: "https://placehold.co/150",
      title: TEST_TITLE,
      artist: TEST_ARTIST,
      mbid: TEST_MBID,
    },
  },
  selectors: null,
  library: null,
};

/** Knowledge response that makes hasKnowledge = true (has personnel). */
const KNOWLEDGE_WITH_CREDITS = {
  knowledge: {
    personnel: [
      { name: "Jane Producer", role: "Producer" },
      { name: "John Engineer", role: "Engineer" },
    ],
    pressing: null,
    relationships: [],
  },
  claims: [],
};

/** Knowledge response with no usable credits — makes hasKnowledge = false. */
const EMPTY_KNOWLEDGE = {
  knowledge: { personnel: [], pressing: null, relationships: [] },
  claims: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Install the stub routes required for a clean page load on /lore/.
 * All API calls the app makes at boot are satisfied with minimal, valid
 * responses so nothing errors in the console.
 */
async function installBaseRoutes(
  page: import("@playwright/test").Page,
  opts: { knowledge?: unknown } = {},
) {
  // Connections — unauthenticated (no Spotify banner needed)
  await page.route("**/api/me/connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );

  // Library — empty
  await page.route("**/api/me/library*", (route) =>
    route.fulfill({ json: { items: [], cursor: null } }),
  );

  // Import job — none
  await page.route("**/api/me/library/import", (route) =>
    route.fulfill({ status: 404, json: { error: "No import job found" } }),
  );

  // Album avatar
  await page.route("**/api/me/album-avatar", (route) =>
    route.fulfill({ json: { current: null, candidates: [] } }),
  );

  // Pickers dial — empty
  await page.route("**/api/pickers/dial", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  // Stations list
  await page.route("**/api/stations*", (route) =>
    route.fulfill({ json: { stations: [] } }),
  );

  // Now-playing / live data
  await page.route("**/api/stations/*/now-playing", (route) =>
    route.fulfill({ json: { nowPlaying: null } }),
  );

  // Recording knowledge — configurable per test
  const knowledgeResponse = opts.knowledge ?? KNOWLEDGE_WITH_CREDITS;
  await page.route(`**/api/recordings/${TEST_MBID}/knowledge`, (route) =>
    route.fulfill({ json: knowledgeResponse }),
  );

  // Catch-all for any other recordings/* knowledge calls
  await page.route("**/api/recordings/*/knowledge", (route) =>
    route.fulfill({ json: EMPTY_KNOWLEDGE }),
  );
}

/**
 * Seed localStorage with the test section-memory record and navigate to the
 * Lore Radio home page.  Navigation loads the page with LocalStorage already
 * populated so the RecordPeekNav component sees the radio memory on first
 * render.
 */
async function loadPageWithMemory(page: import("@playwright/test").Page) {
  // First visit to establish the origin so we can write localStorage.
  await page.goto("/lore/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      "lore:record-peek-memory",
      JSON.stringify(SECTION_MEMORY),
    ] as [string, string],
  );
  // Reload so the component picks up the stored memory on mount.
  await page.reload();
}

/**
 * Long-press the Radio nav sleeve button.
 *
 * Playwright's mouse API fires real pointer events that the onPointerDown /
 * onPointerUp handlers in RecordPeekNav listen to. We hold for 600 ms, which
 * exceeds the 480 ms HOLD_MS threshold.
 */
async function longPressRadioSleeve(page: import("@playwright/test").Page) {
  const radioBtn = page.locator('button[data-section="radio"]');
  await expect(radioBtn).toBeVisible({ timeout: 10_000 });

  const box = await radioBtn.boundingBox();
  if (!box) throw new Error("Radio nav button has no bounding box");

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
}

// ---------------------------------------------------------------------------
// Suite 1 — Peek card appears after long-press
// ---------------------------------------------------------------------------

test.describe("RecordPeekNav — peek card via long-press", () => {
  test("peek card is visible after holding the radio sleeve for 600 ms", async ({
    page,
  }) => {
    await installBaseRoutes(page);
    await loadPageWithMemory(page);
    await longPressRadioSleeve(page);

    // The peek card section has aria-label="radio resume"
    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).toBeVisible({ timeout: 5_000 });
  });

  test("peek card shows the station name from section memory", async ({
    page,
  }) => {
    await installBaseRoutes(page);
    await loadPageWithMemory(page);
    await longPressRadioSleeve(page);

    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).toBeVisible({ timeout: 5_000 });
    await expect(peekCard).toContainText("Test Radio Station");
  });

  test("dismiss button closes the peek card", async ({ page }) => {
    await installBaseRoutes(page);
    await loadPageWithMemory(page);
    await longPressRadioSleeve(page);

    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Dismiss resume peek" }).click();
    await expect(peekCard).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Album art is tappable when knowledge is present
// ---------------------------------------------------------------------------

test.describe("RecordPeekNav — album art tap opens liner notes", () => {
  test("album art button is present when the track has credits", async ({
    page,
  }) => {
    await installBaseRoutes(page, { knowledge: KNOWLEDGE_WITH_CREDITS });
    await loadPageWithMemory(page);
    await longPressRadioSleeve(page);

    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).toBeVisible({ timeout: 5_000 });

    // The tappable album-art button should appear once the knowledge query
    // resolves. React Query fetches it as soon as peekTrackMbid is set.
    const artBtn = peekCard.getByRole("button", { name: "Open liner notes" });
    await expect(artBtn).toBeVisible({ timeout: 8_000 });
  });

  test("tapping album art opens the liner notes sheet", async ({ page }) => {
    await installBaseRoutes(page, { knowledge: KNOWLEDGE_WITH_CREDITS });
    await loadPageWithMemory(page);
    await longPressRadioSleeve(page);

    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).toBeVisible({ timeout: 5_000 });

    const artBtn = peekCard.getByRole("button", { name: "Open liner notes" });
    await expect(artBtn).toBeVisible({ timeout: 8_000 });

    await artBtn.click();

    // The liner notes sheet has role="dialog" and aria-label="Liner notes"
    const sheet = page.getByRole("dialog", { name: "Liner notes" });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
  });

  test("liner notes sheet header shows track title and artist", async ({
    page,
  }) => {
    await installBaseRoutes(page, { knowledge: KNOWLEDGE_WITH_CREDITS });
    await loadPageWithMemory(page);
    await longPressRadioSleeve(page);

    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).toBeVisible({ timeout: 5_000 });

    const artBtn = peekCard.getByRole("button", { name: "Open liner notes" });
    await expect(artBtn).toBeVisible({ timeout: 8_000 });
    await artBtn.click();

    const sheet = page.getByRole("dialog", { name: "Liner notes" });
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // The header must contain both the track title and artist name
    await expect(sheet).toContainText(TEST_TITLE);
    await expect(sheet).toContainText(TEST_ARTIST);
  });

  test("liner notes sheet shows credits from the knowledge response", async ({
    page,
  }) => {
    await installBaseRoutes(page, { knowledge: KNOWLEDGE_WITH_CREDITS });
    await loadPageWithMemory(page);
    await longPressRadioSleeve(page);

    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).toBeVisible({ timeout: 5_000 });

    const artBtn = peekCard.getByRole("button", { name: "Open liner notes" });
    await expect(artBtn).toBeVisible({ timeout: 8_000 });
    await artBtn.click();

    const sheet = page.getByRole("dialog", { name: "Liner notes" });
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // CREDITS section should render the producer's name
    await expect(sheet).toContainText("Jane Producer");
    await expect(sheet).toContainText("Produced by");
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Dismissing the sheet returns to normal state
// ---------------------------------------------------------------------------

test.describe("LinerNotesSheet — close button", () => {
  /**
   * Helper: navigate to page with memory, long-press, open the sheet.
   * Returns the sheet locator.
   */
  async function openSheet(page: import("@playwright/test").Page) {
    await installBaseRoutes(page, { knowledge: KNOWLEDGE_WITH_CREDITS });
    await loadPageWithMemory(page);
    await longPressRadioSleeve(page);

    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).toBeVisible({ timeout: 5_000 });

    const artBtn = peekCard.getByRole("button", { name: "Open liner notes" });
    await expect(artBtn).toBeVisible({ timeout: 8_000 });
    await artBtn.click();

    const sheet = page.getByRole("dialog", { name: "Liner notes" });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    return sheet;
  }

  test("✕ button closes the liner notes sheet", async ({ page }) => {
    const sheet = await openSheet(page);

    await page.getByRole("button", { name: "Close liner notes" }).click();

    await expect(sheet).not.toBeVisible({ timeout: 3_000 });
  });

  test("sheet is gone and nav is back in its normal state after close", async ({
    page,
  }) => {
    const sheet = await openSheet(page);

    await page.getByRole("button", { name: "Close liner notes" }).click();
    await expect(sheet).not.toBeVisible({ timeout: 3_000 });

    // The nav bar must still be present and interactive after dismissal
    const radioBtn = page.locator('button[data-section="radio"]');
    await expect(radioBtn).toBeVisible();

    // The peek card must also be gone (it was cleared when the art was tapped)
    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).not.toBeVisible();
  });

  test("Escape key also closes the sheet", async ({ page }) => {
    const sheet = await openSheet(page);

    await page.keyboard.press("Escape");

    await expect(sheet).not.toBeVisible({ timeout: 3_000 });
  });

  test("clicking the backdrop closes the sheet", async ({ page }) => {
    const sheet = await openSheet(page);

    // The backdrop is a sibling element with class liner-sheet__backdrop
    const backdrop = page.locator(".liner-sheet__backdrop");
    await expect(backdrop).toBeVisible();
    await backdrop.click();

    await expect(sheet).not.toBeVisible({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Album art is NOT tappable when no knowledge is available
// ---------------------------------------------------------------------------

test.describe("RecordPeekNav — album art when no knowledge", () => {
  test("album art is rendered as a plain span (not a button) when knowledge is empty", async ({
    page,
  }) => {
    await installBaseRoutes(page, { knowledge: EMPTY_KNOWLEDGE });
    await loadPageWithMemory(page);
    await longPressRadioSleeve(page);

    const peekCard = page.locator('[aria-label="radio resume"]');
    await expect(peekCard).toBeVisible({ timeout: 5_000 });

    // Wait for the knowledge query to resolve (no spinner, just wait for the
    // button to remain absent after a short settling period)
    await page.waitForTimeout(3_000);

    // No "Open liner notes" button should be present
    await expect(
      peekCard.getByRole("button", { name: "Open liner notes" }),
    ).not.toBeVisible();
  });
});
