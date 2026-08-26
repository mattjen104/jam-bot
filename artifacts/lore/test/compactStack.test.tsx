// @vitest-environment jsdom
/**
 * CompactStack — the homepage mini Stack band.
 *
 * Covers:
 *  Pure helpers:
 *   - relationshipCredit: first typed MB relationship → inline credit line;
 *     null when the knowledge layer has none
 *   - spineArtUrl: group artwork wins; CAA release-group fallback derived
 *     from releaseGroupMbid; null when neither exists
 *   - orderForExpansion: expanded album moves to the top slot; identity
 *     when collapsed or already first
 *   - buildAlbumLinerGroups: richest knowledge wins, claims deduped by text
 *  Component:
 *   - collapsed rows render `album · artist · credit` (credit omitted
 *     cleanly when unavailable), never per-song lists
 *   - clicking a row expands it in place: collapse header at top, metadata
 *     cards + → Stack link below it; other albums' rows stay mounted
 *   - clicking the expanded header collapses back to the five-row order
 *   - CAA fallback art is used for imported albums without artwork
 *   - collapsed rows each render their OWN stationary spine art (no shared
 *     backdrop, no pan class anywhere while collapsed)
 *   - expanded state applies the in-place modifier, renders the album's
 *     backdrop art scoped to the notes region, and only pans once loaded
 *     art overflows that region
 *   - onExpandedChange reports expansion up to the home view
 *  Play controls (Task 216):
 *   - ▶ button hidden when primaryMbid is null
 *   - clicking ▶ launches the album and does NOT expand the row
 *   - ▶ switches to ⏸ when that album is the active ride + playing
 *   - clicking ⏸ calls ride.togglePause, not expansion
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TrackKnowledge, TrackClaim } from "@workspace/api-client-react";

import {
  CompactStack,
  relationshipCredit,
  spineArtUrl,
  orderForExpansion,
  buildAlbumLinerGroups,
  primaryMbid,
  groupMbids,
} from "../src/components/CompactStack";
import type { AlbumGroup } from "../src/pages/Library";
import type { LibraryItem } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("../src/lib/proxyArt", () => ({
  proxyArtUrl: (url: string | null) => url,
}));

vi.mock("../src/lib/rumours", () => ({
  RUMOURS: "rumours.jpg",
  onArtError: vi.fn(),
}));

const setLocation = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", setLocation],
}));

// Library page data — set per test.
let libraryItems: LibraryItem[] = [];
let libraryIsLoading = false;
let libraryIsError = false;
vi.mock("../src/lib/meHooks", () => ({
  useMyLibraryInfinite: () => ({
    data: { pages: [{ items: libraryItems, nextCursor: null }] },
    isLoading: libraryIsLoading,
    isError: libraryIsError,
  }),
}));

// Knowledge fetches — keyed by MBID, set per test.
const knowledgeByMbid = new Map<
  string,
  { knowledge: TrackKnowledge | null; claims: TrackClaim[] }
>();
// Track album-track fetches — keyed by MBID, set per test.
const albumTracksByMbid = new Map<string, { tracks: Array<{ mbid: string; title: string; artist: string }>; rgTitle?: string }>();

// Optional per-test override for getRecordingAlbumTracks — lets a test hand
// back a deferred promise to exercise the in-flight (busy) launch state.
let albumTracksOverride:
  | ((mbid: string) => Promise<{ tracks: Array<{ mbid: string; title: string; artist: string }>; rgTitle?: string }>)
  | null = null;
const albumTracksCalls: string[] = [];

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getGetRecordingKnowledgeQueryKey: (mbid: string) => [
      `/api/recordings/${mbid}/knowledge`,
    ],
    getRecordingKnowledge: vi.fn(async (mbid: string) =>
      knowledgeByMbid.get(mbid) ?? { knowledge: null, claims: [] },
    ),
    getRecordingAlbumTracks: vi.fn(async (mbid: string) => {
      albumTracksCalls.push(mbid);
      if (albumTracksOverride) return albumTracksOverride(mbid);
      return albumTracksByMbid.get(mbid) ?? { tracks: [], rgTitle: undefined };
    }),
  };
});

// Artist-release filmstrip fetches — plain fetch, stubbed per test.
// artistReleasesByMbid: mbid → releases payload (null = fetch rejects).
// rgTracksByMbid: rgMbid → release-group tracks payload (null = 404).
const artistReleasesByMbid = new Map<
  string,
  Array<{
    releaseGroupMbid: string;
    title: string | null;
    primaryType: string | null;
    releaseYear: number | null;
    artworkUrl: string | null;
  }> | null
>();
const rgTracksByMbid = new Map<
  string,
  {
    rgMbid: string;
    rgTitle: string | null;
    rgType: string | null;
    releaseYear: number | null;
    artworkUrl: string | null;
    tracks: Array<{ mbid: string; title: string; artist: string }>;
  } | null
>();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

const fetchStub = vi.fn(async (input: unknown) => {
  const url = String(input);
  const artistMatch = url.match(/\/api\/recordings\/([^/]+)\/artist-releases/);
  if (artistMatch) {
    const payload = artistReleasesByMbid.get(artistMatch[1]!);
    if (payload === undefined || payload === null) {
      return jsonResponse({ error: "not_found" }, false, 404);
    }
    return jsonResponse({ artistName: "Artist", releases: payload });
  }
  const rgMatch = url.match(/\/api\/release-groups\/([^/]+)\/tracks/);
  if (rgMatch) {
    const payload = rgTracksByMbid.get(rgMatch[1]!);
    if (payload === undefined || payload === null) {
      return jsonResponse({ error: "not_found" }, false, 404);
    }
    return jsonResponse(payload);
  }
  return jsonResponse({ error: "unexpected" }, false, 500);
});
vi.stubGlobal("fetch", fetchStub);

// Player provider mock — ride state controlled per test.
let rideActive = false;
let rideStatus: string = "idle";
let rideReplayLabel: string | null = null;
const startReplay = vi.fn();
const togglePause = vi.fn();

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usePlayer: vi.fn(() => ({
      radio: { station: null, status: "idle", toggle: vi.fn() },
      ride: {
        active: rideActive,
        status: rideStatus,
        replayLabel: rideReplayLabel,
        startReplay,
        togglePause,
      },
      scan: { active: false },
    })),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  libraryItems = [];
  libraryIsLoading = false;
  libraryIsError = false;
  knowledgeByMbid.clear();
  albumTracksByMbid.clear();
  albumTracksOverride = null;
  albumTracksCalls.length = 0;
  artistReleasesByMbid.clear();
  rgTracksByMbid.clear();
  rideActive = false;
  rideStatus = "idle";
  rideReplayLabel = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: {
  mbid?: string | null;
  albumTitle?: string | null;
  artist?: string;
  title?: string;
  artworkUrl?: string | null;
  releaseGroupMbid?: string | null;
  releaseYear?: number | null;
  addedAt?: string;
}): LibraryItem {
  return {
    mbid: overrides.mbid ?? null,
    provenance: { kind: "keep" },
    addedAt: overrides.addedAt ?? "2026-08-01T00:00:00Z",
    recording: {
      title: overrides.title ?? "Some Track",
      artist: overrides.artist ?? "Some Artist",
      artworkUrl: overrides.artworkUrl ?? null,
      albumTitle: overrides.albumTitle ?? "Some Album",
      releaseGroupMbid: overrides.releaseGroupMbid ?? null,
      releaseYear: overrides.releaseYear ?? null,
      spotifyUrl: null,
    },
  };
}

function makeKnowledge(overrides: Partial<TrackKnowledge> = {}): TrackKnowledge {
  return {
    personnel: [],
    approximate: false,
    fetchedAtMs: 0,
    ...overrides,
  };
}

const SAMPLES_REL = {
  kind: "samples" as const,
  direction: "forward" as const,
  label: "samples",
  title: "Funky Drummer",
  artist: "James Brown",
  targetType: "recording" as const,
  targetId: "target-1",
  mbUrl: "https://musicbrainz.org/recording/target-1",
};

function makeGroup(overrides: Partial<AlbumGroup> = {}): AlbumGroup {
  return {
    key: "Album\x1fArtist",
    albumTitle: "Album",
    artist: "Artist",
    artworkUrl: null,
    releaseYear: null,
    items: [],
    ...overrides,
  };
}

function renderStack(props: React.ComponentProps<typeof CompactStack> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <CompactStack {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("relationshipCredit", () => {
  it("renders the first relationship as 'label — Title (Artist)'", () => {
    const k = makeKnowledge({ relationships: [SAMPLES_REL] });
    expect(relationshipCredit(k)).toBe("samples — Funky Drummer (James Brown)");
  });

  it("omits the artist parenthetical when absent", () => {
    const k = makeKnowledge({
      relationships: [{ ...SAMPLES_REL, artist: null }],
    });
    expect(relationshipCredit(k)).toBe("samples — Funky Drummer");
  });

  it("returns null with no relationships or no knowledge", () => {
    expect(relationshipCredit(makeKnowledge())).toBeNull();
    expect(relationshipCredit(makeKnowledge({ relationships: [] }))).toBeNull();
    expect(relationshipCredit(null)).toBeNull();
    expect(relationshipCredit(undefined)).toBeNull();
  });
});

describe("spineArtUrl", () => {
  it("prefers the group's own artwork", () => {
    const group = makeGroup({
      artworkUrl: "https://example.com/cover.jpg",
      items: [makeItem({ releaseGroupMbid: "rg-1" })],
    });
    expect(spineArtUrl(group)).toBe("https://example.com/cover.jpg");
  });

  it("falls back to the CAA release-group front image", () => {
    const group = makeGroup({
      items: [
        makeItem({ releaseGroupMbid: null }),
        makeItem({ releaseGroupMbid: "aaaa-bbbb" }),
      ],
    });
    expect(spineArtUrl(group)).toBe(
      "https://coverartarchive.org/release-group/aaaa-bbbb/front-1200",
    );
  });

  it("returns null when there is no artwork and no release group", () => {
    const group = makeGroup({ items: [makeItem({})] });
    expect(spineArtUrl(group)).toBeNull();
  });
});

describe("orderForExpansion", () => {
  const groups = [
    makeGroup({ key: "a" }),
    makeGroup({ key: "b" }),
    makeGroup({ key: "c" }),
  ];

  it("moves the expanded album to the top slot", () => {
    expect(orderForExpansion(groups, "c").map((g) => g.key)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("is identity when collapsed, already first, or unknown", () => {
    expect(orderForExpansion(groups, null)).toBe(groups);
    expect(orderForExpansion(groups, "a")).toBe(groups);
    expect(orderForExpansion(groups, "zzz")).toBe(groups);
  });
});

describe("primaryMbid / groupMbids", () => {
  it("skips soft rows and dedups", () => {
    const group = makeGroup({
      items: [
        makeItem({ mbid: null }),
        makeItem({ mbid: "m1" }),
        makeItem({ mbid: "m1" }),
        makeItem({ mbid: "m2" }),
      ],
    });
    expect(primaryMbid(group)).toBe("m1");
    expect(groupMbids(group)).toEqual(["m1", "m2"]);
  });
});

describe("buildAlbumLinerGroups", () => {
  it("uses the richest knowledge and dedups claims by text", () => {
    const rich = makeKnowledge({
      relationships: [SAMPLES_REL],
      personnel: [{ name: "Producer P", role: "producer" }],
    });
    const poor = makeKnowledge();
    const claim: TrackClaim = {
      text: "Recorded in one take.",
      sourceLabel: "Pitchfork",
      sourceHandle: "pitchfork",
      sourceUrl: "https://pitchfork.com/x",
      status: "published",
    };
    const groups = buildAlbumLinerGroups([
      { knowledge: poor, claims: [claim] },
      { knowledge: rich, claims: [claim] },
    ]);
    const labels = groups.map((g) => g.label);
    expect(labels).toContain("CREDITS");
    expect(labels).toContain("RELATIONSHIPS");
    const claimsGroup = groups.find((g) => g.label === "CLAIMS");
    expect(claimsGroup?.rows).toHaveLength(1);
  });

  it("returns [] with nothing to show", () => {
    expect(buildAlbumLinerGroups([])).toEqual([]);
    expect(
      buildAlbumLinerGroups([{ knowledge: null, claims: [] }]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

describe("CompactStack collapsed rows", () => {
  it("replaces a failed library load with a retryable Stack link", () => {
    libraryIsError = true;
    renderStack();

    const fallback = screen.getByRole("button", {
      name: "We couldn’t load your Stack — open Stack to retry.",
    });
    fireEvent.click(fallback);

    expect(setLocation).toHaveBeenCalledWith("/library");
  });

  it("renders `album · artist · credit` per album, no per-song rows", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Blue Lines", artist: "Massive Attack", title: "Safe From Harm", addedAt: "2026-08-02T00:00:00Z" }),
      makeItem({ mbid: "m2", albumTitle: "Blue Lines", artist: "Massive Attack", title: "Unfinished Sympathy", addedAt: "2026-08-01T00:00:00Z" }),
      makeItem({ mbid: "m3", albumTitle: "Dummy", artist: "Portishead", title: "Roads", addedAt: "2026-07-01T00:00:00Z" }),
    ];
    knowledgeByMbid.set("m1", {
      knowledge: makeKnowledge({ relationships: [SAMPLES_REL] }),
      claims: [],
    });
    renderStack();

    // One row per album, labelled for expansion
    const blueLines = await screen.findByRole("button", {
      name: "Expand Blue Lines · Massive Attack",
    });
    expect(blueLines.getAttribute("aria-expanded")).toBe("false");
    screen.getByRole("button", { name: "Expand Dummy · Portishead" });

    // No per-song rows
    expect(screen.queryByText("Safe From Harm")).toBeNull();
    expect(screen.queryByText("Unfinished Sympathy")).toBeNull();

    // Inline relationship credit appears after the second dot
    await screen.findByText("samples — Funky Drummer (James Brown)");
    // Dummy has no knowledge → credit omitted, row still fine
    expect(screen.getAllByText("·").length).toBeGreaterThanOrEqual(3);
  });

  it("uses CAA release-group fallback art for imports without artwork", () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Imported LP", artist: "Someone", releaseGroupMbid: "rg-42" }),
    ];
    const { container } = renderStack();
    const img = container.querySelector("img.compact-stack__tile-art");
    expect(img?.getAttribute("src")).toBe(
      "https://coverartarchive.org/release-group/rg-42/front-1200",
    );
  });

  it("gives each collapsed row its own square album cover — no shared backdrop, no pan", () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "One", artist: "A", artworkUrl: "https://example.com/one.jpg" }),
      makeItem({ mbid: "m2", albumTitle: "Two", artist: "B", artworkUrl: "https://example.com/two.jpg" }),
      makeItem({ mbid: "m3", albumTitle: "Three", artist: "C", artworkUrl: "https://example.com/three.jpg" }),
    ];
    const { container } = renderStack();
    const spines = container.querySelectorAll("img.compact-stack__tile-art");
    expect(spines).toHaveLength(3);
    expect(
      [...spines].map((img) => img.getAttribute("src")),
    ).toEqual([
      "https://example.com/one.jpg",
      "https://example.com/two.jpg",
      "https://example.com/three.jpg",
    ]);
    // Collapsed rows never carry the hero backdrop or the pan animation.
    expect(container.querySelectorAll("img.compact-stack__backdrop-art")).toHaveLength(0);
    expect(container.querySelector(".compact-stack__backdrop-art--pan")).toBeNull();
  });

  it("uses each album spine as the disclosure without an artist-only wrapper", () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "First", artist: "Shared Artist" }),
      makeItem({ mbid: "m2", albumTitle: "Second", artist: "Shared Artist" }),
      makeItem({ mbid: "m3", albumTitle: "Third", artist: "Another Artist" }),
    ];
    renderStack();

    const first = screen.getByRole("button", {
      name: "Expand First · Shared Artist",
    });
    screen.getByRole("button", { name: "Expand Second · Shared Artist" });
    screen.getByRole("button", { name: "Expand Third · Another Artist" });
    expect(first.closest(".compact-stack__tree-group")).toBeNull();
    expect(screen.queryByRole("button", { name: /albums by Shared Artist/ })).toBeNull();
  });

  it("renders an eight-album home grid without nested play or skip controls", () => {
    libraryItems = Array.from({ length: 10 }, (_, index) =>
      makeItem({
        mbid: `home-${index}`,
        albumTitle: `Home Album ${index + 1}`,
        artist: `Home Artist ${index + 1}`,
        artworkUrl: `https://example.com/home-${index}.jpg`,
        addedAt: `2026-08-${String(20 - index).padStart(2, "0")}T00:00:00Z`,
      }),
    );

    const { container } = renderStack({ homeCarousel: true });
    const homeGrid = container.querySelector(".compact-stack--home");

    expect(homeGrid?.querySelectorAll(".compact-stack__row")).toHaveLength(8);
    expect(homeGrid?.querySelectorAll(".compact-stack__art-tile")).toHaveLength(8);
    expect(homeGrid?.querySelectorAll(".compact-stack__album")).toHaveLength(0);
    expect(homeGrid?.querySelectorAll(".compact-stack__artist")).toHaveLength(8);
    expect(homeGrid?.querySelectorAll(".compact-play-btn")).toHaveLength(0);
    expect(homeGrid?.querySelectorAll(".compact-stack__scan-checkbox")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Play Home Album 1 · Home Artist 1" }),
    ).toBeTruthy();
  });
});

describe("CompactStack density zoom", () => {
  /** N one-track albums, newest first, each with a distinct title/artist. */
  function fillLibrary(n: number) {
    libraryItems = Array.from({ length: n }, (_, i) =>
      makeItem({
        mbid: `m${i}`,
        albumTitle: `Album ${i + 1}`,
        artist: `Artist ${i + 1}`,
        releaseYear: 1970 + i,
        addedAt: `2026-08-${String(20 - i).padStart(2, "0")}T00:00:00Z`,
      }),
    );
  }

  it("defaults to the five-row normal density", () => {
    fillLibrary(8);
    const { container } = renderStack();
    const root = container.querySelector(".compact-stack")!;
    expect(root.className).not.toContain("compact-stack--compact");
    expect(root.className).not.toContain("compact-stack--micro");
    expect(container.querySelectorAll(".compact-stack__row")).toHaveLength(5);
  });

  it("shows ten rows per page at compact density and drops the credit segment", async () => {
    fillLibrary(12);
    knowledgeByMbid.set("m0", {
      knowledge: makeKnowledge({ relationships: [SAMPLES_REL] }),
      claims: [],
    });
    const { container } = renderStack({ density: "compact" });

    // Ten half-height rows, styled by the compact modifier.
    const root = container.querySelector(".compact-stack")!;
    expect(root.className).toContain("compact-stack--compact");
    expect(container.querySelectorAll(".compact-stack__row")).toHaveLength(10);

    // The relationship credit is fetched but never rendered at compact.
    await screen.findByRole("button", { name: "Play Album 1 · Artist 1" });
    expect(container.querySelectorAll(".compact-stack__credit")).toHaveLength(0);
    // The artist segment survives at compact.
    expect(container.querySelectorAll(".compact-stack__artist").length).toBeGreaterThan(0);
    // The year segment survives too.
    expect(container.querySelectorAll(".compact-stack__year").length).toBeGreaterThan(0);
  });

  it("shows fifteen rows per page at micro density with only year + title", () => {
    fillLibrary(20);
    const { container } = renderStack({ density: "micro" });

    const root = container.querySelector(".compact-stack")!;
    expect(root.className).toContain("compact-stack--micro");
    expect(container.querySelectorAll(".compact-stack__row")).toHaveLength(15);

    // Micro rows are year + album title only — no artist, no credit.
    expect(container.querySelectorAll(".compact-stack__artist")).toHaveLength(0);
    expect(container.querySelectorAll(".compact-stack__credit")).toHaveLength(0);
    expect(container.querySelectorAll(".compact-stack__year")).toHaveLength(15);
    expect(container.querySelectorAll(".compact-stack__album")).toHaveLength(15);
    expect(screen.getByText("Album 1")).toBeTruthy();
    expect(screen.queryByText("Artist 1")).toBeNull();
  });

  it("plays the album directly instead of expanding at compact density", async () => {
    fillLibrary(2);
    albumTracksByMbid.set("m0", {
      tracks: [{ mbid: "t1", title: "Song One", artist: "Artist 1" }],
      rgTitle: "Album 1",
    });
    renderStack({ density: "compact" });

    const row = await screen.findByRole("button", { name: "Play Album 1 · Artist 1" });
    await act(async () => {
      fireEvent.click(row);
    });

    // The album launched…
    expect(albumTracksCalls).toEqual(["m0"]);
    expect(startReplay).toHaveBeenCalledTimes(1);
    // …and nothing expanded — no liner-notes region, still collapsed rows.
    expect(screen.queryByRole("region", { name: /liner notes/ })).toBeNull();
    expect(document.querySelector(".compact-stack--expanded")).toBeNull();
  });

  it("plays the album directly instead of expanding at micro density", async () => {
    fillLibrary(2);
    albumTracksByMbid.set("m0", {
      tracks: [{ mbid: "t1", title: "Song One", artist: "Artist 1" }],
    });
    renderStack({ density: "micro" });

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Play Album 1 · Artist 1" }),
      );
    });
    expect(startReplay).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".compact-stack--expanded")).toBeNull();
  });

  it("drops an open expansion when the density leaves normal", async () => {
    fillLibrary(2);
    const { rerender, qc } = renderStack({ density: "normal" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Album 1 · Artist 1" }),
    );
    await screen.findByRole("region", { name: /liner notes/ });

    rerender(
      <QueryClientProvider client={qc}>
        <CompactStack density="compact" />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("region", { name: /liner notes/ })).toBeNull();
    expect(document.querySelector(".compact-stack--expanded")).toBeNull();
  });
});

