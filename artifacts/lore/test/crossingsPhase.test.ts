/**
 * deriveCrossingsPhase — result provenance for the Zone 1 empty state.
 *
 * The definitive "none of your artists played" copy may only render in the
 * "settled" phase: a genuine, non-computing, non-failed server result. A
 * bounded-pending timeout alone must never produce "settled".
 */
import { describe, expect, it } from "vitest";
import { deriveCrossingsPhase } from "../src/hooks/useDialData";

const base = {
  queryError: false,
  serverFailed: false,
  pending: false,
  hasResult: true,
  withinSkeleton: false,
  withinStall: false,
};

describe("deriveCrossingsPhase", () => {
  it("is settled only when a non-computing result is in hand", () => {
    expect(deriveCrossingsPhase({ ...base })).toBe("settled");
  });

  it("is NOT settled when the query is idle but no result has ever arrived", () => {
    // A paused/pre-fetch query reports pending=false with no data — that must
    // read as loading, never as a settled empty result (false "none played").
    expect(deriveCrossingsPhase({ ...base, hasResult: false })).toBe("loading");
  });

  it("is loading while pending within the skeleton deadline", () => {
    expect(
      deriveCrossingsPhase({ ...base, pending: true, withinSkeleton: true, withinStall: true }),
    ).toBe("loading");
  });

  it("is computing (NOT settled) when the skeleton bound expires but the server still computes", () => {
    expect(
      deriveCrossingsPhase({ ...base, pending: true, withinSkeleton: false, withinStall: true }),
    ).toBe("computing");
  });

  it("is stalled once computing persists past the hard bound", () => {
    expect(
      deriveCrossingsPhase({ ...base, pending: true, withinSkeleton: false, withinStall: false }),
    ).toBe("stalled");
  });

  it("is failed when the server reports a crashed compute, regardless of pending", () => {
    expect(deriveCrossingsPhase({ ...base, serverFailed: true })).toBe("failed");
    expect(deriveCrossingsPhase({ ...base, serverFailed: true, pending: true, withinSkeleton: true, withinStall: true })).toBe("failed");
  });

  it("is failed when the query itself errors (retry: false leaves no data)", () => {
    expect(deriveCrossingsPhase({ ...base, queryError: true })).toBe("failed");
  });
});
