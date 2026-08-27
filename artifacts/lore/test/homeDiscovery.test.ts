import { describe, expect, it } from "vitest";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";
import type { LibraryItem } from "../src/lib/meHooks";
import {
  buildCaughtKeeps,
  buildHomeKeepGroups,
  discoveryProvenance,
  homeCrossingMetric,
  liveTrackForRow,
  reconcileDiscoverySlots,
  sameDiscoveryTrackCard,
  selectHistoricalFallback,
} from "../src/components/HomeDiscovery";

function row(overrides: {
  slug?: string;
  playedAt?: string;
  libraryHit?: boolean;
  artistHit?: boolean;
  djName?: string | null;
  picker?: boolean;
  showName?: string;
  setCount?: number;
  dayCount?: number;
  weekCount?: number;
  monthCount?: number;
  lifetimeCount?: number;
} = {}): DialLaneRow {
  const slug = overrides.slug ?? "nts";
  const track = {
    mbid: `${slug}-recording`,
    artistMbid: null,
    title: "Current track",
    artist: "Current artist",
    playedAt: overrides.playedAt ?? "2026-08-27T12:00:00.000Z",
    isLibraryHit: overrides.libraryHit ?? false,
    isArtistHit: overrides.artistHit ?? false,
    isFirstSpin: false,
    releaseYear: 2026,
    ageTier: "current" as const,
  };
  const show = overrides.showName || overrides.djName
    ? {
        runId: 1,
        showName: overrides.showName ?? "Morning show",
        djName: overrides.djName ?? null,
        startedAt: "2026-08-27T10:00:00.000Z",
        endedAt: "2026-08-27T14:00:00.000Z",
        ianaTimezone: "UTC",
        state: "live" as const,
        spins: [],
        crossings: overrides.setCount ?? 0,
        artistCrossings: 0,
        topArtists: overrides.setCount ? ["Set artist"] : [],
        topArtistNames: [],
        currentTrack: track,
        isPickerShow: overrides.picker ?? false,
        pickerId: overrides.picker ? 1 : null,
      }
    : null;
  return {
    ds: {
      station: { id: 1, slug, name: `Station ${slug}` } as DialLaneRow["ds"]["station"],
      isLive: true,
      shows: show ? [show] : [],
      crossings: overrides.dayCount ?? 0,
      artistCrossings: 0,
      firstPlayCrossings: 0,
      weekCrossings: overrides.weekCount ?? 0,
      weekArtistCrossings: 0,
      weekFirstPlayCrossings: 0,
      monthCrossings: overrides.monthCount ?? 0,
      monthArtistCrossings: 0,
      monthFirstPlayCrossings: 0,
      lifetimeCrossings: overrides.lifetimeCount ?? 0,
      lifetimeArtistCrossings: 0,
      lifetimeFirstPlayCrossings: 0,
      liveTrack: track,
      topArtistNames: [],
      topArtistNames24h: overrides.dayCount ? ["Day artist"] : [],
      topArtistNames7d: overrides.weekCount ? ["Week artist"] : [],
      topArtistNamesLifetime: overrides.monthCount || overrides.lifetimeCount ? ["Long artist"] : [],
    },
    show,
    effectiveDjName: overrides.djName ?? null,
  };
}

