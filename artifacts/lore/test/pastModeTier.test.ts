/**
 * Past-mode playback tier orchestration — pure function tests.
 *
 * Covers:
 * - serviceOptionTier(): derives tier from GUIDED_SERVICE_OPTIONS manifest entry
 * - selectPastModeTier(): picks the best tier from Spotify state + options
 * - tierAnnouncementText(): announcement copy for each tier
 * - readLastUsedService / writeLastUsedService: localStorage helpers
 * - Synthetic manifest entry → Tier 2 with no other code change (manifest derivation)
 * - Last-used-service override
 * - No embedAutoAdvance → never Tier 2 (contract test from guidedReplay)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  serviceOptionTier,
  selectPastModeTier,
  tierAnnouncementText,
  readLastUsedService,
  writeLastUsedService,
  LAST_USED_SERVICE_KEY,
  type PlaybackTier,
  type PastModeTierOpts,
} from "../src/player/playbackSession";
import type { GuidedServiceOption } from "../src/lib/guidedReplay";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOption(
  service: string,
  opts: { embedUrlBuilder?: () => string; embedAutoAdvance?: boolean } = {},
): GuidedServiceOption {
  return {
    service,
    label: service,
    ...(opts.embedUrlBuilder !== undefined ? { embedUrlBuilder: opts.embedUrlBuilder } : {}),
    ...(opts.embedAutoAdvance !== undefined ? { embedAutoAdvance: opts.embedAutoAdvance } : {}),
  } as GuidedServiceOption;
}

const spotifyEligible = { connected: true, premium: true, hasActiveDevice: true };
const spotifyIneligible = { connected: false, premium: false, hasActiveDevice: false };
const spotifyNoPremium = { connected: true, premium: false, hasActiveDevice: true };

// ---------------------------------------------------------------------------
// serviceOptionTier — manifest derivation, no per-service switch
// ---------------------------------------------------------------------------

describe("serviceOptionTier", () => {
  it("returns Tier 2 when embedUrlBuilder AND embedAutoAdvance (e.g. YouTube)", () => {
    const option = makeOption("youtube", {
      embedUrlBuilder: () => "https://youtube.com/embed/abc",
      embedAutoAdvance: true,
    });
    expect(serviceOptionTier(option)).toBe(2 as PlaybackTier);
  });

  it("returns Tier 3 when embedUrlBuilder but NOT embedAutoAdvance (e.g. Bandcamp)", () => {
    const option = makeOption("bandcamp", {
      embedUrlBuilder: () => "https://bandcamp.com/embed",
    });
    expect(serviceOptionTier(option)).toBe(3 as PlaybackTier);
  });

  it("returns Tier 4 for an external-only service (no embedUrlBuilder)", () => {
    const option = makeOption("tidal");
    expect(serviceOptionTier(option)).toBe(4 as PlaybackTier);
  });

  it(
    "SYNTHETIC ENTRY: a brand-new option with embedUrlBuilder + embedAutoAdvance is Tier 2 " +
      "with no other code change — proves manifest derivation, not hardcoding",
    () => {
      const syntheticOption = makeOption("hypothetical-auto-service", {
        embedUrlBuilder: () => "https://example.com/embed",
        embedAutoAdvance: true,
      });
      // Tier is derived from the fields, not from recognising the service key.
      expect(serviceOptionTier(syntheticOption)).toBe(2 as PlaybackTier);
    },
  );

  it("embedUrlBuilder present but embedAutoAdvance explicitly false → Tier 3", () => {
    const option = makeOption("someservice", {
      embedUrlBuilder: () => "https://example.com/embed",
      embedAutoAdvance: false,
    });
    expect(serviceOptionTier(option)).toBe(3 as PlaybackTier);
  });

  it("CONTRACT: no embedAutoAdvance → never silently auto-advances (never Tier 2)", () => {
    const bandcamp = makeOption("bandcamp", { embedUrlBuilder: () => "https://bandcamp.com/embed" });
    const externalOnly = makeOption("tidal");
    // Neither can be Tier 2 without embedAutoAdvance.
    expect(serviceOptionTier(bandcamp)).not.toBe(2 as PlaybackTier);
    expect(serviceOptionTier(externalOnly)).not.toBe(2 as PlaybackTier);
  });
});

// ---------------------------------------------------------------------------
// selectPastModeTier — picks the best achievable tier
// ---------------------------------------------------------------------------

describe("selectPastModeTier", () => {
  it("returns Tier 1 when Spotify is connected + premium + active device", () => {
    const tier = selectPastModeTier({
      spotify: spotifyEligible,
      guidedOptions: [],
    });
    expect(tier).toBe(1 as PlaybackTier);
  });

  it("returns Tier 4 when Spotify is not eligible and no guided options", () => {
    const tier = selectPastModeTier({
      spotify: spotifyIneligible,
      guidedOptions: [],
    });
    expect(tier).toBe(4 as PlaybackTier);
  });

  it("returns Tier 2 when Spotify ineligible and a YouTube (Tier 2) option exists", () => {
    const tier = selectPastModeTier({
      spotify: spotifyIneligible,
      guidedOptions: [
        makeOption("youtube", {
          embedUrlBuilder: () => "",
          embedAutoAdvance: true,
        }),
      ],
    });
    expect(tier).toBe(2 as PlaybackTier);
  });

  it("returns Tier 1 (best) even when YouTube is also available", () => {
    const tier = selectPastModeTier({
      spotify: spotifyEligible,
      guidedOptions: [
        makeOption("youtube", { embedUrlBuilder: () => "", embedAutoAdvance: true }),
        makeOption("bandcamp", { embedUrlBuilder: () => "" }),
      ],
    });
    expect(tier).toBe(1 as PlaybackTier);
  });

  it("returns Tier 3 when only Bandcamp (Tier 3) available and Spotify ineligible", () => {
    const tier = selectPastModeTier({
      spotify: spotifyIneligible,
      guidedOptions: [makeOption("bandcamp", { embedUrlBuilder: () => "" })],
    });
    expect(tier).toBe(3 as PlaybackTier);
  });

  it("returns Tier 4 when Spotify has no premium (only has device + connected)", () => {
    const tier = selectPastModeTier({
      spotify: spotifyNoPremium,
      guidedOptions: [],
    });
    expect(tier).toBe(4 as PlaybackTier);
  });

  it("LAST-USED OVERRIDE: last-used 'spotify' + Spotify eligible → Tier 1", () => {
    const tier = selectPastModeTier({
      spotify: spotifyEligible,
      guidedOptions: [],
      lastUsedService: "spotify",
    });
    expect(tier).toBe(1 as PlaybackTier);
  });

  it("LAST-USED OVERRIDE: last-used 'bandcamp' overrides Tier 1 even with Spotify eligible", () => {
    const tier = selectPastModeTier({
      spotify: spotifyEligible,
      guidedOptions: [makeOption("bandcamp", { embedUrlBuilder: () => "" })],
      lastUsedService: "bandcamp",
    });
    // Listener prefers Bandcamp — Tier 3 is returned directly.
    expect(tier).toBe(3 as PlaybackTier);
  });

  it("LAST-USED OVERRIDE: last-used 'youtube' overrides Tier 1", () => {
    const tier = selectPastModeTier({
      spotify: spotifyEligible,
      guidedOptions: [
        makeOption("youtube", { embedUrlBuilder: () => "", embedAutoAdvance: true }),
      ],
      lastUsedService: "youtube",
    });
    expect(tier).toBe(2 as PlaybackTier);
  });

  it("LAST-USED: preferred 'spotify' but Spotify ineligible → falls through to best", () => {
    const tier = selectPastModeTier({
      spotify: spotifyIneligible,
      guidedOptions: [
        makeOption("youtube", { embedUrlBuilder: () => "", embedAutoAdvance: true }),
      ],
      lastUsedService: "spotify", // preferred but not eligible
    });
    // Falls through to best available: YouTube is Tier 2.
    expect(tier).toBe(2 as PlaybackTier);
  });

  it("LAST-USED: preferred service not in guidedOptions → ignores preference, picks best", () => {
    const tier = selectPastModeTier({
      spotify: spotifyIneligible,
      guidedOptions: [
        makeOption("youtube", { embedUrlBuilder: () => "", embedAutoAdvance: true }),
      ],
      lastUsedService: "bandcamp", // not in options
    });
    // bandcamp not found → falls through to YouTube Tier 2
    expect(tier).toBe(2 as PlaybackTier);
  });

  it("SYNTHETIC ENTRY: a synthetic option with embedAutoAdvance → Tier 2 wins over Tier 3", () => {
    const syntheticTier2 = makeOption("hypothetical-service", {
      embedUrlBuilder: () => "https://example.com",
      embedAutoAdvance: true,
    });
    const bandcamp = makeOption("bandcamp", { embedUrlBuilder: () => "" }); // Tier 3
    const tier = selectPastModeTier({
      spotify: spotifyIneligible,
      guidedOptions: [bandcamp, syntheticTier2],
    });
    // Best tier between Tier 2 and Tier 3 is Tier 2.
    expect(tier).toBe(2 as PlaybackTier);
  });
});

// ---------------------------------------------------------------------------
// tierAnnouncementText — one-sentence, clear, not apologetic
// ---------------------------------------------------------------------------

describe("tierAnnouncementText", () => {
  it("Tier 1 → hands-free Spotify message", () => {
    expect(tierAnnouncementText(1)).toBe("This will play hands-free on Spotify");
  });

  it("Tier 2 without label → generic auto-advance message", () => {
    const text = tierAnnouncementText(2);
    expect(text).toContain("auto-advance");
    expect(text).not.toContain("undefined");
  });

  it("Tier 2 with serviceLabel → includes the label", () => {
    const text = tierAnnouncementText(2, "YouTube");
    expect(text).toContain("YouTube");
    expect(text).toContain("auto-advance");
  });

  it("Tier 3 without label → manual advance message", () => {
    const text = tierAnnouncementText(3);
    expect(text).toContain("manually");
  });

  it("Tier 3 with serviceLabel → includes the label", () => {
    const text = tierAnnouncementText(3, "Bandcamp");
    expect(text).toContain("Bandcamp");
    expect(text).toContain("manually");
  });

  it("Tier 4 → cue sheet message, no apology", () => {
    const text = tierAnnouncementText(4);
    expect(text).toContain("cue sheet");
    expect(text.toLowerCase()).not.toContain("sorry");
    expect(text.toLowerCase()).not.toContain("unfortunately");
    expect(text.toLowerCase()).not.toContain("promise");
  });

  it("Tier 4 does not mention a specific service", () => {
    const text = tierAnnouncementText(4);
    expect(text).not.toContain("Spotify");
    expect(text).not.toContain("YouTube");
  });
});

// ---------------------------------------------------------------------------
// localStorage helpers — readLastUsedService / writeLastUsedService
// ---------------------------------------------------------------------------

describe("readLastUsedService / writeLastUsedService", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when nothing is stored", () => {
    expect(readLastUsedService()).toBeNull();
  });

  it("returns the value written by writeLastUsedService", () => {
    writeLastUsedService("youtube");
    expect(readLastUsedService()).toBe("youtube");
  });

  it("overwrites a previous value", () => {
    writeLastUsedService("bandcamp");
    writeLastUsedService("spotify");
    expect(readLastUsedService()).toBe("spotify");
  });

  it("uses LAST_USED_SERVICE_KEY as the storage key", () => {
    writeLastUsedService("tidal");
    expect(store[LAST_USED_SERVICE_KEY]).toBe("tidal");
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined as unknown as Storage);
    expect(() => readLastUsedService()).not.toThrow();
    expect(() => writeLastUsedService("test")).not.toThrow();
  });
});
