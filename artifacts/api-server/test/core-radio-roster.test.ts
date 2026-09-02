import { describe, expect, it } from "vitest";
import {
  CORE_RADIO_ADDITION_SLUGS,
  SEED_STATIONS,
} from "../src/lore/seed.js";
import { deriveStationCategories } from "../src/routes/lore/shared.js";
import type { Station } from "@workspace/db";

describe("Core Radio additions", () => {
  it("reuses exactly one stable seed identity for each requested station", () => {
    expect(CORE_RADIO_ADDITION_SLUGS).toHaveLength(8);
    expect(new Set(CORE_RADIO_ADDITION_SLUGS).size).toBe(8);
    for (const slug of CORE_RADIO_ADDITION_SLUGS) {
      expect(SEED_STATIONS.filter((station) => station.slug === slug), slug).toHaveLength(1);
    }
  });

  it("classifies all eight under the compatible internal anchor key", () => {
    for (const slug of CORE_RADIO_ADDITION_SLUGS) {
      expect(deriveStationCategories({
        slug,
        tags: SEED_STATIONS.find((station) => station.slug === slug)?.tags ?? null,
        sleepMode: false,
        eraGenreMode: false,
      } as Station), slug).toEqual(["anchor"]);
    }
  });

  it("keeps the two new rows playable and source-honest", () => {
    for (const slug of ["wwoz", "kutx"]) {
      const station = SEED_STATIONS.find((candidate) => candidate.slug === slug);
      expect(station?.streamUrl.startsWith("https://"), slug).toBe(true);
      expect(station?.nowPlayingSource, slug).toBe("radio_browser_icy");
      expect((station?.nowPlayingConfig as { streamUrl?: string }).streamUrl, slug)
        .toBe(station?.streamUrl);
    }
  });
});