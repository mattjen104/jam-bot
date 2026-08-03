// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlbumLoreSheet } from "../src/webplayer/AlbumLoreSheet";
import {
  useWpHoldSupport,
  useWpRecording,
  useWpSupport,
} from "../src/webplayer/hooks";
import { useMutationKeep, useMyConnections } from "../src/lib/meHooks";

vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const { makeWebplayerHooksMock } = await import("./helpers/webplayerHooksMock");
  return makeWebplayerHooksMock(importOriginal, {
    useWpRecording: vi.fn(() => ({
      data: {
        mbid: "track-1",
        title: "Long title that remains readable",
        artist: "Альбомный артист",
        artworkUrl: null,
        links: [],
      },
    })),
    useWpKnowledge: vi.fn(() => ({ data: undefined })),
    useWpListProvenance: vi.fn(() => ({ data: { items: [] } })),
    useWpPicks: vi.fn(() => ({ data: { picks: [] } })),
    useWpRecordingSpins: vi.fn(() => ({ data: { spins: [] } })),
    useWpSongExploder: vi.fn(() => ({ data: { episode: null } })),
    useWpLoreCounts: vi.fn(() => ({ data: new Map() })),
    useWpSupport: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })),
    useWpHoldSupport: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useWpUnholdSupport: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  });
});

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyConnections: vi.fn(() => ({ data: { spotify: true }, isLoading: false })),
    useMyKeepStatus: vi.fn(() => ({ data: new Set() })),
    useMutationKeep: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useMutationUnkeep: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useMySpinKeepStatus: vi.fn(() => ({ data: new Map() })),
    useMutationKeepSpin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useMutationUnkeepSpin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrap() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AlbumLoreSheet mbid="track-1" spinningOn="Quiet Radio" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const ladder = {
  data: {
    mbid: "track-1",
    state: "linkable_release",
    emptyMessage: null,
    links: [
      {
        kind: "artist",
        tier: 1,
        paidTo: "artist",
        scope: "catalog",
        url: "https://artist.example/catalog",
        releaseMbid: null,
        releaseGroupMbid: null,
        providerId: "artist-1",
        detail: "Official artist catalogue",
        note: null,
        verification: "trusted",
        sourceUrl: "https://artist.example/catalog",
        attribution: null,
        fetchedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: null,
      },
      {
        kind: "bandcamp",
        tier: 2,
        paidTo: "artist",
        scope: "release",
        url: "https://artist.bandcamp.com/album/release",
        releaseMbid: "release-1",
        releaseGroupMbid: null,
        providerId: "release-1",
        detail: "Exact Bandcamp track",
        note: "Buy direct from the artist.",
        verification: "exact",
        sourceUrl: "https://artist.bandcamp.com/album/release",
        attribution: null,
        fetchedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: null,
      },
      {
        kind: "station",
        tier: 4,
        paidTo: "station",
        scope: "door",
        url: "https://radio.example/join",
        releaseMbid: null,
        releaseGroupMbid: null,
        providerId: null,
        detail: "Quiet Radio support",
        note: "Support the station that aired this recording.",
        verification: "trusted",
        sourceUrl: null,
        attribution: null,
        fetchedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: null,
      },
      {
        kind: "discogs",
        tier: 5,
        paidTo: "seller",
        scope: "release",
        url: "https://www.discogs.com/release/1",
        releaseMbid: "release-1",
        releaseGroupMbid: null,
        providerId: "1",
        detail: "Exact release",
        note: "Secondhand; artist unpaid.",
        verification: "exact",
        sourceUrl: "https://www.discogs.com/release/1",
        attribution: "Data provided by Discogs",
        fetchedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: null,
      },
    ],
    bandcampFriday: { eligible: true, date: "2026-08-07" },
    held: false,
    heldForDate: null,
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

describe("track support sheet", () => {
  it("keeps provenance and Keep before the ordered support ladder", () => {
    vi.mocked(useWpSupport).mockReturnValue(ladder as never);
    wrap();
    const sheet = screen.getByTestId("album-lore-sheet");
    const provenance = screen.getByTestId("track-provenance");
    const keep = screen.getByRole("button", { name: /keep this track/i });
    const support = screen.getByTestId("track-support");
    expect(sheet.compareDocumentPosition(provenance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(provenance.compareDocumentPosition(keep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(keep.compareDocumentPosition(support) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...support.querySelectorAll("[data-testid^='support-row-']")].map((row) => row.getAttribute("data-testid"))).toEqual([
      "support-row-artist",
      "support-row-bandcamp",
      "support-row-station",
      "support-row-discogs",
    ]);
    expect(screen.getByText("Because you heard it here.")).toBeTruthy();
    expect(screen.getByText("Artist is not paid.")).toBeTruthy();
  });

  it("shows exactly one honest empty line and no placeholders", () => {
    vi.mocked(useWpSupport).mockReturnValue({
      ...ladder,
      data: { ...ladder.data, links: [], state: "no_linkable_release", emptyMessage: "No linkable release found." },
    } as never);
    wrap();
    expect(screen.getAllByText("No linkable release found.")).toHaveLength(1);
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
  });

  it("shows the Bandcamp Friday annotation and toggles the hold accessibly", () => {
    vi.mocked(useWpSupport).mockReturnValue(ladder as never);
    const hold = vi.fn((_vars: unknown, options?: { onSuccess?: (value: unknown) => void }) =>
      options?.onSuccess?.({ held: true }),
    );
    vi.mocked(useWpHoldSupport).mockReturnValue({ mutate: hold, isPending: false } as never);
    wrap();
    expect(screen.getByText("fees waived Fri 2026-08-07")).toBeTruthy();
    const button = screen.getByTestId("support-hold-button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(hold).toHaveBeenCalledWith({ mbid: "track-1" }, expect.anything());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toContain("Held for 2026-08-07");
  });

  it("reveals the quiet direct-support line only after Keep succeeds", () => {
    vi.mocked(useWpSupport).mockReturnValue(ladder as never);
    const mutate = vi.fn(
      (_variables: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    vi.mocked(useMutationKeep).mockReturnValue({
      mutate,
      isPending: false,
    } as never);
    wrap();
    expect(screen.queryByTestId("keep-follow-up")).toBeNull();
    fireEvent.click(screen.getByTestId("wp-keep-button"));
    expect(mutate).toHaveBeenCalled();
    expect(screen.getByTestId("keep-follow-up").textContent).toContain(
      "Direct artist support",
    );
  });

  it("degrades loading and provider errors without inventing ladder rows", () => {
    const refetch = vi.fn();
    vi.mocked(useWpSupport).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch,
    } as never);
    wrap();
    expect(screen.getByTestId("support-loading")).toBeTruthy();
    expect(screen.queryByTestId("support-row-artist")).toBeNull();

    cleanup();
    vi.mocked(useWpSupport).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as never);
    wrap();
    expect(screen.getByTestId("support-error")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    expect(refetch).toHaveBeenCalled();
  });

  it("filters unsafe external URLs before rendering them", () => {
    vi.mocked(useWpSupport).mockReturnValue({
      ...ladder,
      data: {
        ...ladder.data,
        links: [
          {
            ...ladder.data.links[0],
            url: "javascript:alert(1)",
          },
        ],
      },
    } as never);
    wrap();
    expect(screen.getByTestId("support-empty")).toBeTruthy();
    expect(screen.queryByTestId("support-row-artist")).toBeNull();
    expect(screen.queryByTestId("support-row-bandcamp")).toBeNull();
  });
});