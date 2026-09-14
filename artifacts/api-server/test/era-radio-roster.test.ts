import { describe, expect, it } from "vitest";
import {
  ERA_RADIO_ADDITION_SLUGS,
  SEED_STATIONS,
} from "../src/lore/seed.js";

describe("curated era radio additions", () => {
  it("adds only the eight stations needed to close the catalog gaps", () => {
    expect(ERA_RADIO_ADDITION_SLUGS).toHaveLength(8);
    expect(new Set(ERA_RADIO_ADDITION_SLUGS).size).toBe(8);
    const counts = new Map<string, number>();
    for (const slug of ERA_RADIO_ADDITION_SLUGS) {
      const matches = SEED_STATIONS.filter((station) => station.slug === slug);
      expect(matches, slug).toHaveLength(1);
      const station = matches[0]!;
      const decade = station.tags?.find((tag) => /^(50s|60s|2000s)$/.test(tag));
      expect(decade, slug).toBeTruthy();
      counts.set(decade!, (counts.get(decade!) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({ "50s": 4, "60s": 2, "2000s": 2 });
  });

  it("keeps every addition playable, explicitly classified, and non-polling", () => {
    for (const slug of ERA_RADIO_ADDITION_SLUGS) {
      const station = SEED_STATIONS.find((candidate) => candidate.slug === slug)!;
      expect(station.streamUrl, slug).toMatch(/^https:\/\//);
      expect(station.streamFormat, slug).toBe("mp3");
      expect(station.tags, slug).toContain("specialist");
      expect(station.tags, slug).toContain("era");
      expect(station.nowPlayingSource, slug).toBeNull();
      expect(station.favorite, slug).toBe(false);
      expect(station.hidden, slug).toBe(false);
    }
  });
});