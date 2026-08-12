// @vitest-environment jsdom
/**
 * Tests for StackRow launch behaviour.
 *
 * Confirms:
 *  - Launch button calls getRecordingAlbumTracks with the first resolved mbid
 *    and passes the complete track list to ride.startReplay.
 *  - When getRecordingAlbumTracks returns zero tracks the launch shows a toast
 *    but does NOT call ride.startReplay.
 *  - When getRecordingAlbumTracks rejects, a toast is shown and startReplay is
 *    never called.
 *  - When the group has no resolved mbid (all soft rows) the Launch button is
 *    disabled.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StackRow } from "../src/components/StackRow";
import type { AlbumGroup } from "../src/pages/Library";
import type { LibraryItem } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockStartReplay = vi.fn();
const mockToast = vi.fn();

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      ride: { startReplay: mockStartReplay },
      spotify: { connected: false, premium: false, pinnedDevice: null },
    })),
  });
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {});
});

vi.mock("../src/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    mbid: "mbid-aaa-0001",
    provenance: { kind: "keep", stationName: "WFMU", stationSlug: "wfmu" },
    addedAt: "2026-08-01T10:00:00Z",
    recording: {
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      artworkUrl: null,
      albumTitle: "Rumours",
      spotifyUrl: null,
    },
    ...overrides,
  };
}

function makeGroup(items: LibraryItem[]): AlbumGroup {
  return {
    key: "Rumours\x1fFleetwood Mac",
    albumTitle: "Rumours",
    artist: "Fleetwood Mac",
    artworkUrl: null,
    items,
  };
}

function renderRow(group: AlbumGroup, open = false) {
  const toggle = vi.fn();
  render(<StackRow group={group} isOpen={open} onToggle={toggle} />);
  return toggle;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Launch — full album enqueued
// ---------------------------------------------------------------------------

describe("StackRow launch — full album ride", () => {
  it("calls getRecordingAlbumTracks then ride.startReplay with all tracks", async () => {
    const { getRecordingAlbumTracks } = await import("@workspace/api-client-react");
    vi.mocked(getRecordingAlbumTracks).mockResolvedValueOnce({
      rgTitle: "Rumours",
      tracks: [
        { mbid: "t1", title: "Go Your Own Way", artist: "Fleetwood Mac", position: 1 },
        { mbid: "t2", title: "Dreams", artist: "Fleetwood Mac", position: 2 },
        { mbid: "t3", title: "The Chain", artist: "Fleetwood Mac", position: 3 },
      ],
    });

    const group = makeGroup([makeItem()]);
    renderRow(group, /* isOpen= */ true);

    fireEvent.click(screen.getByTestId("stack-launch-btn"));

    await waitFor(() => expect(mockStartReplay).toHaveBeenCalledTimes(1));

    const [seeds, label] = mockStartReplay.mock.calls[0] as [
      Array<{ mbid: string; title: string }>,
      string,
    ];
    expect(label).toBe("Rumours");
    expect(seeds).toHaveLength(3);
    expect(seeds[0]?.mbid).toBe("t1");
    expect(seeds[1]?.mbid).toBe("t2");
    expect(seeds[2]?.mbid).toBe("t3");
  });

  it("falls back to the album title from the group when rgTitle is null", async () => {
    const { getRecordingAlbumTracks } = await import("@workspace/api-client-react");
    vi.mocked(getRecordingAlbumTracks).mockResolvedValueOnce({
      rgTitle: null,
      tracks: [{ mbid: "t1", title: "Track One", artist: "Artist", position: 1 }],
    });

    const group = makeGroup([makeItem()]);
    renderRow(group, true);
    fireEvent.click(screen.getByTestId("stack-launch-btn"));

    await waitFor(() => expect(mockStartReplay).toHaveBeenCalledTimes(1));
    const [, label] = mockStartReplay.mock.calls[0] as [unknown, string];
    expect(label).toBe("Rumours"); // from group.albumTitle
  });

  it("uses the first resolved mbid when multiple items exist", async () => {
    const { getRecordingAlbumTracks } = await import("@workspace/api-client-react");
    vi.mocked(getRecordingAlbumTracks).mockResolvedValueOnce({
      rgTitle: "Rumours",
      tracks: [{ mbid: "t1", title: "Track", artist: "Artist", position: 1 }],
    });

    // Soft row first, then a resolved row — should pick the resolved one
    const group = makeGroup([
      makeItem({ mbid: null, soft: true }),
      makeItem({ mbid: "mbid-bbb-0002" }),
    ]);
    renderRow(group, true);
    fireEvent.click(screen.getByTestId("stack-launch-btn"));

    await waitFor(() => expect(getRecordingAlbumTracks).toHaveBeenCalledWith("mbid-bbb-0002"));
  });
});

// ---------------------------------------------------------------------------
// Launch — empty track list
// ---------------------------------------------------------------------------

describe("StackRow launch — empty track list", () => {
  it("shows a toast and does NOT call startReplay when tracks is empty", async () => {
    const { getRecordingAlbumTracks } = await import("@workspace/api-client-react");
    vi.mocked(getRecordingAlbumTracks).mockResolvedValueOnce({ rgTitle: "Rumours", tracks: [] });

    const group = makeGroup([makeItem()]);
    renderRow(group, true);
    fireEvent.click(screen.getByTestId("stack-launch-btn"));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockStartReplay).not.toHaveBeenCalled();
    expect(mockToast.mock.calls[0]?.[0]).toMatchObject({ title: expect.stringContaining("load album") });
  });
});

// ---------------------------------------------------------------------------
// Launch — API error
// ---------------------------------------------------------------------------

describe("StackRow launch — API error", () => {
  it("shows a toast and does NOT call startReplay when getRecordingAlbumTracks rejects", async () => {
    const { getRecordingAlbumTracks } = await import("@workspace/api-client-react");
    vi.mocked(getRecordingAlbumTracks).mockRejectedValueOnce(new Error("network error"));

    const group = makeGroup([makeItem()]);
    renderRow(group, true);
    fireEvent.click(screen.getByTestId("stack-launch-btn"));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockStartReplay).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Launch button disabled when no resolved mbid
// ---------------------------------------------------------------------------

describe("StackRow launch — no resolved mbid", () => {
  it("Launch button is disabled when the group contains only soft rows", () => {
    const group = makeGroup([makeItem({ mbid: null, soft: true })]);
    renderRow(group, true);

    const btn = screen.getByTestId("stack-launch-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Launch button is enabled when at least one resolved mbid exists", () => {
    const group = makeGroup([makeItem({ mbid: "mbid-ccc-0001" })]);
    renderRow(group, true);

    const btn = screen.getByTestId("stack-launch-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
