import { describe, expect, it } from "vitest";
import { collectAlbumTrackPages } from "../src/spotify/appClient.js";

const track = (index: number) => ({
  id: String(index).padStart(22, "0"),
  name: `Track ${index}`,
  track_number: index,
});

describe("Spotify album-track pagination", () => {
  it("collects albums longer than one Spotify page", async () => {
    const offsets: number[] = [];
    const result = await collectAlbumTrackPages(async (offset) => {
      offsets.push(offset);
      return offset === 0
        ? { items: Array.from({ length: 50 }, (_, index) => track(index + 1)), total: 51 }
        : { items: [track(51)], total: 51 };
    });
    expect(offsets).toEqual([0, 50]);
    expect(result.complete).toBe(true);
    expect(result.tracks).toHaveLength(51);
  });

  it("fails closed when a later page is unavailable", async () => {
    const result = await collectAlbumTrackPages(async (offset) =>
      offset === 0
        ? { items: Array.from({ length: 50 }, (_, index) => track(index + 1)), total: 51 }
        : null,
    );
    expect(result).toEqual({ tracks: [], total: 51, complete: false });
  });
});