// @vitest-environment jsdom
/**
 * useDialData — metadata-category filtering (/anchor, /campus, /public,
 * /indie, /discovery).
 *
 * These categories don't trigger extra server fetches: the hook filters the
 * already-fetched Lore station list client-side using the server-supplied
 * single-value `stationCategories` array on each station.
 *
 * Contract under test (additive multi-select taxonomy):
 *  - each metadata category restricts tagged stations to that label
 *  - multiple checked metadata categories UNION their stations (a station
 *    matching any checked category renders)
 *  - stations with stationCategories: [] (or absent) remain in the direct
 *    "Other stations" fallback under every metadata filter
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
    useListStations: vi.fn((params?: { mode?: string }) => {
      // This suite covers editorial metadata filtering only. The hook also
      // asks for disabled sleep/specialist queries, so return empty mode pools
      // rather than accidentally treating the normal fixture list as one.
      const stations = params?.mode === "sleep" || params?.mode === "era-genre" ? [] : STATIONS;
      return {
        data: { stations },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    }),
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

  it("/anchor restricts tagged stations while preserving Other stations", () => {
    expect(slugsFor(new Set(["anchor"]))).toEqual(["kexp", "no-cats", "nts-1"]);
  });

  it("/campus restricts tagged stations while preserving Other stations", () => {
    expect(slugsFor(new Set(["campus"]))).toEqual(["cfuv", "no-cats", "wprb"]);
  });

  it("/public restricts tagged stations while preserving Other stations", () => {
    expect(slugsFor(new Set(["public"]))).toEqual(["no-cats", "wbgo"]);
  });

  it("/indie restricts tagged stations while preserving Other stations", () => {
    expect(slugsFor(new Set(["indie"]))).toEqual(["balamii", "no-cats"]);
  });

  it("/discovery restricts tagged stations while preserving Other stations", () => {
    expect(slugsFor(new Set(["discovery"]))).toEqual(["no-cats", "rb-discovery"]);
  });

  it("stations with empty stationCategories stay reachable under every metadata filter", () => {
    for (const cat of ["anchor", "campus", "public", "indie", "discovery"] as const) {
      expect(slugsFor(new Set([cat]))).toContain("no-cats");
    }
  });

  it("multiple checked categories union their stations (no duplicates)", () => {
    expect(slugsFor(new Set(["campus", "anchor"]))).toEqual(
      ["cfuv", "kexp", "no-cats", "nts-1", "wprb"],
    );
  });

  it("unioning every metadata category retains uncategorized stations", () => {
    expect(slugsFor(new Set(["anchor", "campus", "public", "indie", "discovery"]))).toEqual(
      ["balamii", "cfuv", "kexp", "no-cats", "nts-1", "rb-discovery", "wbgo", "wprb"],
    );
  });
});
