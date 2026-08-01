// @vitest-environment jsdom
/**
 * Component tests for the webplayer's lore chip and run drawer.
 *
 * LoreChip:
 *  - renders nothing (honest absence) when there is no lore
 *  - renders "N · M lists" text when counts exist and fires onOpen on click
 *
 * RunDrawerSheet:
 *  - splits tonight's spins into FROM YOUR LIBRARY and NEW TO YOU sections
 *  - shows the taste-overlap badge and selector trove (shared count + deep cuts)
 *  - opens the album lore panel via the row's lore chip
 *  - passes the runId through to useWpRun for past-run deep links
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoreChip } from "../src/webplayer/LoreChip";
import { RunDrawerSheet } from "../src/webplayer/RunDrawerSheet";
import { useWpRun, useWpLoreCounts } from "../src/webplayer/hooks";

vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/webplayer/hooks")>();
  return {
    ...actual,
    useWpRun: vi.fn(() => ({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    })),
    useWpLoreCounts: vi.fn(() => ({ data: undefined })),
  };
});

vi.mock("../src/lib/meHooks", () => ({
  useMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
  useMyKeepStatus: vi.fn(() => ({ data: new Set() })),
  useMutationKeep: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useMutationUnkeep: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useMySpinKeepStatus: vi.fn(() => ({ data: new Map() })),
  useMutationKeepSpin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useMutationUnkeepSpin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  startSpotifyLibraryConnect: vi.fn(),
}));

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/player/PlayerProvider")>();
  return {
    ...actual,
    usePlayer: vi.fn(() => ({
      radio: { station: null, status: "idle", toggle: vi.fn() },
      ride: { active: false },
      spotify: { connected: false },
      scan: {},
    })),
  };
});

vi.mock("../src/lib/local", () => ({
  useFollows: vi.fn(() => []),
  isFollowed: vi.fn(() => false),
  toggleFollow: vi.fn(),
  djFollowId: vi.fn((slug: string, name: string) => `${slug}:${name}`),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const spin = (over: Record<string, unknown>) => ({
  mbid: null,
  title: "T",
  artist: "A",
  artworkUrl: null,
  playedAt: "2026-07-16T20:00:00.000Z",
  resolved: false,
  inLibrary: false,
  ...over,
});

const runFixture = {
  station: { slug: "kutx", name: "KUTX" },
  show: { name: "Left of the Dial", djName: "Rae" },
  day: "2026-07-16",
  spinCount: 3,
  overlapPct: 41,
  fromLibrary: [
    spin({ mbid: "mbid-lib-1", title: "Dreams", artist: "Fleetwood Mac", resolved: true, inLibrary: true }),
  ],
  newToYou: [
    spin({ mbid: "mbid-new-1", title: "Aftermath", artist: "Broadcast", resolved: true }),
    spin({ title: "Unknown Cut", artist: "Raw Artist" }),
  ],
  trove: {
    selectorName: "Rae",
    sharedCount: 12,
    deepCuts: [{ artist: "Stereolab", spinCount: 7, runCount: 4 }],
  },
  authenticated: true,
};

describe("LoreChip", () => {
  it("renders nothing when there is no lore", () => {
    const { container } = render(
      <LoreChip
        count={{ mbid: "x", artifactCount: 0, listCount: 0, keptSince: null }}
        onOpen={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while counts are still loading", () => {
    const { container } = render(<LoreChip count={undefined} onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows counts and fires onOpen on click", () => {
    const onOpen = vi.fn();
    render(
      <LoreChip
        count={{ mbid: "x", artifactCount: 3, listCount: 2, keptSince: null }}
        onOpen={onOpen}
      />,
    );
    const chip = screen.getByTestId("lore-chip");
    expect(chip.textContent).toContain("3");
    expect(chip.textContent).toContain("2 lists");
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("RunDrawerSheet", () => {
  it("splits spins into library and new sections with overlap badge and trove", () => {
    vi.mocked(useWpRun).mockReturnValue({
      data: runFixture,
      isLoading: false,
    } as ReturnType<typeof useWpRun>);

    wrap(<RunDrawerSheet slug="kutx" onClose={() => {}} onOpenLore={() => {}} />);

    expect(screen.getByText(/FROM YOUR LIBRARY · 1/)).toBeTruthy();
    expect(screen.getByText(/NEW TO YOU · 2/)).toBeTruthy();
    expect(screen.getByText("41% taste overlap")).toBeTruthy();
    expect(screen.getByText(/Fleetwood Mac — Dreams/)).toBeTruthy();
    expect(screen.getByText(/Raw Artist — Unknown Cut/)).toBeTruthy();
    // Trove: shared line + deep cut card + follow button.
    expect(screen.getByText(/share 12 recordings/)).toBeTruthy();
    expect(screen.getByText("Stereolab")).toBeTruthy();
    expect(screen.getByText(/spun 7x across 4 runs/)).toBeTruthy();
    expect(screen.getByText("Follow selector")).toBeTruthy();
  });

  it("opens the lore panel from a row's chip", () => {
    vi.mocked(useWpRun).mockReturnValue({
      data: runFixture,
      isLoading: false,
    } as ReturnType<typeof useWpRun>);
    vi.mocked(useWpLoreCounts).mockReturnValue({
      data: new Map([
        ["mbid-new-1", { mbid: "mbid-new-1", artifactCount: 2, listCount: 1, keptSince: null }],
      ]),
    } as ReturnType<typeof useWpLoreCounts>);

    const onOpenLore = vi.fn();
    wrap(<RunDrawerSheet slug="kutx" onClose={() => {}} onOpenLore={onOpenLore} />);

    fireEvent.click(screen.getByTestId("lore-chip"));
    expect(onOpenLore).toHaveBeenCalledWith("mbid-new-1");
  });

  it("passes runId through to useWpRun for past-run deep links", () => {
    vi.mocked(useWpRun).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useWpRun>);

    wrap(<RunDrawerSheet slug="kutx" runId={4321} onClose={() => {}} onOpenLore={() => {}} />);
    expect(vi.mocked(useWpRun)).toHaveBeenCalledWith("kutx", 4321);
    expect(screen.getByText(/Loading run/)).toBeTruthy();
  });

  it("shows an honest error state (not a stuck loader) when the run fails to load", () => {
    const refetch = vi.fn();
    vi.mocked(useWpRun).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useWpRun>);

    wrap(<RunDrawerSheet slug="kutx" runId={999} onClose={() => {}} onOpenLore={() => {}} />);

    expect(screen.getByText("Run unavailable")).toBeTruthy();
    expect(screen.queryByText(/Loading run/)).toBeNull();
    expect(screen.getByTestId("run-error").textContent).toContain("Couldn't load this run");
    fireEvent.click(screen.getByText("Try again"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows an honest empty state when tonight has no spins", () => {
    vi.mocked(useWpRun).mockReturnValue({
      data: { ...runFixture, fromLibrary: [], newToYou: [], trove: null, spinCount: 0 },
      isLoading: false,
    } as ReturnType<typeof useWpRun>);

    wrap(<RunDrawerSheet slug="kutx" onClose={() => {}} onOpenLore={() => {}} />);
    expect(screen.getByText(/No spins logged for tonight yet/)).toBeTruthy();
  });
});
