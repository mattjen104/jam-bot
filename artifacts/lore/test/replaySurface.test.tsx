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
    expect(screen.getByTestId("replay-playlist").textContent).toContain(
      "Keep this broadcast in a playlist",
    );
    expect(screen.getByRole("link", { name: "Spotify" }).getAttribute("href")).toBe(
      "https://open.spotify.com/track/exact",
    );
    // The tracklist contributes two Keep controls and the guided native queue
    // adds one for its currently selected resolved entry.
    expect(screen.getAllByTitle(/keep this track/i)).toHaveLength(3);
    // Apple Music is now a tab inside GuidedReplayPanel alongside all other services
    expect(screen.getByTestId("guided-replay")).toBeTruthy();
    expect(screen.getByTestId("guided-service-appleMusic")).toBeTruthy();
    // Switch to the Apple Music tab; start is disabled because guidedLinks is empty
    fireEvent.click(screen.getByTestId("guided-service-appleMusic"));
    expect(screen.getByTestId("guided-start").hasAttribute("disabled")).toBe(true);
    // Coverage shows 0 of 2 (no apple music entries in guidedLinks fixture)
    expect(screen.getByTestId("guided-coverage").textContent).toContain("0 of 2");
  });

  it("enables guided mode and shows a receipt for unmapped entries when a service link is present", () => {
    // Give entry 0 an Apple Music guided link so the service tab is enabled
    (useGetReplayManifest as Mock).mockReturnValue({
      data: {
        ...manifest,
        entries: [
          {
            ...manifest.entries[0],
            guidedLinks: [
              {
                service: "apple_music",
                externalId: "123",
                url: "https://music.apple.com/us/song/resolved/123",
                deadLink: false,
              },
            ],
          },
          manifest.entries[1],
        ],
      },
      isLoading: false,
      isError: false,
    });
    renderReplay();

    fireEvent.click(screen.getByTestId("guided-service-appleMusic"));
    expect(screen.getByTestId("guided-coverage").textContent).toContain("1 of 2");
    expect(screen.getByTestId("guided-start").hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByTestId("guided-start"));
    // The identified track appears in the guided card (may also appear in the tracklist)
    expect(screen.getAllByText("Resolved Title").length).toBeGreaterThanOrEqual(1);
    // Only one playable entry — next is immediately disabled
    expect(screen.getByTestId("guided-next").hasAttribute("disabled")).toBe(true);
    // The unresolved entry appears in the missing receipt
    expect(screen.getByTestId("guided-receipt")).toBeTruthy();
  });
});
