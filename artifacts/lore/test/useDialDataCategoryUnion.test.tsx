// @vitest-environment jsdom
/**
 * useDialData — additive union across station-type families.
 *
 * The seven categories draw from three sources:
 *   - ambient    → the sleep-mode server list
 *   - specialist → the era-genre-mode server list
 *   - the rest   → the normal Lore list, filtered client-side by the
 *                  server-supplied `stationCategories` labels
 *
 * Contract under test:
 *  - Ambient-only / Specialist-only selections show ONLY their mode pool —
 *    the normal list is not requested, and even a warm react-query cache
 *    (simulated here: the mock returns data regardless of `enabled`) must
 *    not leak normal stations into the result.
 *  - A mode category combined with a metadata category unions both sources;
 *    a station present in BOTH the normal list and the mode pool still
 *    renders (deduplicated) and counts as always-live, even when it lacks
 *    the checked metadata label.
 *  - Ambient + Specialist unions both pools without touching the normal list.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Station } from "@workspace/api-client-react";
import type { ReactNode } from "react";

const makeStation = (
  id: number,
  slug: string,
  stationCategories: string[],
): Partial<Station> => ({
  id,
  slug,
  name: slug.toUpperCase(),
  streamUrl: `https://stream.example/${slug}`,
  stationCategories,
  tags: null,
  automationClass: null,
  // flagship-tier stations always pass the dial's surface filter, keeping the
  // test focused on the union/filter logic itself.
  tier: "flagship",
});

// "dual" is present in the normal list (id 90) AND the sleep pool — the
// overlap case: deduped by id, but its pool membership must still count.
const NORMAL = [
  makeStation(90, "dual", []),
  makeStation(1, "wprb", ["campus"]),
  makeStation(2, "kexp", ["anchor"]),
];
const SLEEP = [
  makeStation(90, "dual", []),
  makeStation(10, "sleepy", []),
];
const ERA_GENRE = [
  makeStation(20, "fip-jazz", []),
  // Specialist mode deliberately includes normal-dial-hidden genre stations.
  // The explicit Specialist category is their listener-facing escape hatch.
  { ...makeStation(21, "hidden-ambient", []), hidden: true },
];

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useListStations: vi.fn((params?: { mode?: string }) => ({
      data: {
        stations:
          params?.mode === "sleep"
            ? SLEEP
            : params?.mode === "era-genre"
              ? ERA_GENRE
              : NORMAL,
      },
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

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function dialData(categories: Set<DialStationCategory>) {
  const { result } = renderHook(() =>
    useDialData("personal", { categories }),
    { wrapper: Wrapper },
  );
  return result.current.stations;
}

function slugsFor(categories: Set<DialStationCategory>): string[] {
  return dialData(categories).map((s) => s.station.slug).sort();
}

describe("useDialData category union — mode pools", () => {
  it("ambient-only shows only the sleep pool (warm normal cache does not leak)", () => {
    expect(slugsFor(new Set(["ambient"]))).toEqual(["dual", "sleepy"]);
  });

  it("specialist-only shows the complete era-genre pool, including normal-dial-hidden stations", () => {
    expect(slugsFor(new Set(["specialist"]))).toEqual(["fip-jazz", "hidden-ambient"]);
    expect(dialData(new Set(["specialist"])).map((station) => station.station.stationCategories))
      .toEqual([["specialist"], ["specialist"]]);
  });

  it("mode-pool stations render as always-live; normal-list-only stations follow the live pulse", () => {
    const stations = dialData(new Set(["ambient", "campus"]));
    const isLive = (slug: string) =>
      stations.find((s) => s.station.slug === slug)?.isLive;
    // sleep-pool members (including the overlap station) are always live…
    expect(isLive("sleepy")).toBe(true);
    expect(isLive("dual")).toBe(true);
    // …the campus normal-list station is not (no now-playing data in the mock).
    expect(isLive("wprb")).toBe(false);
  });

  it("ambient + campus unions both sources; the overlap station survives without a campus label", () => {
    const slugs = slugsFor(new Set(["ambient", "campus"]));
    expect(slugs).toEqual(["dual", "sleepy", "wprb"]);
    // "dual" appears exactly once despite being in both sources.
    expect(slugs.filter((s) => s === "dual")).toHaveLength(1);
  });

  it("ambient + specialist unions both pools without touching the normal list", () => {
    expect(slugsFor(new Set(["ambient", "specialist"]))).toEqual(
      ["dual", "fip-jazz", "hidden-ambient", "sleepy"],
    );
  });

  it("metadata-only unions still exclude mode pools that were not checked", () => {
    expect(slugsFor(new Set(["campus", "anchor"]))).toEqual(["kexp", "wprb"]);
  });
});