describe("front-door discovery read model", () => {
  it("uses the strict named, inferred, station-claim, and unknown provenance ladder", () => {
    expect(discoveryProvenance(row({ djName: "Maya", picker: true })).kind).toBe("named");
    expect(discoveryProvenance(row({ djName: "Maya" })).kind).toBe("inferred");
    expect(discoveryProvenance(row({ showName: "Morning show" })).kind).toBe("claim");
    expect(discoveryProvenance(row()).kind).toBe("unknown");
  });

  it("widens set → 24h → 7d → 30d → lifetime and returns at most one live station", () => {
    expect(selectHistoricalFallback([
      row({ slug: "week", weekCount: 40 }),
      row({ slug: "day", dayCount: 1 }),
    ])?.window).toBe("24h");
    expect(selectHistoricalFallback([
      row({ slug: "old", showName: "Set", setCount: 2, playedAt: "2026-08-27T11:00:00.000Z" }),
      row({ slug: "new", showName: "Set", setCount: 2, playedAt: "2026-08-27T12:00:00.000Z" }),
    ])?.row.ds.station.slug).toBe("new");
    expect(selectHistoricalFallback([row({ libraryHit: true, lifetimeCount: 9 })])).toBeNull();
  });

  it("uses each station's closest positive interval when the selected scope is now", () => {
    const live = row({ libraryHit: true, lifetimeCount: 20 }).ds;
    const set = row({ showName: "Set", setCount: 2, dayCount: 8 }).ds;
    const day = row({ dayCount: 3, weekCount: 12 }).ds;
    const never = row().ds;

    expect(homeCrossingMetric(live, "now")).toEqual({ count: 1, scope: "now" });
    expect(homeCrossingMetric(set, "now")).toEqual({ count: 2, scope: "set" });
    expect(homeCrossingMetric(day, "now")).toEqual({ count: 3, scope: "24h" });
    expect(homeCrossingMetric(never, "now")).toEqual({ count: 0, scope: "lifetime" });
    expect(homeCrossingMetric(set, "24h")).toEqual({ count: 8, scope: "24h" });
  });

  it("keeps resolution updates on the same card until the source play changes", () => {
    const initial = liveTrackForRow(row({ slug: "same-card" }))!;
    const resolved = {
      ...initial,
      mbid: "resolved-recording",
      playedAt: "2026-08-27T12:00:08.000Z",
      sourcePlayedAt: initial.playedAt,
    };
    const refreshed = {
      ...resolved,
      sourcePlayedAt: "2026-08-27T12:04:00.000Z",
    };
    const nextCard = {
      ...refreshed,
      title: "Next track",
      sourcePlayedAt: "2026-08-27T12:08:00.000Z",
    };

    expect(sameDiscoveryTrackCard(initial, resolved)).toBe(true);
    expect(sameDiscoveryTrackCard(resolved, refreshed)).toBe(true);
    expect(sameDiscoveryTrackCard(refreshed, nextCard)).toBe(false);
  });

  it("keeps unchanged cards in their exact cells while replacements fill vacancies", () => {
    expect(reconcileDiscoverySlots(
      ["alpha", "beta", "charlie"],
      ["replacement", "charlie", "alpha"],
      new Set(["alpha", "charlie"]),
    )).toEqual(["alpha", "replacement", "charlie"]);
    expect(reconcileDiscoverySlots(
      ["alpha", "beta", "charlie"],
      ["alpha", "charlie"],
      new Set(["alpha", "charlie"]),
    )).toEqual(["alpha", null, "charlie"]);
  });

  it("keeps only genuine radio catches, newest first, with honest release identity", () => {
    const item = (addedAt: string, provenance: LibraryItem["provenance"], releaseGroupMbid: string | null): LibraryItem => ({
      mbid: addedAt,
      addedAt,
      provenance,
      recording: {
        title: "Track",
        artist: "Artist",
        artistMbid: "artist-mbid",
        artworkUrl: null,
        albumTitle: null,
        releaseGroupMbid,
        releaseYear: null,
        spotifyUrl: null,
      },
    });
    const catches = buildCaughtKeeps([
      item("2026-08-20T00:00:00.000Z", { kind: "import", service: "spotify" }, "release-1"),
      item("2026-08-25T00:00:00.000Z", { kind: "keep", stationSlug: "wfmu" }, null),
      item("2026-08-27T00:00:00.000Z", { kind: "keep", stationSlug: "nts" }, "release-2"),
    ]);
    expect(catches.map((caught) => caught.stationSlug)).toEqual(["nts", "wfmu"]);
    expect(catches[0]?.releaseGroupMbid).toBe("release-2");
    expect(catches[1]?.artistMbid).toBe("artist-mbid");
  });

  it("formats recent catches as album-first Stack rows", () => {
    const kept = (mbid: string, title: string, stationSlug: string): LibraryItem => ({
      mbid,
      addedAt: `2026-08-${mbid === "track-1" ? "27" : "26"}T00:00:00.000Z`,
      provenance: { kind: "keep", stationSlug, stationName: stationSlug.toUpperCase() },
      recording: {
        title,
        artist: "Artist",
        artistMbid: "artist-mbid",
        artworkUrl: null,
        albumTitle: "Album",
        releaseGroupMbid: "release-group",
        releaseYear: 2026,
        spotifyUrl: null,
      },
    });
    const groups = buildHomeKeepGroups(buildCaughtKeeps([
      kept("track-1", "One", "nts"),
      kept("track-2", "Two", "wfmu"),
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      albumTitle: "Album",
      artist: "Artist",
      stationName: null,
      count: 2,
      releaseGroupMbid: "release-group",
    });
  });
});