// @vitest-environment jsdom
/**
 * Tests for the Keep button affordance in TrackSubRow (inside StackRow).
 *
 * Confirms:
 *  - A `data-testid="track-keep-button"` button is rendered when a track has
 *    an MBID and its provenance.kind is "import" (not yet explicitly kept).
 *  - No keep button is rendered when provenance.kind is already "keep".
 *  - No keep button is rendered for soft (unresolved) import rows (no mbid).
 *  - Clicking the keep button fires useMutationKeep().mutate with the mbid.
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StackRow } from "../src/components/StackRow";
import type { AlbumGroup } from "../src/pages/Library";
import type { LibraryItem } from "../src/lib/meHooks";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      ride: { active: false, startReplay: vi.fn() },
      radio: { station: null },
    })),
  });
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    getRecordingAlbumTracks: vi.fn(async () => ({ tracks: [], rgTitle: null })),
  });
});

const mockMutate = vi.fn();

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMutationKeep: vi.fn(() => ({
      mutate: mockMutate,
      isPending: false,
      isSuccess: false,
      error: null,
    })),
  });
});

vi.mock("../src/components/AlbumInvestigationSheet", () => ({
  AlbumInvestigationSheet: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    mbid: "test-mbid-abc123",
    provenance: { kind: "import", service: "spotify" },
    addedAt: new Date().toISOString(),
    recording: { title: "Test Track", artist: "Test Artist", artworkUrl: null, albumTitle: "Test Album", spotifyUrl: null },
    soft: false,
    removed: false,
    ...overrides,
  };
}

function makeGroup(items: LibraryItem[]): AlbumGroup {
  return {
    key: "test-album-key",
    albumTitle: "Test Album",
    artist: "Test Artist",
    artworkUrl: null,
    releaseYear: null,
    items,
  };
}

function renderRow(group: AlbumGroup, opts: { isOpen?: boolean; onToggle?: () => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StackRow
        group={group}
        isOpen={opts.isOpen ?? true}
        onToggle={opts.onToggle ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TrackSubRow keep button", () => {
  it("renders a keep button for an import-kind item with an MBID", () => {
    const item = makeItem({ provenance: { kind: "import", service: "spotify" } });
    renderRow(makeGroup([item]));

    const btn = screen.getByTestId("track-keep-button");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("keep");
  });

  it("does NOT render a keep button for an already-kept item", () => {
    const item = makeItem({
      provenance: { kind: "keep", stationSlug: "wfmu", stationName: "WFMU" },
    });
    renderRow(makeGroup([item]));

    const btn = screen.queryByTestId("track-keep-button");
    expect(btn).toBeNull();
  });

  it("does NOT render a keep button for a kept-directly item (no station)", () => {
    const item = makeItem({ provenance: { kind: "keep" } });
    renderRow(makeGroup([item]));

    const btn = screen.queryByTestId("track-keep-button");
    expect(btn).toBeNull();
  });

  it("does NOT render a keep button for a soft (unresolved) row without an MBID", () => {
    const item = makeItem({
      mbid: null,
      soft: true,
      provenance: { kind: "import", service: "spotify" },
      recording: null,
    });
    renderRow(makeGroup([item]));

    const btn = screen.queryByTestId("track-keep-button");
    expect(btn).toBeNull();
  });

  it("does NOT render a keep button for a removed track", () => {
    const item = makeItem({
      provenance: { kind: "import", service: "spotify" },
      removed: true,
    });
    renderRow(makeGroup([item]));

    const btn = screen.queryByTestId("track-keep-button");
    expect(btn).toBeNull();
  });

  it("calls useMutationKeep().mutate with the item's MBID when clicked", () => {
    const item = makeItem({ mbid: "test-mbid-click-abc", provenance: { kind: "import", service: "spotify" } });
    renderRow(makeGroup([item]));

    const btn = screen.getByTestId("track-keep-button");
    fireEvent.click(btn);

    expect(mockMutate).toHaveBeenCalledWith({ mbid: "test-mbid-click-abc" });
  });

  it("shows no secondary text for a kept item with no station or picker (minimal presentation)", () => {
    // The new minimal TrackSubRow shows only a dot separator + value when secondary is non-empty.
    // A keep with no station or picker produces an empty secondary — no text appended.
    const item = makeItem({ provenance: { kind: "keep" } });
    renderRow(makeGroup([item]));

    const rows = screen.getAllByTestId("stack-track-row");
    expect(rows.length).toBeGreaterThan(0);
    // Only the track title should appear — no provenance filler text.
    expect(rows[0]!.textContent).toContain("Test Track");
    expect(rows[0]!.textContent).not.toContain("kept directly");
  });
});

describe("StackRow header (feed-parallel)", () => {
  it("shows album · artist in the collapsed header (album-first grammar)", () => {
    const item = makeItem({ provenance: { kind: "keep", stationName: "KEXP" } });
    renderRow(makeGroup([item]));

    const albumRow = screen.getByTestId("stack-album-row");
    // New format: "album · artist" — album name first, no byline, no keep count.
    expect(albumRow.textContent).toContain("Test Album");
    expect(albumRow.textContent).toContain("Test Artist");
    // Album name should appear before artist name in the text content.
    const text = albumRow.textContent ?? "";
    expect(text.indexOf("Test Album")).toBeLessThan(text.indexOf("Test Artist"));
    expect(text).not.toContain("kept on KEXP");
    expect(text).not.toContain("imported from spotify");
  });

  it("shows the station name in the track sub-row secondary slot (not the header)", () => {
    const item = makeItem({ provenance: { kind: "keep", stationName: "KEXP" } });
    renderRow(makeGroup([item]));

    // Secondary appears in the track row, not the album header byline.
    const rows = screen.getAllByTestId("stack-track-row");
    expect(rows[0]!.textContent).toContain("KEXP");
  });

  it("shows service name in the track sub-row secondary slot for import-kind items", () => {
    const item = makeItem({ provenance: { kind: "import", service: "spotify" } });
    renderRow(makeGroup([item]));

    const rows = screen.getAllByTestId("stack-track-row");
    expect(rows[0]!.textContent).toContain("spotify");
    // Album header should NOT contain the verbose "imported from spotify" byline.
    const albumRow = screen.getByTestId("stack-album-row");
    expect(albumRow.textContent).not.toContain("imported from spotify");
  });

  it("collapsed header text is exactly `album · artist` plus the chevron", () => {
    const item = makeItem();
    renderRow(makeGroup([item]), { isOpen: false });

    const header = screen.getByTestId("stack-album-header");
    // Full text: identity line + closed chevron. No counts, no markers.
    expect(header.textContent).toBe("Test Album·Test Artist▾");
  });

  it("shows only the album when the artist is missing (no dangling separator)", () => {
    const item = makeItem();
    const group = { ...makeGroup([item]), artist: "" };
    renderRow(group, { isOpen: false });

    const header = screen.getByTestId("stack-album-header");
    expect(header.textContent).toBe("Test Album▾");
  });

  it("shows only the artist when the album title is missing (no dangling separator)", () => {
    const item = makeItem();
    const group = { ...makeGroup([item]), albumTitle: "" };
    renderRow(group, { isOpen: false });

    const header = screen.getByTestId("stack-album-header");
    expect(header.textContent).toBe("Test Artist▾");
  });

  it("falls back to 'Unknown album' when both album and artist are missing", () => {
    const item = makeItem();
    const group = { ...makeGroup([item]), albumTitle: "", artist: "" };
    renderRow(group, { isOpen: false });

    const header = screen.getByTestId("stack-album-header");
    expect(header.textContent).toBe("Unknown album▾");
  });
});

describe("StackRow collapsed affordances & expansion", () => {
  it("hides track rows and footer actions while collapsed; chevron is the only affordance", () => {
    const item = makeItem();
    renderRow(makeGroup([item]), { isOpen: false });

    expect(screen.queryByTestId("stack-album-expanded")).toBeNull();
    expect(screen.queryByTestId("stack-track-row")).toBeNull();
    expect(screen.queryByTestId("stack-launch-btn")).toBeNull();
    expect(screen.queryByTestId("stack-investigate-btn")).toBeNull();
    // No collapsed investigation marker or keep-count chip remains.
    expect(screen.getByTestId("stack-album-header").textContent).not.toContain("✳");
    // Collapsed state is announced accessibly.
    expect(screen.getByTestId("stack-album-header").getAttribute("aria-expanded")).toBe("false");
  });

  it("reveals track rows and footer actions when open", () => {
    const item = makeItem();
    renderRow(makeGroup([item]), { isOpen: true });

    expect(screen.getByTestId("stack-album-expanded")).toBeTruthy();
    expect(screen.getAllByTestId("stack-track-row").length).toBe(1);
    expect(screen.getByTestId("stack-launch-btn")).toBeTruthy();
    expect(screen.getByTestId("stack-investigate-btn")).toBeTruthy();
    expect(screen.getByTestId("stack-album-header").getAttribute("aria-expanded")).toBe("true");
  });

  it("calls onToggle on click", () => {
    const onToggle = vi.fn();
    renderRow(makeGroup([makeItem()]), { isOpen: false, onToggle });

    fireEvent.click(screen.getByTestId("stack-album-header"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("calls onToggle on Enter and Space keydown (keyboard expansion)", () => {
    const onToggle = vi.fn();
    renderRow(makeGroup([makeItem()]), { isOpen: false, onToggle });

    const header = screen.getByTestId("stack-album-header");
    expect(header.getAttribute("role")).toBe("button");
    expect(header.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(header, { key: "Enter" });
    fireEvent.keyDown(header, { key: " " });
    expect(onToggle).toHaveBeenCalledTimes(2);

    // Other keys do nothing.
    fireEvent.keyDown(header, { key: "Escape" });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
