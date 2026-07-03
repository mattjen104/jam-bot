import { test, expect, type APIRequestContext } from "@playwright/test";

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
 *   - PickerRun   (/archive/picker-runs/:runId)
 *
 * Run IDs are derived groupings (min spin/pick id per run), so they drift
 * between environments as data is re-ingested. The tests therefore discover
 * real run IDs at runtime through the public API instead of hardcoding them:
 *   - Station run: first archived run in GET /api/recordings/:mbid/spins
 *   - Picker run:  first resolved run in GET /api/pickers/:handle/archive
 *
 * Stable anchors used for discovery:
 *   - Recording MBID: 163a820c-e2a2-4219-aa90-8b528f31754d (a resolved spin)
 *   - Picker handle: nts-floating-points (has runs with resolved picks)
 *   - "from" MBID used in the fallback tests: "nonexistent-mbid-xyz" (never
 *     in any run's resolved tracklist by construction)
 */

const REAL_MBID = "163a820c-e2a2-4219-aa90-8b528f31754d";
const PICKER_HANDLE = "nts-floating-points";
const ABSENT_MBID = "nonexistent-mbid-xyz";

// ---------------------------------------------------------------------------
// Run discovery helpers — resolve real run IDs from the live API (memoized)
// ---------------------------------------------------------------------------

let stationRunId: number | undefined;
let pickerRun: { runId: number; resolvedMbid: string } | undefined;

/** First archived station run that contains REAL_MBID as a resolved spin. */
async function getStationRunId(request: APIRequestContext): Promise<number> {
  if (stationRunId !== undefined) return stationRunId;
  const res = await request.get(`/api/recordings/${REAL_MBID}/spins`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    spins: Array<{ runId: number | null }>;
  };
  const withRun = body.spins.find((s) => s.runId != null);
  expect(
    withRun,
    `expected recording ${REAL_MBID} to have at least one archived spin`,
  ).toBeTruthy();
  stationRunId = withRun!.runId!;
  return stationRunId;
}

/** First picker run (for PICKER_HANDLE) with resolved picks, plus one of
 *  its resolved MBIDs — the "present in the run" control case. */
async function getPickerRun(
  request: APIRequestContext,
): Promise<{ runId: number; resolvedMbid: string }> {
  if (pickerRun !== undefined) return pickerRun;
  const archiveRes = await request.get(
    `/api/pickers/${PICKER_HANDLE}/archive`,
  );
  expect(archiveRes.ok()).toBe(true);
  const archive = (await archiveRes.json()) as {
    runs: Array<{ runId: number; resolvedCount: number }>;
  };
  const run = archive.runs.find((r) => r.resolvedCount > 0);
  expect(
    run,
    `expected picker ${PICKER_HANDLE} to have a run with resolved picks`,
  ).toBeTruthy();

  const runRes = await request.get(`/api/archive/picker-runs/${run!.runId}`);
  expect(runRes.ok()).toBe(true);
  const detail = (await runRes.json()) as {
    tracks: Array<{ recording: { mbid: string } | null }>;
  };
  const resolved = detail.tracks.find((t) => t.recording != null);
  expect(resolved).toBeTruthy();
  pickerRun = { runId: run!.runId, resolvedMbid: resolved!.recording!.mbid };
  return pickerRun;
}

// ---------------------------------------------------------------------------
// Integrated flow: Song page → deep link with absent MBID → fallback notice
// ---------------------------------------------------------------------------

test.describe("Song page → 'Hear it in context' → fallback notice (integrated flow)", () => {
  test(
    "discovers run URL from Song page link, navigates with absent from= MBID, " +
      "sees fallback notice, dismisses it",
    async ({ page }) => {
      // Step 1: Land on the Song page for a real recording
      await page.goto(`/lore/song/${REAL_MBID}`);

      // Wait for the "Hear it in context" link in the spin history section
      const spinReplayLink = page.getByTestId("spin-replay-0");
      await expect(spinReplayLink).toBeVisible({ timeout: 10_000 });

      // Step 2: Read the href the Song page generated — it encodes the real run ID
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

    // Wait for the spin history section to appear (real network call)
    const spinReplayLink = page.getByTestId("spin-replay-0");
    await expect(spinReplayLink).toBeVisible({ timeout: 10_000 });

    const href = await spinReplayLink.getAttribute("href");
    expect(href).toMatch(/\/archive\/station-runs\/\d+/);
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
    request,
  }) => {
    // Navigate directly to the run URL with a non-existent from= MBID —
    // exactly what the Song page link does when that song was unresolved.
    const runId = await getStationRunId(request);
    await page.goto(
      `/lore/archive/station-runs/${runId}?play=1&from=${ABSENT_MBID}`,
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
    request,
  }) => {
    const runId = await getStationRunId(request);
    await page.goto(
      `/lore/archive/station-runs/${runId}?play=1&from=${ABSENT_MBID}`,
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
    request,
  }) => {
    // REAL_MBID belongs to this run (it was played), so no fallback is shown.
    const runId = await getStationRunId(request);
    await page.goto(
      `/lore/archive/station-runs/${runId}?play=1&from=${REAL_MBID}`,
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
    request,
  }) => {
    // Navigate directly to a picker run with a from= MBID that is not in the
    // run's resolved picks — the picker-run counterpart of the station flow.
    const { runId } = await getPickerRun(request);
    await page.goto(
      `/lore/archive/picker-runs/${runId}?play=1&from=${ABSENT_MBID}`,
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
    request,
  }) => {
    const { runId } = await getPickerRun(request);
    await page.goto(
      `/lore/archive/picker-runs/${runId}?play=1&from=${ABSENT_MBID}`,
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
    request,
  }) => {
    // The discovered MBID is a resolved pick in this run, so no fallback.
    const { runId, resolvedMbid } = await getPickerRun(request);
    await page.goto(
      `/lore/archive/picker-runs/${runId}?play=1&from=${resolvedMbid}`,
    );

    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByTestId("from-fallback-notice"),
    ).not.toBeVisible();
  });
});
