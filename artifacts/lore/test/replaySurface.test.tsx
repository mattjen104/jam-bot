// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useGetReplayManifest: vi.fn(),
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

import { useGetReplayManifest } from "@workspace/api-client-react";
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

beforeEach(() => {
  (useGetReplayManifest as Mock).mockReturnValue({
    data: manifest,
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
    expect(screen.getByText(/unresolved/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Spotify" }).getAttribute("href")).toBe(
      "https://open.spotify.com/track/exact",
    );
    expect(screen.getAllByTitle(/keep this track/i)).toHaveLength(2);
  });
});