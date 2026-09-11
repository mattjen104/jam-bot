import { describe, expect, it } from "vitest";
import {
  empiricalBayesCrossingScore,
  hasCrossingScoreShape,
  pooledCrossingScorePrior,
} from "../src/routes/me/crossings.js";

describe("crossing empirical-Bayes score", () => {
  it("uses pooled exposure rather than a fixed prior", () => {
    const prior = pooledCrossingScorePrior([
      { crossings: 1, artistCrossings: 0, resolvedExposure: 10 },
      { crossings: 20, artistCrossings: 0, resolvedExposure: 100 },
    ]);
    expect(prior.mean).toBeCloseTo(21 / 110);
    expect(empiricalBayesCrossingScore(1, 10, prior))
      .toBeGreaterThan(empiricalBayesCrossingScore(1, 100, prior));
  });

  it("has a deterministic fallback for zero pooled exposure", () => {
    const prior = pooledCrossingScorePrior([]);
    expect(prior.mean).toBe(0.05);
    expect(empiricalBayesCrossingScore(0, 0, prior)).toBe(0.05);
  });

  it("ties identical rates after smoothing and bounds malformed inputs", () => {
    const prior = pooledCrossingScorePrior([
      { crossings: 1, artistCrossings: 0, resolvedExposure: 10 },
      { crossings: 1, artistCrossings: 0, resolvedExposure: 10 },
    ]);
    expect(empiricalBayesCrossingScore(1, 10, prior))
      .toBe(empiricalBayesCrossingScore(1, 10, prior));
    expect(empiricalBayesCrossingScore(99, 1, prior)).toBeLessThanOrEqual(1);
  });

  it("rejects missing, NaN, and negative cache score fields", () => {
    const row = {
      stationSlug: "s", crossings: 1, artistCrossings: 0,
      weekCrossings: 1, weekArtistCrossings: 0, monthCrossings: 1,
      monthArtistCrossings: 0, lifetimeCrossings: 1, lifetimeArtistCrossings: 0,
      resolvedTracks24h: 1, resolvedTracks7d: 1, resolvedTracks30d: 1,
      resolvedTracksLifetime: 1, score24h: 0.5, score7d: 0.5,
      score30d: 0.5, scoreLifetime: 0.5,
    };
    expect(hasCrossingScoreShape([row])).toBe(true);
    expect(hasCrossingScoreShape([{ ...row, score24h: Number.NaN }])).toBe(false);
    expect(hasCrossingScoreShape([{ ...row, resolvedTracks7d: -1 }])).toBe(false);
    expect(hasCrossingScoreShape([{ ...row, score30d: undefined }])).toBe(false);
  });
});