// @vitest-environment jsdom
/**
 * Regression guard for Task 287: `openStream()` parser must forward the three
 * fields that the Dial fast path depends on for age-tier computation and
 * artist-navigation identity.
 *
 * Specifically, `artistMbid`, `releaseYear`, and `isFirstSpin` were added to
 * `SpinStreamEvent` but the `openStream()` parser inside `nowPlayingStream.ts`
 * did NOT initially include them in the constructed event object — so every
 * resolved override silently had `artistMbid: null`, `releaseYear: null`, and
 * `isFirstSpin: false` until the next REST poll.
 *
 * These tests drive real frames through the FakeEventSource → `openStream()`
 * parser → `subscribeSpinStream` listener chain to confirm the fields survive.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  subscribeSpinStream,
  _testOnly_resetStream,
  type SpinStreamEvent,
} from "../src/webplayer/nowPlayingStream";

// ---------------------------------------------------------------------------
// Fake EventSource (mirrors the one in wpOnAirStream.test.tsx)
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
  addEventListener() {}
  static last(): FakeEventSource {
    const inst = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!inst) throw new Error("No FakeEventSource created yet");
    return inst;
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as Record<string, unknown>).EventSource = FakeEventSource;
});

afterEach(() => {
  _testOnly_resetStream();
  delete (globalThis as Record<string, unknown>).EventSource;
  vi.restoreAllMocks();
});

/** Push a raw JSON frame through the fake EventSource. */
function pushRaw(data: Record<string, unknown>): void {
  FakeEventSource.last().onmessage?.({ data: JSON.stringify(data) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("nowPlayingStream — openStream parser field pass-through", () => {
  it("passes artistMbid, releaseYear, releaseDate, and isFirstSpin through on a resolved spin-changed frame", () => {
    const received: SpinStreamEvent[] = [];
    subscribeSpinStream((ev) => received.push(ev));
    FakeEventSource.last().onopen?.();

    pushRaw({
      stationSlug: "kcrw",
      rawArtist: "Wet Leg",
      rawTitle: "Chaise Longue",
      mbid: "aaaaaaaa-0000-0000-0000-000000000001",
      artworkUrl: "https://img.example/wet-leg.jpg",
      artistMbid: "bbbbbbbb-0000-0000-0000-000000000002",
      releaseYear: 2021,
      releaseDate: "2021-06-25",
      isFirstSpin: true,
      isLibraryHit: true,
      isArtistHit: false,
    });

    expect(received).toHaveLength(1);
    const ev = received[0]!;
    expect(ev.artistMbid).toBe("bbbbbbbb-0000-0000-0000-000000000002");
    expect(ev.artworkUrl).toBe("https://img.example/wet-leg.jpg");
    expect(ev.releaseYear).toBe(2021);
    expect(ev.releaseDate).toBe("2021-06-25");
    expect(ev.isFirstSpin).toBe(true);
    expect(ev.isLibraryHit).toBe(true);
    expect(ev.isArtistHit).toBe(false);
  });

  it("passes artistMbid, releaseYear, and isFirstSpin through on a provisional spin-raw frame", () => {
    const received: SpinStreamEvent[] = [];
    subscribeSpinStream((ev) => received.push(ev));
    FakeEventSource.last().onopen?.();

    pushRaw({
      stationSlug: "kcrw",
      rawArtist: "Wet Leg",
      rawTitle: "Chaise Longue",
      mbid: null,
      type: "spin-raw",
      provisional: true,
      artistMbid: "bbbbbbbb-0000-0000-0000-000000000002",
      releaseYear: 2021,
      isFirstSpin: false,
    });

    expect(received).toHaveLength(1);
    const ev = received[0]!;
    expect(ev.provisional).toBe(true);
    expect(ev.type).toBe("spin-raw");
    expect(ev.artistMbid).toBe("bbbbbbbb-0000-0000-0000-000000000002");
    expect(ev.releaseYear).toBe(2021);
    expect(ev.isFirstSpin).toBe(false);
  });

  it("omits artistMbid, releaseYear, releaseDate, and isFirstSpin keys when absent from the server frame", () => {
    const received: SpinStreamEvent[] = [];
    subscribeSpinStream((ev) => received.push(ev));
    FakeEventSource.last().onopen?.();

    // Frame with only the required fields — the three optional ones absent.
    pushRaw({
      stationSlug: "kcrw",
      rawArtist: "Unknown Artist",
      rawTitle: "Unknown Track",
      mbid: null,
      type: "spin-raw",
      provisional: true,
    });

    expect(received).toHaveLength(1);
    const ev = received[0]!;
    expect("artistMbid" in ev).toBe(false);
    expect("releaseYear" in ev).toBe(false);
    expect("releaseDate" in ev).toBe(false);
    expect("isFirstSpin" in ev).toBe(false);
  });

  it("preserves an explicit null artwork URL from a resolved frame", () => {
    const received: SpinStreamEvent[] = [];
    subscribeSpinStream((ev) => received.push(ev));
    FakeEventSource.last().onopen?.();

    pushRaw({
      stationSlug: "kcrw",
      rawArtist: "Unknown Artist",
      rawTitle: "Unknown Track",
      mbid: null,
      artworkUrl: null,
    });

    expect(received).toHaveLength(1);
    expect(received[0]!.artworkUrl).toBeNull();
  });

  it("passes artistMbid and releaseYear for a spin-raw-failed terminal frame", () => {
    const received: SpinStreamEvent[] = [];
    subscribeSpinStream((ev) => received.push(ev));
    FakeEventSource.last().onopen?.();

    pushRaw({
      stationSlug: "kcrw",
      rawArtist: "Ghost Artist",
      rawTitle: "Ghost Track",
      mbid: null,
      type: "spin-raw-failed",
      provisional: false,
      artistMbid: "cccccccc-0000-0000-0000-000000000003",
      releaseYear: 1977,
      isFirstSpin: false,
    });

    expect(received).toHaveLength(1);
    const ev = received[0]!;
    expect(ev.type).toBe("spin-raw-failed");
    expect(ev.artistMbid).toBe("cccccccc-0000-0000-0000-000000000003");
    expect(ev.releaseYear).toBe(1977);
  });
});
