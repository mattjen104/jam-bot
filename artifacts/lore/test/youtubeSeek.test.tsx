// @vitest-environment jsdom
/**
 * Tests confirming the YouTube seek round-trip using real production code:
 *
 *   1. SeekBar renders and fires onSeek with the correct ms value when the
 *      user releases the range input after scrubbing.
 *   2. useYouTubeDriver.seek() sends the correct seekTo postMessage to the
 *      hidden iframe's contentWindow.
 *   3. A real infoDelivery MessageEvent from the iframe origin updates
 *      progressMs via the driver's subscriber notification path.
 *
 * All three sections exercise actual production code — SeekBar from
 * RideBar.tsx and useYouTubeDriver from useYouTubeDriver.tsx.
 */

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeekBar } from "../src/components/RideBar";
import { useYouTubeDriver } from "../src/player/useYouTubeDriver";
import type { PlaybackDriverHandle, DriverPlaybackStatus } from "../src/player/playbackDriver";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Harness: mounts useYouTubeDriver + its hidden iframe surface in the DOM.
// Capturing `latestHandle` directly in render is safe: the hook's useMemo
// deps are all stable refs so the handle identity doesn't change between
// renders.
// ---------------------------------------------------------------------------

function renderYouTubeDriver() {
  let latestHandle!: PlaybackDriverHandle;

  function Harness() {
    const h = useYouTubeDriver();
    latestHandle = h;
    return <>{h.surface}</>;
  }

  render(<Harness />);

  const iframeEl = document.querySelector("iframe") as HTMLIFrameElement;

  return {
    handle: latestHandle,
    iframeEl,
  };
}

// ---------------------------------------------------------------------------
// Section 1: SeekBar scrub → onSeek receives correct ms
//
// SeekBar is now exported from RideBar.tsx.  We render it with real props,
// fire pointerDown + change + pointerUp on the underlying range input, and
// assert what the onSeek callback receives.
//
// handlePointerUp in SeekBar reads `(e.target as HTMLInputElement).value`.
// fireEvent.change sets input.value before firing, so by the time
// fireEvent.pointerUp fires, input.value already reflects the scrubbed
// position.
// ---------------------------------------------------------------------------

describe("SeekBar scrub → onSeek receives correct ms", () => {
  function mountSeekBar(
    progressMs: number | null,
    durationMs: number | null,
    onSeek: (ms: number) => void,
  ) {
    render(
      <SeekBar progressMs={progressMs} durationMs={durationMs} onSeek={onSeek} />,
    );
    return screen.getByRole("slider", { name: /seek position/i });
  }

  it("calls onSeek with the scrubbed ms value after pointerUp", () => {
    const onSeek = vi.fn();
    const input = mountSeekBar(10_000, 210_000, onSeek);

    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: "42500" } });
    fireEvent.pointerUp(input);

    expect(onSeek).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(42_500);
  });

  it("calls onSeek with 0 when scrubbed to the start", () => {
    const onSeek = vi.fn();
    const input = mountSeekBar(30_000, 180_000, onSeek);

    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.pointerUp(input);

    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("calls onSeek with the full duration when scrubbed to the end", () => {
    const onSeek = vi.fn();
    const input = mountSeekBar(10_000, 180_000, onSeek);

    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: "180000" } });
    fireEvent.pointerUp(input);

    expect(onSeek).toHaveBeenCalledWith(180_000);
  });

  it("passes a Number (not a string) to onSeek", () => {
    const onSeek = vi.fn();
    const input = mountSeekBar(0, 120_000, onSeek);

    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: "15000" } });
    fireEvent.pointerUp(input);

    expect(typeof onSeek.mock.calls[0][0]).toBe("number");
  });

  it("calls onSeek exactly once per scrub gesture", () => {
    const onSeek = vi.fn();
    const input = mountSeekBar(5_000, 60_000, onSeek);

    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: "30000" } });
    fireEvent.pointerUp(input);

    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it("range input max matches durationMs so the value is already in ms", () => {
    const onSeek = vi.fn();
    const input = mountSeekBar(0, 210_000, onSeek);

    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("210000");
  });
});

