import { describe, it, expect } from "vitest";
import {
  mergeSpinIntoOnAir,
  type SpinStreamEvent,
} from "../src/webplayer/nowPlayingStream";
import type { WpOnAirItem, WpOnAirResponse } from "../src/webplayer/hooks";

/**
 * Pure merge tests for the provisional now-playing fast path: a `spin-raw`
 * frame must paint the new track immediately with a resolving flag, and the
 * matching resolved `spin-changed` frame must upgrade it in place without a
 * duplicate "earlier" promotion or a downgrade of an already-resolved row.
 */

function makeItem(overrides?: Partial<WpOnAirItem["now"]>): WpOnAirItem {
  return {
    station: { slug: "kexp", name: "KEXP" } as WpOnAirItem["station"],
    show: null,
    now: {
      mbid: "mbid-old",
      title: "Old Song",
      artist: "Old Artist",
      artworkUrl: "http://img/old.jpg",
      playedAt: "2026-08-17T10:00:00.000Z",
      observedAt: "2026-08-17T10:00:00.000Z",
      freshness: "fresh",
      resolved: true,
      ...overrides,
    },
    earlier: [],
    matchCount: null,
  };
}

function makeState(item: WpOnAirItem = makeItem()): WpOnAirResponse {
  return { items: [item], authenticated: false };
}

const rawFrame: SpinStreamEvent = {
  stationSlug: "kexp",
  rawArtist: "New Artist",
  rawTitle: "New Song",
  mbid: null,
  type: "spin-raw",
  provisional: true,
  observedAt: "2026-08-17T10:04:00.000Z",
  confidence: "unresolved",
};

const resolvedFrame: SpinStreamEvent = {
  stationSlug: "kexp",
  rawArtist: "New Artist",
  rawTitle: "New Song",
  mbid: "mbid-new",
  observedAt: "2026-08-17T10:04:01.000Z",
  confidence: "text",
};

