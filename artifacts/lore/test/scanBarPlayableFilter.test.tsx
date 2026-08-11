// @vitest-environment jsdom
/**
 * ScanBar — attribution-only stations (no streamUrl, no relayUrl) must be
 * excluded from scan candidates entirely: the scan can neither sample nor
 * land on a station that cannot play, so radio.toggle (and its
 * "no live stream configured" safety-net error) is unreachable from the
 * scan path for those stations.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("../src/hooks/useDialData", () => ({ useDialData: vi.fn() }));
vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {});
});
vi.mock("../src/components/StationLane", () => ({ StationLane: () => <div /> }));
vi.mock("../src/components/ContextRail", () => ({ ContextRail: () => <div /> }));
vi.mock("../src/components/SearchOverlay", () => ({ SearchOverlay: () => <div /> }));
vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({ ride: {}, spotify: {}, scan: {}, radio: {} })),
  });
});

import { ScanBar } from "../src/components/DialView";
import type { DialStation, DialShow, DialSpin } from "../src/hooks/useDialData";

function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: "mbid-1", artistMbid: null, title: "Test Track", artist: "Test Artist",
    playedAt: new Date().toISOString(), isLibraryHit: true, isArtistHit: false,
    isFirstSpin: false, ...overrides,
  };
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1, showName: "Morning Mix", djName: null,
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endedAt: new Date().toISOString(), state: "live", spins: [makeSpin()],
    crossings: 0, artistCrossings: 0, topArtists: [], topArtistNames: [],
    currentTrack: null, isPickerShow: false, pickerId: null, ...overrides,
  };
}

function makeDialStation(
  stationOverrides: Record<string, unknown>,
): DialStation {
  return {
    station: {
      slug: "test-fm", name: "Test FM", streamUrl: null, websiteUrl: null,
      description: null, logoUrl: null, radioBrowserId: null, automationClass: null,
      ...stationOverrides,
    } as DialStation["station"],
    isLive: true,
    shows: [makeShow()],
    crossings: 1, artistCrossings: 0, lifetimeCrossings: 0, lifetimeArtistCrossings: 0,
  } as DialStation;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("ScanBar playable-candidate filtering", () => {
  it("excludes attribution-only stations from the candidate count", () => {
    const stations = [
      makeDialStation({ slug: "playable", streamUrl: "https://example.com/a" }),
      makeDialStation({ slug: "attribution-only", streamUrl: null }),
      makeDialStation({ slug: "relayed", streamUrl: null, relayUrl: "/api/stations/relayed/relay" }),
    ];
    render(
      <ScanBar stations={stations} level="all" currentStation={null}
        currentShow={null} currentDj={null} onPlay={vi.fn()} />,
    );
    // 3 stations with library hits, but only 2 are playable.
    expect(screen.getByText(/2 stops/)).toBeTruthy();
  });

  it("never lands the scan on an attribution-only station", () => {
    vi.useFakeTimers();
    const onPlay = vi.fn();
    const stations = [
      makeDialStation({ slug: "attribution-only", streamUrl: null }),
      makeDialStation({ slug: "playable", streamUrl: "https://example.com/a" }),
    ];
    render(
      <ScanBar stations={stations} level="all" currentStation={null}
        currentShow={null} currentDj={null} onPlay={onPlay} />,
    );
    fireEvent.click(screen.getByText("Scan"));
    // Hop through more samples than there are candidates — every sample must
    // come from the playable station only.
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByText("Land"));
      if (onPlay.mock.calls.length > 0) break;
      vi.advanceTimersByTime(3000);
    }
    expect(onPlay).toHaveBeenCalled();
    for (const call of onPlay.mock.calls) {
      expect((call[0] as DialStation).station.slug).toBe("playable");
    }
  });

  it("shows zero stops when every crossing station is attribution-only", () => {
    const stations = [
      makeDialStation({ slug: "wvum", streamUrl: null }),
    ];
    const onPlay = vi.fn();
    render(
      <ScanBar stations={stations} level="all" currentStation={null}
        currentShow={null} currentDj={null} onPlay={onPlay} />,
    );
    expect(screen.getByText(/0 stops/)).toBeTruthy();
    // Scan then Land is a no-op — onPlay never fires.
    fireEvent.click(screen.getByText("Scan"));
    fireEvent.click(screen.getByText("Land"));
    expect(onPlay).not.toHaveBeenCalled();
  });
});