// ---------------------------------------------------------------------------
// Section 2: YouTube driver seek() → correct postMessage to IFrame API
//
// renderYouTubeDriver() mounts the hidden iframe produced by useYouTubeDriver.
// We spy on iframe.contentWindow.postMessage (which jsdom populates for every
// rendered iframe), call the real seek() method, and assert the payload.
//
// useYouTubeDriver.seek() source (useYouTubeDriver.tsx):
//   const seconds = positionMs / 1000;
//   iframe.contentWindow.postMessage(
//     JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }),
//     "https://www.youtube.com",
//   );
// ---------------------------------------------------------------------------

describe("YouTube driver seek() → postMessage payload", () => {
  it("calls postMessage with event='command' and func='seekTo'", async () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    expect(iframeEl.contentWindow).not.toBeNull();

    const spy = vi.spyOn(iframeEl.contentWindow!, "postMessage");
    await act(() => handle.seek!(42_500));

    expect(spy).toHaveBeenCalledOnce();
    const [rawMessage] = spy.mock.calls[0] as [string, ...unknown[]];
    const payload = JSON.parse(rawMessage) as { event: string; func: string; args: unknown[] };
    expect(payload.event).toBe("command");
    expect(payload.func).toBe("seekTo");
  });

  it("converts positionMs to seconds (42 500 ms → 42.5 s)", async () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    const spy = vi.spyOn(iframeEl.contentWindow!, "postMessage");

    await act(() => handle.seek!(42_500));

    const [rawMessage] = spy.mock.calls[0] as [string, ...unknown[]];
    const payload = JSON.parse(rawMessage) as { args: [number, boolean] };
    expect(payload.args[0]).toBeCloseTo(42.5, 6);
  });

  it("sets allowSeekAhead=true as the second arg", async () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    const spy = vi.spyOn(iframeEl.contentWindow!, "postMessage");

    await act(() => handle.seek!(30_000));

    const [rawMessage] = spy.mock.calls[0] as [string, ...unknown[]];
    const payload = JSON.parse(rawMessage) as { args: [number, boolean] };
    expect(payload.args[1]).toBe(true);
  });

  it("targets the 'https://www.youtube.com' origin", async () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    const spy = vi.spyOn(iframeEl.contentWindow!, "postMessage");

    await act(() => handle.seek!(10_000));

    const [, targetOrigin] = spy.mock.calls[0] as [string, string];
    expect(targetOrigin).toBe("https://www.youtube.com");
  });

  it("seek to 0 ms sends 0 seconds", async () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    const spy = vi.spyOn(iframeEl.contentWindow!, "postMessage");

    await act(() => handle.seek!(0));

    const [rawMessage] = spy.mock.calls[0] as [string, ...unknown[]];
    const payload = JSON.parse(rawMessage) as { args: [number, boolean] };
    expect(payload.args[0]).toBe(0);
  });

  it("args array has exactly [seconds, true] — no extra elements", async () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    const spy = vi.spyOn(iframeEl.contentWindow!, "postMessage");

    await act(() => handle.seek!(90_000));

    const [rawMessage] = spy.mock.calls[0] as [string, ...unknown[]];
    const payload = JSON.parse(rawMessage) as { args: unknown[] };
    expect(payload.args).toHaveLength(2);
    expect(payload.args[1]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 3: infoDelivery MessageEvent → progressMs round-trip
//
// After a seek the YouTube IFrame API replies with periodic infoDelivery
// messages.  We dispatch a real MessageEvent on window with the driver's
// iframe as `source` and origin "https://www.youtube.com", then confirm the
// subscriber callback receives progressMs correctly.
//
// Driver gating (useYouTubeDriver.tsx onMessage):
//   if (event.origin !== "https://www.youtube.com") return;
//   if (!iframe || event.source !== iframe.contentWindow) return;
// ---------------------------------------------------------------------------

function dispatchInfoDelivery(opts: {
  source: Window;
  currentTime: number;
  duration?: number;
  origin?: string;
}) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: opts.origin ?? "https://www.youtube.com",
      source: opts.source,
      data: JSON.stringify({
        event: "infoDelivery",
        info: {
          currentTime: opts.currentTime,
          ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
        },
      }),
    }),
  );
}

