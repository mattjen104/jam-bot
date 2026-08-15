// @vitest-environment jsdom
/**
 * Now-playing freshness on the client:
 *
 *  - isStaleNowPlaying: only an explicit "stale" counts — absent/unknown
 *    freshness degrades to non-stale so pre-field payloads behave unchanged.
 *  - gateLiveHitFlags: stale candidates are never counted as confirmed live
 *    crossings (hit flags downgraded); fresh/aging/unknown pass through.
 *  - OnAirRow: a stale station row shows the subtle "may be delayed"
 *    indicator; fresh rows (and rows without the field) do not.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { isStaleNowPlaying, gateLiveHitFlags } from "../src/lib/freshness";
import { OnAirRow } from "../src/webplayer/WebPlayer";
import type { WpOnAirItem } from "../src/webplayer/hooks";

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      radio: { station: null, status: "idle", toggle: vi.fn() },
      ride: { active: false },
      spotify: { connected: false },
      scan: { active: false, toggle: vi.fn() },
    })),
  });
});

vi.mock("../src/lib/social", () => ({
  useSocialMode: vi.fn(() => ({ enabled: false })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("isStaleNowPlaying", () => {
  it("true only for an explicit stale class", () => {
    expect(isStaleNowPlaying({ freshness: "stale" })).toBe(true);
    expect(isStaleNowPlaying({ freshness: "fresh" })).toBe(false);
    expect(isStaleNowPlaying({ freshness: "aging" })).toBe(false);
    expect(isStaleNowPlaying({})).toBe(false);
    expect(isStaleNowPlaying(null)).toBe(false);
    expect(isStaleNowPlaying(undefined)).toBe(false);
  });
});

describe("gateLiveHitFlags — live-crossing exclusion", () => {
  it("downgrades hit flags on stale candidates", () => {
    expect(
      gateLiveHitFlags({ freshness: "stale", isLibraryHit: true, isArtistHit: true }),
    ).toEqual({ isLibraryHit: false, isArtistHit: false });
  });

  it("passes fresh/aging/unknown through unchanged", () => {
    expect(
      gateLiveHitFlags({ freshness: "fresh", isLibraryHit: true, isArtistHit: false }),
    ).toEqual({ isLibraryHit: true, isArtistHit: false });
    expect(
      gateLiveHitFlags({ freshness: "aging", isLibraryHit: false, isArtistHit: true }),
    ).toEqual({ isLibraryHit: false, isArtistHit: true });
    expect(gateLiveHitFlags({ isLibraryHit: true, isArtistHit: true })).toEqual({
      isLibraryHit: true,
      isArtistHit: true,
    });
  });
});

function makeItem(overrides: Partial<WpOnAirItem["now"]> = {}): WpOnAirItem {
  return {
    station: {
      id: 1,
      slug: "kexp",
      name: "KEXP",
      homepageUrl: null,
      streamUrl: null,
    } as unknown as WpOnAirItem["station"],
    show: null,
    now: {
      mbid: "abc-123",
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      artworkUrl: null,
      playedAt: new Date().toISOString(),
      resolved: true,
      ...overrides,
    },
    earlier: [],
    matchCount: null,
  };
}

describe("OnAirRow stale indicator", () => {
  it('shows "may be delayed" when the current track is classified stale', () => {
    render(
      <OnAirRow
        item={makeItem({ freshness: "stale" })}
        authenticated={false}
        nowInLibrary={false}
        onOpenRun={() => {}}
      />,
    );
    expect(screen.getByTestId("wp-stale-kexp").textContent).toContain("may be delayed");
  });

  it("shows no indicator for fresh tracks", () => {
    render(
      <OnAirRow
        item={makeItem({ freshness: "fresh" })}
        authenticated={false}
        nowInLibrary={false}
        onOpenRun={() => {}}
      />,
    );
    expect(screen.queryByTestId("wp-stale-kexp")).toBeNull();
  });

  it("shows no indicator when the field is absent (older payloads)", () => {
    render(
      <OnAirRow
        item={makeItem()}
        authenticated={false}
        nowInLibrary={false}
        onOpenRun={() => {}}
      />,
    );
    expect(screen.queryByTestId("wp-stale-kexp")).toBeNull();
  });
});
