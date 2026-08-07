// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  mockResume,
  mockStartReplay,
  mockAlbumTracks,
  mockPickerRun,
  setLocation,
  mockUseGetRecordingKnowledge,
} = vi.hoisted(() => ({
  mockResume: vi.fn(),
  mockStartReplay: vi.fn(),
  mockAlbumTracks: vi.fn(),
  mockPickerRun: vi.fn(),
  setLocation: vi.fn(),
  mockUseGetRecordingKnowledge: vi.fn(),
}));

vi.mock("wouter", () => ({ useLocation: () => ["/", setLocation] }));
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getRecordingAlbumTracks: mockAlbumTracks,
    getPickerRun: mockPickerRun,
    useGetPickersDial: () => ({ data: { items: [] } }),
    useGetStationNowPlaying: () => ({ data: undefined, isLoading: false }),
    getGetStationNowPlayingQueryKey: (slug: string) => ["station-now-playing", slug],
    useGetRecordingKnowledge: mockUseGetRecordingKnowledge,
    getGetRecordingKnowledgeQueryKey: (mbid: string) => ["recording-knowledge", mbid],
  };
});
vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: { resume: mockResume },
    ride: { startReplay: mockStartReplay },
  }),
}));
vi.mock("../src/lib/meHooks", () => ({
  useMyAlbumAvatar: () => ({ data: undefined }),
  useMyLibraryInfinite: () => ({ data: undefined }),
}));

import { RecordPeekNav } from "../src/components/RecordPeekNav";
import { SECTION_MEMORY_STORAGE_KEY } from "../src/player/sectionMemory";

function seed(mbid = "track-1") {
  return { mbid, title: "Song", artist: "Artist", artworkUrl: null, links: [] };
}

function stored(overrides: Record<string, unknown>) {
  localStorage.setItem(SECTION_MEMORY_STORAGE_KEY, JSON.stringify({
    version: 1,
    radio: null,
    selectors: null,
    library: null,
    ...overrides,
  }));
}

describe("RecordPeekNav", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockAlbumTracks.mockResolvedValue({ rgTitle: "Album", tracks: [] });
    // Default: query settled with no knowledge data
    mockUseGetRecordingKnowledge.mockReturnValue({ data: undefined, isLoading: false });
  });
  afterEach(cleanup);

  it("keeps a normal click as navigation and opens a keyboard peek separately", () => {
    render(<RecordPeekNav />);
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(setLocation).toHaveBeenCalledWith("/library");
    expect(mockStartReplay).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("button", { name: "Library" }), { key: "Enter" });
    expect(screen.queryByRole("button", { name: /Open album/i })).toBeNull();
  });

  it("cancels a moving long press instead of revealing an action", () => {
    vi.useFakeTimers();
    render(<RecordPeekNav />);
    const tab = screen.getByRole("button", { name: "Radio" });
    fireEvent.pointerDown(tab, { pointerType: "touch", clientX: 0, clientY: 0 });
    fireEvent.pointerMove(tab, { pointerType: "touch", clientX: 30, clientY: 0 });
    vi.advanceTimersByTime(600);
    expect(screen.queryByRole("region")).toBeNull();
    vi.useRealTimers();
  });

  it("resumes saved radio as a live station through the player operation", async () => {
    stored({
      radio: { kind: "radio", station: { id: 7, slug: "night-fm", name: "Night FM", streamUrl: "https://stream.example/live", streamFormat: "mp3", logoUrl: null } },
    });
    render(<RecordPeekNav />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Radio" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Resume live" }));
    expect(mockResume).toHaveBeenCalledWith(expect.objectContaining({ slug: "night-fm" }));
  });

  it("restores a selector queue at its saved position", async () => {
    stored({ selectors: { kind: "selectors", label: "Documented Run", queue: [seed(), seed("track-2")], orientation: "past", index: 1 } });
    render(<RecordPeekNav />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Selectors" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Resume Ghost Radio" }));
    expect(mockStartReplay).toHaveBeenCalledWith(
      [seed(), seed("track-2")],
      "Documented Run",
      expect.objectContaining({ timeOrientation: "past", startIndex: 0 }),
    );
  });

  it("renders album art as a plain span while the knowledge query is still loading", async () => {
    mockUseGetRecordingKnowledge.mockReturnValue({ data: undefined, isLoading: true });
    stored({
      radio: {
        kind: "radio",
        station: { id: 1, slug: "kexp", name: "KEXP", streamUrl: "https://stream.example/live", streamFormat: "mp3", logoUrl: null },
        lastTrack: { mbid: "abc-123", title: "Song", artist: "Artist", artworkUrl: "https://art.example/cover.jpg" },
      },
    });
    render(<RecordPeekNav />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Radio" }), { key: "Enter" });

    // Peek section should be visible
    await screen.findByRole("region", { name: /radio resume/i });

    // Art must be a span, not a button, while knowledge is still loading
    const artEl = screen.getByRole("region", { name: /radio resume/i })
      .querySelector(".record-peek__art");
    expect(artEl?.tagName.toLowerCase()).toBe("span");
    expect(screen.queryByRole("button", { name: "Open liner notes" })).toBeNull();
  });

  it("promotes album art to a tappable button once the knowledge query resolves with data", async () => {
    mockUseGetRecordingKnowledge.mockReturnValue({
      data: {
        knowledge: {
          personnel: [{ role: "Producer", name: "Someone" }],
          pressing: null,
          relationships: [],
        },
        claims: [],
      },
      isLoading: false,
    });
    stored({
      radio: {
        kind: "radio",
        station: { id: 1, slug: "kexp", name: "KEXP", streamUrl: "https://stream.example/live", streamFormat: "mp3", logoUrl: null },
        lastTrack: { mbid: "abc-123", title: "Song", artist: "Artist", artworkUrl: "https://art.example/cover.jpg" },
      },
    });
    render(<RecordPeekNav />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Radio" }), { key: "Enter" });

    // Art must be an accessible button once knowledge has loaded
    const artBtn = await screen.findByRole("button", { name: "Open liner notes" });
    expect(artBtn.tagName.toLowerCase()).toBe("button");
  });

  it("opens the remembered Library album from track one", async () => {
    stored({
      library: {
        kind: "library",
        track: seed(),
        album: { mbid: "album-1", title: "Album", artworkUrl: null },
        albumLookupMbid: "track-1",
      },
    });
    mockAlbumTracks.mockResolvedValue({
      rgTitle: "Album",
      tracks: [
        { mbid: "album-track-1", title: "First", artist: "Artist" },
        { mbid: "track-1", title: "Song", artist: "Artist" },
      ],
    });
    render(<RecordPeekNav />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Library" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Open album" }));
    await waitFor(() => expect(mockStartReplay).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ mbid: "album-track-1" })]),
      "Album",
      expect.objectContaining({ context: "library", startIndex: 0 }),
    ));
  });
});