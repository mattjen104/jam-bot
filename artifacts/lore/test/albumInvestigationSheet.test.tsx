// @vitest-environment jsdom
/**
 * Tests for AlbumInvestigationSheet — verifies that published claims render
 * as indexed source cards and are NOT listed in the "Not yet indexed" section.
 *
 * Covers:
 *  - buildInvestigationCards pure function: claim → indexed card mapping
 *  - buildInvestigationCards: catalogued source without claims → not-yet-indexed
 *  - buildInvestigationCards: unknown sourceHandle still produces an indexed card
 *  - buildInvestigationCards: draft claims are excluded
 *  - buildInvestigationCards: multi-MBID claim dedup and excerpt joining
 *  - Component render: Song Exploder claim appears in Sources, not in Not yet indexed
 *  - Component render: close button calls onDismiss
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  buildInvestigationCards,
  AlbumInvestigationSheet,
  type IndexedSourceCard,
} from "../src/components/AlbumInvestigationSheet";
import type { TrackClaim } from "@workspace/api-client-react";
import type { AlbumGroup } from "../src/pages/Library";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("../src/lib/proxyArt", () => ({
  proxyArtUrl: (url: string | null) => url,
}));

vi.mock("../src/lib/rumours", () => ({
  onArtError: vi.fn(),
}));

// Mock the api-client-react barrel so useQueries resolves immediately
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Return a stable query key so useQueries can cache by MBID
    getGetRecordingKnowledgeQueryKey: (mbid: string) => [
      `/api/recordings/${mbid}/knowledge`,
    ],
    // Default: no claims — individual tests override via QueryClient seeding
    getRecordingKnowledge: vi.fn(async (_mbid: string) => ({
      knowledge: null,
      claims: [],
    })),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClaim(overrides: Partial<TrackClaim> = {}): TrackClaim {
  return {
    id: 1,
    text: "The snare was recorded in a stairwell for natural reverb.",
    sourceLabel: "Song Exploder",
    sourceHandle: "song-exploder",
    sourceUrl: "https://songexploder.net/ep/123",
    status: "published",
    ...overrides,
  };
}

function makeGroup(mbids: (string | null)[]): AlbumGroup {
  return {
    key: "test-album\x1fTest Artist",
    albumTitle: "Test Album",
    artist: "Test Artist",
    artworkUrl: null,
    releaseYear: null,
    items: mbids.map((mbid, i) => ({
      mbid,
      provenance: { kind: "keep" },
      addedAt: `2026-0${i + 1}-01T00:00:00Z`,
      recording: {
        title: `Track ${i + 1}`,
        artist: "Test Artist",
        artworkUrl: null,
        albumTitle: "Test Album",
        spotifyUrl: null,
      },
    })),
  };
}

function renderSheet(group: AlbumGroup, queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AlbumInvestigationSheet
        group={group}
        onDismiss={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Pure function tests — buildInvestigationCards
// ---------------------------------------------------------------------------

describe("buildInvestigationCards", () => {
  it("published claim produces an indexed card with the claim text as excerpt", () => {
    const claim = makeClaim();
    const { indexed, notIndexed } = buildInvestigationCards([claim]);

    expect(indexed).toHaveLength(1);
    const card = indexed[0] as IndexedSourceCard;
    expect(card.label).toBe("Song Exploder");
    expect(card.excerpt).toContain("stairwell");
    expect(card.url).toBe("https://songexploder.net/ep/123");

    // song-exploder is indexed, so it must not appear in the pending list
    expect(notIndexed.map((s) => s.id)).not.toContain("song-exploder");
  });

  it("catalogued source with no claims appears in notIndexed", () => {
    const { indexed, notIndexed } = buildInvestigationCards([]);
    expect(indexed).toHaveLength(0);
    const pendingIds = notIndexed.map((s) => s.id);
    expect(pendingIds).toContain("song-exploder");
    expect(pendingIds).toContain("pitchfork");
    expect(pendingIds).toContain("beato");
  });

  it("draft claims are excluded", () => {
    const claim = makeClaim({ status: "draft" });
    const { indexed } = buildInvestigationCards([claim]);
    expect(indexed).toHaveLength(0);
  });

  it("rejected claims are excluded", () => {
    const claim = makeClaim({ status: "rejected" });
    const { indexed } = buildInvestigationCards([claim]);
    expect(indexed).toHaveLength(0);
  });

  it("unknown sourceHandle still produces an indexed card (not discarded)", () => {
    const claim = makeClaim({
      sourceHandle: "some-new-source",
      sourceLabel: "Brand New Source",
    });
    const { indexed } = buildInvestigationCards([claim]);
    expect(indexed).toHaveLength(1);
    expect(indexed[0]!.label).toBe("Brand New Source");
  });

  it("multiple claims for the same sourceHandle are joined as a single card (up to 2 sentences)", () => {
    const claims = [
      makeClaim({ text: "First sentence." }),
      makeClaim({ text: "Second sentence." }),
      makeClaim({ text: "Third sentence — should be omitted." }),
    ];
    const { indexed } = buildInvestigationCards(claims);
    expect(indexed).toHaveLength(1);
    expect(indexed[0]!.excerpt).toBe("First sentence. Second sentence.");
    expect(indexed[0]!.excerpt).not.toContain("Third");
  });

  it("book claim produces a Book / biography card with title and author split out", () => {
    const claim = makeClaim({
      sourceHandle: "book",
      sourceLabel: "Making Rumours — Ken Caillat & Steven Stiefel",
      sourceUrl: "https://www.worldcat.org/title/making-rumours",
      text: '"The Chain" was assembled from separate pieces recorded at different sessions.',
    });
    const { indexed, notIndexed } = buildInvestigationCards([claim]);

    expect(indexed).toHaveLength(1);
    const card = indexed[0] as IndexedSourceCard;
    expect(card.id).toBe("book");
    expect(card.type).toBe("Book / biography");
    expect(card.label).toBe("Making Rumours");
    expect(card.bookAuthor).toBe("Ken Caillat & Steven Stiefel");
    expect(card.url).toBe("https://www.worldcat.org/title/making-rumours");
    expect(notIndexed.map((s) => s.id)).not.toContain("book");
  });

  it("book claim without a link degrades to url=null (no fabricated link)", () => {
    const claim = makeClaim({
      sourceHandle: "book",
      sourceLabel: "Chronicles: Volume One — Bob Dylan",
      sourceUrl: "",
    });
    const { indexed } = buildInvestigationCards([claim]);
    expect(indexed).toHaveLength(1);
    expect(indexed[0]!.url).toBeNull();
  });

  it("book sourceLabel without an author suffix keeps full label and null author", () => {
    const claim = makeClaim({
      sourceHandle: "book",
      sourceLabel: "Revolution in the Head",
    });
    const { indexed } = buildInvestigationCards([claim]);
    expect(indexed[0]!.label).toBe("Revolution in the Head");
    expect(indexed[0]!.bookAuthor).toBeNull();
  });

  it("draft book claims are excluded from cards", () => {
    const claim = makeClaim({
      sourceHandle: "book",
      sourceLabel: "Making Rumours — Ken Caillat & Steven Stiefel",
      status: "draft",
    });
    const { indexed } = buildInvestigationCards([claim]);
    expect(indexed).toHaveLength(0);
  });

  it("non-book claims keep bookAuthor null even with an em-dash in the label", () => {
    const claim = makeClaim({
      sourceHandle: "song-exploder",
      sourceLabel: "Song Exploder — Episode 123",
    });
    const { indexed } = buildInvestigationCards([claim]);
    expect(indexed[0]!.bookAuthor).toBeNull();
    expect(indexed[0]!.label).toBe("Song Exploder — Episode 123");
  });

  it("claims from different sourceHandles each get their own card", () => {
    const claims = [
      makeClaim({ sourceHandle: "song-exploder", sourceLabel: "Song Exploder" }),
      makeClaim({ sourceHandle: "genius",        sourceLabel: "Genius" }),
    ];
    const { indexed, notIndexed } = buildInvestigationCards(claims);
    const indexedIds = indexed.map((c) => c.id);
    expect(indexedIds).toContain("song-exploder");
    expect(indexedIds).toContain("genius");
    expect(notIndexed.map((s) => s.id)).not.toContain("song-exploder");
    expect(notIndexed.map((s) => s.id)).not.toContain("genius");
  });
});

// ---------------------------------------------------------------------------
// Component render tests
// ---------------------------------------------------------------------------

describe("AlbumInvestigationSheet — component render", () => {
  it("renders album title and artist in the header", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const group = makeGroup([null]); // no resolved MBIDs — no fetch needed

    renderSheet(group, qc);

    // getByText throws if the element is not in the document
    expect(screen.getByText("Test Album").textContent).toBe("Test Album");
    expect(screen.getByText("Test Artist").textContent).toBe("Test Artist");
  });

  it("shows track count in the provenance strip", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const group = makeGroup(["mbid-1", "mbid-2"]);

    // Pre-seed both MBID queries with empty claims so loading resolves immediately
    qc.setQueryData(["/api/recordings/mbid-1/knowledge"], { knowledge: null, claims: [] });
    qc.setQueryData(["/api/recordings/mbid-2/knowledge"], { knowledge: null, claims: [] });

    renderSheet(group, qc);

    expect(screen.getByText(/2 tracks kept/i).textContent).toMatch(/2 tracks kept/i);
  });

  it("Song Exploder claim renders as a source card and is absent from Not yet indexed", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const group = makeGroup(["mbid-se"]);

    const claim = makeClaim({
      text: "Rick Rubin brought the reverb unit from his home studio.",
    });
    qc.setQueryData(["/api/recordings/mbid-se/knowledge"], {
      knowledge: null,
      claims: [claim],
    });

    renderSheet(group, qc);

    // The source card should contain the excerpt
    expect(
      screen.getByText(/Rick Rubin brought the reverb unit/i).textContent,
    ).toMatch(/Rick Rubin brought the reverb unit/i);

    // "Not yet indexed" list must NOT contain "Song Exploder"
    const pending = screen.queryByTestId("album-inv-pending");
    if (pending) {
      expect(pending.textContent).not.toContain("Song Exploder");
    }
  });

  it("book claim renders a card with title, author byline, type, and external link", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const group = makeGroup(["mbid-book"]);

    const claim = makeClaim({
      sourceHandle: "book",
      sourceLabel: "Making Rumours — Ken Caillat & Steven Stiefel",
      sourceUrl: "https://www.worldcat.org/title/making-rumours",
      text: "The bassline was extracted from an abandoned outtake.",
    });
    qc.setQueryData(["/api/recordings/mbid-book/knowledge"], {
      knowledge: null,
      claims: [claim],
    });

    renderSheet(group, qc);

    expect(screen.getByText("Making Rumours").textContent).toBe("Making Rumours");
    expect(
      screen.getByText("Ken Caillat & Steven Stiefel").textContent,
    ).toBe("Ken Caillat & Steven Stiefel");
    expect(screen.getByText("Book / biography").textContent).toBe("Book / biography");
    expect(
      screen.getByText(/abandoned outtake/i).textContent,
    ).toMatch(/abandoned outtake/i);

    const link = screen.getByRole("link", { name: /open making rumours/i });
    expect(link.getAttribute("href")).toBe(
      "https://www.worldcat.org/title/making-rumours",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("book claim without a link renders the card but no external link", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const group = makeGroup(["mbid-book-nolink"]);

    const claim = makeClaim({
      sourceHandle: "book",
      sourceLabel: "Chronicles: Volume One — Bob Dylan",
      sourceUrl: "",
      text: "The song began as a long stream-of-consciousness piece.",
    });
    qc.setQueryData(["/api/recordings/mbid-book-nolink/knowledge"], {
      knowledge: null,
      claims: [claim],
    });

    renderSheet(group, qc);

    expect(screen.getByText("Chronicles: Volume One").textContent).toBe(
      "Chronicles: Volume One",
    );
    expect(
      screen.queryByRole("link", { name: /open chronicles/i }),
    ).toBeNull();
  });

  it("close button calls onDismiss", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const group = makeGroup([]);
    const onDismiss = vi.fn();

    render(
      <QueryClientProvider client={qc}>
        <AlbumInvestigationSheet group={group} onDismiss={onDismiss} />
      </QueryClientProvider>,
    );

    screen.getByRole("button", { name: /close investigation/i }).click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
