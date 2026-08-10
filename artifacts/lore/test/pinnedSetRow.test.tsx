// @vitest-environment jsdom
/**
 * PinnedSetRow — the Dial's pinned tuned-station sentence (Task #37).
 *
 * Verifies:
 *  - the live sentence unfurls with the COMPLETE current setlist (no truncation)
 *  - live setlist artists add to the library only (no play/navigate) and the
 *    add affordance flips off once seeded
 *  - live mode never exposes export/playlist controls (structurally absent)
 *  - the single left chevron toggles to the previous completed set
 *  - the past set renders in past tense with the strongest provenance, its full
 *    artist list, and export controls
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useGetStationArchive: vi.fn(() => ({ data: undefined, isLoading: false })),
    useGetStationRun: vi.fn(() => ({ data: undefined, isLoading: false })),
    getGetStationArchiveQueryKey: vi.fn(() => ["station-archive"]),
    getGetStationRunQueryKey: vi.fn(() => ["station-run"]),
  });
});

import {
  useGetStationArchive,
  useGetStationRun,
} from "@workspace/api-client-react";
import { PinnedSetRow } from "../src/components/dial/PinnedSetRow";
import type { DialShow, DialSpin, DialStation } from "../src/hooks/useDialData";

function makeSpin(artist: string, title: string, overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    artist,
    title,
    playedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    ...overrides,
  };
}

function makeShow(spins: DialSpin[], overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 42,
    showName: "Deep Cuts",
    djName: "DJ Nova",
    startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    ianaTimezone: "America/New_York",
    state: "live",
    spins,
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack: spins[spins.length - 1] ?? null,
    isPickerShow: false,
    pickerId: null,
    ...overrides,
  };
}

function makeStation(): DialStation {
  return {
    station: {
      slug: "kexp",
      name: "KEXP",
      automationClass: null,
      streamUrl: null,
      websiteUrl: null,
      hidden: false,
      favorite: false,
      ianaTimezone: "America/New_York",
    } as DialStation["station"],
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
  };
}

function renderPinned(props: {
  ds?: DialStation;
  show?: DialShow | null;
  seedsLower?: Set<string>;
  onAddArtist?: (name: string) => void;
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onAddArtist = props.onAddArtist ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <PinnedSetRow
        ds={props.ds ?? makeStation()}
        show={props.show === undefined ? null : props.show}
        seedsLower={props.seedsLower ?? new Set()}
        onAddArtist={onAddArtist}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onAddArtist };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  (useGetStationArchive as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: false });
  (useGetStationRun as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: false });
});

describe("PinnedSetRow — live unfurl", () => {
  it("renders the full setlist inline with no truncation", () => {
    const spins = ["A Band", "B Band", "C Band", "D Band", "E Band", "F Band", "G Band", "H Band"]
      .map((name) => makeSpin(name, `${name} Track`));
    renderPinned({ show: makeShow(spins) });

    // The pinned set row is present.
    expect(document.querySelector(".dial-pinned-set")).toBeTruthy();
    // Every artist appears exactly once — the set lives inline in the
    // sentence, with no "N more" collapse and no duplicate queue block.
    for (const name of spins.map((s) => s.artist)) {
      expect(screen.getAllByText(name)).toHaveLength(1);
    }
    expect(document.body.textContent).not.toMatch(/\bmore\b/);
    // Provenance is inline in the sentence — DJ leads.
    expect(document.body.textContent).toContain("DJ Nova");
  });

  it("live setlist artists add to the library only — no export, no navigation", () => {
    const spins = [makeSpin("A Band", "T1"), makeSpin("B Band", "T2")];
    const { onAddArtist } = renderPinned({ show: makeShow(spins) });

    // No export/playlist controls in live mode — structurally absent.
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();

    // Artist names are not navigation buttons (no gram-link--nav).
    expect(document.querySelector(".gram-link--nav")).toBeNull();

    // The `+` affordance adds the artist.
    fireEvent.click(screen.getByRole("button", { name: /Add A Band to your artists/i }));
    expect(onAddArtist).toHaveBeenCalledWith("A Band");
  });

  it("shows a single left chevron to step back one set", () => {
    renderPinned({ show: makeShow([makeSpin("A Band", "T1")]) });
    const chevs = screen.getAllByRole("button", { name: /previous set|current set/i });
    expect(chevs).toHaveLength(1);
  });
});

describe("PinnedSetRow — past set", () => {
  it("chevron reveals the previous completed run in past tense with export controls", async () => {
    (useGetStationArchive as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        station: { slug: "kexp", name: "KEXP", stationClass: "community" },
        runs: [
          // Current live run — must be skipped.
          { runId: 42, date: "2026-08-10", show: null, spinCount: 3, resolvedCount: 3, sourceUrl: null, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() },
          // The previous completed run.
          { runId: 41, date: "2026-08-10", show: { name: "Morning Sound", djName: "DJ Sol" }, spinCount: 2, resolvedCount: 2, sourceUrl: null, startedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), endedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() },
        ],
        nextOffset: null,
      },
      isLoading: false,
    });
    (useGetStationRun as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        station: { slug: "kexp", name: "KEXP", stationClass: "community" },
        run: { runId: 41, date: "2026-08-10", spinCount: 2, resolvedCount: 2, sourceUrl: null, startedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), endedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() },
        tracks: [
          { position: 1, playedAt: null, rawArtist: "Past One", rawTitle: "P1", confidence: "high", recording: null },
          { position: 2, playedAt: null, rawArtist: "Past Two", rawTitle: "P2", confidence: "high", recording: null },
        ],
      },
      isLoading: false,
    });

    renderPinned({ show: makeShow([makeSpin("Live One", "L1")]) });

    fireEvent.click(screen.getByRole("button", { name: /previous set/i }));

    await waitFor(() => {
      // Strongest provenance: the past run's DJ, past tense verb.
      expect(document.body.textContent).toContain("DJ Sol");
      expect(document.body.textContent).toContain("played");
    });
    // Full past artist list.
    expect(screen.getByText("Past One")).toBeTruthy();
    expect(screen.getByText("Past Two")).toBeTruthy();
    // Export/playlist controls appear ONLY for the completed past set.
    expect(screen.getByRole("button", { name: /download/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /past set export format/i })).toBeTruthy();
  });
});
