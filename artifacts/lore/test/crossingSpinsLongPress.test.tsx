// @vitest-environment jsdom
/**
 * Component-level regression for the crossing spins drill-down state reset.
 *
 * Confirmed behavior:
 *   • The long-press tune-in path on a compact collapsed row must clear
 *     spinsDrill so that reopening the ⬤ detail does not restore the previous
 *     drill-down panel.
 *
 * Implementation note: vi.useFakeTimers() is used to trigger the 600ms
 * long-press timer synchronously inside act().
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before FrontDoorRow import.
// ---------------------------------------------------------------------------

vi.mock("@workspace/lore-attribution", () => ({
  eligibleDjNames: () => [] as string[],
  eligibleDjName: () => null,
}));

vi.mock("../src/hooks/useRadioPlayer", () => ({
  resolvePlaybackSource: () => ({ url: "http://example.com/stream", type: "stream" }),
}));

vi.mock("../src/lib/proxyArt", () => ({ proxyArtUrl: (u: string) => u }));
vi.mock("../src/lib/utils", () => ({ safeHttpUrl: () => null }));
vi.mock("../src/components/ListenerAvatarStack", () => ({
  ListenerAvatarStack: () => null,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { FrontDoorRow } from "../src/components/dial/FrontDoorRow";
import type { DialStation, DialShow, DialSpin } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    title: "Track",
    artist: "The Knife",
    playedAt: new Date(Date.now() - 60_000).toISOString(), // 1 min ago — within 24h
    isLibraryHit: true,
    isArtistHit: false,
    isFirstSpin: false,
    releaseYear: null,
    ageTier: null,
    ...overrides,
  };
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Morning Show",
    djName: null,
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    endedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ianaTimezone: null,
    state: "live",
    spins: [makeSpin()],
    crossings: 1,
    artistCrossings: 0,
    topArtists: ["The Knife"],
    topArtistNames: [],
    currentTrack: makeSpin(),
    isPickerShow: false,
    pickerId: null,
    ...overrides,
  };
}

function makeDs(overrides: Partial<DialStation> = {}): DialStation {
  return {
    station: {
      slug: "kexp",
      name: "KEXP",
      tier: "flagship",
      qualityTier: "proven",
      automationClass: "human",
      homepageUrl: null,
      homepageBlurb: null,
    } as DialStation["station"],
    isLive: true,
    shows: [makeShow()],
    crossings: 1,
    artistCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
    topArtistNames24h: ["The Knife"],
    topArtistNames7d: [],
    topArtistNamesLifetime: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FrontDoorRow crossing spins drill-down — long-press reset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("long-press tune-in clears spinsDrill so the spins panel stays hidden on reopen", () => {
    const onTuneIn = vi.fn();
    const ds = makeDs();
    const show = ds.shows[0]!;

    const { container } = render(
      <FrontDoorRow
        ds={ds}
        show={show}
        ov={0}
        isActive={false}
        isSampling={false}
        onTuneIn={onTuneIn}
        compactSentence={true}
        hasCrossing={true}
        crossingScope="24h"
      />,
    );

    // 1. Open the ⬤ crossing detail.
    const dot = container.querySelector(".fdrow__crossing-dot");
    expect(dot).not.toBeNull();
    act(() => { fireEvent.click(dot!); });
    expect(container.querySelector(".fdrow__crossing-detail")).not.toBeNull();

    // 2. Open the spins drill-down via "see spins".
    const seeSpins = container.querySelector(".fdrow__crossing-see-spins");
    expect(seeSpins).not.toBeNull();
    act(() => { fireEvent.click(seeSpins!); });
    expect(container.querySelector(".fdrow__crossing-spins")).not.toBeNull();

    // 3. Long-press the row root (not the dot — the dot stops pointerDown propagation).
    const row = container.querySelector(".fdrow");
    expect(row).not.toBeNull();
    act(() => { fireEvent.pointerDown(row!); });

    // Advance past the 600ms long-press threshold.
    act(() => { vi.advanceTimersByTime(650); });

    // 4. Both the detail and the spins panel must be gone after long-press.
    expect(container.querySelector(".fdrow__crossing-spins")).toBeNull();
    expect(container.querySelector(".fdrow__crossing-detail")).toBeNull();
    // The "today's spins only" partial note must not linger in the DOM.
    expect(container.querySelector(".fdrow__crossing-spins-note")).toBeNull();
    expect(onTuneIn).toHaveBeenCalledTimes(1);

    // 5. Reopen the ⬤ detail — the spins panel must NOT reappear (spinsDrill was reset).
    act(() => { fireEvent.click(dot!); });
    expect(container.querySelector(".fdrow__crossing-detail")).not.toBeNull();
    expect(container.querySelector(".fdrow__crossing-spins")).toBeNull();
  });
});
