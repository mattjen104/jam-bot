// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, describe, expect, it, vi } from "vitest";
import Explore from "../src/pages/Explore";

const refetch = vi.fn();
const toggle = vi.fn();
let response: ReturnType<typeof exploreResponse> | undefined;

vi.mock("../src/hooks/useExplore", async () => {
  const actual = await vi.importActual<typeof import("../src/hooks/useExplore")>("../src/hooks/useExplore");
  return {
    ...actual,
    useExplore: () => ({
      data: response,
      isLoading: false,
      error: null,
      refetch,
    }),
  };
});

vi.mock("../src/hooks/useDialData", () => ({
  useDialData: () => ({
    stations: [{
      station: {
        id: 1,
        slug: "kexp",
        name: "KEXP",
        streamUrl: "https://example.com/kexp.mp3",
        streamFormat: "mp3",
        mode: "live",
        attribution: true,
        mayHaveAds: false,
        votes: 0,
        clickcount: 0,
        upcomingShowCount: 0,
        stationCategories: [],
      },
      liveTrack: { artist: "Japanese Breakfast" },
    }],
  }),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: {
      station: null,
      status: "idle",
      toggle,
    },
  }),
}));

vi.mock("../src/components/StationMark", () => ({
  StationMark: ({ name }: { name: string }) => <span>{name} mark</span>,
}));

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    station: {
      slug: "kexp",
      name: "KEXP",
      city: "Seattle",
      region: "WA",
      latitude: 47.6,
      longitude: -122.3,
      approximateDistanceMiles: null,
    },
    show: { name: "The Morning Show", djName: "John", startsAt: "2026-09-05T15:00:00Z", endsAt: "2026-09-05T18:00:00Z", live: true },
    primaryReason: { kind: "recent_rotation", text: "Recent station profile is available." },
    evidence: {
      artistRecentPlays: 3,
      libraryCrossings24h: 2,
      genreMatch: "exact",
      profileGenres: [{ genre: "indie", count: 12 }],
    },
    readiness: "ready",
    confidence: "schedule_attributed",
    timing: { startsAt: "2026-09-05T15:00:00Z", endsAt: "2026-09-05T18:00:00Z", isLive: true },
    ...overrides,
  };
}

function exploreResponse() {
  const item = candidate();
  return {
    onAirNow: [item],
    comingUp: [{ ...item, timing: { ...item.timing, isLive: false }, show: { ...item.show, live: false } }],
    showsToKnow: [{ ...item, timing: { ...item.timing, isLive: false }, show: { ...item.show, live: false } }],
    stations: [item],
    metadata: {
      mode: "newness" as const,
      radiusMiles: null,
      partial: { schedules: false, genreEnrichment: false, coordinates: false, personalCrossings: false },
      locality: null,
    },
  };
}

function renderExplore(path = "/explore") {
  const { hook, searchHook, history, navigate } = memoryLocation({ path, record: true });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={hook} searchHook={searchHook}>
        <Explore />
      </Router>
    </QueryClientProvider>,
  );
  return { hook, searchHook, history: history!, navigate };
}

afterEach(() => {
  cleanup();
  response = undefined;
  vi.clearAllMocks();
});

describe("Explore", () => {
  it("offers every entry path without fetching until one is chosen", () => {
    renderExplore();
    for (const label of ["Near You", "Artists", "Genres", "New Music", "Stations", "Library"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
    expect(screen.getByText("Choose a starting point")).toBeTruthy();
  });

  it("writes a ZIP and radius into the URL and states the privacy boundary", () => {
    const { history } = renderExplore();
    fireEvent.click(screen.getByRole("button", { name: /Near You/ }));
    fireEvent.change(screen.getByLabelText("Explore search"), { target: { value: "98101" } });
    fireEvent.change(screen.getByLabelText("Search radius"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    expect(history.at(-1)).toContain("mode=location");
    expect(history.at(-1)).toContain("zip=98101");
    expect(history.at(-1)).toContain("radiusMiles=100");
    expect(screen.getByText(/ZIP is sent for this search only and is not saved/)).toBeTruthy();
  });

  it("renders live results first and lets evidence pivot the same surface", () => {
    response = exploreResponse();
    const { history } = renderExplore("/explore?mode=newness");
    const sections = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(sections.slice(0, 4)).toEqual(["Live radio", "Upcoming shows", "Shows to know", "Stations"]);
    fireEvent.click(screen.getAllByRole("button", { name: "indie · 12" })[0]);
    expect(history.at(-1)).toContain("mode=genre");
    expect(history.at(-1)).toContain("q=indie");
  });

  it("pivots an on-air artist with the required query intact", () => {
    response = exploreResponse();
    const { history } = renderExplore("/explore?mode=newness");
    fireEvent.click(screen.getAllByRole("button", { name: "Japanese Breakfast" })[0]);
    expect(history.at(-1)).toContain("mode=artist");
    expect(history.at(-1)).toContain("q=Japanese+Breakfast");
  });

  it("restores URL-owned ZIP and radius values after navigation", () => {
    response = exploreResponse();
    const original = "/explore?mode=location&zip=98101&radiusMiles=25";
    const { navigate } = renderExplore(original);
    fireEvent.change(screen.getByLabelText("Explore search"), { target: { value: "10001" } });
    fireEvent.change(screen.getByLabelText("Search radius"), { target: { value: "100" } });

    act(() => navigate("/explore?mode=newness"));
    act(() => navigate(original));

    expect((screen.getByLabelText("Explore search") as HTMLInputElement).value).toBe("98101");
    expect((screen.getByLabelText("Search radius") as HTMLSelectElement).value).toBe("25");
  });

  it("plays a live card through the shared radio player", () => {
    response = exploreResponse();
    renderExplore("/explore?mode=newness");
    fireEvent.click(screen.getByTestId("button-listen-kexp"));
    expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ slug: "kexp" }));
  });

  it("keeps useful station results visible when live evidence is absent", () => {
    const item = candidate({ show: null, timing: null });
    response = {
      ...exploreResponse(),
      onAirNow: [],
      comingUp: [],
      showsToKnow: [],
      stations: [item],
      metadata: {
        ...exploreResponse().metadata,
        partial: { schedules: true, genreEnrichment: true, coordinates: false, personalCrossings: false },
      },
    };
    renderExplore("/explore?mode=newness");
    expect(screen.getByText(/Nothing is confirmed live/)).toBeTruthy();
    expect(screen.getByTestId("card-explore-stations-kexp")).toBeTruthy();
    expect(screen.getByText(/Lore won’t invent missing details/)).toBeTruthy();
  });
});