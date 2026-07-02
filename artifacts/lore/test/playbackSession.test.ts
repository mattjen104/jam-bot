import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveFallback,
  resolveAudioPath,
  isLiveServiceRide,
  readStoredPlaybackMode,
  writeStoredPlaybackMode,
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