describe("CompactStack expansion", () => {
  it("expands a non-top row in place with metadata cards and a Stack link, then collapses", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "First Album", artist: "A", addedAt: "2026-08-03T00:00:00Z" }),
      makeItem({ mbid: "m2", albumTitle: "Second Album", artist: "B", artworkUrl: "https://example.com/second.jpg", addedAt: "2026-08-02T00:00:00Z" }),
    ];
    knowledgeByMbid.set("m2", {
      knowledge: makeKnowledge({
        relationships: [SAMPLES_REL],
        pressing: { label: "Island", year: 1994, country: "UK" },
      }),
      claims: [
        {
          text: "Mixed at Coach House studios.",
          sourceLabel: "Pitchfork",
          sourceHandle: "pitchfork",
          sourceUrl: "https://pitchfork.com/y",
          status: "published",
        },
      ],
    });
    renderStack();

    // Expand the SECOND album
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Second Album · B" }),
    );

    // Header for the expanded album is present and collapsible; the other
    // album's row stays mounted below the notes (in-place expansion — no
    // takeover, nothing unmounts).
    const header = await screen.findByRole("button", {
      name: "Collapse Second Album",
    });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(
      header.closest(".compact-stack")?.classList.contains(
        "compact-stack--expanded",
      ),
    ).toBe(true);
    screen.getByRole("button", { name: "Expand First Album · A" });

    // The expanded header keeps the selected album's own spine art. Liner
    // notes are plain metadata below it, rather than a separate hero.
    const stackEl = header.closest(".compact-stack")!;
    expect(header.querySelector("img.compact-stack__spine-art")).not.toBeNull();
    expect(stackEl.querySelector("img.compact-stack__backdrop-art")).toBeNull();

    // Metadata cards render per row: pressing, relationship, claim + source link
    await screen.findByText("Island · 1994 · UK");
    screen.getByText("samples — Funky Drummer (James Brown)");
    screen.getByText("Mixed at Coach House studios.");
    const srcLink = screen.getByRole("link", {
      name: /Open source for Mixed at Coach House/,
    });
    expect(srcLink.getAttribute("href")).toBe("https://pitchfork.com/y");

    // → Stack link navigates to the album in the full Stack
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    expect(setLocation).toHaveBeenCalledWith(
      `/library?openAlbum=${encodeURIComponent("Second Album\x1fB")}`,
    );

    // Header tap collapses back to the row list
    fireEvent.click(header);
    await screen.findByRole("button", { name: "Expand First Album · A" });
    screen.getByRole("button", { name: "Expand Second Album · B" });
  });

  it("shows the honest empty card when an album has no liner notes", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Quiet Album", artist: "C" }),
    ];
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Quiet Album · C" }),
    );
    await screen.findByText("No liner notes available for this album yet.");
  });

  it("reports expansion up through onExpandedChange for the home view", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Hero Album", artist: "D" }),
    ];
    const onExpandedChange = vi.fn();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <CompactStack onExpandedChange={onExpandedChange} />
      </QueryClientProvider>,
    );

    // Mount reports collapsed.
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Hero Album · D" }),
    );
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(
      await screen.findByRole("button", { name: "Collapse Hero Album" }),
    );
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it("drops a stale expansion when the album leaves the library groups", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Vanishing Album", artist: "E", addedAt: "2026-08-02T00:00:00Z" }),
      makeItem({ mbid: "m2", albumTitle: "Staying Album", artist: "F", addedAt: "2026-08-01T00:00:00Z" }),
    ];
    const onExpandedChange = vi.fn();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={qc}>
        <CompactStack onExpandedChange={onExpandedChange} />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Vanishing Album · E" }),
    );
    await screen.findByRole("button", { name: "Collapse Vanishing Album" });
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);

    // A refetch removes the expanded album from the top five. The stale key
    // must be dropped: the collapsed strip returns and the home view is told
    // the hero is gone (so the mini feed and remote come back).
    libraryItems = [
      makeItem({ mbid: "m2", albumTitle: "Staying Album", artist: "F", addedAt: "2026-08-01T00:00:00Z" }),
    ];
    view.rerender(
      <QueryClientProvider client={qc}>
        <CompactStack onExpandedChange={onExpandedChange} />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: "Expand Staying Album · F" });
    expect(
      screen.queryByRole("button", { name: "Collapse Vanishing Album" }),
    ).toBeNull();
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// Paging (offset window + shuffle highlight)
// ---------------------------------------------------------------------------

