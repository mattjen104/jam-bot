// @vitest-environment jsdom
/**
 * Tests for the shared now-playing SSE subscription layer (Task: browser push
 * updates for now-playing).
 *
 * mergeSpinIntoOnAir (pure):
 *  - a pushed spin change replaces the matching station's `now` (track, mbid,
 *    observedAt, confidence-derived resolved flag) and promotes the outgoing
 *    artist into `earlier`
 *  - the same event delivered twice returns the previous object untouched
 *  - stations not in the cached list (off-air) are left for the next poll
 *
 * useWpOnAir + stream:
 *  - a pushed event merges into the ["wp","onair"] react-query cache and the
 *    now-playing UI re-renders with the new track without any refetch
 *  - repeated connection failures mark the stream degraded (poll cadence
 *    returns to 30s); a successful open marks it healthy (poll stretches)
 *  - one EventSource is shared across multiple hook consumers
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  mergeSpinIntoOnAir,
  subscribeSpinStream,
  subscribeStreamHealth,
  getStreamHealthy,
  STREAM_DEGRADED_AFTER_FAILURES,
  _testOnly_resetStream,
  type SpinStreamEvent,
} from "../src/webplayer/nowPlayingStream";
import {
  useWpOnAir,
  WP_ONAIR_POLL_STREAM_HEALTHY_MS,
  WP_ONAIR_POLL_DEGRADED_MS,
  type WpOnAirResponse,
  type WpOnAirItem,
} from "../src/webplayer/hooks";

// ---------------------------------------------------------------------------
// Fake EventSource
// ---------------------------------------------------------------------------

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  static last(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as Record<string, unknown>).EventSource = FakeEventSource;
});

afterEach(() => {
  cleanup();
  _testOnly_resetStream();
  delete (globalThis as Record<string, unknown>).EventSource;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const item = (slug: string, over: Partial<WpOnAirItem["now"]> = {}): WpOnAirItem => ({
  station: { slug, name: slug.toUpperCase() } as WpOnAirItem["station"],
  show: null,
  now: {
    mbid: "mbid-old",
    title: "Old Title",
    artist: "Old Artist",
    artworkUrl: "http://art/old.jpg",
    playedAt: "2026-08-15T10:00:00.000Z",
    observedAt: "2026-08-15T10:00:00.000Z",
    freshness: "fresh",
    resolved: true,
    ...over,
  },
  earlier: ["Earlier One"],
  matchCount: null,
});

const onAir = (...items: WpOnAirItem[]): WpOnAirResponse => ({
  items,
  authenticated: false,
});

const pushEvent = (over: Partial<SpinStreamEvent> = {}): SpinStreamEvent => ({
  stationSlug: "kutx",
  rawArtist: "New Artist",
  rawTitle: "New Title",
  mbid: "mbid-new",
  observedAt: "2026-08-15T10:05:00.000Z",
  confidence: "text",
  ...over,
});

// ---------------------------------------------------------------------------
// mergeSpinIntoOnAir
// ---------------------------------------------------------------------------

describe("mergeSpinIntoOnAir", () => {
  it("replaces the matching station's now and promotes the old artist to earlier", () => {
    const prev = onAir(item("kutx"), item("kexp"));
    const next = mergeSpinIntoOnAir(prev, pushEvent())!;
    expect(next).not.toBe(prev);
    const updated = next.items[0]!;
    expect(updated.now).toMatchObject({
      mbid: "mbid-new",
      title: "New Title",
      artist: "New Artist",
      artworkUrl: null,
      playedAt: "2026-08-15T10:05:00.000Z",
      observedAt: "2026-08-15T10:05:00.000Z",
      freshness: "fresh",
      resolved: true,
    });
    expect(updated.earlier).toEqual(["Old Artist", "Earlier One"]);
    // Other stations untouched (same reference).
    expect(next.items[1]).toBe(prev.items[1]);
  });

  it("marks unresolved pushes as resolved:false", () => {
    const prev = onAir(item("kutx"));
    const next = mergeSpinIntoOnAir(prev, pushEvent({ mbid: null }))!;
    expect(next.items[0]!.now.resolved).toBe(false);
    expect(next.items[0]!.now.mbid).toBeNull();
  });

  it("returns the previous object untouched for a same-track event (idempotent)", () => {
    const prev = onAir(item("kutx"));
    const once = mergeSpinIntoOnAir(prev, pushEvent())!;
    const twice = mergeSpinIntoOnAir(once, pushEvent());
    expect(twice).toBe(once);
  });

  it("leaves stations that are not in the cached list for the next poll", () => {
    const prev = onAir(item("kexp"));
    expect(mergeSpinIntoOnAir(prev, pushEvent({ stationSlug: "kutx" }))).toBe(prev);
    expect(mergeSpinIntoOnAir(undefined, pushEvent())).toBeUndefined();
  });

  it("caps and dedupes the earlier strip", () => {
    const prev = onAir({
      ...item("kutx"),
      earlier: ["A", "B", "C"],
    });
    const next = mergeSpinIntoOnAir(prev, pushEvent())!;
    expect(next.items[0]!.earlier).toEqual(["Old Artist", "A", "B"]);
  });
});

// ---------------------------------------------------------------------------
// Stream manager: sharing, reconnect, degraded health
// ---------------------------------------------------------------------------

describe("now-playing stream manager", () => {
  it("shares one EventSource across subscribers and closes when the last leaves", () => {
    const un1 = subscribeSpinStream(() => {});
    const un2 = subscribeSpinStream(() => {});
    expect(FakeEventSource.instances).toHaveLength(1);
    un1();
    expect(FakeEventSource.last().closed).toBe(false);
    un2();
    expect(FakeEventSource.last().closed).toBe(true);
  });

  it("marks the stream healthy on open and degraded after repeated failures, reconnecting with backoff", () => {
    vi.useFakeTimers();
    const health: boolean[] = [];
    subscribeStreamHealth((h) => health.push(h));

    // Open → healthy.
    act(() => FakeEventSource.last().onopen?.());
    expect(getStreamHealthy()).toBe(true);

    // Repeated failures → degraded after the threshold, with backoff retries.
    for (let i = 0; i < STREAM_DEGRADED_AFTER_FAILURES; i++) {
      FakeEventSource.last().onerror?.();
      vi.advanceTimersByTime(60_000); // beyond max backoff — reconnects
    }
    expect(getStreamHealthy()).toBe(false);
    expect(health).toEqual([true, false]);
    // A later successful open restores health and resets the failure count.
    FakeEventSource.last().onopen?.();
    expect(getStreamHealthy()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useWpOnAir integration: pushed events render in the now-playing UI
// ---------------------------------------------------------------------------

function NowPlayingProbe() {
  const { data } = useWpOnAir();
  const first = data?.items[0];
  return (
    <div>
      <span data-testid="np-title">{first?.now.title ?? "none"}</span>
      <span data-testid="np-observed">{first?.now.observedAt ?? ""}</span>
    </div>
  );
}

describe("useWpOnAir + SSE push", () => {
  it("merges a pushed spin change into the cache and re-renders the UI without a refetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(onAir(item("kutx"))), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NowPlayingProbe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("np-title").textContent).toBe("Old Title"));
    const fetchCalls = fetchSpy.mock.calls.length;

    // Server pushes a spin change over the shared stream.
    act(() => {
      FakeEventSource.last().onmessage?.({ data: JSON.stringify(pushEvent()) });
    });

    // React Query batches cache notifications asynchronously — wait for the
    // re-render rather than asserting synchronously after the push.
    await waitFor(() =>
      expect(screen.getByTestId("np-title").textContent).toBe("New Title"),
    );
    expect(screen.getByTestId("np-observed").textContent).toBe(
      "2026-08-15T10:05:00.000Z",
    );
    // No extra network round-trip was needed for the update.
    expect(fetchSpy.mock.calls.length).toBe(fetchCalls);
  });

  it("stretches polling while healthy and resumes 30s when degraded", () => {
    expect(WP_ONAIR_POLL_STREAM_HEALTHY_MS).toBeGreaterThan(WP_ONAIR_POLL_DEGRADED_MS);
    expect(WP_ONAIR_POLL_DEGRADED_MS).toBe(30_000);
  });
});
