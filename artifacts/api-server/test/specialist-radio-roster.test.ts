import { describe, expect, it } from "vitest";
import {
  SEED_STATIONS,
  SPECIALIST_RADIO_SLUGS,
} from "../src/lore/seed.js";
import { supportsBackfill } from "../src/lore/adapters.js";

describe("Specialist Radio roster", () => {
  it("contains exactly 21 unique stations including the instrumental addition", () => {
    expect(SPECIALIST_RADIO_SLUGS).toHaveLength(21);
    expect(new Set(SPECIALIST_RADIO_SLUGS).size).toBe(21);
    expect(SPECIALIST_RADIO_SLUGS).toEqual(expect.arrayContaining([
      "kiosk-radio", "lahmacun-radio", "oroko-radio", "lyl-radio",
      "8ball-radio", "boxout-fm", "cashmere-radio",
      "nightride-chillsynth",
    ]));
  });

  it("has one reproducible seed per roster identity", () => {
    for (const slug of SPECIALIST_RADIO_SLUGS) {
      const seeds = SEED_STATIONS.filter((station) => station.slug === slug);
      expect(seeds, slug).toHaveLength(1);
    }
  });

  it("enrolls five timestamped histories in cursor-safe backfill", () => {
    const backfillable = SPECIALIST_RADIO_SLUGS
      .map((slug) => SEED_STATIONS.find((station) => station.slug === slug))
      .filter((station) => supportsBackfill(station?.nowPlayingSource));
    expect(backfillable).toHaveLength(5);
    expect(backfillable.filter((station) => station?.nowPlayingSource === "somafm")).toHaveLength(4);
    expect(backfillable.find((station) => station?.slug === "kexp")?.nowPlayingSource).toBe("kexp_api");
    expect(backfillable.filter((station) => station?.nowPlayingSource === "somafm").every((station) =>
      typeof (station.nowPlayingConfig as { channel?: unknown }).channel === "string"
    )).toBe(true);
  });

  it("keeps mandatory metadata-free stations playable without a poller", () => {
    for (const slug of ["8ball-radio", "boxout-fm", "cashmere-radio"]) {
      const station = SEED_STATIONS.find((candidate) => candidate.slug === slug);
      expect(station?.streamUrl, slug).toBeTruthy();
      expect(station?.nowPlayingSource, slug).toBeNull();
    }
  });

  it("seeds the verified instrumental channel with official evidence and honest ICY metadata", () => {
    const station = SEED_STATIONS.find(
      (candidate) => candidate.slug === "nightride-chillsynth",
    );
    expect(station).toMatchObject({
      streamUrl: "https://stream.nightride.fm/chillsynth.mp3",
      streamQuality: "320kbps MP3",
      nowPlayingSource: "radio_browser_icy",
      automationClass: "automated",
      source: "curated",
    });
    expect(station?.tags).toEqual(expect.arrayContaining([
      "specialist",
      "instrumental",
    ]));
    expect(station?.nowPlayingConfig).toMatchObject({
      instrumentalClaim: true,
      evidenceUrl: "https://nightride.fm/",
    });
  });
});