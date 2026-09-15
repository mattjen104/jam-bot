// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Station } from "@workspace/db";
import {
  getStationDescription,
  getStationProfile,
  STATION_PROFILES,
} from "../src/lore/station-descriptions.js";
import { toStation } from "../src/routes/lore/shared.js";

const EXPECTED_SLUGS = [
  "amazing-radio",
  "bbc-6music",
  "cjlo",
  "dublab",
  "fbi-radio",
  "fip-electro",
  "fip-groove",
  "fip-jazz",
  "fip-main",
  "fip-metal",
  "fip-reggae",
  "fip-rock",
  "fip-world",
  "glacer-fm",
  "kcrw-eclectic24",
  "kdvs",
  "kutx",
  "kool-fm",
  "kucr",
  "kuvo",
  "kvrx",
  "kalx",
  "kexp",
  "kxlu",
  "nts-1",
  "nts-2",
  "radio-k",
  "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f",
  "soho-radio",
  "the-lot-radio",
  "voices-radio",
  "wfmu",
  "wpfw",
  "wknc",
  "wmbr",
  "wprb",
  "wruw",
  "wusb",
  "wxyc",
  "wxdu",
  "wwoz",
  "wrek",
  "whrb",
  "wjcu",
  "wuog",
  "wvum",
  "worldwide-fm",
  "xray-fm",
  "wkcr",
  "wnur",
] as const;

const BRO_ZONE_SLUGS = [
  "kexp",
  "dublab",
  "kcrw-eclectic24",
  "kxlu",
  "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f",
  "kucr",
  "wpfw",
  "wknc",
  "wxdu",
  "wxyc",
  "xray-fm",
  "kuvo",
  "wruw",
  "wjcu",
] as const;

const MISSION_STATION_SLUGS = [
  "wwoz",
  "wfmu",
  "dublab",
  "the-lot-radio",
  "worldwide-fm",
  "xray-fm",
  "wxyc",
  "wruw",
  "kuvo",
  "amazing-radio",
  "glacer-fm",
  "radio-k",
  "fbi-radio",
  "cjlo",
  "soho-radio",
  "voices-radio",
  "kool-fm",
] as const;

function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: 1,
    slug: "unreviewed-station",
    name: "Unreviewed Station",
    org: null,
    country: "US",
    city: null,
    ianaTimezone: null,
    streamUrl: "https://stream.example.test/live",
    streamQuality: null,
    streamFormat: "mp3",
    mode: "live",
    homepageUrl: null,
    donateUrl: null,
    logoUrl: null,
    attribution: true,
    tags: null,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    discoveryScore: null,
    homepageBlurb: null,
    upcomingShowCount: 0,
    tier: null,
    source: null,
    nowPlayingSource: null,
    nowPlayingConfig: null,
    automationClass: null,
    active: true,
    hidden: false,
    favorite: false,
    sleepMode: false,
    eraGenreMode: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Station;
}

describe("station profiles", () => {
  it("contains exactly the reviewed 50-key roster", () => {
    expect(Object.keys(STATION_PROFILES).sort()).toEqual([...EXPECTED_SLUGS].sort());
    expect(new Set(Object.keys(STATION_PROFILES)).size).toBe(50);
  });

  it("covers every Bro Zone station", () => {
    for (const slug of BRO_ZONE_SLUGS) {
      expect(getStationProfile(slug), slug).not.toBeNull();
    }
  });

  it("covers every Beyond/MISSION_STATIONS station", () => {
    for (const slug of MISSION_STATION_SLUGS) {
      expect(getStationProfile(slug), slug).not.toBeNull();
    }
  });

  it("keeps profile copy and source metadata within the contract", () => {
    for (const [slug, profile] of Object.entries(STATION_PROFILES)) {
      expect(profile.summary.length, `${slug} summary`).toBeGreaterThanOrEqual(120);
      expect(profile.summary.length, `${slug} summary`).toBeLessThanOrEqual(220);
      expect(profile.description.length, `${slug} description`).toBeGreaterThanOrEqual(500);
      expect(profile.description.length, `${slug} description`).toBeLessThanOrEqual(1000);
      expect(
        profile.sources.filter((source) => source.url.startsWith("https://")).length,
        `${slug} HTTPS sources`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns null for unknown profiles and preserves the summary helper", () => {
    expect(getStationProfile("unreviewed-station")).toBeNull();
    expect(getStationDescription("kexp")).toBe(STATION_PROFILES.kexp.summary);
    expect(getStationDescription("unreviewed-station")).toBeUndefined();
  });

  it("uses reviewed summaries while retaining the scraper fallback", () => {
    expect(
      toStation(makeStation({ slug: "kexp", homepageBlurb: "scraped copy" })).homepageBlurb,
    ).toBe(STATION_PROFILES.kexp.summary);
    expect(
      toStation(
        makeStation({
          slug: "unreviewed-station",
          homepageBlurb: "scraped copy",
        }),
      ).homepageBlurb,
    ).toBe("scraped copy");
    expect(toStation(makeStation()).homepageBlurb).toBeNull();
  });
});