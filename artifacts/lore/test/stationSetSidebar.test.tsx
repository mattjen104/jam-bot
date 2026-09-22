/**
 * StationSetSidebar — the landscape Dial panel with the tuned station's
 * in-progress set ("On air" + "Earlier this set").
 *
 * Covers the task's done-criteria:
 *  - per-row Keep on a resolved historical spin fires the mbid keep mutation
 *    with the spinId and station/show provenance attached;
 *  - an unresolved row is labelled honestly ("Unresolved" / "Title not
 *    broadcast", never a fabricated title) and offers the keep-as-ID
 *    (pending-keeps) path via the spin keep mutation;
 *  - Kept state is restored from the keep-status queries (mbit + spin paths);
 *  - selector provenance renders only when the server supplied an eligible
 *    djName, and the panel degrades when album/metadata are absent;
 *  - no set data (404 / station without spins) renders nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  StationSetSidebar,
  resolveSetSidebarSlug,
} from "../src/components/dial/StationSetSidebar";

const useGetStationCurrentSet = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetStationCurrentSet,
}));

const keepMutate = vi.hoisted(() => vi.fn());
const keepSpinMutate = vi.hoisted(() => vi.fn());
let keepStatusSet = new Set<string>();
let spinStatusSaved = new Set<number>();
let spinStatusPending = new Set<number>();

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    // Authenticated listener (any non-null connections value).
    useMyConnections: vi.fn(() => ({ data: [], isLoading: false })),
    useAppConfig: vi.fn(() => ({ data: { demoSurface: false } })),
    useMyKeepStatus: vi.fn(() => ({ data: keepStatusSet })),
    useMySpinKeepStatus: vi.fn(() => ({
      data: { saved: spinStatusSaved, pending: spinStatusPending },
    })),
    useMutationKeep: vi.fn(() => ({ mutate: keepMutate, isPending: false })),
    useMutationKeepSpin: vi.fn(() => ({ mutate: keepSpinMutate, isPending: false })),
    useMutationUnkeep: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useMutationUnkeepSpin: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  });
});

const MBID_A = "mbid-good-morning-captain";
const MBID_B = "mbid-the-peter-criss-jazz";

function fixture() {
  return {
    station: { slug: "wfmu", name: "WFMU", stationClass: "curated" },
    ianaTimezone: "America/New_York",
    runId: 900,
    startedAt: "2026-09-22T05:58:00.000Z",
    showName: "Overnight",
    djName: "Diane K",
    spins: [
      {
        spinId: 903,
        mbid: MBID_A,
        artistMbid: "artist-slint",
        releaseGroupMbid: "rg-spiderland",
        albumTitle: "Spiderland",
        title: "Good Morning, Captain",
        artist: "Slint",
        playedAt: "2026-09-22T06:35:00.000Z",
        showName: "Overnight",
        djName: "Diane K",
      },
      {
        spinId: 902,
        mbid: MBID_B,
        artistMbid: "artist-doncab",
        releaseGroupMbid: "rg-doncab",
        albumTitle: "Don Caballero 2",
        title: "The Peter Criss Jazz",
        artist: "Don Caballero",
        playedAt: "2026-09-22T06:24:00.000Z",
        showName: "Overnight",
        djName: "Diane K",
      },
      {
        spinId: 901,
        mbid: null,
        artistMbid: null,
        releaseGroupMbid: null,
        albumTitle: null,
        title: "",
        artist: "",
        playedAt: "2026-09-22T06:18:00.000Z",
        showName: "Overnight",
        djName: "Diane K",
      },
    ],
  };
}

beforeEach(() => {
  keepStatusSet = new Set();
  spinStatusSaved = new Set();
  spinStatusPending = new Set();
  keepMutate.mockClear();
  keepSpinMutate.mockClear();
  useGetStationCurrentSet.mockReturnValue({ data: fixture() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StationSetSidebar — rendering", () => {
  it("renders the On air card and Earlier-this-set rows, newest first", () => {
    render(<StationSetSidebar stationSlug="wfmu" />);

    // On air card: eyebrow, selector provenance, serif title, Artist · Album.
    expect(screen.getByText(/ON AIR · WFMU · Overnight/)).toBeTruthy();
    expect(screen.getByText("Selected by Diane K")).toBeTruthy();
    expect(screen.getByText("Good Morning, Captain")).toBeTruthy();
    expect(screen.getByText(/Slint · Spiderland/)).toBeTruthy();
    // Keep copy names the real destination (Library Inbox), not "Up Next".
    expect(screen.getByText(/to your Library Inbox with this spin attached/)).toBeTruthy();

    // Earlier rows.
    expect(screen.getByText("Earlier this set")).toBeTruthy();
    expect(screen.getByTestId("setrow-902")).toBeTruthy();
    expect(screen.getByTestId("setrow-901")).toBeTruthy();
  });

  it("renders nothing when the station has no set data", () => {
    useGetStationCurrentSet.mockReturnValue({ data: undefined });
    const { container } = render(<StationSetSidebar stationSlug="wfmu" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("StationSetSidebar — per-row keep", () => {
  it("keeps a resolved earlier spin by mbid with spinId + station provenance", () => {
    render(<StationSetSidebar stationSlug="wfmu" />);
    const row = screen.getByTestId("setrow-902");
    const button = row.querySelector('[data-testid="keep-button"]')!;
    expect(button.textContent).toContain("Keep");
    fireEvent.click(button);
    expect(keepMutate).toHaveBeenCalledWith({
      mbid: MBID_B,
      spinId: 902,
      provenance: expect.objectContaining({
        kind: "keep",
        stationSlug: "wfmu",
        stationName: "WFMU",
      }),
    });
    expect(keepSpinMutate).not.toHaveBeenCalled();
  });

  it("offers the keep-as-ID path for an unresolved row without fabricating a title", () => {
    render(<StationSetSidebar stationSlug="wfmu" />);
    const row = screen.getByTestId("setrow-901");
    // Honest unresolved rendering — never an invented title.
    expect(row.textContent).toContain("Unresolved");
    expect(row.textContent).toContain("Title not broadcast");
    const button = row.querySelector('[data-testid="keep-button"]')!;
    expect(button.textContent).toContain("Keep as ID");
    fireEvent.click(button);
    expect(keepSpinMutate).toHaveBeenCalledWith({
      spinId: 901,
      provenance: expect.objectContaining({ stationSlug: "wfmu" }),
    });
    expect(keepMutate).not.toHaveBeenCalled();
  });

  it("keeps the on-air track via the primary Keep action", () => {
    render(<StationSetSidebar stationSlug="wfmu" />);
    fireEvent.click(screen.getByText("Keep this song"));
    expect(keepMutate).toHaveBeenCalledWith({
      mbid: MBID_A,
      spinId: 903,
      provenance: expect.objectContaining({ stationSlug: "wfmu" }),
    });
  });
});

describe("StationSetSidebar — kept state restoration", () => {
  it("shows Kept for a resolved spin already in the library", () => {
    keepStatusSet = new Set([MBID_B]);
    render(<StationSetSidebar stationSlug="wfmu" />);
    const row = screen.getByTestId("setrow-902");
    expect(row.querySelector('[data-testid="keep-button"]')!.textContent).toContain("Kept");
  });

  it("shows Saved for an unresolved spin already kept as ID", () => {
    spinStatusPending = new Set([901]);
    render(<StationSetSidebar stationSlug="wfmu" />);
    const row = screen.getByTestId("setrow-901");
    expect(row.querySelector('[data-testid="keep-button"]')!.textContent).toContain("Saved");
  });
});

describe("resolveSetSidebarSlug — landscape/portrait guard", () => {
  it("stays hidden in portrait even with a tuned station", () => {
    expect(
      resolveSetSidebarSlug({ sidebarLayout: false, inContext: true, ctxSlug: "wfmu", tunedSlug: "kboo" }),
    ).toBeNull();
  });

  it("pins to the selected station in landscape", () => {
    expect(
      resolveSetSidebarSlug({ sidebarLayout: true, inContext: true, ctxSlug: "wfmu", tunedSlug: "kboo" }),
    ).toBe("wfmu");
  });

  it("follows the tuned station when nothing is selected", () => {
    expect(
      resolveSetSidebarSlug({ sidebarLayout: true, inContext: false, ctxSlug: null, tunedSlug: "kboo" }),
    ).toBe("kboo");
  });

  it("stays hidden with no selection and nothing tuned", () => {
    expect(
      resolveSetSidebarSlug({ sidebarLayout: true, inContext: false, ctxSlug: null, tunedSlug: null }),
    ).toBeNull();
  });
});

describe("StationSetSidebar — honest degradation", () => {
  it("omits the selector line when djName is not eligible and drops the album when unknown", () => {
    const data = fixture();
    data.djName = null;
    data.spins[0]!.albumTitle = null;
    useGetStationCurrentSet.mockReturnValue({ data });
    render(<StationSetSidebar stationSlug="wfmu" />);
    expect(screen.queryByText(/Selected by/)).toBeNull();
    expect(screen.queryByText(/Spiderland/)).toBeNull();
    // Artist still renders on its own.
    expect(screen.getByText("Slint")).toBeTruthy();
  });
});
