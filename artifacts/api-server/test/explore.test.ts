import { describe, expect, it } from "vitest";
import { composeExplore, type ExploreCandidate, type ExploreMode } from "../src/routes/explore.js";

const candidate = (slug: string, overrides: Partial<ExploreCandidate> = {}): ExploreCandidate => ({
  station: { slug, name: slug, city: null, region: null, latitude: null, longitude: null },
  show: null, recentProfile: null, freshness: null, discoveryScore: null,
  artistCount: 0, crossingCount: 0, exactGenre: false, adjacentGenre: false,
  ...overrides,
});

describe("composeExplore", () => {
  it.each<[ExploreMode, Partial<ExploreCandidate>, Partial<ExploreCandidate>]>([
    ["artist", { artistCount: 5 }, { artistCount: 1 }],
    ["library-crossing", { crossingCount: 4 }, { crossingCount: 1 }],
    ["genre", { exactGenre: true }, { adjacentGenre: true }],
    ["newness", { discoveryScore: 90 }, { discoveryScore: 40 }],
  ])("ranks %s evidence transparently", (mode, strong, weak) => {
    expect(composeExplore([candidate("weak", weak), candidate("strong", strong)], mode, 2)[0]!.station.slug).toBe("strong");
  });

  it("keeps unattributed live stations honest", () => {
    const result = composeExplore([candidate("live")], "station", 1)[0]!;
    expect(result.show).toBeNull();
    expect(result.timing).toBeNull();
  });
});