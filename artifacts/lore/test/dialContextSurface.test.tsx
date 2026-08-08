// @vitest-environment jsdom
/**
 * useDialSurface — URL ownership tests.
 *
 * The hook must rebuild mode/stack/temporal from the URL on mount (shared
 * links, refresh) and keep the URL in sync via history.replaceState ONLY —
 * intra-context steps and scrub moves must never push history entries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDialSurface } from "../src/dial/useDialSurface";

function setUrl(search: string) {
  window.history.replaceState(null, "", `/${search}`);
}

describe("useDialSurface", () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;
  let replaceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setUrl("");
    pushSpy = vi.spyOn(window.history, "pushState");
    replaceSpy = vi.spyOn(window.history, "replaceState");
  });
  afterEach(() => {
    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("starts in dial mode on a bare '/'", () => {
    const { result } = renderHook(() => useDialSurface());
    expect(result.current.mode).toBe("dial");
    expect(result.current.restored).toBe(false);
  });

  it("tune writes the ctx param and enters context mode", () => {
    const { result } = renderHook(() => useDialSurface());
    act(() => result.current.tune("kexp", "KEXP"));
    expect(result.current.mode).toBe("context");
    expect(new URLSearchParams(window.location.search).get("ctx")).toBe("station:kexp");
  });

  it("every update uses replace, never push (scrub included)", () => {
    const { result } = renderHook(() => useDialSurface());
    act(() => result.current.tune("kexp"));
    act(() => result.current.push({ kind: "artist", id: "mbid-1" }));
    act(() => result.current.temporal({ kind: "past", runId: 9 })); // scrub move
    act(() => result.current.temporal({ kind: "past", runId: 10 })); // scrub move
    act(() => result.current.back());
    act(() => result.current.dial());
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("a redundant temporal update does not rewrite the URL", () => {
    const { result } = renderHook(() => useDialSurface());
    act(() => result.current.tune("kexp"));
    const callsAfterTune = replaceSpy.mock.calls.length;
    act(() => result.current.temporal({ kind: "live" })); // already live
    expect(replaceSpy.mock.calls.length).toBe(callsAfterTune);
  });

  it("restores mode, stack and past position from the URL on mount", () => {
    setUrl("?ctx=station:kexp&lens=artist:mbid-1&at=run:55");
    const { result } = renderHook(() => useDialSurface());
    expect(result.current.mode).toBe("context");
    expect(result.current.restored).toBe(true);
    expect(result.current.ctx?.stack.map((f) => f.id)).toEqual(["kexp", "mbid-1"]);
    expect(result.current.ctx?.temporal).toEqual({ kind: "past", runId: 55 });
  });

  it("URL round-trip: state written by one instance restores in a fresh one", () => {
    const first = renderHook(() => useDialSurface());
    act(() => first.result.current.tune("wfmu"));
    act(() => first.result.current.push({ kind: "artist", id: "mbid-2" }));
    act(() => first.result.current.temporal({ kind: "past", runId: 77 }));
    first.unmount();

    const second = renderHook(() => useDialSurface());
    expect(second.result.current.mode).toBe("context");
    expect(second.result.current.ctx?.stack.map((f) => `${f.kind}:${f.id}`)).toEqual([
      "station:wfmu",
      "artist:mbid-2",
    ]);
    expect(second.result.current.ctx?.temporal).toEqual({ kind: "past", runId: 77 });
  });

  it("dial clears the context params but preserves unrelated ones", () => {
    setUrl("?library=connected");
    const { result } = renderHook(() => useDialSurface());
    act(() => result.current.tune("kexp"));
    act(() => result.current.dial());
    expect(window.location.search).toBe("?library=connected");
    expect(result.current.mode).toBe("dial");
  });

  it("back pops one level; popping the root returns to dial mode", () => {
    const { result } = renderHook(() => useDialSurface());
    act(() => result.current.tune("kexp"));
    act(() => result.current.push({ kind: "artist", id: "mbid-1" }));
    act(() => result.current.back());
    expect(result.current.ctx?.stack).toHaveLength(1);
    act(() => result.current.back());
    expect(result.current.mode).toBe("dial");
    expect(new URLSearchParams(window.location.search).get("ctx")).toBeNull();
  });
});
