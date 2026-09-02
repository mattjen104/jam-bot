import { describe, expect, it } from "vitest";
import {
  computeRecentStationProfile,
  isPollutedStationSpin,
} from "../src/lore/genre-insights.js";

const now = new Date("2026-09-02T12:00:00.000Z");

function spin(index: number, overrides: Record<string, unknown> = {}) {
  return {
    mbid: `mbid-${index}`,
    artistMbid: `artist-${index}`,
    artist: `Artist ${index}`,
    title: `Track ${index}`,
    rawArtist: `Artist ${index}`,
    rawTitle: `Track ${index}`,
    showName: null,
    djName: null,
    genres: ["rock"],
    releaseYear: 2024,
    playedAt: new Date(now.getTime() - index * 60_000),
    ...overrides,
  };
}

describe("recent station profile", () => {
  it("keeps unresolved clean spins in the denominator and excludes labels", () => {
    const result = computeRecentStationProfile(
      [
        spin(1),
        spin(2, { mbid: null, artistMbid: null, artist: null, rawArtist: "The station", showName: "The station" }),
        spin(3, { mbid: null, artistMbid: null, artist: null, rawArtist: "Unknown", rawTitle: "Track 3" }),
      ],
      { stationName: "Station FM", now },
    );

    expect(result.profile.sampleSize).toBe(1);
    expect(result.profile.resolvedCount).toBe(1);
    expect(result.profile.excludedCount).toBe(2);
    expect(result.profile.resolutionRate).toBe(1);
    expect(result.freshness.sampleSize).toBe(1);
  });

  it("computes readiness from stored fact thresholds and freshness", () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      spin(index, {
        artistMbid: `artist-${index % 30}`,
        artist: `Artist ${index % 30}`,
        rawArtist: `Artist ${index % 30}`,
      }),
    );
    const result = computeRecentStationProfile(rows, { now });
    expect(result.profile.uniqueTrackCount).toBe(50);
    expect(result.profile.uniqueArtistCount).toBe(30);
    expect(result.profile.readinessTier).toBe("ready");

    const stale = computeRecentStationProfile(
      rows.map((row) => ({
        ...row,
        playedAt: new Date("2026-07-01T12:00:00.000Z"),
      })),
      { now },
    );
    expect(stale.profile.readinessTier).toBe("insufficient");
    expect(stale.freshness.hasRecentUsableSpin).toBe(false);
  });

  it("recognizes station and show pollution before aggregation", () => {
    expect(isPollutedStationSpin({
      ...spin(1),
      rawArtist: "Night Drive",
      showName: "Night Drive",
    })).toBe(true);
    expect(isPollutedStationSpin({
      ...spin(1),
      rawArtist: "Björk",
      rawTitle: "Jóga",
    })).toBe(false);
  });
});