describe("infoDelivery → progressMs round-trip", () => {
  it("notifies subscribers with progressMs = currentTime * 1000", () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    const cb = vi.fn<[DriverPlaybackStatus], void>();
    handle.onStatusChange(cb);

    act(() => {
      dispatchInfoDelivery({
        source: iframeEl.contentWindow!,
        currentTime: 42.5,
        duration: 210,
      });
    });

    expect(cb).toHaveBeenCalled();
    expect(cb.mock.calls[0][0].progressMs).toBe(42_500);
  });

  it("notifies subscribers with durationMs = duration * 1000", () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    const cb = vi.fn<[DriverPlaybackStatus], void>();
    handle.onStatusChange(cb);

    act(() => {
      dispatchInfoDelivery({
        source: iframeEl.contentWindow!,
        currentTime: 10,
        duration: 210.5,
      });
    });

    expect(cb.mock.calls[0][0].durationMs).toBe(210_500);
  });

  it("progressMs is 0 when currentTime is 0 (seek-to-start confirmed)", () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    const cb = vi.fn<[DriverPlaybackStatus], void>();
    handle.onStatusChange(cb);

    act(() => {
      dispatchInfoDelivery({
        source: iframeEl.contentWindow!,
        currentTime: 0,
        duration: 180,
      });
    });

    expect(cb.mock.calls[0][0].progressMs).toBe(0);
  });

  it("ignores infoDelivery from a wrong origin — subscriber not called", () => {
    const { handle, iframeEl } = renderYouTubeDriver();
    const cb = vi.fn();
    handle.onStatusChange(cb);

    act(() => {
      dispatchInfoDelivery({
        source: iframeEl.contentWindow!,
        currentTime: 99,
        duration: 200,
        origin: "https://evil.example.com",
      });
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores infoDelivery from a different iframe's contentWindow", () => {
    const { handle } = renderYouTubeDriver();
    const cb = vi.fn();
    handle.onStatusChange(cb);

    // A second, unrelated iframe's contentWindow — driver must ignore it.
    const otherIframe = document.createElement("iframe");
    document.body.appendChild(otherIframe);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.youtube.com",
          source: otherIframe.contentWindow!,
          data: JSON.stringify({
            event: "infoDelivery",
            info: { currentTime: 55, duration: 200 },
          }),
        }),
      );
    });

    expect(cb).not.toHaveBeenCalled();
    otherIframe.remove();
  });

  it("full round-trip: scrub 42 500 ms → seek() postMessage → infoDelivery → progressMs 42 500", async () => {
    // Step 1 — SeekBar fires onSeek(42 500)
    const onSeek = vi.fn();
    render(
      <SeekBar progressMs={10_000} durationMs={210_000} onSeek={onSeek} />,
    );
    const input = screen.getByRole("slider");
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: "42500" } });
    fireEvent.pointerUp(input);
    expect(onSeek).toHaveBeenCalledWith(42_500);
    const seekMs = onSeek.mock.calls[0][0] as number;

    // Step 2 — driver.seek() sends seekTo with the correct seconds
    const { handle, iframeEl } = renderYouTubeDriver();
    const postSpy = vi.spyOn(iframeEl.contentWindow!, "postMessage");
    await act(() => handle.seek!(seekMs));

    const [rawMessage] = postSpy.mock.calls[0] as [string, string];
    const payload = JSON.parse(rawMessage) as {
      func: string;
      args: [number, boolean];
    };
    expect(payload.func).toBe("seekTo");
    expect(payload.args[0]).toBeCloseTo(42.5, 6);
    expect(payload.args[1]).toBe(true);

    // Step 3 — YouTube replies with infoDelivery; driver updates subscribers
    const statusCb = vi.fn<[DriverPlaybackStatus], void>();
    handle.onStatusChange(statusCb);

    act(() => {
      dispatchInfoDelivery({
        source: iframeEl.contentWindow!,
        currentTime: payload.args[0],
        duration: 210,
      });
    });

    expect(statusCb.mock.calls[0][0].progressMs).toBe(42_500);
  });
});
