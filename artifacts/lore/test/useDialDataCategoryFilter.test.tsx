// @vitest-environment jsdom
/**
 * useDialData — metadata-category filtering (/spinitron, /college, /longtail).
 *
 * These categories don't trigger extra server fetches: the hook filters the
 * already-fetched Lore station list client-side using the server-supplied
 * `stationCategories` array on each station.
 *
 * Contract under test:
 *  - lore-only (default): no filtering, every station renders
 *  - a single metadata category restricts to stations carrying that label
 *  - multiple metadata categories union their matches
 *  - metadata categories WITHOUT lore still fetch the base list and filter it
 *  - stations with stationCategories: [] (or absent) never match a metadata
 *    filter but always pass when no metadata filter is active
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Station } from "@workspace/api-client-react";

const makeStation = (slug: string, stationCategories: string[]): Partial<Station> => ({
  slug,
  name: slug.toUpperCase(),
  streamUrl: `https://stream.example/${slug}`,
  stationCategories,
  tags: null,
  automationClass: null,
  // flagship stations always pass the dial's surface filter (no live signal
  // or schedule data in this mock), keeping the test focused on the
  // metadata-category filter itself.
  tier: "flagship",
});

const STATIONS = [
  makeStation("wprb", ["spinitron", "college"]),
  makeStation("kexp", []),
  makeStation("rb-longtail", ["longtail"]),
  makeStation("cfuv", ["college"]),
  makeStation("nts-1", []),
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

import { useDialData, type DialStationCategory } from "../src/hooks/useDialData";

function slugsFor(categories: Set<DialStationCategory>): string[] {
  const { result } = renderHook(() =>
    useDialData("personal", { categories }),
  );
  return result.current.stations.map((s) => s.station.slug).sort();
}

describe("useDialData metadata-category filter", () => {
  it("lore alone shows every station (no metadata filter)", () => {
    expect(slugsFor(new Set(["lore"]))).toEqual(
      ["cfuv", "kexp", "nts-1", "rb-longtail", "wprb"],
    );
  });

  it("/spinitron restricts to stations labeled spinitron", () => {
    expect(slugsFor(new Set(["lore", "spinitron"]))).toEqual(["wprb"]);
  });

  it("/college restricts to stations labeled college", () => {
    expect(slugsFor(new Set(["lore", "college"]))).toEqual(["cfuv", "wprb"]);
  });

  it("/longtail restricts to stations labeled longtail", () => {
    expect(slugsFor(new Set(["lore", "longtail"]))).toEqual(["rb-longtail"]);
  });

  it("multiple metadata categories union their matches", () => {
    expect(slugsFor(new Set(["lore", "college", "longtail"]))).toEqual(
      ["cfuv", "rb-longtail", "wprb"],
    );
  });

  it("metadata category without lore still filters the base list", () => {
    expect(slugsFor(new Set(["college"]))).toEqual(["cfuv", "wprb"]);
  });

  it("stations with empty stationCategories never match a metadata filter", () => {
    const slugs = slugsFor(new Set(["lore", "spinitron", "college", "longtail"]));
    expect(slugs).not.toContain("kexp");
    expect(slugs).not.toContain("nts-1");
  });
});