describe("mergeSpinIntoOnAir — provisional spin-raw frames", () => {
  it("paints the new track immediately with resolving: true", () => {
    const prev = makeState();
    const next = mergeSpinIntoOnAir(prev, rawFrame);
    expect(next).not.toBe(prev);
    const now = next!.items[0]!.now;
    expect(now.artist).toBe("New Artist");
    expect(now.title).toBe("New Song");
    expect(now.mbid).toBeNull();
    expect(now.resolved).toBe(false);
    expect(now.resolving).toBe(true);
    expect(now.freshness).toBe("fresh");
    expect(now.observedAt).toBe("2026-08-17T10:04:00.000Z");
    // The outgoing artist is promoted into the earlier strip exactly once.
    expect(next!.items[0]!.earlier).toEqual(["Old Artist"]);
  });

  it("upgrades to the resolved frame in place, clearing resolving", () => {
    const provisional = mergeSpinIntoOnAir(makeState(), rawFrame)!;
    const next = mergeSpinIntoOnAir(provisional, resolvedFrame)!;
    const now = next.items[0]!.now;
    expect(now.mbid).toBe("mbid-new");
    expect(now.resolved).toBe(true);
    expect(now.resolving).toBe(false);
    expect(now.artist).toBe("New Artist");
    expect(now.title).toBe("New Song");
    // Same artist/title as the provisional row — no second earlier promotion.
    expect(next.items[0]!.earlier).toEqual(["Old Artist"]);
  });

  it("returns the same reference for a duplicate provisional frame (no flicker)", () => {
    const provisional = mergeSpinIntoOnAir(makeState(), rawFrame)!;
    expect(mergeSpinIntoOnAir(provisional, rawFrame)).toBe(provisional);
  });

  it("clears resolving when the final frame is unresolved (mbid: null)", () => {
    // Resolution failure is a VALID terminal outcome: the persisted
    // spin-changed carries the same artist/title with mbid still null. The
    // row must upgrade out of the resolving state — otherwise the cue sticks
    // until a different track arrives.
    const unresolvedFinal: SpinStreamEvent = {
      stationSlug: "kexp",
      rawArtist: "New Artist",
      rawTitle: "New Song",
      mbid: null,
      observedAt: "2026-08-17T10:04:03.000Z",
      confidence: "unresolved",
    };
    const provisional = mergeSpinIntoOnAir(makeState(), rawFrame)!;
    const next = mergeSpinIntoOnAir(provisional, unresolvedFinal)!;
    expect(next).not.toBe(provisional);
    const now = next.items[0]!.now;
    expect(now.resolving).toBe(false);
    expect(now.resolved).toBe(false); // still unresolved — honest display
    expect(now.mbid).toBeNull();
    expect(now.observedAt).toBe("2026-08-17T10:04:03.000Z");
    expect(now.freshness).toBe("fresh");
    // No spurious earlier-strip churn.
    expect(next.items[0]!.earlier).toEqual(["Old Artist"]);
    // A repeat of the same terminal frame is now a no-op.
    expect(mergeSpinIntoOnAir(next, unresolvedFinal)).toBe(next);
  });

  it("reverts to the last persisted track on a terminal spin-raw-failed frame", () => {
    // The write failed after spin-raw was emitted — no spin-changed is
    // coming. The row must fall back to the stashed pre-provisional state,
    // not keep showing an unpersisted track.
    const failedFrame: SpinStreamEvent = {
      stationSlug: "kexp",
      rawArtist: "New Artist",
      rawTitle: "New Song",
      mbid: null,
      type: "spin-raw-failed",
      provisional: true,
      observedAt: "2026-08-17T10:04:02.000Z",
      confidence: "unresolved",
    };
    const provisional = mergeSpinIntoOnAir(makeState(), rawFrame)!;
    expect(provisional.items[0]!.now.artist).toBe("New Artist");
    const reverted = mergeSpinIntoOnAir(provisional, failedFrame)!;
    expect(reverted).not.toBe(provisional);
    const row = reverted.items[0]!;
    expect(row.now.artist).toBe("Old Artist");
    expect(row.now.title).toBe("Old Song");
    expect(row.now.mbid).toBe("mbid-old");
    expect(row.now.resolved).toBe(true);
    expect(row.now.resolving).toBeUndefined();
    expect(row.now.revertTo).toBeUndefined();
    // The earlier strip is restored too — no phantom "Old Artist" promotion.
    expect(row.earlier).toEqual([]);
    // Repeats of the failure frame are referentially stable no-ops.
    expect(mergeSpinIntoOnAir(reverted, failedFrame)).toBe(reverted);
  });

  it("ignores failure frames that don't match the current provisional row", () => {
    const provisional = mergeSpinIntoOnAir(makeState(), rawFrame)!;
    const staleFailure: SpinStreamEvent = {
      stationSlug: "kexp",
      rawArtist: "Someone Else",
      rawTitle: "Other Track",
      mbid: null,
      type: "spin-raw-failed",
      provisional: true,
    };
    expect(mergeSpinIntoOnAir(provisional, staleFailure)).toBe(provisional);
    // A failure frame when nothing is provisional is also a no-op.
    const idle = makeState();
    expect(mergeSpinIntoOnAir(idle, { ...staleFailure, rawArtist: "Old Artist", rawTitle: "Old Song" })).toBe(idle);
  });

  it("chained provisional frames revert to the last PERSISTED track, not the previous provisional one", () => {
    const secondRaw: SpinStreamEvent = {
      ...rawFrame,
      rawArtist: "Newer Artist",
      rawTitle: "Newer Song",
      observedAt: "2026-08-17T10:04:30.000Z",
    };
    const first = mergeSpinIntoOnAir(makeState(), rawFrame)!;
    const second = mergeSpinIntoOnAir(first, secondRaw)!;
    expect(second.items[0]!.now.artist).toBe("Newer Artist");
    const failed: SpinStreamEvent = {
      stationSlug: "kexp",
      rawArtist: "Newer Artist",
      rawTitle: "Newer Song",
      mbid: null,
      type: "spin-raw-failed",
      provisional: true,
    };
    const reverted = mergeSpinIntoOnAir(second, failed)!;
    // Reverts straight to the persisted "Old Artist" row, never to the
    // unpersisted "New Artist" provisional.
    expect(reverted.items[0]!.now.artist).toBe("Old Artist");
    expect(reverted.items[0]!.earlier).toEqual([]);
  });

  it("never downgrades an already-resolved row on a late duplicate raw frame", () => {
    // Row already showing the new track resolved; a duplicate spin-raw for
    // the same artist/title (mbid: null) must not flip it back to resolving.
    const resolvedItem = makeItem({
      mbid: "mbid-new",
      title: "New Song",
      artist: "New Artist",
      resolved: true,
    });
    const prev = makeState(resolvedItem);
    expect(mergeSpinIntoOnAir(prev, rawFrame)).toBe(prev);
  });

  it("leaves other stations' rows untouched", () => {
    const other = makeItem();
    other.station = { slug: "kcrw", name: "KCRW" } as WpOnAirItem["station"];
    const prev: WpOnAirResponse = { items: [makeItem(), other], authenticated: false };
    const next = mergeSpinIntoOnAir(prev, rawFrame)!;
    expect(next.items[1]).toBe(other);
  });
});
