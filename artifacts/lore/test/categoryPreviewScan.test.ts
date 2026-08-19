import { describe, expect, it } from "vitest";
import { buildCategoryPreviewQueue } from "../src/player/categoryPreviewScan";

const stations = [
  { slug: "a", name: "A", stationCategories: ["campus"] },
  { slug: "b", name: "B", stationCategories: ["public"] },
] as any;

describe("buildCategoryPreviewQueue", () => {
  it("keeps only resolved first plays in the category, newest first, once per MBID", () => {
    const result = buildCategoryPreviewQueue("campus", stations, new Map([
      ["a", [
        { mbid: "old", artist: "A", title: "Old", playedAt: "2026-08-18T10:00:00Z", isFirstSpin: true },
        { mbid: "same", artist: "A", title: "Same", playedAt: "2026-08-19T10:00:00Z", isFirstSpin: true },
        { mbid: null, artist: "A", title: "Unresolved", isFirstSpin: true },
        { mbid: "not-new", artist: "A", title: "No", isFirstSpin: false },
      ]],
      ["b", [{ mbid: "wrong-category", artist: "B", title: "No", isFirstSpin: true }]],
    ]));
    expect(result.map((track) => track.mbid)).toEqual(["same", "old"]);
    expect(result[0]).toMatchObject({ stationSlug: "a", category: "campus" });
  });

  it("returns an empty queue when the category has no eligible spins", () => {
    expect(buildCategoryPreviewQueue("indie", stations, new Map())).toEqual([]);
  });
});