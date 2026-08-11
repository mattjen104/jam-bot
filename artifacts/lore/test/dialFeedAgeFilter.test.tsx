// @vitest-environment jsdom
/**
 * DialFeedLane — age-tier filtering before pagination.
 *
 * Covers:
 *  1. No activeAgeTiers / empty set → every row renders.
 *  2. Active tiers hide rows whose current track's ageTier misses the set.
 *  3. Rows with unknown age (null tier) or no current track always pass.
 *  4. liveTrack takes precedence over the show's currentTrack.
 *  5. Filtering applies across bands (reason / dj / rest).
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

vi.mock("../src/components/dial/FrontDoorRow", () => ({
  FrontDoorRow: ({ ds }: { ds: { station: { slug: string } }; [k: string]: unknown }) => (
    <div data-testid={`fdrow-${ds.station.slug}`} className="fdrow" />
  ),
  ZoneLabel: () => null,
  agoLabel: () => "just now",
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { DialFeedLane } from "../src/components/dial/DialFeedLane";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";
import type { DialStation, DialShow, DialSpin } from "../src/hooks/useDialData";
import type { AgeTier } from "../src/lib/dialAgeFilter";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeSpin(ageTier: AgeTier | null, overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: "00000000-0000-0000-0000-000000000001",
    artistMbid: null,
    title: "Track",
    artist: "Artist",
    playedAt: new Date().toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: ageTier === "first",
    releaseYear: null,
    ageTier,
    ...overrides,
  };
}

function makeDialStation(slug: string, liveTrack: DialSpin | null | undefined): DialStation {
  return {
    station: {
      slug,
      name: `Station ${slug}`,
      automationClass: null,
      streamUrl: null,
      websiteUrl: null,
      hidden: false,
      favorite: false,
    } as DialStation["station"],
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
    ...(liveTrack !== undefined ? { liveTrack } : {}),
  };
}

function makeShow(currentTrack: DialSpin | null): DialShow {
  return {
    runId: 1,
    showName: "Show",
    djName: null,
    startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    ianaTimezone: null,
    state: "live",
    spins: [],
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack,
    isPickerShow: false,
    pickerId: null,
  };
}

/** Row whose station liveTrack carries the given tier (or no track at all). */
function rowWithTier(slug: string, tier: AgeTier | null | "none"): DialLaneRow {
  return {
    ds: makeDialStation(slug, tier === "none" ? null : makeSpin(tier)),
    show: null,
    effectiveDjName: null,
  };
}

function renderFeed(overrides: Partial<React.ComponentProps<typeof DialFeedLane>> = {}) {
  return render(
    <DialFeedLane
      reasonRows={[]}
      djRows={[]}
      restRows={[]}
      popSortDesc={true}
      activeSlug={null}
      samplingSlug={null}
      scrubTarget={null}
      displayMode="personal"
      presenceMap={new Map()}
      popMap={new Map()}
      seedsLower={new Set()}
      artworkUrl={null}
      popLineFor={() => null}
      ovFor={() => 0}
      onAddArtist={vi.fn()}
      onTuneIn={vi.fn()}
      onSetExpand={vi.fn()}
      {...overrides}
    />,
  );
}

const bySlug = (slug: string) => document.querySelector(`[data-testid="fdrow-${slug}"]`);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DialFeedLane — age-tier filtering", () => {
  it("renders every row when no tiers are active (undefined or empty set)", () => {
    const rows = [rowWithTier("cur", "current"), rowWithTier("deep", "deep")];
    renderFeed({ restRows: rows });
    expect(bySlug("cur")).toBeTruthy();
    expect(bySlug("deep")).toBeTruthy();
    cleanup();
    renderFeed({ restRows: rows, activeAgeTiers: new Set() });
    expect(bySlug("cur")).toBeTruthy();
    expect(bySlug("deep")).toBeTruthy();
  });

  it("hides rows whose current track misses every active tier", () => {
    renderFeed({
      restRows: [rowWithTier("cur", "current"), rowWithTier("cat", "catalog"), rowWithTier("deep", "deep")],
      activeAgeTiers: new Set<AgeTier>(["current", "catalog"]),
    });
    expect(bySlug("cur")).toBeTruthy();
    expect(bySlug("cat")).toBeTruthy();
    expect(bySlug("deep")).toBeNull();
  });

  it("keeps 'first' rows only when the First tier is active", () => {
    renderFeed({
      restRows: [rowWithTier("first", "first"), rowWithTier("deep", "deep")],
      activeAgeTiers: new Set<AgeTier>(["first"]),
    });
    expect(bySlug("first")).toBeTruthy();
    expect(bySlug("deep")).toBeNull();
  });

  it("always passes rows with unknown age or no current track", () => {
    renderFeed({
      restRows: [rowWithTier("unknown", null), rowWithTier("dark", "none")],
      activeAgeTiers: new Set<AgeTier>(["current"]),
    });
    expect(bySlug("unknown")).toBeTruthy();
    expect(bySlug("dark")).toBeTruthy();
  });

  it("prefers the station's liveTrack over the show's currentTrack", () => {
    // liveTrack says deep; the show's currentTrack says current. With only
    // "current" active the row must hide (liveTrack wins).
    const row: DialLaneRow = {
      ds: makeDialStation("mix", makeSpin("deep")),
      show: makeShow(makeSpin("current")),
      effectiveDjName: null,
    };
    renderFeed({ restRows: [row], activeAgeTiers: new Set<AgeTier>(["current"]) });
    expect(bySlug("mix")).toBeNull();
  });

  it("falls back to the show's currentTrack when the station has no liveTrack", () => {
    const row: DialLaneRow = {
      ds: makeDialStation("showtrack", null),
      show: makeShow(makeSpin("deep")),
      effectiveDjName: null,
    };
    renderFeed({ restRows: [row], activeAgeTiers: new Set<AgeTier>(["current"]) });
    // liveTrack is null → falls back to show.currentTrack (deep) → hidden.
    expect(bySlug("showtrack")).toBeNull();
  });

  it("filters across all bands (reason / dj / rest)", () => {
    renderFeed({
      reasonRows: [rowWithTier("r-deep", "deep")],
      djRows: [rowWithTier("d-cur", "current")],
      restRows: [rowWithTier("x-cat", "catalog")],
      activeAgeTiers: new Set<AgeTier>(["current"]),
    });
    expect(bySlug("r-deep")).toBeNull();
    expect(bySlug("d-cur")).toBeTruthy();
    expect(bySlug("x-cat")).toBeNull();
  });
});
