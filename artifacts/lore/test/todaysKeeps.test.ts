import { describe, expect, it } from "vitest";
import type { LibraryItem } from "../src/lib/meHooks";
import {
  getTodaysActiveKeeps,
  hasCrossedTodaysBoundary,
} from "../src/lib/todaysKeeps";

function item(
  mbid: string,
  addedAt: string,
  options: { removed?: boolean; resolved?: boolean } = {},
): LibraryItem {
  return {
    mbid,
    addedAt,
    removed: options.removed,
    provenance: { kind: "keep" },
    recording: options.resolved === false
      ? null
      : {
          title: `Track ${mbid}`,
          artist: "Artist",
          artworkUrl: null,
          albumTitle: null,
          spotifyUrl: null,
        },
  };
}

describe("today's keeps", () => {
  const now = new Date(2026, 8, 9, 15, 0);

  it("fills the bounded result past removed and unresolved recent rows", () => {
    const todayAt = (hour: number) => new Date(2026, 8, 9, hour).toISOString();
    const items = [
      ...Array.from({ length: 6 }, (_, index) =>
        item(`removed-${index}`, todayAt(14 - index), { removed: true })),
      item("unresolved", todayAt(8), { resolved: false }),
      ...Array.from({ length: 7 }, (_, index) =>
        item(`active-${index}`, todayAt(7 - index))),
    ];

    expect(getTodaysActiveKeeps(items, now).map((keep) => keep.mbid)).toEqual([
      "active-0",
      "active-1",
      "active-2",
      "active-3",
      "active-4",
      "active-5",
    ]);
  });

  it("stops pagination only after rows cross the local day boundary", () => {
    const today = [item("today", new Date(2026, 8, 9, 1).toISOString())];
    const yesterday = item("yesterday", new Date(2026, 8, 8, 23).toISOString());

    expect(hasCrossedTodaysBoundary(today, now)).toBe(false);
    expect(hasCrossedTodaysBoundary([...today, yesterday], now)).toBe(true);
  });
});