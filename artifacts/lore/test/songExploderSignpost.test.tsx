// @vitest-environment jsdom
/**
 * Tests for SongExploderSignpost — the playback-synced Song Exploder anchor
 * card rendered during NowPlaying.
 *
 * Verifies:
 *  1. A card appears when progressMs crosses an anchor's positionMs.
 *  2. The same anchor never fires twice on the same song (ref-based fired Set).
 *  3. The fired Set resets on MBID change so anchors re-fire on a new track.
 *  4. The card auto-dismisses after 14 seconds.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return { ...actual, useGetRecordingSongExploder: vi.fn() };
});

import { useGetRecordingSongExploder } from "@workspace/api-client-react";
import { SongExploderSignpost } from "../src/components/NowPlaying";

const mockUseGetRecordingSongExploder = useGetRecordingSongExploder as Mock;

const ANCHOR_A = {
  id: 1,
  positionMs: 5_000,
  text: "Here we mixed in the B-section guitar",
  sourceUrl: "https://songexploder.net/ep/1",
};

const ANCHOR_B = {
  id: 2,
  positionMs: 30_000,
  text: "This is the breakdown they almost cut",
  sourceUrl: "https://songexploder.net/ep/2",
};

function setupAnchors(anchors: typeof ANCHOR_A[]) {
  mockUseGetRecordingSongExploder.mockReturnValue({
    data: { anchors },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SongExploderSignpost — anchor crossing", () => {
  it("shows no card when progressMs has not yet crossed the anchor", () => {
    setupAnchors([ANCHOR_A]);
    render(<SongExploderSignpost mbid="mbid-1" progressMs={4_999} />);
    expect(screen.queryByTestId("se-signpost")).toBeNull();
  });

  it("shows the card when progressMs crosses positionMs exactly", () => {
    setupAnchors([ANCHOR_A]);
    render(<SongExploderSignpost mbid="mbid-1" progressMs={5_000} />);
    expect(screen.getByTestId("se-signpost")).toBeTruthy();
    expect(screen.getByText(ANCHOR_A.text)).toBeTruthy();
  });

  it("shows the card when progressMs overshoots positionMs", () => {
    setupAnchors([ANCHOR_A]);
    render(<SongExploderSignpost mbid="mbid-1" progressMs={20_000} />);
    expect(screen.getByTestId("se-signpost")).toBeTruthy();
  });

  it("fires the most-recently-crossed anchor when multiple are defined", () => {
    setupAnchors([ANCHOR_A, ANCHOR_B]);
    render(<SongExploderSignpost mbid="mbid-1" progressMs={35_000} />);
    expect(screen.getByText(ANCHOR_B.text)).toBeTruthy();
  });

  it("shows no card when progressMs is null", () => {
    setupAnchors([ANCHOR_A]);
    render(<SongExploderSignpost mbid="mbid-1" progressMs={null} />);
    expect(screen.queryByTestId("se-signpost")).toBeNull();
  });

  it("shows no card when there are no anchors", () => {
    setupAnchors([]);
    render(<SongExploderSignpost mbid="mbid-1" progressMs={99_999} />);
    expect(screen.queryByTestId("se-signpost")).toBeNull();
  });
});

describe("SongExploderSignpost — no repeat fire on same song", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not re-show a fired anchor when progressMs advances further", () => {
    setupAnchors([ANCHOR_A]);
    const { rerender } = render(
      <SongExploderSignpost mbid="mbid-1" progressMs={5_000} />
    );
    expect(screen.getByTestId("se-signpost")).toBeTruthy();

    // Dismiss via the 14 s timer
    act(() => { vi.advanceTimersByTime(14_001); });
    expect(screen.queryByTestId("se-signpost")).toBeNull();

    // Progress advances — anchor must NOT re-fire (still in firedRef)
    rerender(<SongExploderSignpost mbid="mbid-1" progressMs={7_000} />);
    expect(screen.queryByTestId("se-signpost")).toBeNull();
  });

  it("only fires each anchor once per song even when progressMs jumps far past it", () => {
    setupAnchors([ANCHOR_A]);
    const { rerender } = render(
      <SongExploderSignpost mbid="mbid-1" progressMs={0} />
    );
    expect(screen.queryByTestId("se-signpost")).toBeNull();

    rerender(<SongExploderSignpost mbid="mbid-1" progressMs={5_500} />);
    expect(screen.getByTestId("se-signpost")).toBeTruthy();

    // Dismiss via 14 s timer
    act(() => { vi.advanceTimersByTime(14_001); });

    // Progress advances further — anchor must NOT re-fire
    rerender(<SongExploderSignpost mbid="mbid-1" progressMs={10_000} />);
    expect(screen.queryByTestId("se-signpost")).toBeNull();
  });
});

describe("SongExploderSignpost — MBID change resets fired set", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("re-fires an anchor when a new MBID is set (new song)", () => {
    setupAnchors([ANCHOR_A]);
    const { rerender } = render(
      <SongExploderSignpost mbid="mbid-1" progressMs={6_000} />
    );
    expect(screen.getByTestId("se-signpost")).toBeTruthy();

    // Dismiss via timer
    act(() => { vi.advanceTimersByTime(14_001); });
    expect(screen.queryByTestId("se-signpost")).toBeNull();

    // Switch to a new track — progress resets to 0 then advances past the anchor.
    // (In real use the MBID changes alongside a progress reset to 0.)
    rerender(<SongExploderSignpost mbid="mbid-2" progressMs={0} />);
    expect(screen.queryByTestId("se-signpost")).toBeNull();

    rerender(<SongExploderSignpost mbid="mbid-2" progressMs={6_000} />);
    expect(screen.getByTestId("se-signpost")).toBeTruthy();
  });

  it("clears any active card immediately when MBID changes mid-display", () => {
    setupAnchors([ANCHOR_A]);
    const { rerender } = render(
      <SongExploderSignpost mbid="mbid-1" progressMs={6_000} />
    );
    expect(screen.getByTestId("se-signpost")).toBeTruthy();

    // Switch track before 14 s — card must vanish immediately
    rerender(<SongExploderSignpost mbid="mbid-2" progressMs={0} />);
    expect(screen.queryByTestId("se-signpost")).toBeNull();
  });
});

describe("SongExploderSignpost — auto-dismiss after 14 seconds", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("dismisses the card after 14 000 ms", () => {
    setupAnchors([ANCHOR_A]);
    render(<SongExploderSignpost mbid="mbid-1" progressMs={6_000} />);
    expect(screen.getByTestId("se-signpost")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(14_000); });
    expect(screen.queryByTestId("se-signpost")).toBeNull();
  });

  it("keeps the card visible just before 14 000 ms", () => {
    setupAnchors([ANCHOR_A]);
    render(<SongExploderSignpost mbid="mbid-1" progressMs={6_000} />);

    act(() => { vi.advanceTimersByTime(13_999); });
    expect(screen.getByTestId("se-signpost")).toBeTruthy();
  });

  it("resets the dismiss timer when a second anchor fires before the first expires", () => {
    setupAnchors([ANCHOR_A, ANCHOR_B]);
    const { rerender } = render(
      <SongExploderSignpost mbid="mbid-1" progressMs={6_000} />
    );
    expect(screen.getByText(ANCHOR_A.text)).toBeTruthy();

    // Advance 10 s (still within first 14 s window) then trigger second anchor
    act(() => { vi.advanceTimersByTime(10_000); });
    rerender(<SongExploderSignpost mbid="mbid-1" progressMs={31_000} />);
    expect(screen.getByText(ANCHOR_B.text)).toBeTruthy();

    // 13 s since second anchor fired — card must still be visible (timer was reset)
    act(() => { vi.advanceTimersByTime(13_000); });
    expect(screen.getByTestId("se-signpost")).toBeTruthy();

    // Full 14 s since second anchor — now it dismisses
    act(() => { vi.advanceTimersByTime(1_001); });
    expect(screen.queryByTestId("se-signpost")).toBeNull();
  });
});
