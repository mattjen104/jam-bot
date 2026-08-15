// @vitest-environment jsdom
/**
 * useDialData — metadata-category filtering (/anchor, /campus, /public,
 * /indie, /discovery).
 *
 * These categories don't trigger extra server fetches: the hook filters the
 * already-fetched Lore station list client-side using the server-supplied
 * single-value `stationCategories` array on each station.
 *
 * Contract under test (single-select taxonomy):
 *  - each metadata category restricts to stations carrying exactly that label
 *  - stations with stationCategories: [] (or absent) never match a metadata
 *    filter
 *  - an empty categories set applies no filter (legacy/no-filter path)
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
  // flagship-tier stations always pass the dial's surface filter (no live
  // signal or schedule data in this mock), keeping the test focused on the
  // metadata-category filter itself.
  tier: "flagship",
});

const STATIONS = [
  makeStation("wprb", ["campus"]),
  makeStation("kexp", ["anchor"]),
  makeStation("rb-discovery", ["discovery"]),
  makeStation("cfuv", ["campus"]),
  makeStation("nts-1", ["anchor"]),
  makeStation("wbgo", ["public"]),
  makeStation("balamii", ["indie"]),
  makeStation("no-cats", []),
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
  it("an empty categories set applies no filter (every station renders)", () => {
    expect(slugsFor(new Set())).toEqual(
      ["balamii", "cfuv", "kexp", "no-cats", "nts-1", "rb-discovery", "wbgo", "wprb"],
    );
  });

  it("/anchor restricts to stations labeled anchor", () => {
    expect(slugsFor(new Set(["anchor"]))).toEqual(["kexp", "nts-1"]);
  });

  it("/campus restricts to stations labeled campus", () => {
    expect(slugsFor(new Set(["campus"]))).toEqual(["cfuv", "wprb"]);
  });

  it("/public restricts to stations labeled public", () => {
    expect(slugsFor(new Set(["public"]))).toEqual(["wbgo"]);
  });

  it("/indie restricts to stations labeled indie", () => {
    expect(slugsFor(new Set(["indie"]))).toEqual(["balamii"]);
  });

  it("/discovery restricts to stations labeled discovery", () => {
    expect(slugsFor(new Set(["discovery"]))).toEqual(["rb-discovery"]);
  });

  it("stations with empty stationCategories never match a metadata filter", () => {
    for (const cat of ["anchor", "campus", "public", "indie", "discovery"] as const) {
      expect(slugsFor(new Set([cat]))).not.toContain("no-cats");
    }
  });
});
