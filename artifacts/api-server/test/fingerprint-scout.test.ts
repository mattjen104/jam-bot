import { describe, it, expect } from "vitest";
import { parseAuddResponse } from "../src/lore/audd.js";
import {
  computeScoutFlag,
  isNatureNoiseName,
  SCOUT_VERDICT_MIN_SAMPLES,
} from "../src/lore/fingerprint-scout.js";
import { RADIO_BROWSER_NAME_BLOCKLIST } from "../src/lore/radio-browser.js";

describe("parseAuddResponse", () => {
  it("shapes a successful match with musicbrainz enrichment", () => {
    const body = {
      status: "success",
      result: {
        artist: "Broadcast",
        title: "Come On Let's Go",
        isrc: "GBAFL0000123",
        musicbrainz: [{ id: "a1b2c3d4-0000-1111-2222-333344445555" }],
      },
    };
    expect(parseAuddResponse(body)).toEqual({
      rawArtist: "Broadcast",
      rawTitle: "Come On Let's Go",
      isrc: "GBAFL0000123",
      recordingId: "a1b2c3d4-0000-1111-2222-333344445555",
    });
  });

  it("returns null for a no-match success (result: null)", () => {
    expect(parseAuddResponse({ status: "success", result: null })).toBeNull();
  });

  it("returns null for error responses and junk shapes", () => {
    expect(parseAuddResponse({ status: "error", error: { error_code: 901 } })).toBeNull();
    expect(parseAuddResponse(null)).toBeNull();
    expect(parseAuddResponse("nope")).toBeNull();
    expect(parseAuddResponse({ status: "success", result: { artist: "", title: "X" } })).toBeNull();
  });

  it("omits isrc/recordingId when absent without failing", () => {
    const rec = parseAuddResponse({
      status: "success",
      result: { artist: "Stereolab", title: "French Disko" },
    });
    expect(rec).toEqual({ rawArtist: "Stereolab", rawTitle: "French Disko" });
  });
});

describe("isNatureNoiseName", () => {
  it("classifies nature/noise stations", () => {
    expect(isNatureNoiseName("Calm Ocean Waves 24/7")).toBe(true);
    expect(isNatureNoiseName("Birdsong Radio")).toBe(true);
    expect(isNatureNoiseName("Pure White Noise")).toBe(true);
    expect(isNatureNoiseName("Nature Radio Thunder")).toBe(true);
  });

  it("passes ordinary music stations", () => {
    expect(isNatureNoiseName("WFMU")).toBe(false);
    expect(isNatureNoiseName("SomaFM n5MD")).toBe(false);
    expect(isNatureNoiseName(null)).toBe(false);
  });
});

describe("computeScoutFlag", () => {
  it("promotes on a crossing", () => {
    expect(
      computeScoutFlag({ samples: 3, recognitions: 2, crossings: 1, firstPlays: 0 }),
    ).toBe("promote");
  });

  it("promotes on several first plays", () => {
    expect(
      computeScoutFlag({ samples: 6, recognitions: 4, crossings: 0, firstPlays: 3 }),
    ).toBe("promote");
  });

  it("flags remove after enough samples with zero recognitions", () => {
    expect(
      computeScoutFlag({
        samples: SCOUT_VERDICT_MIN_SAMPLES,
        recognitions: 0,
        crossings: 0,
        firstPlays: 0,
      }),
    ).toBe("remove");
  });

  it("flags remove when recognitions exist but nothing was interesting", () => {
    expect(
      computeScoutFlag({
        samples: SCOUT_VERDICT_MIN_SAMPLES + 2,
        recognitions: 5,
        crossings: 0,
        firstPlays: 0,
      }),
    ).toBe("remove");
  });

  it("keeps scouting before the sample threshold", () => {
    expect(
      computeScoutFlag({ samples: 2, recognitions: 0, crossings: 0, firstPlays: 0 }),
    ).toBe("scouting");
    expect(
      computeScoutFlag({ samples: 5, recognitions: 1, crossings: 0, firstPlays: 1 }),
    ).toBe("scouting");
  });
});

describe("RADIO_BROWSER_NAME_BLOCKLIST quality-review additions", () => {
  const blocked = (name: string) =>
    RADIO_BROWSER_NAME_BLOCKLIST.some((b) => name.toLowerCase().includes(b));

  it("blocks the Saudi commercial family that slipped in via the world tag", () => {
    expect(blocked("Saudia Radio 87.7 FM")).toBe(true);
    expect(blocked("SBA Riyadh Radio 91.5 FM")).toBe(true);
    expect(blocked("SBA Jeddah Radio 98.0 FM")).toBe(true);
    expect(blocked("SBA Saudia Radio 103.6 FM")).toBe(true);
    expect(blocked("MBC Loud 94.3 FM")).toBe(true);
    expect(blocked("Galaxy FM KSA 99.9")).toBe(true);
  });

  it("blocks the #1 Splash background-channel family", () => {
    expect(blocked("#1 Splash Spa")).toBe(true);
    expect(blocked("#1 Splash Jazz")).toBe(true);
  });

  it("does not block legitimate stations", () => {
    expect(blocked("KEXP")).toBe(false);
    expect(blocked("SomaFM Deep Space One")).toBe(false);
    expect(blocked("PANORAMA80")).toBe(false);
  });
});

describe("scout verdict safety", () => {
  it("does not infer a removal recommendation before completed samples reach threshold", () => {
    // Provider/capture failures deliberately do not increment samples in
    // scoutTick, so an AudD outage cannot manufacture this threshold.
    expect(computeScoutFlag({ samples: 0, recognitions: 0, crossings: 0, firstPlays: 0 })).toBe("scouting");
  });
});
