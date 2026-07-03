// @vitest-environment jsdom
/**
 * End-to-end integration tests for the "hear it in context" → fallback notice flow.
 *
 * These tests cover the full user journey that unit tests cannot:
 *   1. Song page renders "Hear it in context" links with the correct
 *      ?from=<mbid>&play=1 deep-link URL pointing at a station/picker run.
 *   2. Navigating to that URL when the mbid is NOT in the run's resolved
 *      tracklist triggers the amber fallback notice.
 *   3. Clicking the dismiss button hides the notice.
 *
 * Together these tests pin the end-to-end contract across Song → StationRun
 * and Song → PickerRun without requiring a real browser or network.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@workspace/api-client-react", () => ({
  useGetRecording: vi.fn(),
  useGetRecordingPreview: vi.fn(),
  useGetRecordingEntry: vi.fn(),
  useGetRecordingKnowledge: vi.fn(),
  useGetRecordingLyrics: vi.fn(),
  useGetRecordingSpins: vi.fn(),
  useGetRecordingSegues: vi.fn(),
  useGetRecordingPicks: vi.fn(),
  useGetStationRun: vi.fn(),
  useGetPickerRun: vi.fn(),
  getRecording: vi.fn(async () => ({ links: [] })),
  getRecordingSegues: vi.fn(async () => ({ next: [] })),
  getRecordingPreview: vi.fn(async (mbid: string) => ({
    previewUrl: `https://previews.example/${mbid}.mp3`,
    artworkUrl: null,
  })),
  getStationNowPlaying: vi.fn(),
  spotifyPlay: vi.fn(),
  spotifyPause: vi.fn(async () => {}),
  spotifyResume: vi.fn(),
  getSpotifyPlayer: vi.fn(),
  getSpotifyStatus: vi.fn(async () => ({
    configured: false,
    connected: false,
    premium: false,
    displayName: null,
    product: null,
  })),
  spotifyLogout: vi.fn(),
}));

import {
  useGetRecording,
  useGetRecordingPreview,
  useGetRecordingEntry,
  useGetRecordingKnowledge,
  useGetRecordingLyrics,
  useGetRecordingSpins,
  useGetRecordingSegues,
  useGetRecordingPicks,
  useGetStationRun,
  useGetPickerRun,
} from "@workspace/api-client-react";
import { PlayerProvider } from "../src/player/PlayerProvider";
import { PlayerDock } from "../src/components/PlayerDock";
import Song from "../src/pages/Song";
import StationRun from "../src/pages/StationRun";
import PickerRun from "../src/pages/PickerRun";

// --------------------------------------------------------------------------
// Shared test data
// --------------------------------------------------------------------------

const SONG_MBID = "song-mbid-anchor";
const RUN_ID = 42;

/** A recording whose mbid is SONG_MBID — present in the Song page. */
const recordingData = {
  mbid: SONG_MBID,
  title: "Anchor Track",
  artist: "Test Artist",
  artworkUrl: null,
  links: [],
  releaseYear: null,
  duration: null,
  isrc: null,
};

/** Spin history for SONG_MBID: one spin with a runId. */
const spinsData = [
  {
    spinId: 1,
    runId: RUN_ID,
    playedAt: "2024-06-02T10:00:00Z",
    confidence: "recording_id" as const,
    station: { name: "KEXP 90.3 FM", slug: "kexp" },
    show: { name: "Morning Show", djName: null },
  },
];

/** Picks data for SONG_MBID: one pick with a runId from a picker. */
const picksData = [
  {
    runId: RUN_ID,
    sourceUrl: "https://example.com/list",
    listTitle: "Good Tracks",
    ordinal: 3,
    trackCount: 20,
    pickedAt: "2024-06-01T00:00:00Z",
    picker: {
      handle: "gilles",
      name: "Gilles Peterson",
      pickerType: "dj",
      trustTier: "A",
    },
  },
];

/**
 * A run with 5 resolved tracks — SONG_MBID is intentionally NOT among them.
 * This is the "from= not found" scenario that triggers the fallback notice.
 */
function makeRunData(kind: "station" | "picker") {
  const tracks = Array.from({ length: 5 }, (_, i) => ({
    position: i,
    rawTitle: `Track ${i}`,
    rawArtist: `Artist ${i}`,
    playedAt: `2024-06-02T10:0${i}:00Z`,
    confidence: "recording_id",
    recording: {
      mbid: `run-mbid-${i}`,
      title: `Track ${i}`,
      artist: `Artist ${i}`,
      artworkUrl: null,
      links: [],
    },
  }));

  if (kind === "station") {
    return {
      station: { name: "KEXP", slug: "kexp" },
      run: {
        date: "2024-06-02",
        show: { name: "Morning Show", djName: null },
        sourceUrl: null,
      },
      tracks,
    };
  }
  return {
    picker: { name: "Gilles Peterson", handle: "gilles" },
    run: {
      title: "Good Tracks",
      pickedAt: "2024-06-01",
      sourceUrl: "https://example.com/list",
    },
    tracks,
  };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function renderSongPage(mbid: string) {
  const { hook, searchHook } = memoryLocation({
    path: `/song/${mbid}`,
    searchPath: "",
    static: true,
  });
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <PlayerProvider>
        <Route path="/song/:mbid" component={Song} />
        <PlayerDock />
      </PlayerProvider>
    </Router>,
  );
}

