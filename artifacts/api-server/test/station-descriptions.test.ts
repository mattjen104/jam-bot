// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Station } from "@workspace/db";
import {
  STATION_DESCRIPTION_OVERRIDES,
  getStationDescription,
} from "../src/lore/station-descriptions.js";
import { toStation } from "../src/routes/lore/shared.js";

const EXPECTED_SLUGS = [
  "kexp",
  "wwoz",
  "kutx",
  "kcrw-eclectic24",
  "nts-1",
  "nts-2",
  "bbc-6music",
  "fip-main",
  "wfmu",
  "bytefm-192k",
  "dublab",
  "rinse-fm",
  "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f",
  "rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631",
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

describe("station description overrides", () => {
  it("covers every top/core station exactly once", () => {
    expect(Object.keys(STATION_DESCRIPTION_OVERRIDES).sort()).toEqual(
      [...EXPECTED_SLUGS].sort(),
    );
  });

  it("keeps every editorial description concise and non-empty", () => {
    for (const slug of EXPECTED_SLUGS) {
      const description = getStationDescription(slug);
      expect(description, slug).toBeTruthy();
      expect(description!.length, slug).toBeGreaterThanOrEqual(120);
      expect(description!.length, slug).toBeLessThanOrEqual(220);
    }
  });

  it("overrides reviewed copy while retaining scraper fallback elsewhere", () => {
    expect(
      toStation(makeStation({ slug: "kexp", homepageBlurb: "scraped copy" })).homepageBlurb,
    ).toBe(getStationDescription("kexp"));
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