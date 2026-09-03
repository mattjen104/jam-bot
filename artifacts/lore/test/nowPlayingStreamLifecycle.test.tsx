import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _testOnly_resetStream,
  subscribeSpinStream,
  subscribeStreamCatchUp,
  subscribeStreamSnapshot,
} from "../src/webplayer/nowPlayingStream";
import {
  _testOnly_applyWpSpin,
  _testOnly_mergeWpOnAirFetch,
  _testOnly_refreshWpOnAir,
  type WpOnAirResponse,
} from "../src/webplayer/hooks";
import { QueryClient } from "@tanstack/react-query";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Set<EventListener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, data: Record<string, unknown>, lastEventId = "") {
    const event = new MessageEvent(type, {
      data: JSON.stringify(data),
      lastEventId,
    });
    if (type === "message") this.onmessage?.(event);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("shared now-playing stream recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    _testOnly_resetStream();
  });

  afterEach(() => {
    _testOnly_resetStream();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("ignores duplicate and out-of-order station versions", () => {
    const received: string[] = [];
    const unsubscribe = subscribeSpinStream((event) => {
      received.push(event.rawTitle);
    });
    const source = FakeEventSource.instances[0]!;

    source.dispatch("stream-info", {
      streamId: "epoch-a",
      cursor: 0,
      snapshotRequired: false,
    });
    source.dispatch("message", {
      stationSlug: "kexp",
      rawArtist: "A",
      rawTitle: "Newest",
      mbid: null,
      eventId: 2,
      stationVersion: 2,
      type: "spin-raw",
      provisional: true,
    }, "2");
    source.dispatch("message", {
      stationSlug: "kexp",
      rawArtist: "A",
      rawTitle: "Duplicate",
      mbid: null,
      eventId: 2,
      stationVersion: 2,
    }, "2");
    source.dispatch("message", {
      stationSlug: "kexp",
      rawArtist: "A",
      rawTitle: "Older Version",
      mbid: null,
      eventId: 3,
      stationVersion: 1,
      type: "spin-raw-failed",
    }, "3");

    expect(received).toEqual(["Newest"]);
    unsubscribe();
  });

  it("reconnects once with the acknowledged cursor after lifecycle bursts", async () => {
    const catchUp = vi.fn();
    const unsubscribeSpin = subscribeSpinStream(() => undefined);
    const unsubscribeCatchUp = subscribeStreamCatchUp(catchUp);
    const source = FakeEventSource.instances[0]!;
    source.dispatch("stream-info", {
      streamId: "epoch-a",
      cursor: 0,
      snapshotRequired: false,
    });
    source.dispatch("message", {
      stationSlug: "kexp",
      rawArtist: "A",
      rawTitle: "Current",
      mbid: "mbid",
      eventId: 7,
      stationVersion: 4,
      type: "spin-changed",
    }, "7");

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(151);

    expect(catchUp).toHaveBeenCalledTimes(1);
    expect(source.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toContain("lastEventId=7");
    expect(FakeEventSource.instances[1]!.url).toContain("streamId=epoch-a");
    unsubscribeSpin();
    unsubscribeCatchUp();
  });

  it("requests a version reset and waits for snapshot recovery on a new epoch", async () => {
    let finishSnapshot: (() => void) | undefined;
    const snapshot = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSnapshot = resolve;
        }),
    );
    const unsubscribeSnapshot = subscribeStreamSnapshot(snapshot);
    const source = FakeEventSource.instances[0]!;

    source.dispatch("stream-info", {
      streamId: "epoch-a",
      cursor: 0,
      snapshotRequired: false,
    });
    source.dispatch("stream-info", {
      streamId: "epoch-b",
      cursor: 0,
      snapshotRequired: true,
    });
    source.dispatch("snapshot-required", {
      streamId: "epoch-b",
      cursor: 0,
      reason: "cursor-unavailable",
    });
    source.dispatch("stream-ready", {
      streamId: "epoch-b",
      cursor: 0,
      snapshotRequired: true,
    });

    expect(snapshot).toHaveBeenCalledWith({
      cursor: 0,
      resetVersions: true,
    });
    finishSnapshot?.();
    await Promise.resolve();
    unsubscribeSnapshot();
  });

  it("treats replay expiry in the same epoch as an authoritative snapshot", async () => {
    const snapshot = vi.fn(() => Promise.resolve());
    const unsubscribeSnapshot = subscribeStreamSnapshot(snapshot);
    const source = FakeEventSource.instances[0]!;
    source.dispatch("stream-info", {
      streamId: "epoch-a",
      cursor: 40,
      snapshotRequired: true,
    });
    source.dispatch("snapshot-required", {
      streamId: "epoch-a",
      cursor: 40,
      reason: "cursor-unavailable",
    });
    source.dispatch("stream-ready", {
      streamId: "epoch-a",
      cursor: 40,
      snapshotRequired: true,
    });
    await Promise.resolve();

    expect(snapshot).toHaveBeenCalledWith({
      cursor: 40,
      resetVersions: true,
    });
    unsubscribeSnapshot();
  });

  it("single-flights catch-up requests from multiple mounted consumers", async () => {
    let finishRequest: (() => void) | undefined;
    const refetchQueries = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRequest = resolve;
        }),
    );
    const queryClient = {
      setQueryData: vi.fn(),
      refetchQueries,
    } as unknown as QueryClient;

    const first = _testOnly_refreshWpOnAir(queryClient, false);
    const second = _testOnly_refreshWpOnAir(queryClient, false);
    expect(first).toBe(second);
    expect(refetchQueries).toHaveBeenCalledTimes(1);
    finishRequest?.();
    await first;
  });

  it("drains an SSE update that arrives before the initial REST snapshot completes", () => {
    const queryClient = new QueryClient();
    const staleSnapshot: WpOnAirResponse = {
      authenticated: false,
      items: [
        {
          station: { slug: "kexp", name: "KEXP" } as WpOnAirResponse["items"][number]["station"],
          show: null,
          now: {
            mbid: "old-mbid",
            title: "Old Track",
            artist: "Old Artist",
            artworkUrl: null,
            playedAt: "2026-09-03T10:00:00.000Z",
            resolved: true,
          },
          earlier: [],
          matchCount: null,
        },
      ],
    };

    // The fetch has started but React Query has no cache yet.
    _testOnly_applyWpSpin(queryClient, {
      stationSlug: "kexp",
      rawArtist: "New Artist",
      rawTitle: "New Track",
      mbid: "new-mbid",
      type: "spin-changed",
      eventId: 12,
      stationVersion: 3,
      observedAt: "2026-09-03T10:00:02.000Z",
    });
    expect(queryClient.getQueryData(["wp", "onair"])).toBeUndefined();

    // The in-flight request returns the pre-change row. The queued SSE frame
    // must be applied before that snapshot is installed in the cache.
    const merged = _testOnly_mergeWpOnAirFetch(queryClient, staleSnapshot);
    expect(merged.items[0]!.now.artist).toBe("New Artist");
    expect(merged.items[0]!.now.title).toBe("New Track");
    expect(merged.items[0]!.now.eventId).toBe(12);
  });
});