function renderRunPage(
  kind: "station" | "picker",
  runId: number,
  searchPath: string,
) {
  const base =
    kind === "station" ? "/archive/station-runs" : "/archive/picker-runs";
  const { hook, searchHook } = memoryLocation({
    path: `${base}/${runId}`,
    searchPath,
    static: true,
  });
  const PageComponent = kind === "station" ? StationRun : PickerRun;
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <PlayerProvider>
        <Route path={`${base}/:runId`} component={PageComponent} />
        <PlayerDock />
      </PlayerProvider>
    </Router>,
  );
}

// --------------------------------------------------------------------------
// Test setup
// --------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(
    () => {},
  );
  vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(
    () => {},
  );

  // Song page hooks
  (useGetRecording as Mock).mockReturnValue({
    data: recordingData,
    isLoading: false,
    isError: false,
  });
  (useGetRecordingPreview as Mock).mockReturnValue({
    data: null,
    isLoading: false,
  });
  (useGetRecordingEntry as Mock).mockReturnValue({
    data: null,
    isLoading: false,
  });
  (useGetRecordingKnowledge as Mock).mockReturnValue({
    data: null,
    isLoading: false,
  });
  (useGetRecordingLyrics as Mock).mockReturnValue({
    data: null,
    isLoading: false,
  });
  (useGetRecordingSpins as Mock).mockReturnValue({
    data: { spins: spinsData },
    isLoading: false,
    isError: false,
  });
  (useGetRecordingSegues as Mock).mockReturnValue({
    data: { next: [] },
    isLoading: false,
  });
  (useGetRecordingPicks as Mock).mockReturnValue({
    data: { picks: picksData },
    isLoading: false,
    isError: false,
  });

  // Archive run hooks — note SONG_MBID is absent from the resolved tracklist
  (useGetStationRun as Mock).mockReturnValue({
    data: makeRunData("station"),
    isLoading: false,
    isError: false,
  });
  (useGetPickerRun as Mock).mockReturnValue({
    data: makeRunData("picker"),
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
// Tests: Song page → "Hear it in context" link
// --------------------------------------------------------------------------

describe("Song page — 'Hear it in context' link construction", () => {
  it("station spin link includes ?play=1&from=<mbid> pointing at the run", async () => {
    renderSongPage(SONG_MBID);
    const link = await screen.findByTestId("spin-replay-0");
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain(`/archive/station-runs/${RUN_ID}`);
    expect(href).toContain("play=1");
    expect(href).toContain(`from=${SONG_MBID}`);
  });

  it("picker pick link includes ?play=1&from=<mbid> pointing at the run", async () => {
    renderSongPage(SONG_MBID);
    const link = await screen.findByTestId("pick-replay-0");
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain(`/archive/picker-runs/${RUN_ID}`);
    expect(href).toContain("play=1");
    expect(href).toContain(`from=${SONG_MBID}`);
  });
});

// --------------------------------------------------------------------------
// Tests: StationRun — fallback notice when from= mbid is not in the run
// --------------------------------------------------------------------------

describe("StationRun — fallback notice via 'hear it in context' deep link", () => {
  it("shows the amber banner when the linked song is absent from the resolved tracklist", async () => {
    // SONG_MBID is not among the run's tracks ("run-mbid-0" … "run-mbid-4").
    // This is exactly what happens when a user clicks "Hear it in context" and
    // the song has since fallen off the resolved tracklist.
    renderRunPage("station", RUN_ID, `play=1&from=${SONG_MBID}`);
    await waitFor(() => {
      expect(screen.getByTestId("from-fallback-notice")).toBeTruthy();
    });
    expect(
      screen.getByTestId("from-fallback-notice").textContent,
    ).toContain("isn't in this run's resolved tracklist");
  });

  it("hides the amber banner after the user clicks Dismiss", async () => {
    renderRunPage("station", RUN_ID, `play=1&from=${SONG_MBID}`);
    await waitFor(() => {
      expect(screen.getByTestId("from-fallback-notice")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("from-fallback-notice")).toBeNull();
  });

  it("does NOT show the banner when the linked song IS in the tracklist", async () => {
    // "run-mbid-2" is present in the run — no fallback needed.
    renderRunPage("station", RUN_ID, "play=1&from=run-mbid-2");
    await waitFor(() => {
      const badge = screen.queryByTestId("ride-mode-badge");
      expect(badge).not.toBeNull();
    });
    expect(screen.queryByTestId("from-fallback-notice")).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Tests: PickerRun — fallback notice via 'hear it in context' deep link
// --------------------------------------------------------------------------

describe("PickerRun — fallback notice via 'hear it in context' deep link", () => {
  it("shows the amber banner when the linked song is absent from the resolved picks", async () => {
    renderRunPage("picker", RUN_ID, `play=1&from=${SONG_MBID}`);
    await waitFor(() => {
      expect(screen.getByTestId("from-fallback-notice")).toBeTruthy();
    });
    expect(
      screen.getByTestId("from-fallback-notice").textContent,
    ).toContain("isn't in this run's resolved tracklist");
  });

  it("hides the amber banner after the user clicks Dismiss", async () => {
    renderRunPage("picker", RUN_ID, `play=1&from=${SONG_MBID}`);
    await waitFor(() => {
      expect(screen.getByTestId("from-fallback-notice")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("from-fallback-notice")).toBeNull();
  });

  it("does NOT show the banner when the linked song IS in the resolved picks", async () => {
    renderRunPage("picker", RUN_ID, "play=1&from=run-mbid-3");
    await waitFor(() => {
      const badge = screen.queryByTestId("ride-mode-badge");
      expect(badge).not.toBeNull();
    });
    expect(screen.queryByTestId("from-fallback-notice")).toBeNull();
  });
});
