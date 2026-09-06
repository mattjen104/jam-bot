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
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Station } from "@workspace/api-client-react";

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
      data: undefined,
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
});
