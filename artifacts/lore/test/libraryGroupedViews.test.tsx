// @vitest-environment jsdom
/**
 * Tests for the grouped library views (album and artist accordion).
 *
 * Covers two scenarios triggered by a keep being toggled mid-session:
 *   1. The last track in an album group is un-kept → the album group row
 *      disappears from the rendered list.
 *   2. An artist group has multiple albums; all tracks from one album are
 *      un-kept → that album's sub-row disappears while the artist group
 *      (and its remaining album) stays intact.
 *
 * Strategy:
 *   - Pure-function tests exercise buildAlbumGroups / buildArtistGroups
 *     directly — no mocks needed.
 *   - Component tests render AlbumGroupRow / ArtistGroupRow with a real
 *     React tree, simulating the parent re-rendering with updated groups
 *     after a keep toggle.
 */

import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — only LibraryRow needs to be stubbed; the group rows don't
// use wouter or the player directly.
// ---------------------------------------------------------------------------

vi.mock("../src/components/LibraryRow", () => ({
  LibraryRow: ({ item }: { item: { mbid: string | null; recording?: { title?: string | null } | null } }) => (
    <li data-testid="library-row" data-mbid={item.mbid ?? "soft"}>
      {item.recording?.title ?? item.mbid ?? "unknown"}
    </li>
  ),
}));

// ---------------------------------------------------------------------------
// Imports (must follow vi.mock)
// ---------------------------------------------------------------------------