describe("CompactStack paging", () => {
  const sevenAlbums = () =>
    Array.from({ length: 7 }, (_, i) =>
      makeItem({
        mbid: `m${i + 1}`,
        albumTitle: `Album ${i + 1}`,
        artist: `Artist ${i + 1}`,
        // Descending recency so Album 1 is the newest group.
        addedAt: `2026-08-0${7 - i}T00:00:00Z`,
      }),
    );

  it("windows the library five albums at a time via the offset prop", async () => {
    libraryItems = sevenAlbums();
    const { qc, rerender } = renderStack({ offset: 0 });

    // Page 1: the five newest albums only.
    for (let i = 1; i <= 5; i++) {
      await screen.findByRole("button", { name: `Expand Album ${i} · Artist ${i}` });
    }
    expect(screen.queryByRole("button", { name: "Expand Album 6 · Artist 6" })).toBeNull();

    // Page 2 (offset 5): the remaining two albums, nothing from page 1.
    rerender(
      <QueryClientProvider client={qc}>
        <CompactStack offset={5} />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Expand Album 6 · Artist 6" });
    screen.getByRole("button", { name: "Expand Album 7 · Artist 7" });
    expect(screen.queryByRole("button", { name: "Expand Album 1 · Artist 1" })).toBeNull();
  });

  it("collapses the expanded album when a page change moves it out of the window", async () => {
    libraryItems = sevenAlbums();
    const onExpandedChange = vi.fn();
    const { qc, rerender } = renderStack({ offset: 0, onExpandedChange });

    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Album 1 · Artist 1" }),
    );
    await screen.findByRole("button", { name: "Collapse Album 1" });
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);

    // Paging to offset 5 drops the expanded album from the visible window —
    // the expansion collapses instead of reordering off-page.
    rerender(
      <QueryClientProvider client={qc}>
        <CompactStack offset={5} onExpandedChange={onExpandedChange} />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Expand Album 6 · Artist 6" });
    expect(screen.queryByRole("button", { name: "Collapse Album 1" })).toBeNull();
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it("highlights exactly the shuffle-sampled row via shuffleKey", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Album 1", artist: "Artist 1" }),
      makeItem({ mbid: "m2", albumTitle: "Album 2", artist: "Artist 2", addedAt: "2026-07-31T00:00:00Z" }),
    ];
    renderStack({ shuffleKey: "Album 2\x1fArtist 2" });
    await screen.findByRole("button", { name: "Expand Album 2 · Artist 2" });
    const sampling = document.querySelectorAll(".compact-stack__row--sampling");
    expect(sampling).toHaveLength(1);
    expect(sampling[0].textContent).toContain("Album 2");
  });
});

