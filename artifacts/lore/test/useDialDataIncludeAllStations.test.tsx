// @vitest-environment jsdom
/**
 * useDialData — includeAllStations option (main SplitHome view contract).
 *
 * The dial's default surface filter only keeps stations that are live,
 * flagship-tier, or carry at least one named show. The main SplitHome view
 * lists EVERY station alphabetically instead, so it passes
 * `includeAllStations: true` to bypass that filter.
 *
 * Contract under test (raw station data, NOT a mocked hook output):
 *  - an off-air, non-flagship station with no schedule metadata (no shows at
 *    all — the "Unknown show" Radio Browser case) is DROPPED by default
 *  - the same station IS returned when includeAllStations is true
 *  - metadata-category filtering still applies on top of includeAllStations
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Station } from "@workspace/api-client-react";

const onAirState = vi.hoisted(() => ({
  data: undefined as
    | {
        items: Array<{
          station: { slug: string; name: string };
          show: { name: string; djName: string | null } | null;
          now: {
            mbid: string;
            title: string;
            artist: string;
            artworkUrl: null;
            playedAt: string;
            freshness: "fresh";
            resolved: true;
          };
          earlier: string[];
          matchCount: null;
        }>;
        authenticated: boolean;
      }
    | undefined,
}));

const scheduleState = vi.hoisted(() => ({
  data: undefined as
    | {
        items: Array<{
          stationSlug: string;
          stationName: string;
          ianaTimezone: string | null;
          runs: Array<{
            runId: number;
            show: {
              name: string;
              djName: string | null;
              pickerId: number | null;
            };
            spinCount: number;
            resolvedCount: number;
            startedAt: string;
            endedAt: string;
            ianaTimezone: string | null;
          }>;
        }>;
      }
    | undefined,
}));

const makeStation = (
  slug: string,
  overrides: Partial<Station> = {},
): Partial<Station> => ({
  slug,
  name: slug.toUpperCase(),
  streamUrl: `https://stream.example/${slug}`,
  stationCategories: [],
  tags: null,
  automationClass: null,
  // Default tier is NOT flagship, so a station only surfaces through the
  // default filter when live or carrying a named show — neither is mocked.
  tier: "standard",
  ...overrides,
});

const STATIONS = [
  // Flagship: passes the default filter even with no live signal/schedule.
  makeStation("kexp", { tier: "flagship", stationCategories: ["anchor"] }),
  // Off-air, non-flagship, no schedule metadata: the case the default filter
  // drops and the main view must still show.
  makeStation("rb-quiet-webstream", { stationCategories: ["discovery"] }),
  makeStation("cfuv-offair", { stationCategories: ["campus"] }),
];

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useListStations: vi.fn(() => ({
      data: { stations: STATIONS },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })),
    useGetStationsSchedule: vi.fn(() => ({
      data: scheduleState.data,
      isLoading: false,
    })),
  });
});

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal);
});

vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const { makeWebplayerHooksMock } = await import("./helpers/webplayerHooksMock");
  return makeWebplayerHooksMock(importOriginal, {
    useWpOnAir: vi.fn(() => ({
      data: onAirState.data,
      isLoading: false,
      dataUpdatedAt: 0,
    })),
  });
});

import { useDialData, type DialStationCategory } from "../src/hooks/useDialData";

function slugsFor(opts: {
  includeAllStations?: boolean;
  categories?: Set<DialStationCategory>;
}): string[] {
  const { result } = renderHook(() => useDialData("personal", opts));
  return result.current.stations.map((s) => s.station.slug).sort();
}

describe("useDialData includeAllStations", () => {
  beforeEach(() => {
    onAirState.data = undefined;
    scheduleState.data = undefined;
  });

  it("default filter drops off-air non-flagship stations without a named show", () => {
    expect(slugsFor({})).toEqual(["kexp"]);
  });

  it("includeAllStations returns every station, off-air ones included", () => {
    expect(slugsFor({ includeAllStations: true })).toEqual([
      "cfuv-offair",
      "kexp",
      "rb-quiet-webstream",
    ]);
  });

  it("off-air stations carry isLive=false so views can render them as offline", () => {
    const { result } = renderHook(() =>
      useDialData("personal", { includeAllStations: true }),
    );
    const bySlug = new Map(
      result.current.stations.map((s) => [s.station.slug, s]),
    );
    expect(bySlug.get("rb-quiet-webstream")?.isLive).toBe(false);
    expect(bySlug.get("cfuv-offair")?.isLive).toBe(false);
  });

  it("metadata-category filter still applies on top of includeAllStations", () => {
    expect(
      slugsFor({ includeAllStations: true, categories: new Set(["campus"]) }),
    ).toEqual(["cfuv-offair"]);
    expect(
      slugsFor({ includeAllStations: true, categories: new Set(["discovery"]) }),
    ).toEqual(["rb-quiet-webstream"]);
  });

  it("keeps one current track while a provider show handoff updates its eligible byline", () => {
    const playedAt = new Date().toISOString();
    const now = {
      mbid: "same-live-track",
      title: "Shared Track",
      artist: "Broadcast Artist",
      artworkUrl: null,
      playedAt,
      freshness: "fresh" as const,
      resolved: true as const,
    };
    const setShow = (name: string, djName: string | null) => {
      onAirState.data = {
        authenticated: false,
        items: [{
          station: { slug: "kexp", name: "KEXP" },
          show: { name, djName },
          now,
          earlier: [],
          matchCount: null,
        }],
      };
    };

    setShow("Morning Transmission", "DJ First");
    const { result, rerender } = renderHook(() =>
      useDialData("personal", { includeAllStations: true }),
    );
    const first = result.current.stations.find((item) => item.station.slug === "kexp")!;
    expect(first.shows).toHaveLength(1);
    expect(first.shows[0]).toMatchObject({
      showName: "Morning Transmission",
      djName: "DJ First",
      currentTrack: { mbid: "same-live-track", title: "Shared Track" },
    });

    setShow("Afternoon Transmission", "DJ Second");
    rerender();
    const handedOff = result.current.stations.find((item) => item.station.slug === "kexp")!;
    expect(handedOff.shows).toHaveLength(1);
    expect(handedOff.shows[0]).toMatchObject({
      showName: "Afternoon Transmission",
      djName: "DJ Second",
      currentTrack: { mbid: "same-live-track", title: "Shared Track" },
    });

    setShow("Artist Takeover", "Broadcast Artist");
    rerender();
    const collision = result.current.stations.find((item) => item.station.slug === "kexp")!;
    expect(collision.shows).toHaveLength(1);
    expect(collision.shows[0]).toMatchObject({
      showName: "Artist Takeover",
      djName: null,
      currentTrack: { mbid: "same-live-track", title: "Shared Track" },
    });
  });

  it("carries only current schedule and provider attribution into artist-action exclusions", () => {
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    scheduleState.data = {
      items: [{
        stationSlug: "kexp",
        stationName: "KEXP",
        ianaTimezone: "America/Los_Angeles",
        runs: [
          {
            runId: 1,
            show: { name: "Current Affairs", djName: "DJ Current", pickerId: null },
            spinCount: 0,
            resolvedCount: 0,
            startedAt: iso(-30 * 60_000),
            endedAt: iso(30 * 60_000),
            ianaTimezone: "America/Los_Angeles",
          },
          {
            runId: 2,
            show: { name: "Grounded Artist", djName: "Past Host", pickerId: null },
            spinCount: 0,
            resolvedCount: 0,
            startedAt: iso(-4 * 60 * 60_000),
            endedAt: iso(-3 * 60 * 60_000),
            ianaTimezone: "America/Los_Angeles",
          },
        ],
      }],
    };
    onAirState.data = {
      authenticated: true,
      items: [{
        station: { slug: "kexp", name: "KEXP" },
        show: { name: "Provider Hour", djName: "Provider Host" },
        now: {
          mbid: "grounded-recording",
          title: "Grounded Track",
          artist: "Grounded Artist",
          artworkUrl: null,
          playedAt: iso(-5_000),
          freshness: "fresh",
          resolved: true,
        },
        earlier: [],
        matchCount: null,
      }],
    };

    const { result } = renderHook(() =>
      useDialData("personal", { includeAllStations: true }),
    );
    const station = result.current.stations.find((item) => item.station.slug === "kexp")!;

    expect(station.artistActionExclusions).toEqual(expect.arrayContaining([
      "Current Affairs",
      "DJ Current",
      "Provider Hour",
      "Provider Host",
    ]));
    expect(station.artistActionExclusions).not.toContain("Grounded Artist");
    expect(station.artistActionExclusions).not.toContain("Past Host");
    expect(station.liveTrack).toMatchObject({
      mbid: "grounded-recording",
      artist: "Grounded Artist",
    });
  });
});
