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
    items,
  };
}

function renderRow(group: AlbumGroup) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StackRow
        group={group}
        isOpen={true}
        onToggle={vi.fn()}
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

  it("shows provenance text 'kept directly' for a kept item with no station or picker", () => {
    // Expand the row and check the provPart text in TrackSubRow
    const item = makeItem({ provenance: { kind: "keep" } });
    renderRow(makeGroup([item]));

    const rows = screen.getAllByTestId("stack-track-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.textContent).toContain("kept directly");
  });
});

describe("albumByline", () => {
  it("shows 'kept directly' in the album header byline when kind=keep but no station or picker", () => {
    const item = makeItem({ provenance: { kind: "keep" } });
    renderRow(makeGroup([item]));

    // The album row header should include "kept directly" byline
    const albumRow = screen.getByTestId("stack-album-row");
    expect(albumRow.textContent).toContain("kept directly");
  });

  it("shows station name in byline when kind=keep with station", () => {
    const item = makeItem({ provenance: { kind: "keep", stationName: "KEXP" } });
    renderRow(makeGroup([item]));

    const albumRow = screen.getByTestId("stack-album-row");
    expect(albumRow.textContent).toContain("kept on KEXP");
  });

  it("shows 'imported from spotify' byline for import-kind items", () => {
    const item = makeItem({ provenance: { kind: "import", service: "spotify" } });
    renderRow(makeGroup([item]));

    const albumRow = screen.getByTestId("stack-album-row");
    expect(albumRow.textContent).toContain("imported from spotify");
  });
});
