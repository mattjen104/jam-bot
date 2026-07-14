// @vitest-environment jsdom
/**
 * Schedule page column layout: every slot row shows an aligned Genre column
 * and a Discovery score column, with "—" placeholders when insights are
 * missing, and the new-music tier keeps its sparkle highlight.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@workspace/api-client-react", () => ({
  useGetAllScrapedShows: vi.fn(),
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

import { useGetAllScrapedShows } from "@workspace/api-client-react";
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScheduleCalendar genre & discovery columns", () => {
  it("renders genre chips and a tinted discovery score for enriched slots, and — placeholders otherwise", () => {
    (useGetAllScrapedShows as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        stations: [
          {
            slug: "kexp",
            name: "KEXP",
            shows: [
              {
                showName: "Seek & Destroy",
                dayOfWeek: todayDow,
                startTime: "00:00",
                endTime: "23:59",
                djName: "Tanner",
                genres: ["rock", "heavy metal", "metal"],
                discoveryScore: 78,
                discoveryLabel: "new-music",
              },
              {
                showName: "Mystery Hour",
                dayOfWeek: todayDow,
                startTime: "00:00",
                endTime: "23:58",
                djName: null,
                genres: [],
                discoveryScore: null,
                discoveryLabel: null,
              },
            ],
          },
        ],
      },
      isLoading: false,
    });

    renderSchedule();

    // Column headers are present (one per section container).
    expect(screen.getAllByText("Genre").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Disc.").length).toBeGreaterThan(0);

    // Both slots are live all day → live section rows.
    const rows = screen.getAllByTestId("slot-kexp-00:00");
    expect(rows.length).toBe(2);

    // Genre chips rendered.
    expect(screen.getByText("rock")).toBeTruthy();
    expect(screen.getByText("heavy metal")).toBeTruthy();

    // Discovery score cell shows the rounded number with the sparkle badge.
    const score = screen.getByTestId("discovery-kexp-00:00");
    expect(score.textContent).toContain("78");
    expect(screen.getByTestId("new-music-badge-kexp-00:00")).toBeTruthy();

    // The un-enriched slot shows placeholders (genre + discovery dashes).
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a 'recent' tier score without the sparkle badge", () => {
    (useGetAllScrapedShows as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        stations: [
          {
            slug: "fip",
            name: "FIP",
            shows: [
              {
                showName: "Club FIP",
                dayOfWeek: todayDow,
                startTime: "00:00",
                endTime: "23:59",
                djName: null,
                genres: ["jazz"],
                discoveryScore: 41.6,
                discoveryLabel: "recent",
              },
            ],
          },
        ],
      },
      isLoading: false,
    });

    renderSchedule();

    const score = screen.getByTestId("discovery-fip-00:00");
    expect(score.textContent).toContain("42"); // rounded
    expect(screen.queryByTestId("new-music-badge-fip-00:00")).toBeNull();
  });
});
