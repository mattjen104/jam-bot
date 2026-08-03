// @vitest-environment jsdom
/**
 * Confirms that the YourWeekCard week navigation correctly reflects both
 * sides of a Sunday/Monday midnight boundary.
 *
 * Covers:
 *  1. The card initially requests the current ISO week from useMyWeeklySummary.
 *  2. Clicking "Previous week" causes the card to request the prior ISO week
 *     (the week that contains Sunday 23:58 when the listener crossed midnight).
 *  3. Clicking "Next week" from the prior week returns to the current week.
 *  4. Both weeks surface their respective tracks with no cross-contamination.
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { YourWeekCard } from "../src/components/YourWeekCard";

// ---------------------------------------------------------------------------
// ISO week helpers (mirrors YourWeekCard.tsx — used to compute expected labels)
// ---------------------------------------------------------------------------

function mondayToIsoWeekLabel(monday: Date): string {
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86_400_000);
  const week =
    Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function currentIsoWeekLabel(): string {
  const now = new Date();
  const utcDay = now.getUTCDay() || 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (utcDay - 1)),
  );
  return mondayToIsoWeekLabel(monday);
}

function stepWeekLabel(label: string, delta: -1 | 1): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) throw new Error(`Bad week label: ${label}`);
  const isoYear = parseInt(m[1]!, 10);
  const isoWeek = parseInt(m[2]!, 10);
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86_400_000);
  const thisMonday = new Date(week1Monday.getTime() + (isoWeek - 1) * 7 * 86_400_000);
  const next = new Date(thisMonday.getTime() + delta * 7 * 86_400_000);
  return mondayToIsoWeekLabel(next);
}

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
      <a href={href}>{children}</a>
    ),
  };
});

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useIsAuthenticated: vi.fn(() => true as boolean | null),
    useMyWeeklySummary: vi.fn(() => ({ data: undefined, isLoading: false })),
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWeeklySummary(
  week: string,
  trackMbid: string,
  trackTitle: string,
): {
  week: string;
  weekStart: string;
  weekEnd: string;
  tracks: Array<{
    mbid: string;
    title: string;
    artist: string;
    artworkUrl: null;
    spinCount: number;
    dwellSeconds: number;
    firstHeard: string;
    lastHeard: string;
  }>;
  totalTracks: number;
  totalDwellSeconds: number;
} {
  // Derive weekStart/weekEnd from the label so formatWeekRange works.
  const m = /^(\d{4})-W(\d{2})$/.exec(week)!;
  const isoYear = parseInt(m[1]!, 10);
  const isoWeek = parseInt(m[2]!, 10);
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86_400_000);
  const monday = new Date(week1Monday.getTime() + (isoWeek - 1) * 7 * 86_400_000);
  const sunday = new Date(monday.getTime() + 7 * 86_400_000- 1);

  return {
    week,
    weekStart: monday.toISOString(),
    weekEnd: sunday.toISOString(),
    tracks: [
      {
        mbid: trackMbid,
        title: trackTitle,
        artist: "Test Artist",
        artworkUrl: null,
        spinCount: 1,
        dwellSeconds: 180,
        firstHeard: monday.toISOString(),
        lastHeard: monday.toISOString(),
      },
    ],
    totalTracks: 1,
    totalDwellSeconds: 180,
  };
}

function renderCard() {
  const { hook: loc } = memoryLocation({ path: "/", static: true });
  return render(
    <Router hook={loc}>
      <YourWeekCard />
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("YourWeekCard — midnight boundary week navigation", () => {
  const CURRENT_WEEK = currentIsoWeekLabel();
  const PREV_WEEK = stepWeekLabel(CURRENT_WEEK, -1);

  // Unique MBIDs so assertions can distinguish the two weeks.
  const MBID_CURRENT = `midnight-current-${Date.now()}`;
  const MBID_PREV = `midnight-prev-${Date.now()}`;

  beforeEach(async () => {
    // Set up useMyWeeklySummary to return week-appropriate data.
    // The hook is called with the currently selected week label.
    const { useMyWeeklySummary } = await import("../src/lib/meHooks");
    vi.mocked(useMyWeeklySummary).mockImplementation((week: string | null) => {
      if (week === CURRENT_WEEK) {
        return { data: makeWeeklySummary(CURRENT_WEEK, MBID_CURRENT, "Current Week Track"), isLoading: false };
      }
      if (week === PREV_WEEK) {
        return { data: makeWeeklySummary(PREV_WEEK, MBID_PREV, "Previous Week Track"), isLoading: false };
      }
      return { data: { week: week ?? "", weekStart: "", weekEnd: "", tracks: [], totalTracks: 0, totalDwellSeconds: 0 }, isLoading: false };
    });
  });

  it("initially requests the current ISO week and displays its tracks", async () => {
    renderCard();

    // The "Your week" kicker confirms the card rendered.
    expect(screen.getByText("Your week")).toBeTruthy();

    // The current week's track is visible.
    expect(screen.getByText("Current Week Track")).toBeTruthy();

    // The previous week's track is NOT visible.
    expect(screen.queryByText("Previous Week Track")).toBeNull();
  });

  it("navigating to the previous week shows that week's tracks", async () => {
    renderCard();

    // Navigate back one week.
    fireEvent.click(screen.getByTestId("your-week-prev"));

    // The previous week's track appears.
    expect(screen.getByText("Previous Week Track")).toBeTruthy();

    // The current week's track is gone.
    expect(screen.queryByText("Current Week Track")).toBeNull();
  });

  it("navigating back then forward returns to the current week", async () => {
    renderCard();

    // Go back …
    fireEvent.click(screen.getByTestId("your-week-prev"));
    expect(screen.getByText("Previous Week Track")).toBeTruthy();

    // … then forward again.
    fireEvent.click(screen.getByTestId("your-week-next"));
    expect(screen.getByText("Current Week Track")).toBeTruthy();
    expect(screen.queryByText("Previous Week Track")).toBeNull();
  });

  it("both weeks are independently queryable — no cross-contamination", async () => {
    // Verify the helper places Sunday 23:58 UTC and Monday 00:02 UTC in
    // different ISO weeks (pure unit test of the client-side week logic).
    const sundayNight = new Date("2026-01-18T23:58:00.000Z"); // Sunday
    const mondayMorning = new Date("2026-01-19T00:02:00.000Z"); // Monday

    function dateToIsoWeekLabel(d: Date): string {
      const utcDay = d.getUTCDay() || 7;
      const monday = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (utcDay - 1)),
      );
      return mondayToIsoWeekLabel(monday);
    }

    const sundayWeek = dateToIsoWeekLabel(sundayNight);
    const mondayWeek = dateToIsoWeekLabel(mondayMorning);

    // Sunday 23:58 must be in the earlier week.
    expect(sundayWeek).toBe("2026-W03");
    // Monday 00:02 must be in the later week.
    expect(mondayWeek).toBe("2026-W04");
    // The two are distinct — no double-counting.
    expect(sundayWeek).not.toBe(mondayWeek);

    // stepping back one week from "2026-W04" must land on "2026-W03"
    expect(stepWeekLabel("2026-W04", -1)).toBe("2026-W03");
    // stepping forward one week from "2026-W03" must land on "2026-W04"
    expect(stepWeekLabel("2026-W03", 1)).toBe("2026-W04");
  });
});
