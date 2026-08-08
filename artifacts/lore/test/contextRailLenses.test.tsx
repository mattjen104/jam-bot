// @vitest-environment jsdom
/**
 * ContextRail lens tests.
 *
 * The rail renders sentence + attribution + the active lens for the top
 * context frame. Lenses are compact previews with an explicit "Open" link to
 * the canonical route — and opening/closing lenses must NEVER touch playback
 * (the rail has no player wiring; every interaction only calls onPush).
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The artist lens searches the archive via the generated hook; mock the
// barrel so no QueryClientProvider is needed (see lore test conventions).
const searchArtistRuns = vi.fn(() => ({ data: undefined, isLoading: false, isError: false }));
vi.mock("@workspace/api-client-react", () => ({
  useSearchArtistRuns: (...args: unknown[]) => searchArtistRuns(...args),
  getSearchArtistRunsQueryKey: (params: unknown) => ["artist-runs", params],
}));

import { ContextRail, type RailSet } from "../src/components/ContextRail";
import type { ContextDescriptor } from "../src/dial/dialContext";
import type { DialShow, DialSpin, DialStation } from "../src/hooks/useDialData";

function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    title: "Some Song",
    artist: "Test Artist",
    playedAt: new Date("2026-08-08T10:00:00Z").toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    ...overrides,
  };
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 42,
    showName: "Morning Becomes Eclectic",
    djName: "Novena Carmel",
    startedAt: "2026-08-08T09:00:00Z",
    endedAt: "2026-08-08T12:00:00Z",
    ianaTimezone: "America/Los_Angeles",
    state: "live",
    spins: [
      makeSpin({ artist: "Broadcast", artistMbid: "mbid-broadcast" }),
      makeSpin({ artist: "Portishead", isLibraryHit: true }),
    ],
    crossings: 1,
    artistCrossings: 0,
    topArtists: ["Portishead"],
    topArtistNames: [],
    currentTrack: makeSpin({ artist: "Broadcast", artistMbid: "mbid-broadcast" }),
    isPickerShow: false,
    pickerId: null,
    ...overrides,
  };
}

function makeRow(): { ds: DialStation; show: DialShow } {
  const show = makeShow();
  return {
    ds: {
      station: { slug: "kcrw", name: "KCRW" } as DialStation["station"],
      isLive: true,
      shows: [show],
      crossings: 1,
      artistCrossings: 0,
      weekCrossings: 0,
      weekArtistCrossings: 0,
      monthCrossings: 0,
      monthArtistCrossings: 0,
      lifetimeCrossings: 3,
      lifetimeArtistCrossings: 1,
      topArtistNames: [],
    },
    show,
  };
}

function makeSet(overrides: Partial<RailSet> = {}): RailSet {
  return {
    id: "kcrw:2026-08-08T09:00:00Z",
    runId: 42,
    stationSlug: "kcrw",
    stationName: "KCRW",
    startedAt: "2026-08-08T09:00:00Z",
    ianaTimezone: "America/Los_Angeles",
    showName: "Morning Becomes Eclectic",
    djNames: ["Novena Carmel"],
    artists: [
      { name: "Broadcast", inLibrary: false },
      { name: "Portishead", inLibrary: true },
    ],
    spins: [
      makeSpin({ artist: "Broadcast", artistMbid: "mbid-broadcast" }),
      makeSpin({ artist: "Portishead", isLibraryHit: true }),
    ],
    ...overrides,
  };
}

function ctxWith(stack: ContextDescriptor["stack"]): ContextDescriptor {
  return { stack, temporal: { kind: "live" } };
}

const baseProps = () => ({
  row: makeRow(),
  sets: [makeSet()],
  seedsLower: new Set<string>(),
  onAddSeed: vi.fn(),
  onPush: vi.fn(),
});

afterEach(() => {
  cleanup();
  searchArtistRuns.mockClear();
  searchArtistRuns.mockReturnValue({ data: undefined, isLoading: false, isError: false });
});

describe("ContextRail", () => {
  it("renders the summary sentence with attribution below (station lens default)", () => {
    const props = baseProps();
    render(<ContextRail ctx={ctxWith([{ kind: "station", id: "kcrw", label: "KCRW" }])} {...props} />);
    // sentence contains linkable artist, attribution carries show · station
    expect(document.querySelector(".crail__sentence")?.textContent).toContain("Portishead");
    expect(document.querySelector(".crail__attribution")?.textContent).toContain("KCRW");
    // station lens is the default with an open action to the canonical route
    const open = screen.getByRole("link", { name: /open archive/i });
    expect(open.getAttribute("href")).toBe("/archive/stations/kcrw");
  });

  it("sentence artist links push an artist frame (mbid when known)", () => {
    const props = baseProps();
    const row = makeRow();
    row.show.currentTrack = makeSpin({ artist: "Broadcast", artistMbid: "mbid-broadcast", isLibraryHit: true });
    row.show.topArtists = ["Broadcast"];
    render(<ContextRail ctx={ctxWith([{ kind: "station", id: "kcrw", label: "KCRW" }])} {...props} row={row} />);
    const sentence = document.querySelector(".crail__sentence") as HTMLElement;
    fireEvent.click(within(sentence).getByRole("button", { name: "Broadcast" }));
    expect(props.onPush).toHaveBeenCalledWith({ kind: "artist", id: "mbid-broadcast", label: "Broadcast" });
  });

  it("show attribution opens the show lens; DJ lens links to /dj/:name", () => {
    const props = baseProps();
    const { rerender } = render(
      <ContextRail ctx={ctxWith([{ kind: "station", id: "kcrw", label: "KCRW" }])} {...props} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Morning Becomes Eclectic" }));
    expect(props.onPush).toHaveBeenCalledWith({
      kind: "show",
      id: "Morning Becomes Eclectic",
      label: "Morning Becomes Eclectic",
    });

    rerender(
      <ContextRail
        ctx={ctxWith([
          { kind: "station", id: "kcrw", label: "KCRW" },
          { kind: "dj", id: "Novena Carmel", label: "Novena Carmel" },
        ])}
        {...props}
      />,
    );
    const open = screen.getByRole("link", { name: /open/i });
    expect(open.getAttribute("href")).toBe("/dj/Novena%20Carmel");
  });

  it("set lens shows the tracklist and opens the canonical run route", () => {
    const props = baseProps();
    render(
      <ContextRail
        ctx={ctxWith([
          { kind: "station", id: "kcrw", label: "KCRW" },
          { kind: "set", id: "kcrw:2026-08-08T09:00:00Z", label: "Morning Becomes Eclectic" },
        ])}
        {...props}
      />,
    );
    const lens = document.querySelector(".crail-lens")!;
    expect(lens.textContent).toContain("Broadcast");
    expect(lens.textContent).toContain("Portishead");
    expect(screen.getByRole("link", { name: /open/i }).getAttribute("href"))
      .toBe("/archive/station-runs/42");
  });

  it("set lens opens the SELECTED set's own run route, not the tuned show's", () => {
    // A historical set (different run than the currently tuned show, run 42).
    const historical = makeSet({
      id: "kcrw:2026-07-01T09:00:00Z",
      runId: 99,
      startedAt: "2026-07-01T09:00:00Z",
      showName: "An Older Show",
    });
    const props = baseProps();
    render(
      <ContextRail
        ctx={ctxWith([
          { kind: "station", id: "kcrw", label: "KCRW" },
          { kind: "set", id: "kcrw:2026-07-01T09:00:00Z", label: "An Older Show" },
        ])}
        {...props}
        sets={[makeSet(), historical]}
      />,
    );
    expect(screen.getByRole("link", { name: /open/i }).getAttribute("href"))
      .toBe("/archive/station-runs/99");
  });

  it("set lens without a run id falls back to the station archive", () => {
    const noRun = makeSet({ id: "kcrw:norun", runId: null });
    const props = baseProps();
    render(
      <ContextRail
        ctx={ctxWith([
          { kind: "station", id: "kcrw", label: "KCRW" },
          { kind: "set", id: "kcrw:norun", label: "Set" },
        ])}
        {...props}
        sets={[noRun]}
      />,
    );
    expect(screen.getByRole("link", { name: /open/i }).getAttribute("href"))
      .toBe("/archive/stations/kcrw");
  });

  it("artist lens lists sets containing the artist from the archive endpoint", () => {
    searchArtistRuns.mockReturnValue({
      data: {
        query: "Broadcast",
        stationRuns: [
          {
            station: { slug: "kexp", name: "KEXP" },
            run: { runId: 77, date: "2026-08-01", show: { name: "Drive Time" } },
          },
        ],
        pickerRuns: [],
      },
      isLoading: false,
      isError: false,
    } as never);
    const props = baseProps();
    render(
      <ContextRail
        ctx={ctxWith([
          { kind: "station", id: "kcrw", label: "KCRW" },
          { kind: "artist", id: "mbid-broadcast", label: "Broadcast" },
        ])}
        {...props}
      />,
    );
    expect(screen.getByText(/sets containing this artist/i)).toBeTruthy();
    const runLink = screen.getByRole("link", { name: /kexp/i });
    expect(runLink.getAttribute("href")).toBe("/archive/station-runs/77");
    expect(screen.getByRole("link", { name: /open/i }).getAttribute("href")).toBe("/artist/mbid-broadcast");
  });

  it("artist lens degrades to already-loaded dial sets without a spinner when the endpoint has nothing", () => {
    const props = baseProps();
    render(
      <ContextRail
        ctx={ctxWith([
          { kind: "station", id: "kcrw", label: "KCRW" },
          { kind: "artist", id: "name:Broadcast", label: "Broadcast" },
        ])}
        {...props}
      />,
    );
    // fallback: the loaded set containing Broadcast is listed, no loading text
    expect(screen.queryByText(/searching the archive/i)).toBeNull();
    expect(document.querySelector(".crail-lens")!.textContent).toContain("Morning Becomes Eclectic");
    // + affordance to seed the artist
    fireEvent.click(screen.getByRole("button", { name: /add broadcast to your artists/i }));
    expect(props.onAddSeed).toHaveBeenCalledWith("Broadcast");
  });

  it("artist lens restored from a URL (mbid frame, no label) recovers the name from loaded data", () => {
    // surface.push serializes only kind:id — frame labels are NOT restored
    // after a refresh/shared link. The lens must recover the artist name
    // from already-loaded dial data and stay fully functional.
    const props = baseProps();
    render(
      <ContextRail
        ctx={ctxWith([
          { kind: "station", id: "kcrw", label: "KCRW" },
          { kind: "artist", id: "mbid-broadcast" },
        ])}
        {...props}
      />,
    );
    // name recovered → search enabled with the recovered name
    expect(searchArtistRuns).toHaveBeenLastCalledWith(
      { q: "Broadcast" },
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    // lede shows the recovered name, canonical open link intact
    expect(document.querySelector(".crail-lens__lede")!.textContent).toContain("Broadcast");
    expect(screen.getByRole("link", { name: /open/i }).getAttribute("href")).toBe("/artist/mbid-broadcast");
    // loaded-set fallback works
    expect(document.querySelector(".crail-lens")!.textContent).toContain("Morning Becomes Eclectic");
    // + add affordance works
    fireEvent.click(screen.getByRole("button", { name: /add broadcast to your artists/i }));
    expect(props.onAddSeed).toHaveBeenCalledWith("Broadcast");
  });

  it("artist lens restored from a URL (name frame, no label) recovers the name from the frame id", () => {
    const props = baseProps();
    render(
      <ContextRail
        ctx={ctxWith([
          { kind: "station", id: "kcrw", label: "KCRW" },
          { kind: "artist", id: "name:Broadcast" },
        ])}
        {...props}
      />,
    );
    expect(document.querySelector(".crail-lens__lede")!.textContent).toContain("Broadcast");
    expect(document.querySelector(".crail-lens")!.textContent).toContain("Morning Becomes Eclectic");
  });

  it("never touches playback: interactions only push frames", () => {
    // The rail receives no player handles at all — its only outward channels
    // are onPush and onAddSeed. Clicking through sentence links must call
    // onPush and nothing else observable.
    const props = baseProps();
    render(<ContextRail ctx={ctxWith([{ kind: "station", id: "kcrw", label: "KCRW" }])} {...props} />);
    expect(document.querySelector("audio")).toBeNull();
    const sentence = document.querySelector(".crail__sentence") as HTMLElement;
    fireEvent.click(within(sentence).getByRole("button", { name: "Portishead" }));
    expect(props.onPush).toHaveBeenCalledTimes(1);
    expect(props.onAddSeed).not.toHaveBeenCalled();
  });
});
