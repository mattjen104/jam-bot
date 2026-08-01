/**
 * Shared factory helpers for tests that mock useDialData or construct DialShow
 * objects. Both helpers accept a partial override so callers only set what
 * their test needs.
 */
import type { DialStation, DialShow, DialSpin } from "../../src/hooks/useDialData";

export function makeDialSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    title: "Test Track",
    artist: "Test Artist",
    playedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    ...overrides,
  };
}

export function makeDialShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Morning Show",
    djName: null,
    startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    state: "live",
    spins: [],
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack: null,
    isPickerShow: false,
    /** pickerId null = show not yet linked to a picker row */
    pickerId: null,
    ...overrides,
  };
}

export function makeDialStation(overrides: Partial<DialStation> = {}): DialStation {
  return {
    station: {
      slug: "test-station",
      name: "Test Radio",
      automationClass: null,
      streamUrl: null,
      websiteUrl: null,
      hidden: false,
      favorite: false,
    } as DialStation["station"],
    isLive: false,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    ...overrides,
  };
}

/**
 * Returns a complete, type-safe useDialData return shape with sensible
 * defaults. Pass overrides to customise only what the test needs.
 */
export function makeDialData(
  overrides: Partial<{
    stations: DialStation[];
    isLoading: boolean;
    isCoreLoading: boolean;
    liveLoading: boolean;
    crossingsLoading: boolean;
    hasLibrary: boolean;
    overlapByPickerId: Map<number, number>;
    pickerNameToId: Map<string, number>;
  }> = {},
) {
  return {
    stations: [],
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: false,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
    ...overrides,
  };
}
