import { describe, expect, test } from "vitest";
import type { DialSpin, DialStation } from "../src/hooks/useDialData";
import { demoStationEvidence } from "../src/lib/demoStationEvidence";

function spin(
  artist: string,
  artistMbid: string,
  playedAt: string,
  isLibraryHit = false,
): DialSpin {
  return {
    artist,
    artistMbid,
    title: `${artist} song`,
    mbid: `${artistMbid}-recording`,
    isrc: null,
    spotifyId: null,
    playedAt,
    isLibraryHit,
    isArtistHit: false,
    freshness: "fresh",
    resolving: false,
  };
}

function station(overrides: Partial<DialStation> = {}): DialStation {
  return {
    station: { slug: "test", name: "Test FM" },
    shows: [],
    isLive: false,
    topArtistNames7d: [],
    ...overrides,
  } as DialStation;
}

describe("demo station evidence", () => {
  test("uses the three latest distinct validated artists for an empty Library", () => {
    const now = new Date().toISOString();
    const evidence = demoStationEvidence(station({
      isLive: true,
      shows: [{
        state: "live",
        spins: [
          spin("Broadcast metadata", "", now),
          spin("Broadcast", "artist-b", now),
          spin("Broadcast", "artist-b", now),
          spin("Can", "artist-c", now),
          spin("Stereolab", "artist-s", now),
          spin("Fourth", "artist-4", now),
        ],
      }],
    }), false);

    expect(evidence.kind).toBe("current-set");
    expect(evidence.lead).toBe("This set");
    expect(evidence.artists.map((artist) => artist.name)).toEqual([
      "Broadcast",
      "Can",
      "Stereolab",
    ]);
  });

  test("focus copy reflects the focused artist rather than general station overlap", () => {
    const now = new Date().toISOString();
    const evidence = demoStationEvidence(station({
      isLive: true,
      sevenDayCrossingCount: 12,
      topArtistNames7d: ["Can", "Stereolab"],
      shows: [{
        state: "live",
        spins: [
          spin("Stereolab", "artist-s", now, true),
          spin("Can", "artist-c", now, true),
        ],
      }],
    }), true, "Stereolab", "artist-s");

    expect(evidence.kind).toBe("crossings");
    expect(evidence.lead).toBe("1 crossing this week");
    expect(evidence.artists).toEqual([{ name: "Stereolab", artistMbid: "artist-s" }]);
  });

  test("counts artist-only weekly crossings for focused ordering and copy", () => {
    const now = new Date().toISOString();
    const artistOnly = {
      ...spin("Stereolab", "artist-s", now),
      isArtistHit: true,
    };
    const evidence = demoStationEvidence(station({
      shows: [{ state: "past", spins: [artistOnly] }],
    }), true, "Stereolab", "artist-s");

    expect(evidence.kind).toBe("crossings");
    expect(evidence.lead).toBe("1 crossing this week");
  });

  test("does not invent current-set or recent evidence from an all-history match", () => {
    const evidence = demoStationEvidence(station(), true, "Stereolab");
    expect(evidence.kind).toBe("none");
  });
});