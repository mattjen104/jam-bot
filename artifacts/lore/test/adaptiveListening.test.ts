import { describe, expect, it } from "vitest";
import {
  adaptiveListeningCopy,
  deriveAdaptiveListeningState,
  importProgressLabel,
  isConfirmedCrossing,
} from "../src/lib/adaptiveListening";

describe("adaptive listening state", () => {
  it("keeps a listener in honest import and resolving states before crossings lead", () => {
    expect(deriveAdaptiveListeningState({
      hasLibrary: false,
      hasSeeds: false,
      confirmedLiveCrossings: 0,
      importJob: { status: "running", phase: "fetching", total: 1300, resolved: 0 },
    })).toBe("importing");
    expect(deriveAdaptiveListeningState({
      hasLibrary: true,
      hasSeeds: false,
      confirmedLiveCrossings: 4,
      importJob: { status: "running", phase: "resolve", total: 1300, resolved: 600 },
    })).toBe("resolving");
    expect(importProgressLabel({
      status: "running",
      phase: "resolve",
      total: 1300,
      resolved: 600,
    })).toContain("600 of 1,300");
  });

  it("leads with crossings only after confirmed live evidence exists", () => {
    expect(isConfirmedCrossing({
      isLibraryHit: true,
      isArtistHit: false,
      resolving: true,
    })).toBe(false);
    expect(isConfirmedCrossing({
      isLibraryHit: false,
      isArtistHit: true,
      resolving: false,
    })).toBe(true);
    expect(deriveAdaptiveListeningState({
      hasLibrary: true,
      hasSeeds: false,
      confirmedLiveCrossings: 1,
      importJob: null,
    })).toBe("crossing-ready");
  });

  it("uses station-led cold and historical established fallbacks", () => {
    expect(deriveAdaptiveListeningState({
      hasLibrary: false,
      hasSeeds: false,
      confirmedLiveCrossings: 0,
    })).toBe("cold");
    expect(deriveAdaptiveListeningState({
      hasLibrary: true,
      hasSeeds: false,
      confirmedLiveCrossings: 0,
    })).toBe("established");
    expect(adaptiveListeningCopy("established").description).not.toContain("right now");
  });
});