// ---------------------------------------------------------------------------
// Album checkboxes (skip preference)
// ---------------------------------------------------------------------------

describe("CompactStack album checkboxes", () => {
  const twoAlbums = () => [
    makeItem({ mbid: "m1", albumTitle: "Blue Lines", artist: "Massive Attack", addedAt: "2026-08-02T00:00:00Z" }),
    makeItem({ mbid: "m2", albumTitle: "Dummy", artist: "Portishead", addedAt: "2026-08-01T00:00:00Z" }),
  ];

  it("renders a trailing checkbox on each row when onToggleSkip is provided", async () => {
    libraryItems = twoAlbums();
    renderStack({ skipped: new Set(), onToggleSkip: vi.fn() });
    await screen.findByRole("button", { name: "Expand Blue Lines · Massive Attack" });
    const skip = screen.getByRole("checkbox", {
      name: "Skip Blue Lines · Massive Attack in the Stack window",
    });
    expect(skip.getAttribute("class")).toContain("compact-stack__scan-checkbox");
    screen.getByRole("checkbox", {
      name: "Skip Dummy · Portishead in the Stack window",
    });
  });

  it("renders no checkbox without a skip handler", async () => {
    libraryItems = twoAlbums();
    renderStack();
    await screen.findByRole("button", { name: "Expand Blue Lines · Massive Attack" });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("toggling a checkbox calls onToggleSkip with the group key and does not expand", async () => {
    libraryItems = twoAlbums();
    const onToggleSkip = vi.fn();
    renderStack({ skipped: new Set(), onToggleSkip });
    const checkbox = await screen.findByRole("checkbox", {
      name: "Skip Dummy · Portishead in the Stack window",
    });
    fireEvent.click(checkbox);
    expect(onToggleSkip).toHaveBeenCalledWith("Dummy\x1fPortishead");
    // The row must not have expanded.
    expect(screen.queryByRole("region")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Expand Dummy · Portishead" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("skipped albums move to the below-fold region, dimmed but interactive", async () => {
    libraryItems = twoAlbums();
    const onToggleSkip = vi.fn();
    const { container } = renderStack({
      skipped: new Set(["Dummy\x1fPortishead"]),
      onToggleSkip,
    });
    await screen.findByRole("button", { name: "Expand Blue Lines · Massive Attack" });

    // The skipped album is NOT among the active rows…
    const region = container.querySelector(".compact-stack__skipped-region");
    expect(region).not.toBeNull();
    const skippedRow = region!.querySelector(".compact-stack__row--skipped");
    expect(skippedRow?.textContent).toContain("Dummy");
    // …and the active window contains only Blue Lines.
    const activeRows = [...container.querySelectorAll(".compact-stack__row")]
      .filter((r) => !r.classList.contains("compact-stack__row--skipped"));
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]!.textContent).toContain("Blue Lines");

    // The skipped row stays interactive: its checkbox offers re-inclusion.
    const recheck = screen.getByRole("checkbox", {
      name: "Include Dummy · Portishead in the Stack window",
    });
    fireEvent.click(recheck);
    expect(onToggleSkip).toHaveBeenCalledWith("Dummy\x1fPortishead");
  });
});

// ---------------------------------------------------------------------------
// Release year (leading annotation)
// ---------------------------------------------------------------------------

describe("CompactStack release year", () => {
  it("renders the year as a leading mono annotation when non-null", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Dummy", artist: "Portishead", releaseYear: 1994 }),
    ];
    const { container } = renderStack();
    await screen.findByRole("button", { name: "Expand Dummy · Portishead" });
    const year = container.querySelector(".compact-stack__year");
    expect(year?.textContent).toBe("1994");
    // The year leads the row grammar, ahead of the album title.
    const text = container.querySelector(".compact-stack__text")!;
    expect(text.firstElementChild).toBe(year);
  });

  it("takes the first non-null year in the group and omits it cleanly when null", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Dated", artist: "A", releaseYear: null, addedAt: "2026-08-02T00:00:00Z" }),
      makeItem({ mbid: "m2", albumTitle: "Dated", artist: "A", releaseYear: 1987, addedAt: "2026-08-01T00:00:00Z" }),
      makeItem({ mbid: "m3", albumTitle: "Undated", artist: "B", releaseYear: null }),
    ];
    const { container } = renderStack();
    await screen.findByRole("button", { name: "Expand Dated · A" });
    const years = [...container.querySelectorAll(".compact-stack__year")];
    expect(years.map((y) => y.textContent)).toEqual(["1987"]);
  });
});

