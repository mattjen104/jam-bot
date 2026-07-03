// @vitest-environment jsdom
/**
 * Regression tests for the "hear it in context" deep link:
 *   /archive/station-runs/:runId?play=1&from=<mbid>
 *   /archive/picker-runs/:runId?play=1&from=<mbid>
 *
 * The autoplay effect in StationRun/PickerRun must start the replay at the
 * track matching ?from= (its index within the RESOLVED tracklist), falling
 * back to track 1 only when the mbid isn't in the resolved list. A refactor
 * of those effects could silently regress to always starting at track 1 —
 * these tests pin the player dock's "Replay N/M" position.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@workspace/api-client-react", () => ({
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

import { useGetPickerRun, useGetStationRun } from "@workspace/api-client-react";
import { PlayerProvider } from "../src/player/PlayerProvider";
import { PlayerDock } from "../src/components/PlayerDock";
import StationRun from "../src/pages/StationRun";
import PickerRun from "../src/pages/PickerRun";

/**
 * Build a tracklist with `resolvedCount` resolved tracks (mbid-0..mbid-N-1)
 * and two unresolved "honest gap" rows interleaved near the top. The gaps
 * matter: the start index must be computed against the resolved list only,
 * so raw playlist position and replay position intentionally differ.
 */
function makeTracks(resolvedCount: number) {
  const tracks: Array<Record<string, unknown>> = [];
  let position = 0;
  for (let i = 0; i < resolvedCount; i++) {
    // Insert unresolved gaps after the 3rd and 7th resolved tracks.
    if (i === 3 || i === 7) {
      tracks.push({
        position: position++,
        rawTitle: `Unresolved ${i}`,
        rawArtist: "Unknown",
        playedAt: null,
        confidence: "unresolved",
        recording: null,
      });
    }
    tracks.push({
      position: position++,
      rawTitle: `Track ${i}`,
      rawArtist: `Artist ${i}`,
      playedAt: null,
      confidence: "recording_id",
      recording: {
        mbid: `mbid-${i}`,
        title: `Track ${i}`,
        artist: `Artist ${i}`,
        artworkUrl: null,
        links: [],
      },
    });
  }
  return tracks;
}

const RESOLVED = 45;

const stationRunData = {
  station: { name: "KEXP", slug: "kexp" },
  run: {
    date: "2024-06-02",
    show: { name: "Early", djName: null },
    sourceUrl: null,
  },
  tracks: makeTracks(RESOLVED),
};

const pickerRunData = {
  picker: { name: "Gilles Peterson", handle: "gilles" },
  run: {
    title: "Worldwide favourites",
    pickedAt: "2024-06-02",
    sourceUrl: "https://example.com/worldwide",
  },
  tracks: makeTracks(RESOLVED),
};

function renderRunPage(
  page: "station" | "picker",
  searchPath: string,
) {
  const base =
    page === "station" ? "/archive/station-runs" : "/archive/picker-runs";
  const { hook, searchHook } = memoryLocation({
    path: `${base}/7`,
    searchPath,
    static: true,
  });
  const PageComponent = page === "station" ? StationRun : PickerRun;
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <PlayerProvider>
        <Route path={`${base}/:runId`} component={PageComponent} />
        <PlayerDock />
      </PlayerProvider>
    </Router>,
  );
}

async function expectReplayBadge(text: string) {
  await waitFor(() => {
    const badge = screen.getByTestId("ride-mode-badge");
    expect(badge.textContent).toContain(text);
  });
}

beforeEach(() => {
  // jsdom's media element can't actually play — stub the playback surface so
  // the preview path resolves without throwing.
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(
    () => {},
  );
  vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(
    () => {},
  );
  (useGetStationRun as Mock).mockReturnValue({
    data: stationRunData,
    isLoading: false,
    isError: false,
  });
  (useGetPickerRun as Mock).mockReturnValue({
    data: pickerRunData,
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StationRun ?play=1&from= deep link", () => {
  it("starts the replay at the matching track, positioned in the resolved list", async () => {
    // mbid-19 is the 20th resolved track (gaps sit before it in raw order).
    renderRunPage("station", "play=1&from=mbid-19");
    await expectReplayBadge(`Replay 20/${RESOLVED}`);
  });

  it("falls back to track 1 when the from mbid is not in the run", async () => {
    renderRunPage("station", "play=1&from=mbid-does-not-exist");
    await expectReplayBadge(`Replay 1/${RESOLVED}`);
  });

  it("starts at track 1 when no from param is given", async () => {
    renderRunPage("station", "play=1");
    await expectReplayBadge(`Replay 1/${RESOLVED}`);
  });

  it("does not start a replay without ?play=1", async () => {
    renderRunPage("station", "from=mbid-19");
    // The page renders, but no ride bar / badge ever mounts.
    await screen.findAllByText(/Early/);
    expect(screen.queryByTestId("ride-mode-badge")).toBeNull();
  });
});

describe("PickerRun ?play=1&from= deep link", () => {
  it("starts the replay at the matching pick, positioned in the resolved list", async () => {
    renderRunPage("picker", "play=1&from=mbid-19");
    await expectReplayBadge(`Replay 20/${RESOLVED}`);
  });

  it("falls back to pick 1 when the from mbid is not in the run", async () => {
    renderRunPage("picker", "play=1&from=mbid-does-not-exist");
    await expectReplayBadge(`Replay 1/${RESOLVED}`);
  });

  it("starts at pick 1 when no from param is given", async () => {
    renderRunPage("picker", "play=1");
    await expectReplayBadge(`Replay 1/${RESOLVED}`);
  });
});
