// @vitest-environment jsdom
/**
 * Tests for the Library timeline lens helpers and row source labeling.
 *
 * The mixed feed arrives deduplicated from the server (one resolved row per
 * track, `dualSource` derived from import traces), so there is no client
 * merge to test — see the API DB tests for pagination/dual-source coverage.
 *
 * Lens helpers:
 *   - parseLens URL parsing, LENS_SOURCE scoping, hasRadioProvenance.
 *
 * Row labeling (LibraryRow Byline):
 *   - keep rows read "Kept from Lore" (with picked-by/heard-on when known)
 *   - import rows read "Imported from <service>"
 *   - dual-source rows show the dual label
 *   - soft rows read "Unresolved · needs matching"
 *   - removed rows keep their gray removed badge in place
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks for LibraryRow's hook dependencies
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: vi.fn(() => ["/library", vi.fn()]),
  useSearch: vi.fn(() => ""),
}));

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      ride: { active: false, startReplay: vi.fn() },
      spotify: { connected: false, premium: false, pinnedDevice: null },
    })),
  });
});

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyAlbumAvatar: vi.fn(() => ({ data: { current: null, candidates: [], needsChoice: false } })),
    useSetAlbumAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useSetLibraryRemoved: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  });
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    getRecordingAlbumTracks: vi.fn(() => new Promise(() => { /* pending */ })),
    spotifyPlay: vi.fn(),
  });
});

vi.mock("../src/components/AlbumShelf", () => ({
  AlbumShelf: () => null,
}));

// ---------------------------------------------------------------------------
// Imports (must follow vi.mock)
// ---------------------------------------------------------------------------

import {
  parseLens,
  hasRadioProvenance,
  LENS_SOURCE,
} from "../src/pages/Library";
import { LibraryRow } from "../src/components/LibraryRow";
import type { LibraryItem } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<LibraryItem> & { mbid?: string | null }): LibraryItem {
  return {
    mbid: "mbid-default",
    addedAt: "2026-01-01T00:00:00Z",
    provenance: { kind: "keep" },
    recording: {
      title: "Track",
      artist: "Artist",
      artworkUrl: null,
      albumTitle: "Album",
      spotifyUrl: null,
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Lens helpers
// ---------------------------------------------------------------------------

describe("parseLens / LENS_SOURCE / hasRadioProvenance", () => {
  it("parses all lens values and rejects unknown ones", () => {
    expect(parseLens("lens=recent")).toBe("recent");
    expect(parseLens("lens=albums")).toBe("albums");
    expect(parseLens("lens=artists")).toBe("artists");
    expect(parseLens("lens=lore")).toBe("lore");
    expect(parseLens("lens=matching")).toBe("matching");
    expect(parseLens("lens=critic")).toBe("critic");
    expect(parseLens("lens=bogus")).toBe("");
    expect(parseLens("")).toBe("");
  });

  it("scopes keep-lenses to keep, matching to soft, timeline/grouped to full feed", () => {
    expect(LENS_SOURCE["recent"]).toBe("keep");
    // From Lore is scoped server-side (radio-provenance keeps) so pagination
    // and totals describe exactly the visible feed.
    expect(LENS_SOURCE["lore"]).toBe("lore");
    expect(LENS_SOURCE["matching"]).toBe("soft");
    expect(LENS_SOURCE[""]).toBeUndefined();
    expect(LENS_SOURCE["albums"]).toBeUndefined();
    expect(LENS_SOURCE["artists"]).toBeUndefined();
  });

  it("hasRadioProvenance requires a keep with picker or station", () => {
    expect(hasRadioProvenance(makeItem({ provenance: { kind: "keep", stationSlug: "kexp" } }))).toBe(true);
    expect(hasRadioProvenance(makeItem({ provenance: { kind: "keep", pickerName: "DJ" } }))).toBe(true);
    expect(hasRadioProvenance(makeItem({ provenance: { kind: "keep" } }))).toBe(false);
    expect(hasRadioProvenance(makeItem({ provenance: { kind: "import", service: "spotify" } }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LibraryRow source labels
// ---------------------------------------------------------------------------

function renderRow(item: LibraryItem) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ul>
        <LibraryRow item={item} />
      </ul>
    </QueryClientProvider>,
  );
}

describe("LibraryRow source labels", () => {
  it("labels a plain keep row 'Kept from Lore'", () => {
    renderRow(makeItem({ provenance: { kind: "keep" } }));
    expect(screen.getByText("Kept from Lore")).toBeTruthy();
  });

  it("keeps the picked-by provenance ladder inside the keep label", () => {
    renderRow(makeItem({ provenance: { kind: "keep", pickerHandle: "dj-x", pickerName: "DJ X", stationSlug: "kexp", stationName: "KEXP" } }));
    expect(screen.getByText(/Kept from Lore — picked by/)).toBeTruthy();
    expect(screen.getByText("DJ X")).toBeTruthy();
    expect(screen.getByText("KEXP")).toBeTruthy();
  });

  it("keeps the heard-on rung for station-only keeps", () => {
    renderRow(makeItem({ provenance: { kind: "keep", stationSlug: "kexp", stationName: "KEXP" } }));
    expect(screen.getByText(/Kept from Lore — heard on/)).toBeTruthy();
  });

  it("labels an import row 'Imported from <service>'", () => {
    renderRow(makeItem({ provenance: { kind: "import", service: "spotify" } }));
    expect(screen.getByText(/Imported from spotify/)).toBeTruthy();
  });

  it("shows the dual label on a kept-and-imported row", () => {
    renderRow(makeItem({ dualSource: true, provenance: { kind: "keep", stationSlug: "kexp", stationName: "KEXP" } }));
    expect(screen.getByTestId("library-dual-source").textContent).toContain("also imported");
  });

  it("shows the dual label on an import-provenance dual row", () => {
    renderRow(makeItem({ dualSource: true, provenance: { kind: "import", service: "spotify" } }));
    expect(screen.getByTestId("library-dual-source").textContent).toContain("also kept from Lore");
  });

  it("labels soft rows 'Unresolved · needs matching'", () => {
    renderRow(makeItem({ mbid: null, soft: true, spotifyId: "sp1", provenance: { kind: "import", service: "spotify" } }));
    expect(screen.getByText(/Unresolved · needs matching/)).toBeTruthy();
  });

  it("removed rows keep the gray removed treatment and badge in place", () => {
    renderRow(makeItem({ removed: true, provenance: { kind: "keep" } }));
    expect(screen.getByTestId("library-removed-badge")).toBeTruthy();
    const row = screen.getByTestId("library-row");
    expect(row.className).toContain("lrow--removed");
  });
});