// ---------------------------------------------------------------------------
// Artist release cycle (filmstrip in the expanded view)
// ---------------------------------------------------------------------------

describe("CompactStack artist release cycle", () => {
  const portisheadReleases = [
    { releaseGroupMbid: "rg-dummy", title: "Dummy", primaryType: "Album", releaseYear: 1994, artworkUrl: null },
    { releaseGroupMbid: "rg-portishead", title: "Portishead", primaryType: "Album", releaseYear: 1997, artworkUrl: null },
    { releaseGroupMbid: "rg-third", title: "Third", primaryType: "Album", releaseYear: 2008, artworkUrl: null },
  ];

  it("shows the filmstrip chronologically in the expanded view with the current album highlighted", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Portishead", artist: "Portishead", releaseGroupMbid: "rg-portishead", releaseYear: 1997 }),
    ];
    // Server returns newest-first; the strip re-sorts oldest → newest.
    artistReleasesByMbid.set("m1", [...portisheadReleases].reverse());
    const { container } = renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Portishead · Portishead" }),
    );

    const stripEl = await screen.findByRole("group", { name: "More by Portishead" });
    expect(container.contains(stripEl)).toBe(true);
    // Chronological ascending: 1994 → 1997 → 2008.
    const yearLabels = [...stripEl.querySelectorAll(".compact-stack__filmstrip-year")]
      .map((y) => y.textContent);
    expect(yearLabels).toEqual(["1994", "1997", "2008"]);
    // The kept album's tile is the active one.
    const active = stripEl.querySelector(".compact-stack__filmstrip-tile--active");
    expect(active?.getAttribute("aria-label")).toBe("View Portishead (1997)");
  });

  it("tapping a tile swaps the expanded header and notes to that release", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Portishead", artist: "Portishead", releaseGroupMbid: "rg-portishead" }),
    ];
    artistReleasesByMbid.set("m1", portisheadReleases);
    rgTracksByMbid.set("rg-third", {
      rgMbid: "rg-third",
      rgTitle: "Third",
      rgType: "Album",
      releaseYear: 2008,
      artworkUrl: null,
      tracks: [
        { mbid: "t-silence", title: "Silence", artist: "Portishead" },
        { mbid: "t-hunter", title: "Hunter", artist: "Portishead" },
      ],
    });
    knowledgeByMbid.set("t-silence", {
      knowledge: makeKnowledge({ relationships: [SAMPLES_REL] }),
      claims: [],
    });
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Portishead · Portishead" }),
    );
    const tile = await screen.findByRole("button", { name: "View Third (2008)" });
    fireEvent.click(tile);

    // Header identity swaps to the tapped release; collapse still works.
    await screen.findByRole("button", { name: "Collapse Third" });
    // The notes follow the swapped release's own tracks.
    await screen.findByText("samples — Funky Drummer (James Brown)");
    // The tapped tile becomes the highlighted one.
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    // The header play control now launches the swapped release.
    const playBtn = await screen.findByRole("button", { name: "Play Third" });
    fireEvent.click(playBtn);
    await vi.waitFor(() => expect(startReplay).toHaveBeenCalledTimes(1));
    const [seeds, label] = startReplay.mock.calls[0] as Parameters<typeof startReplay>;
    expect(label).toBe("Third");
    expect(seeds[0]).toMatchObject({ mbid: "t-silence", title: "Silence" });
  });

  it("omits the filmstrip when the artist has a single known release", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Only Album", artist: "Solo Act", releaseGroupMbid: "rg-only" }),
    ];
    artistReleasesByMbid.set("m1", [
      { releaseGroupMbid: "rg-only", title: "Only Album", primaryType: "Album", releaseYear: 2001, artworkUrl: null },
    ]);
    const { container } = renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Only Album · Solo Act" }),
    );
    await screen.findByText("No liner notes available for this album yet.");
    await vi.waitFor(() => {
      expect(fetchStub.mock.calls.some(([u]) =>
        String(u).includes("/artist-releases"),
      )).toBe(true);
    });
    expect(container.querySelector(".compact-stack__filmstrip")).toBeNull();
  });

  it("silently omits the filmstrip when the artist-releases fetch fails", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Fragile LP", artist: "Nobody" }),
    ];
    artistReleasesByMbid.set("m1", null); // 404
    const { container } = renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Fragile LP · Nobody" }),
    );
    await screen.findByText("No liner notes available for this album yet.");
    await vi.waitFor(() => {
      expect(fetchStub.mock.calls.some(([u]) =>
        String(u).includes("/artist-releases"),
      )).toBe(true);
    });
    expect(container.querySelector(".compact-stack__filmstrip")).toBeNull();
  });

  it("ignores a stale swap response when a newer tile was tapped first", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Portishead", artist: "Portishead", releaseGroupMbid: "rg-portishead" }),
    ];
    artistReleasesByMbid.set("m1", portisheadReleases);
    rgTracksByMbid.set("rg-dummy", {
      rgMbid: "rg-dummy",
      rgTitle: "Dummy",
      rgType: "Album",
      releaseYear: 1994,
      artworkUrl: null,
      tracks: [{ mbid: "t-roads", title: "Roads", artist: "Portishead" }],
    });
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Portishead · Portishead" }),
    );
    await screen.findByRole("group", { name: "More by Portishead" });

    // The Third fetch hangs until the test releases it.
    let releaseThird!: (r: Response) => void;
    fetchStub.mockImplementationOnce((input: unknown) => {
      expect(String(input)).toContain("/api/release-groups/rg-third/tracks");
      return new Promise<Response>((res) => {
        releaseThird = res;
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "View Third (2008)" }));
    // A faster tap on Dummy completes first and wins the header.
    fireEvent.click(screen.getByRole("button", { name: "View Dummy (1994)" }));
    await screen.findByRole("button", { name: "Collapse Dummy" });

    // The slow Third response lands late and must be ignored.
    await act(async () => {
      releaseThird(
        jsonResponse({
          rgMbid: "rg-third",
          rgTitle: "Third",
          rgType: "Album",
          releaseYear: 2008,
          artworkUrl: null,
          tracks: [{ mbid: "t-silence", title: "Silence", artist: "Portishead" }],
        }),
      );
    });
    expect(screen.getByRole("button", { name: "Collapse Dummy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collapse Third" })).toBeNull();
  });

  it("ignores a pending swap when a different album is expanded before it lands", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Portishead", artist: "Portishead", releaseGroupMbid: "rg-portishead", addedAt: "2026-08-02T00:00:00Z" }),
      makeItem({ mbid: "m2", albumTitle: "Blue Lines", artist: "Massive Attack", addedAt: "2026-08-01T00:00:00Z" }),
    ];
    artistReleasesByMbid.set("m1", portisheadReleases);
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Portishead · Portishead" }),
    );
    await screen.findByRole("group", { name: "More by Portishead" });

    let releaseThird!: (r: Response) => void;
    fetchStub.mockImplementationOnce(
      () =>
        new Promise<Response>((res) => {
          releaseThird = res;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "View Third (2008)" }));

    // Expand a different album before the swap lands.
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Blue Lines · Massive Attack" }),
    );
    await screen.findByRole("button", { name: "Collapse Blue Lines" });
    await act(async () => {
      releaseThird(
        jsonResponse({
          rgMbid: "rg-third",
          rgTitle: "Third",
          rgType: "Album",
          releaseYear: 2008,
          artworkUrl: null,
          tracks: [{ mbid: "t-silence", title: "Silence", artist: "Portishead" }],
        }),
      );
    });
    // The late response must not hijack the Blue Lines expansion…
    expect(
      screen.getByRole("button", { name: "Collapse Blue Lines" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collapse Third" })).toBeNull();

    // …nor resurface when Portishead is re-expanded: the view starts clean.
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Portishead · Portishead" }),
    );
    await screen.findByRole("button", { name: "Collapse Portishead" });
    expect(screen.queryByRole("button", { name: "Collapse Third" })).toBeNull();
  });

  it("cancels a pending swap when the currently displayed tile is tapped", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Portishead", artist: "Portishead", releaseGroupMbid: "rg-portishead" }),
    ];
    artistReleasesByMbid.set("m1", portisheadReleases);
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Portishead · Portishead" }),
    );
    await screen.findByRole("group", { name: "More by Portishead" });

    // Start a swap to Third that hangs until the test releases it…
    let releaseThird!: (r: Response) => void;
    fetchStub.mockImplementationOnce((input: unknown) => {
      expect(String(input)).toContain("/api/release-groups/rg-third/tracks");
      return new Promise<Response>((res) => {
        releaseThird = res;
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "View Third (2008)" }));

    // …then re-affirm the album already on display (its tile is the active
    // one). That tap must cancel the pending swap: the late Third response
    // can no longer replace the view.
    fireEvent.click(screen.getByRole("button", { name: "View Portishead (1997)" }));
    await act(async () => {
      releaseThird(
        jsonResponse({
          rgMbid: "rg-third",
          rgTitle: "Third",
          rgType: "Album",
          releaseYear: 2008,
          artworkUrl: null,
          tracks: [{ mbid: "t-silence", title: "Silence", artist: "Portishead" }],
        }),
      );
    });
    expect(screen.getByRole("button", { name: "Collapse Portishead" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collapse Third" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// → Stack link href (swapped vs. unswapped)
// ---------------------------------------------------------------------------

describe("CompactStack → Stack link href", () => {
  const portisheadReleases = [
    { releaseGroupMbid: "rg-dummy", title: "Dummy", primaryType: "Album", releaseYear: 1994, artworkUrl: null },
    { releaseGroupMbid: "rg-portishead", title: "Portishead", primaryType: "Album", releaseYear: 1997, artworkUrl: null },
    { releaseGroupMbid: "rg-third", title: "Third", primaryType: "Album", releaseYear: 2008, artworkUrl: null },
  ];

  it("targets the kept album key when no swap is active", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Portishead", artist: "Portishead", releaseGroupMbid: "rg-portishead" }),
    ];
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Portishead · Portishead" }),
    );
    await screen.findByRole("button", { name: "Stack" });

    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    expect(setLocation).toHaveBeenCalledWith(
      `/library?openAlbum=${encodeURIComponent("Portishead\x1fPortishead")}`,
    );
  });

  it("targets the swapped release after a filmstrip tile tap", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Portishead", artist: "Portishead", releaseGroupMbid: "rg-portishead" }),
    ];
    artistReleasesByMbid.set("m1", portisheadReleases);
    rgTracksByMbid.set("rg-third", {
      rgMbid: "rg-third",
      rgTitle: "Third",
      rgType: "Album",
      releaseYear: 2008,
      artworkUrl: null,
      tracks: [{ mbid: "t-silence", title: "Silence", artist: "Portishead" }],
    });
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Portishead · Portishead" }),
    );

    // Tap the "Third" tile in the filmstrip.
    const tile = await screen.findByRole("button", { name: "View Third (2008)" });
    fireEvent.click(tile);

    // Wait for the swap to settle (the "Collapse Third" header appears).
    await screen.findByRole("button", { name: "Collapse Third" });

    // → Stack now links to the swapped album, not the kept one.
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    expect(setLocation).toHaveBeenCalledWith(
      `/library?openAlbum=${encodeURIComponent("Third\x1fPortishead")}`,
    );
  });

  it("updates the link again when the listener swaps to yet another release", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "Portishead", artist: "Portishead", releaseGroupMbid: "rg-portishead" }),
    ];
    artistReleasesByMbid.set("m1", portisheadReleases);
    rgTracksByMbid.set("rg-third", {
      rgMbid: "rg-third",
      rgTitle: "Third",
      rgType: "Album",
      releaseYear: 2008,
      artworkUrl: null,
      tracks: [{ mbid: "t-silence", title: "Silence", artist: "Portishead" }],
    });
    rgTracksByMbid.set("rg-dummy", {
      rgMbid: "rg-dummy",
      rgTitle: "Dummy",
      rgType: "Album",
      releaseYear: 1994,
      artworkUrl: null,
      tracks: [{ mbid: "t-roads", title: "Roads", artist: "Portishead" }],
    });
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Portishead · Portishead" }),
    );

    // First swap: Third
    const thirdTile = await screen.findByRole("button", { name: "View Third (2008)" });
    fireEvent.click(thirdTile);
    await screen.findByRole("button", { name: "Collapse Third" });

    // Second swap: Dummy — link must update to the new swap
    fireEvent.click(screen.getByRole("button", { name: "View Dummy (1994)" }));
    await screen.findByRole("button", { name: "Collapse Dummy" });

    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    expect(setLocation).toHaveBeenCalledWith(
      `/library?openAlbum=${encodeURIComponent("Dummy\x1fPortishead")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Play controls (Task 216)
// ---------------------------------------------------------------------------

describe("CompactStack play controls", () => {
  it("hides the play button when primaryMbid is null (unresolved album)", async () => {
    libraryItems = [
      // mbid: null → no resolved recording → no play button
      makeItem({ mbid: null, albumTitle: "Ghost Album", artist: "Unknown" }),
    ];
    renderStack();
    await screen.findByRole("button", { name: "Expand Ghost Album · Unknown" });
    expect(screen.queryByRole("button", { name: /Play Ghost Album/ })).toBeNull();
  });

  it("shows the play button for a resolved album", async () => {
    libraryItems = [
      makeItem({ mbid: "m-play", albumTitle: "Blue Lines", artist: "Massive Attack" }),
    ];
    renderStack();
    await screen.findByRole("button", { name: "Play Blue Lines" });
  });

  it("clicking play does NOT expand the row", async () => {
    libraryItems = [
      makeItem({ mbid: "m-iso", albumTitle: "Isolation Test", artist: "Band" }),
    ];
    albumTracksByMbid.set("m-iso", {
      tracks: [{ mbid: "t1", title: "Track One", artist: "Band" }],
    });
    renderStack();
    const playBtn = await screen.findByRole("button", { name: "Play Isolation Test" });
    fireEvent.click(playBtn);
    // The expand button (role=button aria-expanded=false) should still be in the DOM
    const expandBtn = screen.getByRole("button", { name: "Expand Isolation Test · Band" });
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
    // Collapsed liner-notes region must NOT be present
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("clicking play calls ride.startReplay with the correct seeds", async () => {
    libraryItems = [
      makeItem({ mbid: "m-launch", albumTitle: "Dummy", artist: "Portishead" }),
    ];
    albumTracksByMbid.set("m-launch", {
      tracks: [
        { mbid: "t-roads", title: "Roads", artist: "Portishead" },
        { mbid: "t-glory", title: "Glory Box", artist: "Portishead" },
      ],
      rgTitle: "Dummy",
    });
    renderStack();
    const playBtn = await screen.findByRole("button", { name: "Play Dummy" });
    fireEvent.click(playBtn);
    // Wait for the async launch to complete
    await vi.waitFor(() => expect(startReplay).toHaveBeenCalledTimes(1));
    const [seeds, label, opts] = startReplay.mock.calls[0] as Parameters<typeof startReplay>;
    expect(label).toBe("Dummy");
    expect(opts).toMatchObject({ timeOrientation: "curated", context: "library" });
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toMatchObject({ mbid: "t-roads", title: "Roads", artist: "Portishead" });
    expect(seeds[1]).toMatchObject({ mbid: "t-glory", title: "Glory Box", artist: "Portishead" });
  });

  it("shows ⏸ (Pause button) when ride is active with matching label and playing", async () => {
    rideActive = true;
    rideStatus = "playing";
    rideReplayLabel = "Active Album";
    libraryItems = [
      makeItem({ mbid: "m-active", albumTitle: "Active Album", artist: "Artist" }),
    ];
    renderStack();
    // Should show pause button, not play button
    await screen.findByRole("button", { name: "Pause Active Album" });
    expect(screen.queryByRole("button", { name: "Play Active Album" })).toBeNull();
  });

  it("clicking ⏸ calls ride.togglePause and does NOT expand the row", async () => {
    rideActive = true;
    rideStatus = "playing";
    rideReplayLabel = "Paused Album";
    libraryItems = [
      makeItem({ mbid: "m-pause", albumTitle: "Paused Album", artist: "Artist" }),
    ];
    renderStack();
    const pauseBtn = await screen.findByRole("button", { name: "Pause Paused Album" });
    fireEvent.click(pauseBtn);
    expect(togglePause).toHaveBeenCalledTimes(1);
    expect(startReplay).not.toHaveBeenCalled();
    // Row must NOT have expanded
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("shows muted ▶ (Play button) when ride is loading for this album", async () => {
    rideActive = true;
    rideStatus = "loading";
    rideReplayLabel = "Loading Album";
    libraryItems = [
      makeItem({ mbid: "m-loading", albumTitle: "Loading Album", artist: "Artist" }),
    ];
    renderStack();
    // Shows Play (not Pause) when loading — icon is muted but still present
    await screen.findByRole("button", { name: "Play Loading Album" });
  });

  it("is muted/inert while the album-tracks request is in flight — only one request and one startReplay", async () => {
    libraryItems = [
      makeItem({ mbid: "m-flight", albumTitle: "Inflight Album", artist: "Band" }),
    ];
    let resolveTracks!: (v: { tracks: Array<{ mbid: string; title: string; artist: string }>; rgTitle?: string }) => void;
    albumTracksOverride = () =>
      new Promise((resolve) => {
        resolveTracks = resolve;
      });
    renderStack();
    const playBtn = await screen.findByRole("button", { name: "Play Inflight Album" });
    fireEvent.click(playBtn);
    // While the request is pending the button is muted/inert…
    await vi.waitFor(() => {
      expect(playBtn.getAttribute("data-loading")).toBe("true");
      expect(playBtn.getAttribute("aria-disabled")).toBe("true");
    });
    // …and hammering it fires no extra requests
    fireEvent.click(playBtn);
    fireEvent.click(playBtn);
    expect(albumTracksCalls).toHaveLength(1);
    // Resolve the deferred request — exactly one replay starts
    resolveTracks({
      tracks: [{ mbid: "t1", title: "Track One", artist: "Band" }],
      rgTitle: "Inflight Album",
    });
    await vi.waitFor(() => expect(startReplay).toHaveBeenCalledTimes(1));
    expect(albumTracksCalls).toHaveLength(1);
  });

  it("clicking ▶ while album is loading is a no-op (does not call startReplay or togglePause)", async () => {
    rideActive = true;
    rideStatus = "loading";
    rideReplayLabel = "Loading Album";
    libraryItems = [
      makeItem({ mbid: "m-noop", albumTitle: "Loading Album", artist: "Artist" }),
    ];
    renderStack();
    const playBtn = await screen.findByRole("button", { name: "Play Loading Album" });
    fireEvent.click(playBtn);
    expect(startReplay).not.toHaveBeenCalled();
    expect(togglePause).not.toHaveBeenCalled();
  });

  it("clicking ▶ on a paused album calls togglePause, not startReplay", async () => {
    rideActive = true;
    rideStatus = "paused";
    rideReplayLabel = "Paused Album";
    libraryItems = [
      makeItem({ mbid: "m-paused", albumTitle: "Paused Album", artist: "Artist" }),
    ];
    renderStack();
    // Paused → shows ▶ (Play icon) but clicking resumes via togglePause
    const playBtn = await screen.findByRole("button", { name: "Play Paused Album" });
    fireEvent.click(playBtn);
    expect(togglePause).toHaveBeenCalledTimes(1);
    expect(startReplay).not.toHaveBeenCalled();
  });

  it("pressing Enter on the play button does NOT expand the row", async () => {
    libraryItems = [
      makeItem({ mbid: "m-key", albumTitle: "Keyboard Test", artist: "Band" }),
    ];
    renderStack();
    const playBtn = await screen.findByRole("button", { name: "Play Keyboard Test" });
    fireEvent.keyDown(playBtn, { key: "Enter" });
    // Row must NOT have expanded
    expect(screen.queryByRole("region")).toBeNull();
    const expandBtn = screen.getByRole("button", { name: "Expand Keyboard Test · Band" });
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
  });

  it("pressing Space on the play button does NOT expand the row", async () => {
    libraryItems = [
      makeItem({ mbid: "m-space", albumTitle: "Space Test", artist: "Band" }),
    ];
    renderStack();
    const playBtn = await screen.findByRole("button", { name: "Play Space Test" });
    fireEvent.keyDown(playBtn, { key: " " });
    // Row must NOT have expanded
    expect(screen.queryByRole("region")).toBeNull();
    const expandBtn = screen.getByRole("button", { name: "Expand Space Test · Band" });
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Expanded-header play control (Task 219)
// ---------------------------------------------------------------------------

describe("CompactStack expanded-header play control", () => {
  it("offers ▶ in the expanded header; clicking it launches the album and does NOT collapse", async () => {
    libraryItems = [
      makeItem({ mbid: "m-hdr", albumTitle: "Header Album", artist: "Band" }),
    ];
    albumTracksByMbid.set("m-hdr", {
      tracks: [{ mbid: "t1", title: "Track One", artist: "Band" }],
      rgTitle: "Header Album",
    });
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Header Album · Band" }),
    );
    // The collapse affordance and the play control coexist in the header.
    await screen.findByRole("button", { name: "Collapse Header Album" });
    const playBtn = await screen.findByRole("button", {
      name: "Play Header Album",
    });
    fireEvent.click(playBtn);
    await vi.waitFor(() => expect(startReplay).toHaveBeenCalledTimes(1));
    const [seeds, label, opts] = startReplay.mock.calls[0] as Parameters<typeof startReplay>;
    expect(label).toBe("Header Album");
    expect(opts).toMatchObject({ timeOrientation: "curated", context: "library" });
    expect(seeds[0]).toMatchObject({ mbid: "t1" });
    // The band stays expanded — playing never dismisses the investigation view.
    screen.getByRole("button", { name: "Collapse Header Album" });
    expect(screen.getByRole("region")).not.toBeNull();
  });

  it("shows ⏸ in the expanded header while this album is playing", async () => {
    rideActive = true;
    rideStatus = "playing";
    rideReplayLabel = "Hero Playing";
    libraryItems = [
      makeItem({ mbid: "m-hplay", albumTitle: "Hero Playing", artist: "Artist" }),
    ];
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Hero Playing · Artist" }),
    );
    const pauseBtn = await screen.findByRole("button", {
      name: "Pause Hero Playing",
    });
    fireEvent.click(pauseBtn);
    expect(togglePause).toHaveBeenCalledTimes(1);
    expect(startReplay).not.toHaveBeenCalled();
    // Still expanded after toggling pause.
    screen.getByRole("button", { name: "Collapse Hero Playing" });
  });

  it("omits the header play control for an unresolved album", async () => {
    libraryItems = [
      makeItem({ mbid: null, albumTitle: "Unresolved LP", artist: "Nobody" }),
    ];
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Unresolved LP · Nobody" }),
    );
    await screen.findByRole("button", { name: "Collapse Unresolved LP" });
    expect(
      screen.queryByRole("button", { name: /Play Unresolved LP/ }),
    ).toBeNull();
  });

  it("pressing Enter on the header play button does NOT collapse the band", async () => {
    libraryItems = [
      makeItem({ mbid: "m-hkey", albumTitle: "Keyboard Header", artist: "Band" }),
    ];
    renderStack();
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Keyboard Header · Band" }),
    );
    const playBtn = await screen.findByRole("button", {
      name: "Play Keyboard Header",
    });
    fireEvent.keyDown(playBtn, { key: "Enter" });
    screen.getByRole("button", { name: "Collapse Keyboard Header" });
    expect(screen.getByRole("region")).not.toBeNull();
  });
});
