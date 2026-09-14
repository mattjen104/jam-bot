// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRadioCatalogParams, joinCatalogRows } from "../src/hooks/useRadioCatalog";
import { useRadioCatalog } from "../src/hooks/useRadioCatalog";
import { createRadioBrowseState } from "../src/lib/radioBrowseState";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("radio catalog read model bridge", () => {
  it("keeps locality device-local while sending it only to the catalog request", () => {
    const state = createRadioBrowseState({ locality: { zip: "02139" } });
    const params = buildRadioCatalogParams(state, false);
    expect(params.get("lens")).toBe("local");
    expect(params.get("zip")).toBe("02139");
    expect(params.toString()).toContain("zip=02139");
  });

  it("uses an all-catalog cold start without claiming personalization", () => {
    const state = { ...createRadioBrowseState(), sort: "nearest" as const };
    const params = buildRadioCatalogParams(state, false);
    expect(params.get("lens")).toBe("all");
    expect(params.get("limit")).toBe("4");
    expect(params.get("offset")).toBe("0");
    expect(params.get("sort")).toBe("recommended");
    expect(params.get("zip")).toBeNull();
  });

  it("requests each four-station page from the server", () => {
    const first = buildRadioCatalogParams({ ...createRadioBrowseState(), page: 1 }, false);
    const second = buildRadioCatalogParams({ ...createRadioBrowseState(), page: 2 }, false);
    expect(first.get("limit")).toBe("4");
    expect(first.get("offset")).toBe("0");
    expect(second.get("limit")).toBe("4");
    expect(second.get("offset")).toBe("4");
    expect(second.toString()).not.toBe(first.toString());
  });

  it("resolves the first page with one request, then asks the server for page two", async () => {
    const response = {
      stations: [],
      items: [],
      metadata: {
        lens: "all",
        sort: "recommended",
        claim: "Catalog order",
        eligibleCount: 531,
        returnedCount: 0,
        omittedUnknownLocation: 0,
        filters: { stationTypes: [], formats: [], decades: [] },
        semantics: { withinFamily: "or", betweenFamilies: "and" },
        partial: { locality: false, personalization: false },
        locality: null,
        radiusMiles: null,
        personalCrossings: false,
      },
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => response,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ page }) => useRadioCatalog({ ...createRadioBrowseState(), page }, false),
      { initialProps: { page: 1 } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=4");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("offset=0");
    rerender({ page: 2 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("limit=4");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("offset=4");
  });

  it("never re-inserts an operational row omitted by the catalog", () => {
    const rows = [{ slug: "kept" }, { slug: "omitted" }, { slug: "also-kept" }];
    expect(joinCatalogRows(
      ["also-kept", "omitted", "missing"],
      rows,
      (row) => row.slug,
      (row) => row.slug !== "omitted",
    )).toEqual([{ slug: "also-kept" }]);
  });

  it("uses canonical API vocabulary in request filters", () => {
    const state = {
      ...createRadioBrowseState(),
      filters: {
        ...createRadioBrowseState().filters,
        stationTypes: ["independent-dj" as const],
        specialistFormats: ["jazz" as const],
        decades: ["1980s" as const],
      },
    };
    const params = buildRadioCatalogParams(state, false);
    expect(params.get("stationType")).toBe("independent-dj");
    expect(params.get("format")).toBe("jazz");
    expect(params.get("decade")).toBe("1980s");
  });

  it("sends every server-owned filter and changes the catalog key", () => {
    const base = createRadioBrowseState({ locality: { zip: "02139" } });
    const filtered = {
      ...base,
      filters: {
        ...base.filters,
        playingNow: ["deep" as const],
        broZones: ["seattle" as const],
        followedOnly: true,
        supportOnly: true,
      },
    };
    const params = buildRadioCatalogParams(filtered, false);
    expect(params.get("playing")).toBe("deep");
    expect(params.get("broZones")).toBe("seattle");
    expect(params.get("followed")).toBe("1");
    expect(params.get("support")).toBe("1");
    expect(params.toString()).not.toBe(buildRadioCatalogParams(base, false).toString());
  });

  it("sends a bounded artist focus only through For You", () => {
    const state = {
      ...createRadioBrowseState(),
      lens: "for-you" as const,
      focusedArtist: "  A\u0000  Very   Loud Artist  ",
    };
    expect(buildRadioCatalogParams(state, true).get("artist")).toBe("A Very Loud Artist");
    expect(buildRadioCatalogParams({ ...state, lens: "all" }, true).get("artist")).toBeNull();
  });
});