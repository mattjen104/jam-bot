// @vitest-environment jsdom
/**
 * Regression tests for the Play icon on ShowTimeline chips inside StationList.
 *
 * The condition gating the Play icon is:
 *   (replayable || isActive)
 * where replayable = resolvedCount > 0 and isActive = run.runId === activeRunId.
 *
 * A show that just started has resolvedCount=0 but isActive=true, so the Play
 * icon must still appear. A past inactive show with resolvedCount=0 must not
 * show the icon.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Station, StationScheduleRun } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useGetStationUpcomingSchedule: vi.fn(() => ({
      data: { shows: [] },
      isLoading: false,
    })),
    getGetStationUpcomingScheduleQueryKey: vi.fn((slug: string) => [
      "station-upcoming-schedule",
      slug,
    ]),
  });
});

vi.mock("../src/components/QualityBadge", () => ({
  QualityBadge: () => null,
}));

vi.mock("../src/components/FollowButton", () => ({
  FollowButton: () => null,
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { StationList } from "../src/components/StationList";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeStation(slug = "test-fm"): Station {
  return {
    id: 1,
    slug,
    name: "Test FM",
    streamUrl: "https://stream.example.com/test",
    streamFormat: "mp3",
    mode: "spinitron",
    attribution: false,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    org: null,
    city: null,
    country: null,
    streamQuality: null,
    homepageUrl: null,
    donateUrl: null,
    logoUrl: null,
    tags: [],
  } as unknown as Station;
}

function makeRun(
  overrides: Partial<StationScheduleRun> & Pick<StationScheduleRun, "runId" | "startedAt" | "endedAt" | "resolvedCount">,
): StationScheduleRun {
  return {
    show: { name: "Morning Show", djName: null, pickerId: null },
    spinCount: 10,
    ...overrides,
  };
}

function renderList(slug: string, runs: StationScheduleRun[]) {
  const station = makeStation(slug);
  return render(
    <StationList
      stations={[station]}
      activeSlug={null}
      status="idle"
      schedule={new Map([[slug, runs]])}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
}

/** Returns the show-chip element for the given runId, or null. */
function getChip(container: HTMLElement, runId: number | string) {
  return container.querySelector(`[data-testid="show-chip-${runId}"]`);
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ShowTimeline — Play icon on active chip with zero resolved tracks", () => {
  it("renders the Play icon when isActive=true and resolvedCount=0 (show just started)", () => {
    const now = Date.now();
    const run = makeRun({
      runId: 1,
      resolvedCount: 0,
      startedAt: new Date(now - 60_000).toISOString(),      // started 1 min ago
      endedAt: new Date(now + 2 * 60 * 60_000).toISOString(), // ends 2 h from now
    });

    const { container } = renderList("test-fm", [run]);

    const chip = getChip(container, 1);
    expect(chip, "show-chip-1 should be in the DOM").not.toBeNull();

    // The Play icon from lucide-react renders as an <svg> inside the chip.
    const svg = chip!.querySelector("svg");
    expect(svg, "Play icon <svg> should be present when isActive=true and resolvedCount=0").not.toBeNull();
  });

  it("does not render the Play icon when isActive=false and resolvedCount=0", () => {
    const now = Date.now();
    // Run 1: ended 6 hours ago — outside the 4-hour recency window, not the active run.
    const staleRun = makeRun({
      runId: 1,
      resolvedCount: 0,
      startedAt: new Date(now - 8 * 60 * 60_000).toISOString(), // 8 h ago
      endedAt: new Date(now - 6 * 60 * 60_000).toISOString(),   // 6 h ago
    });
    // Run 2: currently live — becomes the activeRunId (both by time and as last run).
    const activeRun = makeRun({
      runId: 2,
      resolvedCount: 0,
      startedAt: new Date(now - 30 * 60_000).toISOString(),       // 30 min ago
      endedAt: new Date(now + 90 * 60_000).toISOString(),          // 90 min from now
    });

    const { container } = renderList("test-fm", [staleRun, activeRun]);

    const staleChip = getChip(container, 1);
    expect(staleChip, "show-chip-1 should be in the DOM").not.toBeNull();

    // The stale chip is neither active nor replayable — no Play icon.
    const svg = staleChip!.querySelector("svg");
    expect(svg, "Play icon <svg> should NOT be present when isActive=false and resolvedCount=0").toBeNull();
  });
});

describe("ShowTimeline — Play icon on replayable chips (existing behaviour)", () => {
  it("renders the Play icon on a past chip that has resolved tracks even when not active", () => {
    const now = Date.now();
    // Run 1: ended well outside the 4-hour window but has resolved tracks.
    const replayableRun = makeRun({
      runId: 10,
      resolvedCount: 5,
      startedAt: new Date(now - 8 * 60 * 60_000).toISOString(),
      endedAt: new Date(now - 6 * 60 * 60_000).toISOString(),
    });
    // Run 2: currently live, becomes activeRunId.
    const activeRun = makeRun({
      runId: 11,
      resolvedCount: 0,
      startedAt: new Date(now - 15 * 60_000).toISOString(),
      endedAt: new Date(now + 2 * 60 * 60_000).toISOString(),
    });

    const { container } = renderList("test-fm", [replayableRun, activeRun]);

    const chip = getChip(container, 10);
    expect(chip, "show-chip-10 should be in the DOM").not.toBeNull();

    const svg = chip!.querySelector("svg");
    expect(svg, "Play icon <svg> should be present when resolvedCount > 0 (replayable)").not.toBeNull();
  });

  it("renders the Play icon on the active chip that also has resolved tracks", () => {
    const now = Date.now();
    const run = makeRun({
      runId: 20,
      resolvedCount: 3,
      startedAt: new Date(now - 60 * 60_000).toISOString(),
      endedAt: new Date(now + 60 * 60_000).toISOString(),
    });

    const { container } = renderList("test-fm", [run]);

    const chip = getChip(container, 20);
    expect(chip).not.toBeNull();

    const svg = chip!.querySelector("svg");
    expect(svg, "Play icon <svg> should be present when both isActive and replayable").not.toBeNull();
  });
});
