import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveFallback,
  resolveAudioPath,
  isLiveServiceRide,
  readStoredPlaybackMode,
  writeStoredPlaybackMode,
  availableServices,
  rankServices,
  rideFallbackLabel,
  PLAYBACK_MODE_STORAGE_KEY,
  type TimeOrientation,
  type PlaybackMode,
} from "../src/player/playbackSession";

// ---------------------------------------------------------------------------
// resolveFallback — all branches of the fallback ladder
// ---------------------------------------------------------------------------
describe("resolveFallback", () => {
  it("returns service when service is available", () => {
    const orientations: TimeOrientation[] = ["live", "past", "curated"];
    for (const o of orientations) {
      expect(resolveFallback(true, o, false)).toBe("service");
      expect(resolveFallback(true, o, true)).toBe("service");
    }
  });

  it("returns passthrough for live when service is unavailable", () => {
    expect(resolveFallback(false, "live", false)).toBe("passthrough");
    expect(resolveFallback(false, "live", true)).toBe("passthrough");
  });

  it("returns preview for past when service is unavailable and preview exists", () => {
    expect(resolveFallback(false, "past", true)).toBe("preview");
  });

  it("returns skip for past when service and preview are both unavailable", () => {
    expect(resolveFallback(false, "past", false)).toBe("skip");
  });

  it("returns preview for curated when service is unavailable and preview exists", () => {
    expect(resolveFallback(false, "curated", true)).toBe("preview");
  });

  it("returns skip for curated when service and preview are both unavailable", () => {
    expect(resolveFallback(false, "curated", false)).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// resolveAudioPath — all (mode × orientation × flags) combinations
// ---------------------------------------------------------------------------
describe("resolveAudioPath", () => {
  describe("passthrough mode (not service-ride)", () => {
    it("returns passthrough for live orientation regardless of service flags", () => {
      const result = resolveAudioPath(
        { mode: "passthrough", timeOrientation: "live" },
        { serviceConnected: true, serviceFailed: false, previewAvailable: true },
      );
      expect(result).toBe("passthrough");
    });

    it("returns preview for past orientation in passthrough mode", () => {
      const result = resolveAudioPath(
        { mode: "passthrough", timeOrientation: "past" },
        { serviceConnected: false, serviceFailed: false, previewAvailable: true },
      );
      expect(result).toBe("preview");
    });

    it("returns preview for curated orientation in passthrough mode", () => {
      const result = resolveAudioPath(
        { mode: "passthrough", timeOrientation: "curated" },
        { serviceConnected: true, serviceFailed: true, previewAvailable: false },
      );
      expect(result).toBe("preview");
    });
  });

  describe("resolve_to_service mode", () => {
    it("returns service when connected and not failed", () => {
      expect(
        resolveAudioPath(
          { mode: "resolve_to_service", timeOrientation: "live" },
          { serviceConnected: true, serviceFailed: false, previewAvailable: true },
        ),
      ).toBe("service");
    });

    it("returns service when connected and not failed (curated)", () => {
      expect(
        resolveAudioPath(
          { mode: "resolve_to_service", timeOrientation: "curated" },
          { serviceConnected: true, serviceFailed: false, previewAvailable: true },
        ),
      ).toBe("service");
    });

    it("returns passthrough for live when service failed", () => {
      expect(
        resolveAudioPath(
          { mode: "resolve_to_service", timeOrientation: "live" },
          { serviceConnected: true, serviceFailed: true, previewAvailable: true },
        ),
      ).toBe("passthrough");
    });

    it("returns passthrough for live when service not connected", () => {
      expect(
        resolveAudioPath(
          { mode: "resolve_to_service", timeOrientation: "live" },
          { serviceConnected: false, serviceFailed: false, previewAvailable: false },
        ),
      ).toBe("passthrough");
    });

    it("returns preview for past when service failed and preview available", () => {
      expect(
        resolveAudioPath(
          { mode: "resolve_to_service", timeOrientation: "past" },
          { serviceConnected: true, serviceFailed: true, previewAvailable: true },
        ),
      ).toBe("preview");
    });

    it("returns skip for past when service failed and no preview", () => {
      expect(
        resolveAudioPath(
          { mode: "resolve_to_service", timeOrientation: "past" },
          { serviceConnected: true, serviceFailed: true, previewAvailable: false },
        ),
      ).toBe("skip");
    });

    it("returns skip for curated when service failed and no preview", () => {
      expect(
        resolveAudioPath(
          { mode: "resolve_to_service", timeOrientation: "curated" },
          { serviceConnected: true, serviceFailed: true, previewAvailable: false },
        ),
      ).toBe("skip");
    });
  });
});

// ---------------------------------------------------------------------------
// isLiveServiceRide — advance-driver detection
// ---------------------------------------------------------------------------
describe("isLiveServiceRide", () => {
  it("returns true only for live + resolve_to_service", () => {
    expect(isLiveServiceRide("resolve_to_service", "live")).toBe(true);
  });

  const nonLiveOrientations: TimeOrientation[] = ["past", "curated"];
  for (const o of nonLiveOrientations) {
    it(`returns false for ${o} + resolve_to_service`, () => {
      expect(isLiveServiceRide("resolve_to_service", o)).toBe(false);
    });
  }

  const modes: PlaybackMode[] = ["passthrough", "resolve_to_service"];
  for (const m of modes) {
    if (m === "resolve_to_service") continue;
    it(`returns false for live + ${m}`, () => {
      expect(isLiveServiceRide(m, "live")).toBe(false);
    });
  }

  it("returns false for passthrough regardless of orientation", () => {
    const orientations: TimeOrientation[] = ["live", "past", "curated"];
    for (const o of orientations) {
      expect(isLiveServiceRide("passthrough", o)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence — mode toggle default and persistence
// ---------------------------------------------------------------------------
describe("mode toggle persistence", () => {
  // Provide a minimal localStorage stub for Node/vitest environment.
  let store: Record<string, string> = {};
  const localStorageMock = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    store = {};
  });

  it("defaults to passthrough when nothing is stored", () => {
    expect(readStoredPlaybackMode()).toBe("passthrough");
  });

  it("reads resolve_to_service after it is written", () => {
    writeStoredPlaybackMode("resolve_to_service");
    expect(readStoredPlaybackMode()).toBe("resolve_to_service");
  });

  it("reads passthrough after passthrough is written", () => {
    writeStoredPlaybackMode("resolve_to_service");
    writeStoredPlaybackMode("passthrough");
    expect(readStoredPlaybackMode()).toBe("passthrough");
  });

  it("stores under the canonical key", () => {
    writeStoredPlaybackMode("resolve_to_service");
    expect(store[PLAYBACK_MODE_STORAGE_KEY]).toBe("resolve_to_service");
  });

  it("defaults to passthrough when the stored value is unrecognised", () => {
    store[PLAYBACK_MODE_STORAGE_KEY] = "invalid_value";
    expect(readStoredPlaybackMode()).toBe("passthrough");
  });

  it("defaults to passthrough when localStorage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      get() { throw new Error("SecurityError"); },
      configurable: true,
    });
    expect(readStoredPlaybackMode()).toBe("passthrough");
  });
});

// ---------------------------------------------------------------------------
// availableServices — service option list
// ---------------------------------------------------------------------------
describe("availableServices", () => {
  const base = {
    appleMusicConfigured: false,
    appleMusicAuthorized: false,
    trackHasYouTube: false,
    trackHasAppleMusic: false,
  };

  it("always includes YouTube", () => {
    const svcs = availableServices(base);
    expect(svcs.some((s) => s.id === "youtube")).toBe(true);
  });

  it("excludes Apple Music when not configured", () => {
    const svcs = availableServices(base);
    expect(svcs.some((s) => s.id === "apple-music")).toBe(false);
  });

  it("includes Apple Music when configured", () => {
    const svcs = availableServices({ ...base, appleMusicConfigured: true });
    expect(svcs.some((s) => s.id === "apple-music")).toBe(true);
  });

  it("YouTube category is seamless", () => {
    const svcs = availableServices(base);
    const yt = svcs.find((s) => s.id === "youtube")!;
    expect(yt.category).toBe("seamless");
    expect(yt.requiresConnect).toBe(false);
  });

  it("Apple Music category is seamless-connected", () => {
    const svcs = availableServices({ ...base, appleMusicConfigured: true });
    const am = svcs.find((s) => s.id === "apple-music")!;
    expect(am.category).toBe("seamless-connected");
  });

  it("Apple Music requiresConnect=true when not authorized", () => {
    const svcs = availableServices({ ...base, appleMusicConfigured: true, appleMusicAuthorized: false });
    const am = svcs.find((s) => s.id === "apple-music")!;
    expect(am.requiresConnect).toBe(true);
  });

  it("Apple Music requiresConnect=false when authorized", () => {
    const svcs = availableServices({ ...base, appleMusicConfigured: true, appleMusicAuthorized: true });
    const am = svcs.find((s) => s.id === "apple-music")!;
    expect(am.requiresConnect).toBe(false);
  });

  it("YouTube trackSupported=true when track has a YouTube link", () => {
    const svcs = availableServices({ ...base, trackHasYouTube: true });
    const yt = svcs.find((s) => s.id === "youtube")!;
    expect(yt.trackSupported).toBe(true);
  });

  it("YouTube trackSupported=false when track has no YouTube link", () => {
    const svcs = availableServices(base);
    const yt = svcs.find((s) => s.id === "youtube")!;
    expect(yt.trackSupported).toBe(false);
  });

  it("Apple Music trackSupported reflects track link availability", () => {
    const withLink = availableServices({ ...base, appleMusicConfigured: true, trackHasAppleMusic: true });
    const withoutLink = availableServices({ ...base, appleMusicConfigured: true, trackHasAppleMusic: false });
    expect(withLink.find((s) => s.id === "apple-music")!.trackSupported).toBe(true);
    expect(withoutLink.find((s) => s.id === "apple-music")!.trackSupported).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rankServices — ordering guarantee
// ---------------------------------------------------------------------------
describe("rankServices", () => {
  const base = {
    appleMusicConfigured: false,
    appleMusicAuthorized: false,
    trackHasYouTube: false,
    trackHasAppleMusic: false,
  };

  it("returns YouTube first (seamless before seamless-connected)", () => {
    const ranked = rankServices({ ...base, appleMusicConfigured: true });
    expect(ranked[0]!.id).toBe("youtube");
  });

  it("puts track-supported YouTube before unsupported YouTube (both seamless)", () => {
    // Only YouTube is here; both cases are seamless — just check ordering stability
    const supported = rankServices({ ...base, trackHasYouTube: true });
    const unsupported = rankServices({ ...base, trackHasYouTube: false });
    expect(supported[0]!.id).toBe("youtube");
    expect(unsupported[0]!.id).toBe("youtube");
    expect(supported[0]!.trackSupported).toBe(true);
    expect(unsupported[0]!.trackSupported).toBe(false);
  });

  it("places track-supported YouTube before Apple Music (seamless > seamless-connected)", () => {
    const ranked = rankServices({
      ...base,
      appleMusicConfigured: true,
      trackHasYouTube: true,
      trackHasAppleMusic: true,
    });
    const ytIdx = ranked.findIndex((s) => s.id === "youtube");
    const amIdx = ranked.findIndex((s) => s.id === "apple-music");
    expect(ytIdx).toBeLessThan(amIdx);
  });

  it("with no YouTube link, YouTube (seamless) still sorts before Apple Music (seamless-connected)", () => {
    const ranked = rankServices({ ...base, appleMusicConfigured: true });
    const ytIdx = ranked.findIndex((s) => s.id === "youtube");
    const amIdx = ranked.findIndex((s) => s.id === "apple-music");
    expect(ytIdx).toBeLessThan(amIdx);
  });

  it("returns only YouTube when Apple Music is not configured", () => {
    const ranked = rankServices(base);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.id).toBe("youtube");
  });

  it("returns both services when Apple Music is configured", () => {
    const ranked = rankServices({ ...base, appleMusicConfigured: true });
    expect(ranked).toHaveLength(2);
    expect(ranked.map((s) => s.id)).toContain("youtube");
    expect(ranked.map((s) => s.id)).toContain("apple-music");
  });

  it("does not mutate the original availableServices output", () => {
    const opts = { ...base, appleMusicConfigured: true };
    const before = availableServices(opts).map((s) => s.id).join(",");
    rankServices(opts);
    const after = availableServices(opts).map((s) => s.id).join(",");
    expect(before).toBe(after);
  });
});

// ---------------------------------------------------------------------------
// rideFallbackLabel — service-aware suffix
// ---------------------------------------------------------------------------
describe("rideFallbackLabel (extended)", () => {
  it("defaults to Spotify prefix for backwards-compatibility (no service arg)", () => {
    expect(rideFallbackLabel(false, "live")).toContain("Spotify");
    expect(rideFallbackLabel(true, "live")).toContain("Spotify device lost");
  });

  it("shows YouTube prefix when service is youtube", () => {
    const label = rideFallbackLabel(false, "past", "youtube");
    expect(label).toContain("YouTube");
    expect(label).not.toContain("Spotify");
  });

  it("shows Apple Music prefix when service is apple-music", () => {
    const label = rideFallbackLabel(false, "curated", "apple-music");
    expect(label).toContain("Apple Music");
    expect(label).not.toContain("Spotify");
  });

  it("device-lost prefix only used for Spotify", () => {
    const spotify = rideFallbackLabel(true, "live", "spotify");
    const youtube = rideFallbackLabel(true, "live", "youtube");
    expect(spotify).toBe("Spotify device lost · listening to broadcast");
    // YouTube has no device-lost concept; shows unavailable prefix instead.
    expect(youtube).toContain("Unavailable on YouTube");
  });

  it("live suffix is broadcast, past/curated suffix is preview", () => {
    expect(rideFallbackLabel(false, "live", "youtube")).toContain("listening to broadcast");
    expect(rideFallbackLabel(false, "past", "youtube")).toContain("playing preview");
    expect(rideFallbackLabel(false, "curated", "youtube")).toContain("playing preview");
  });
});

// ---------------------------------------------------------------------------
// Advance logic per time_orientation (deterministic advance driver)
// ---------------------------------------------------------------------------
describe("time_orientation advance driver", () => {
  it("live service-ride suppresses Spotify poll advance", () => {
    // isLiveServiceRide is the guard: when true, the now-playing poll drives
    // advances, so the Spotify poll must skip its advance branch.
    expect(isLiveServiceRide("resolve_to_service", "live")).toBe(true);
  });

  it("past service-ride uses Spotify poll advance (not now-playing)", () => {
    expect(isLiveServiceRide("resolve_to_service", "past")).toBe(false);
  });

  it("curated service-ride uses Spotify poll advance (not now-playing)", () => {
    expect(isLiveServiceRide("resolve_to_service", "curated")).toBe(false);
  });

  it("passthrough live does not use live service-ride path", () => {
    expect(isLiveServiceRide("passthrough", "live")).toBe(false);
  });
});
