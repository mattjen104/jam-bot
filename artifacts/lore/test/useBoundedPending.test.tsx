// @vitest-environment jsdom
/**
 * useBoundedPending — the settle deadline that keeps the Zone 1 crossings
 * skeleton from holding the dial hostage.
 *
 * Contract:
 *  - mirrors `pending` while it is false or freshly true
 *  - once `pending` has been continuously true for `deadlineMs`, flips to
 *    false (the dial degrades to rendering what it has)
 *  - resets when `pending` clears, so a later refetch gets a fresh deadline
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useBoundedPending } from "../src/hooks/useDialData";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useBoundedPending", () => {
  it("returns false when pending is false", () => {
    const { result } = renderHook(() => useBoundedPending(false, 1000));
    expect(result.current).toBe(false);
  });

  it("returns true while pending and before the deadline", () => {
    const { result } = renderHook(() => useBoundedPending(true, 1000));
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(999); });
    expect(result.current).toBe(true);
  });

  it("flips to false once pending has lasted past the deadline", () => {
    const { result } = renderHook(() => useBoundedPending(true, 1000));
    act(() => { vi.advanceTimersByTime(1001); });
    expect(result.current).toBe(false);
  });

  it("resets the deadline when pending clears and re-arms", () => {
    const { result, rerender } = renderHook(
      ({ pending }: { pending: boolean }) => useBoundedPending(pending, 1000),
      { initialProps: { pending: true } },
    );
    act(() => { vi.advanceTimersByTime(1001); });
    expect(result.current).toBe(false);

    // Pending clears — hook returns false and the expiry resets.
    rerender({ pending: false });
    expect(result.current).toBe(false);

    // Pending starts again — fresh deadline, so true until it elapses.
    rerender({ pending: true });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(1001); });
    expect(result.current).toBe(false);
  });
});
