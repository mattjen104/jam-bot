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
 *   - clicking a row expands it: header at top, metadata cards + → Stack
 *     link; other albums' rows are gone
 *   - clicking the expanded header collapses back to the five-row order
 *   - CAA fallback art is used for imported albums without artwork
 *  Play controls (Task 216):
 *   - ▶ button hidden when primaryMbid is null
 *   - clicking ▶ launches the album and does NOT expand the row
 *   - ▶ switches to ⏸ when that album is the active ride + playing
 *   - clicking ⏸ calls ride.togglePause, not expansion
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  onArtError: vi.fn(),
}));

const setLocation = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", setLocation],
}));

// Library page data — set per test.
let libraryItems: LibraryItem[] = [];
vi.mock("../src/lib/meHooks", () => ({
  useMyLibraryInfinite: () => ({
    data: { pages: [{ items: libraryItems, nextCursor: null }] },
    isLoading: false,
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
  knowledgeByMbid.clear();
  albumTracksByMbid.clear();
  albumTracksOverride = null;
  albumTracksCalls.length = 0;
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
    items: [],
    ...overrides,
  };
}

function renderStack() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CompactStack />
    </QueryClientProvider>,
  );
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
      "https://coverartarchive.org/release-group/aaaa-bbbb/front-500",
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
    const img = container.querySelector("img.compact-stack__spine-art");
    expect(img?.getAttribute("src")).toBe(
      "https://coverartarchive.org/release-group/rg-42/front-500",
    );
  });
});

describe("CompactStack expansion", () => {
  it("expands a non-top row into the top slot with metadata cards and a Stack link, then collapses", async () => {
    libraryItems = [
      makeItem({ mbid: "m1", albumTitle: "First Album", artist: "A", addedAt: "2026-08-03T00:00:00Z" }),
      makeItem({ mbid: "m2", albumTitle: "Second Album", artist: "B", addedAt: "2026-08-02T00:00:00Z" }),
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

    // Header for the expanded album is present and collapsible;
    // the other album's row is covered (gone).
    const header = await screen.findByRole("button", {
      name: "Collapse Second Album",
    });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.queryByRole("button", { name: "Expand First Album · A" }),
    ).toBeNull();

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