import {
  buildAlbumGroups,
  buildArtistGroups,
  AlbumGroupRow,
  ArtistGroupRow,
  type AlbumGroup,
  type ArtistGroup,
} from "../src/pages/Library";
import type { LibraryItem } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: {
  mbid?: string;
  title?: string;
  artist?: string;
  albumTitle?: string;
}): LibraryItem {
  return {
    mbid: overrides.mbid ?? "mbid-default",
    addedAt: "2024-01-01T00:00:00Z",
    provenance: { kind: "keep" },
    recording: {
      title: overrides.title ?? "Track",
      artist: overrides.artist ?? "Artist",
      artworkUrl: null,
      albumTitle: overrides.albumTitle ?? "Album",
      spotifyUrl: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ===========================================================================
// Pure-function tests — buildAlbumGroups
// ===========================================================================

describe("buildAlbumGroups", () => {
  it("returns an empty array when given no items", () => {
    expect(buildAlbumGroups([])).toHaveLength(0);
  });

  it("groups tracks that share an album+artist key into one group", () => {
    const items = [
      makeItem({ mbid: "a", title: "T1", artist: "Artist A", albumTitle: "Album X" }),
      makeItem({ mbid: "b", title: "T2", artist: "Artist A", albumTitle: "Album X" }),
    ];
    const groups = buildAlbumGroups(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[0]!.albumTitle).toBe("Album X");
  });

  it("produces separate groups for different albums by the same artist", () => {
    const items = [
      makeItem({ mbid: "a", artist: "Artist A", albumTitle: "Album X" }),
      makeItem({ mbid: "b", artist: "Artist A", albumTitle: "Album Y" }),
    ];
    const groups = buildAlbumGroups(items);
    expect(groups).toHaveLength(2);
  });

  it("removing the last track from an album causes that group to disappear", () => {
    const trackA = makeItem({ mbid: "solo", artist: "Solo Artist", albumTitle: "Only Album" });
    const trackB = makeItem({ mbid: "other", artist: "Other Artist", albumTitle: "Other Album" });

    // Both tracks present → two groups
    expect(buildAlbumGroups([trackA, trackB])).toHaveLength(2);

    // trackA removed → only Album for 'other' remains
    const groups = buildAlbumGroups([trackB]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.albumTitle).toBe("Other Album");
  });

  it("removing one of multiple tracks leaves the group intact with one fewer item", () => {
    const t1 = makeItem({ mbid: "t1", artist: "A", albumTitle: "Alb" });
    const t2 = makeItem({ mbid: "t2", artist: "A", albumTitle: "Alb" });
    const t3 = makeItem({ mbid: "t3", artist: "A", albumTitle: "Alb" });

    const before = buildAlbumGroups([t1, t2, t3]);
    expect(before[0]!.items).toHaveLength(3);

    // Un-keep t2
    const after = buildAlbumGroups([t1, t3]);
    expect(after).toHaveLength(1);
    expect(after[0]!.items).toHaveLength(2);
    expect(after[0]!.items.map((i) => i.mbid)).not.toContain("t2");
  });
});

// ===========================================================================
// Pure-function tests — buildArtistGroups
// ===========================================================================

describe("buildArtistGroups", () => {
  it("returns an empty array when given no items", () => {
    expect(buildArtistGroups([])).toHaveLength(0);
  });

  it("groups tracks by artist and builds nested album sub-groups", () => {
    const items = [
      makeItem({ mbid: "a", artist: "The Band", albumTitle: "Album 1" }),
      makeItem({ mbid: "b", artist: "The Band", albumTitle: "Album 2" }),
      makeItem({ mbid: "c", artist: "Solo Act", albumTitle: "Solo Album" }),
    ];
    const groups = buildArtistGroups(items);
    expect(groups).toHaveLength(2);

    const band = groups.find((g) => g.artist === "The Band")!;
    expect(band.albums).toHaveLength(2);
    expect(band.items).toHaveLength(2);

    const solo = groups.find((g) => g.artist === "Solo Act")!;
    expect(solo.albums).toHaveLength(1);
  });

  it("removing all tracks from one album removes that album sub-group while preserving the artist", () => {
    const album1Track1 = makeItem({ mbid: "a1t1", artist: "The Band", albumTitle: "Album 1" });
    const album1Track2 = makeItem({ mbid: "a1t2", artist: "The Band", albumTitle: "Album 1" });
    const album2Track1 = makeItem({ mbid: "a2t1", artist: "The Band", albumTitle: "Album 2" });

    // Before: artist has 2 albums
    const before = buildArtistGroups([album1Track1, album1Track2, album2Track1]);
    const bandBefore = before.find((g) => g.artist === "The Band")!;
    expect(bandBefore.albums).toHaveLength(2);

    // Un-keep both tracks from Album 1
    const after = buildArtistGroups([album2Track1]);
    expect(after).toHaveLength(1);
    const bandAfter = after[0]!;
    expect(bandAfter.artist).toBe("The Band");
    expect(bandAfter.albums).toHaveLength(1);
    expect(bandAfter.albums[0]!.albumTitle).toBe("Album 2");
    expect(bandAfter.items).toHaveLength(1);
  });

  it("removing the only track from an artist removes that artist's group entirely", () => {
    const t = makeItem({ mbid: "solo", artist: "Only Artist", albumTitle: "Only Album" });
    const other = makeItem({ mbid: "other", artist: "Other Artist", albumTitle: "Other" });

    const after = buildArtistGroups([other]);
    expect(after.map((g) => g.artist)).not.toContain("Only Artist");
    expect(after).toHaveLength(1);
  });
});

// ===========================================================================
// Component tests — AlbumGroupRow
// ===========================================================================

describe("AlbumGroupRow", () => {
  function makeGroup(items: LibraryItem[]): AlbumGroup {
    return {
      key: "Artist A\x1fAlbum X",
      albumTitle: "Album X",
      artist: "Artist A",
      artworkUrl: null,
      items,
    };
  }

  it("renders the album title in the group header", () => {
    render(
      <AlbumGroupRow
        group={makeGroup([makeItem({ mbid: "t1", albumTitle: "Album X" })])}
        openDoorMbid={null}
        setOpenDoorMbid={vi.fn()}
      />,
    );
    expect(screen.getByText("Album X")).toBeTruthy();
  });

  it("does not show track rows before the group is expanded", () => {
    render(
      <AlbumGroupRow
        group={makeGroup([makeItem({ mbid: "t1" })])}
        openDoorMbid={null}
        setOpenDoorMbid={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("library-row")).toBeNull();
  });

  it("shows track rows after the header is clicked to expand", () => {
    render(
      <AlbumGroupRow
        group={makeGroup([
          makeItem({ mbid: "t1", title: "Track One" }),
          makeItem({ mbid: "t2", title: "Track Two" }),
        ])}
        openDoorMbid={null}
        setOpenDoorMbid={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("library-album-group").querySelector("[role='button']")!);
    expect(screen.getAllByTestId("library-row")).toHaveLength(2);
  });

  it("removes the last track row when the group is re-rendered with an empty items list", () => {
    /**
     * Simulates the parent removing the sole track from keptItems and
     * re-calling buildAlbumGroups — the new group has items: [].
     * In practice the parent would stop rendering this row entirely (since
     * buildAlbumGroups returns no entry for that album), but the component
     * must also handle a re-render with 0 items gracefully.
     */
    function Wrapper() {
      const [items, setItems] = React.useState<LibraryItem[]>([
        makeItem({ mbid: "only-track", title: "Only Track" }),
      ]);
      return (
        <>
          <button data-testid="remove-btn" onClick={() => setItems([])}>
            remove
          </button>
          {items.length > 0 && (
            <AlbumGroupRow
              group={makeGroup(items)}
              openDoorMbid={null}
              setOpenDoorMbid={vi.fn()}
            />
          )}
        </>
      );
    }

    render(<Wrapper />);

    // Expand the group
    fireEvent.click(screen.getByTestId("library-album-group").querySelector("[role='button']")!);
    expect(screen.getAllByTestId("library-row")).toHaveLength(1);

    // Simulate un-keep of the last track → parent removes this group row
    fireEvent.click(screen.getByTestId("remove-btn"));
    expect(screen.queryByTestId("library-album-group")).toBeNull();
    expect(screen.queryByTestId("library-row")).toBeNull();
  });

  it("reflects updated item count when a second track is removed from an expanded group", () => {
    function Wrapper() {
      const all = [
        makeItem({ mbid: "t1", title: "Track One" }),
        makeItem({ mbid: "t2", title: "Track Two" }),
      ];
      const [items, setItems] = useState<LibraryItem[]>(all);
      return (
        <>
          <button data-testid="remove-t2" onClick={() => setItems([all[0]!])}>
            remove t2
          </button>
          <AlbumGroupRow
            group={makeGroup(items)}
            openDoorMbid={null}
            setOpenDoorMbid={vi.fn()}
          />
        </>
      );
    }

    render(<Wrapper />);
    // Expand
    fireEvent.click(screen.getByTestId("library-album-group").querySelector("[role='button']")!);
    expect(screen.getAllByTestId("library-row")).toHaveLength(2);

    // Remove t2
    fireEvent.click(screen.getByTestId("remove-t2"));
    expect(screen.getAllByTestId("library-row")).toHaveLength(1);
    expect(screen.queryByText("Track Two")).toBeNull();
  });
});

// ===========================================================================
// Component tests — ArtistGroupRow
// ===========================================================================

describe("ArtistGroupRow", () => {
  function makeArtistGroup(albums: { title: string; items: LibraryItem[] }[]): ArtistGroup {
    const allItems = albums.flatMap((a) => a.items);
    return {
      key: "The Band",
      artist: "The Band",
      items: allItems,
      albums: albums.map((a) => ({
        key: `The Band\x1f${a.title}`,
        albumTitle: a.title,
        artist: "The Band",
        artworkUrl: null,
        items: a.items,
      })),
    };
  }

  it("renders the artist name in the group header", () => {
    const group = makeArtistGroup([
      { title: "Album 1", items: [makeItem({ mbid: "t1", artist: "The Band", albumTitle: "Album 1" })] },
    ]);
    render(
      <ArtistGroupRow group={group} openDoorMbid={null} setOpenDoorMbid={vi.fn()} />,
    );
    expect(screen.getByText("The Band")).toBeTruthy();
  });

  it("shows album count and track count in the header", () => {
    const group = makeArtistGroup([
      {
        title: "Album 1",
        items: [
          makeItem({ mbid: "t1", artist: "The Band", albumTitle: "Album 1" }),
          makeItem({ mbid: "t2", artist: "The Band", albumTitle: "Album 1" }),
        ],
      },
      {
        title: "Album 2",
        items: [makeItem({ mbid: "t3", artist: "The Band", albumTitle: "Album 2" })],
      },
    ]);
    render(
      <ArtistGroupRow group={group} openDoorMbid={null} setOpenDoorMbid={vi.fn()} />,
    );
    expect(screen.getByText(/2 albums/)).toBeTruthy();
    expect(screen.getByText(/3 tracks/)).toBeTruthy();
  });

  it("does not show album sub-rows before the group is expanded", () => {
    const group = makeArtistGroup([
      { title: "Album 1", items: [makeItem({ mbid: "t1" })] },
    ]);
    render(
      <ArtistGroupRow group={group} openDoorMbid={null} setOpenDoorMbid={vi.fn()} />,
    );
    expect(screen.queryByTestId("library-row")).toBeNull();
    expect(screen.queryByText("Album 1")).toBeNull();
  });

  it("shows both album sub-headers and their tracks when expanded", () => {
    const group = makeArtistGroup([
      {
        title: "Album 1",
        items: [makeItem({ mbid: "t1", title: "Song One", artist: "The Band", albumTitle: "Album 1" })],
      },
      {
        title: "Album 2",
        items: [makeItem({ mbid: "t2", title: "Song Two", artist: "The Band", albumTitle: "Album 2" })],
      },
    ]);
    render(
      <ArtistGroupRow group={group} openDoorMbid={null} setOpenDoorMbid={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Album 1")).toBeTruthy();
    expect(screen.getByText("Album 2")).toBeTruthy();
    expect(screen.getAllByTestId("library-row")).toHaveLength(2);
  });

  it("removes only the un-kept album's sub-row when its tracks are removed mid-session", () => {
    /**
     * Simulates un-keeping all tracks from Album 1.
     * The parent recomputes buildArtistGroups([remaining items]) and passes
     * a new group prop with albums: [album2Only].
     * Verify Album 1's sub-header and tracks disappear while Album 2 stays.
     */
    const album1Item = makeItem({ mbid: "a1t1", title: "A1 Song", artist: "The Band", albumTitle: "Album 1" });
    const album2Item = makeItem({ mbid: "a2t1", title: "A2 Song", artist: "The Band", albumTitle: "Album 2" });

    function Wrapper() {
      const [includeAlbum1, setIncludeAlbum1] = useState(true);
      const albums = includeAlbum1
        ? [
            { title: "Album 1", items: [album1Item] },
            { title: "Album 2", items: [album2Item] },
          ]
        : [{ title: "Album 2", items: [album2Item] }];
      const group = makeArtistGroup(albums);
      return (
        <>
          <button data-testid="unkept-album1" onClick={() => setIncludeAlbum1(false)}>
            unkept album1
          </button>
          <ArtistGroupRow group={group} openDoorMbid={null} setOpenDoorMbid={vi.fn()} />
        </>
      );
    }

    render(<Wrapper />);

    // Expand the artist group
    fireEvent.click(screen.getByTestId("library-artist-group").querySelector("[role='button']")!);

    // Both albums visible before toggle
    expect(screen.getByText("Album 1")).toBeTruthy();
    expect(screen.getByText("Album 2")).toBeTruthy();
    expect(screen.getAllByTestId("library-row")).toHaveLength(2);

    // Un-keep all Album 1 tracks → parent re-renders with updated group
    fireEvent.click(screen.getByTestId("unkept-album1"));

    expect(screen.queryByText("Album 1")).toBeNull();
    expect(screen.getByText("Album 2")).toBeTruthy();
    expect(screen.getAllByTestId("library-row")).toHaveLength(1);
    expect(screen.queryByText("A1 Song")).toBeNull();
    expect(screen.getByText("A2 Song")).toBeTruthy();
  });

  it("collapses to a single album row when one of two albums has all its tracks removed", () => {
    const a1 = makeItem({ mbid: "x1", title: "First", artist: "The Band", albumTitle: "First Album" });
    const a2 = makeItem({ mbid: "x2", title: "Second", artist: "The Band", albumTitle: "Second Album" });

    function Wrapper() {
      const [items, setItems] = useState([a1, a2]);
      const albums = buildAlbumGroups(items).map((ag) => ({
        title: ag.albumTitle,
        items: ag.items,
      }));
      const group = makeArtistGroup(albums);
      return (
        <>
          <button data-testid="remove-first" onClick={() => setItems([a2])}>
            remove first
          </button>
          <ArtistGroupRow group={group} openDoorMbid={null} setOpenDoorMbid={vi.fn()} />
        </>
      );
    }

    render(<Wrapper />);
    // Expand
    fireEvent.click(screen.getByTestId("library-artist-group").querySelector("[role='button']")!);
    expect(screen.getAllByTestId("library-row")).toHaveLength(2);

    // Remove First Album's track
    fireEvent.click(screen.getByTestId("remove-first"));
    expect(screen.queryByText("First Album")).toBeNull();
    expect(screen.getByText("Second Album")).toBeTruthy();
    expect(screen.getAllByTestId("library-row")).toHaveLength(1);

    // Confirm header counts update too
    expect(screen.getByText(/1 album/)).toBeTruthy();
    expect(screen.getByText(/1 track/)).toBeTruthy();
  });
});
