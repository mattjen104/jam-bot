// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useGetReplayManifest: vi.fn(),
    useGetAppleMusicReplayMaterialization: vi.fn(),
    useGetGuidedReplayQueue: vi.fn(),
    getSpotifyStatus: vi.fn(async () => ({
      configured: false,
      connected: false,
      premium: false,
      displayName: null,
      product: null,
    })),
  });
});

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
  });
});

import {
  useGetAppleMusicReplayMaterialization,
  useGetGuidedReplayQueue,
  useGetReplayManifest,
} from "@workspace/api-client-react";
import { PlayerProvider } from "../src/player/PlayerProvider";
import Replay from "../src/pages/Replay";

const manifest = {
  replayId: 17,
  station: { slug: "kexp", name: "KEXP 90.3 FM", stationClass: "curated" },
  show: { name: "Morning Show", djName: "DJ Lore" },
  picker: {
    name: "DJ Lore",
    handle: "dj-lore",
    pickerType: "dj",
    trustTier: 3,
  },
  bounds: {
    date: "2026-07-02",
    startedAt: "2026-07-02T10:00:00Z",
    endedAt: "2026-07-02T10:03:00Z",
  },
  coverage: { total: 2, resolved: 1, unresolved: 1 },
  entries: [
    {
      position: 0,
      spinId: 101,
      playedAt: "2026-07-02T10:00:00Z",
      source: "kexp",
      citation: null,
      rawArtist: "Resolved Artist",
      rawTitle: "Resolved Title",
      confidence: "text",
      guidedLinks: [],
      recording: {
        mbid: "recording-1",
        title: "Resolved Title",
        artist: "Resolved Artist",
        artistMbid: null,
        artworkUrl: null,
        links: [
          {
            name: "Spotify",
            url: "https://open.spotify.com/track/exact",
            kind: "exact",
          },
        ],
        genres: null,
      },
    },
    {
      position: 1,
      spinId: 102,
      playedAt: "2026-07-02T10:03:00Z",
      source: "kexp",
      citation: "https://kexp.org/archive",
      rawArtist: "Unknown Artist",
      rawTitle: "Unknown Title",
      confidence: "unresolved",
      guidedLinks: [],
      recording: null,
    },
  ],
};

const appleMusicMaterialization = {
  configured: false,
  developerToken: null,
  appName: "Lore",
  apiBase: "https://api.music.apple.com",
  replayId: 17,
  entries: [
    {
      position: 0,
      spinId: 101,
      recordingMbid: "recording-1",
      rawArtist: "Resolved Artist",
      rawTitle: "Resolved Title",
      title: "Resolved Title",
      artist: "Resolved Artist",
      appleMusicId: "apple-track-1",
      url: "https://music.apple.com/us/song/example/123",
      status: "available",
      reason: null,
    },
    {
      position: 1,
      spinId: 102,
      recordingMbid: null,
      rawArtist: "Unknown Artist",
      rawTitle: "Unknown Title",
      title: "Unknown Title",
      artist: "Unknown Artist",
      appleMusicId: null,
      url: null,
      status: "unresolved",
      reason: "unresolved",
    },
  ],
  coverage: { total: 2, available: 1, unavailable: 0, unresolved: 1, dead: 0 },
} as const;

const guidedQueue = {
  replayId: 17,
  service: "spotify",
  serviceLabel: "Spotify",
  services: [{ service: "spotify", label: "Spotify", available: 1, total: 2 }],
  coverage: { total: 2, available: 1, missing: 1 },
  entries: [
    {
      position: 0,
      spinId: 101,
      playedAt: "2026-07-02T10:00:00Z",
      recordingMbid: "recording-1",
      title: "Resolved Title",
      artist: "Resolved Artist",
      provenance: { source: "kexp", citation: null },
      target: {
        kind: "native",
        url: "spotify:track:1234567890123456789012",
        externalId: "1234567890123456789012",
        fallbackUrl: "https://open.spotify.com/track/1234567890123456789012",
      },
      missingReason: null,
    },
    {
      position: 1,
      spinId: 102,
      playedAt: "2026-07-02T10:03:00Z",
      recordingMbid: null,
      title: "Unknown Title",
      artist: "Unknown Artist",
      provenance: { source: "kexp", citation: "https://kexp.org/archive" },
      target: null,
      missingReason: "not_mapped",
    },
  ],
} as const;

beforeEach(() => {
  (useGetReplayManifest as Mock).mockReturnValue({
    data: manifest,
    isLoading: false,
    isError: false,
  });
  (useGetAppleMusicReplayMaterialization as Mock).mockReturnValue({
    data: appleMusicMaterialization,
    isLoading: false,
    isError: false,
  });
  (useGetGuidedReplayQueue as Mock).mockReturnValue({
    data: guidedQueue,
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderReplay() {
  const { hook, searchHook } = memoryLocation({
    path: "/replay/17",
    static: true,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <PlayerProvider>
          <Route path="/replay/:id" component={Replay} />
        </PlayerProvider>
      </Router>
    </QueryClientProvider>,
  );
}

describe("Ghost Replay surface", () => {
  it("renders reconstruction framing, explicit coverage, honest gaps, links, and Keep provenance controls", () => {
    renderReplay();

    expect(screen.getByText(/Ghost Replay · dated reconstruction/i)).toBeTruthy();
    expect(screen.getByTestId("replay-coverage").textContent).toContain("2");
    expect(screen.getByTestId("replay-coverage").textContent).toContain("1");
    expect(screen.getByText("Unknown Title")).toBeTruthy();
    expect(screen.getByTestId("replay-coverage").textContent).toMatch(/unresolved/i);
    expect(screen.getByRole("link", { name: "Spotify" }).getAttribute("href")).toBe(
      "https://open.spotify.com/track/exact",
    );
    expect(screen.getAllByTitle(/keep this track/i)).toHaveLength(3);
    expect(screen.getByTestId("apple-music-replay").textContent).toContain(
      "Lore does not host, copy, or recreate the original broadcast audio.",
    );
    expect(screen.getByTestId("apple-music-coverage").textContent).toContain(
      "never resolved",
    );
    expect(screen.getByTestId("apple-music-start").hasAttribute("disabled")).toBe(true);
  });

  it("keeps native-app replay guidance separate and advances only on explicit controls", () => {
    renderReplay();

    expect(screen.getByTestId("guided-queue-coverage").textContent).toContain("1 of 2");
    expect(screen.getByTestId("guided-queue-open").getAttribute("href")).toBe(
      "spotify:track:1234567890123456789012",
    );
    expect(screen.getByTestId("guided-queue-current").textContent).toContain("Resolved Title");
    fireEvent.click(screen.getByTestId("guided-queue-next"));
    expect(screen.getByTestId("guided-queue-current").textContent).toContain("Unknown Title");
    expect(screen.getByTestId("guided-queue-status").textContent).toMatch(/next broadcast position/i);
    expect(screen.getByText("No service mapping")).toBeTruthy();
  });
});
