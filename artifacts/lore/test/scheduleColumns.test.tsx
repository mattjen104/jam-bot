// @vitest-environment jsdom
/**
 * Schedule page column layout: every slot row shows an aligned "Recent plays"
 * rolling-genre column and an "Era" discovery column, with "—" placeholders
 * when rolling data is missing, and the new-music tier keeps its sparkle
 * highlight.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// PlayerProvider (rendered inside ScheduleCalendar's subtree) uses useWpOnAir
// (React Query). Stub it so tests don't need a real QueryClientProvider.
vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/webplayer/hooks")>();
  return {
    ...actual,
    useWpOnAir: vi.fn(() => ({ data: undefined, isLoading: false, dataUpdatedAt: 0 })),
    useWpLoreCounts: vi.fn(() => ({ data: undefined })),
    useWpRecordingSpins: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })),
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useGetAllScrapedShows: vi.fn(),
  useGetStationsRollingGenres: vi.fn(() => ({ data: undefined })),
  useListStations: vi.fn(() => ({ data: null, isLoading: false })),
  getSpotifyStatus: vi.fn(async () => ({
    configured: false,
    connected: false,
    premium: false,
    displayName: null,
    product: null,
  })),
  getStationNowPlaying: vi.fn(),
  getSpotifyPlayer: vi.fn(),
  spotifyPlay: vi.fn(),
  spotifyPause: vi.fn(async () => {}),
  spotifyResume: vi.fn(),
  spotifyLogout: vi.fn(),
  getRecordingPreview: vi.fn(async () => ({ previewUrl: null, artworkUrl: null })),
}));

import {
  useGetAllScrapedShows,
  useGetStationsRollingGenres,
} from "@workspace/api-client-react";
import { PlayerProvider } from "../src/player/PlayerProvider";
import ScheduleCalendar from "../src/pages/ScheduleCalendar";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const todayDow = DOW[new Date().getDay()];

function renderSchedule() {
  const { hook } = memoryLocation({ path: "/schedule", static: true });
  return render(
    <Router hook={hook}>
      <PlayerProvider>
        <ScheduleCalendar />
      </PlayerProvider>
    </Router>,
  );
}

function mockShows(
  slug: string,
  name: string,
  shows: Array<Record<string, unknown>>,
) {
  (useGetAllScrapedShows as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { stations: [{ slug, name, shows }] },
    isLoading: false,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScheduleCalendar rolling-genre & era columns", () => {
  it("renders rolling genre chips and a sparkled 'new' era label for enriched stations, and — placeholders otherwise", () => {
    mockShows("kexp", "KEXP", [
      {
        showName: "Seek & Destroy",
        dayOfWeek: todayDow,
        startTime: "00:00",
        endTime: "23:59",
        djName: "Tanner",
      },
    ]);
    (useGetStationsRollingGenres as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        stations: {
          kexp: [
            // chips[0] = newest
            { genre: "heavy metal", playedAt: "2026-07-16T10:00:00Z", discoveryLabel: "new-music" },
            { genre: "rock", playedAt: "2026-07-16T09:55:00Z", discoveryLabel: null },
          ],
        },
      },
    });

    renderSchedule();

    // Column headers are present (one per section container).
    expect(screen.getAllByText("Recent plays").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Era").length).toBeGreaterThan(0);

    // The slot row renders.
    expect(screen.getAllByTestId("slot-kexp-00:00").length).toBeGreaterThan(0);

    // Rolling genre chips rendered.
    expect(screen.getAllByText("rock").length).toBeGreaterThan(0);
    expect(screen.getAllByText("heavy metal").length).toBeGreaterThan(0);

    // Era label shows the new-music tier with its sparkle icon.
    const eras = screen.getAllByTestId("discovery-era-label");
    expect(eras.some((el) => el.textContent?.includes("new"))).toBe(true);
    expect(eras.some((el) => el.querySelector("svg") !== null)).toBe(true);
  });

  it("shows a 'recent' era label without the sparkle, and — when no rolling data exists", () => {
    mockShows("fip", "FIP", [
      {
        showName: "Club FIP",
        dayOfWeek: todayDow,
        startTime: "00:00",
        endTime: "23:59",
        djName: null,
      },
    ]);
    (useGetStationsRollingGenres as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        stations: {
          fip: [
            { genre: "jazz", playedAt: "2026-07-16T10:00:00Z", discoveryLabel: "recent" },
          ],
        },
      },
    });

    renderSchedule();

    const eras = screen.getAllByTestId("discovery-era-label");
    expect(eras.some((el) => el.textContent?.includes("recent"))).toBe(true);
    // 'recent' tier never gets the sparkle icon.
    expect(eras.every((el) => el.querySelector("svg") === null)).toBe(true);
  });

  it("shows placeholders when a station has no rolling data", () => {
    mockShows("kexp", "KEXP", [
      {
        showName: "Mystery Hour",
        dayOfWeek: todayDow,
        startTime: "00:00",
        endTime: "23:59",
        djName: null,
      },
    ]);
    // Rolling genres endpoint has nothing yet.
    (useGetStationsRollingGenres as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { stations: {} },
    });

    renderSchedule();

    expect(screen.getAllByTestId("slot-kexp-00:00").length).toBeGreaterThan(0);
    // Genre and era columns both degrade to dashes.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("discovery-era-label")).toBeNull();
  });
});
