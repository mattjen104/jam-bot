// @vitest-environment jsdom
/**
 * Unit tests for useAppleMusicDriver — specifically the authorization error
 * path, which must:
 *   1. Emit state:"error" via the onStatusChange subscriber so the UI leaves
 *      the "loading" state rather than hanging.
 *   2. Re-throw so PlayerProvider's catch-cascade can fall back to YouTube /
 *      preview (the existing .catch() handler in PlayerProvider does this).
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppleMusicDriver } from "../src/player/useAppleMusicDriver";
import type { MusicKitInstance } from "../src/lib/appleMusicReplay";
import type { DriverPlaybackStatus } from "../src/player/playbackDriver";

// ---------------------------------------------------------------------------
// Minimal RideItem fixture
// ---------------------------------------------------------------------------
function makeItem(mbid = "mbid-1") {
  return {
    mbid,
    title: "Test Track",
    artist: "Test Artist",
    links: [
      {
        name: "apple_music",
        url: "https://music.apple.com/us/album/test/123?i=456",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Fake MusicKit helpers
// ---------------------------------------------------------------------------
function fakeMusicKit(
  authorizeImpl: () => Promise<unknown> = async () => ({}),
): MusicKitInstance {
  return {
    authorize: vi.fn(authorizeImpl),
    setQueue: vi.fn(async () => ({})),
    play: vi.fn(async () => ({})),
    pause: vi.fn(async () => ({})),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    skipToNextItem: vi.fn(async () => ({})),
    skipToPreviousItem: vi.fn(async () => ({})),
  };
}

function installMusicKit(music: MusicKitInstance) {
  window.MusicKit = {
    configure: vi.fn(),
    getInstance: () => music,
    Events: {
      mediaItemDidChange: "mediaItemDidChange",
      playbackStateDidChange: "playbackStateDidChange",
      authorizationStatusDidChange: "authorizationStatusDidChange",
      playbackError: "playbackError",
    },
  };
}

afterEach(() => {
  delete window.MusicKit;
  vi.restoreAllMocks();
});

describe("useAppleMusicDriver — authorization error handling", () => {
  it("emits state:'error' and rejects when authorize() throws", async () => {
    const authError = new Error("User cancelled authorization");
    const music = fakeMusicKit(async () => { throw authError; });
    installMusicKit(music);

    const { result } = renderHook(() =>
      useAppleMusicDriver({ developerToken: "fake-token", appName: "Test" }),
    );

    const statuses: DriverPlaybackStatus[] = [];
    result.current.onStatusChange((s) => statuses.push(s));

    await act(async () => {
      await expect(result.current.play(makeItem())).rejects.toThrow(
        "User cancelled authorization",
      );
    });

    // The driver must have emitted "loading" then "error" — never "playing".
    const states = statuses.map((s) => s.state);
    expect(states).toContain("loading");
    expect(states).toContain("error");
    expect(states).not.toContain("playing");
  });

  it("emits state:'error' and rejects when authorize() throws a token-expiry error", async () => {
    const authError = new Error("NOT_AUTHORIZED");
    const music = fakeMusicKit(async () => { throw authError; });
    installMusicKit(music);

    const { result } = renderHook(() =>
      useAppleMusicDriver({ developerToken: "expired-token", appName: "Test" }),
    );

    const statuses: DriverPlaybackStatus[] = [];
    result.current.onStatusChange((s) => statuses.push(s));

    await act(async () => {
      await expect(result.current.play(makeItem())).rejects.toThrow();
    });

    expect(statuses.map((s) => s.state)).toContain("error");
  });

  it("does NOT emit error and plays successfully when authorize() resolves", async () => {
    const music = fakeMusicKit();
    installMusicKit(music);

    const { result } = renderHook(() =>
      useAppleMusicDriver({ developerToken: "valid-token", appName: "Test" }),
    );

    const statuses: DriverPlaybackStatus[] = [];
    result.current.onStatusChange((s) => statuses.push(s));

    await act(async () => {
      await result.current.play(makeItem());
    });

    expect(statuses.map((s) => s.state)).not.toContain("error");
    expect(music.authorize).toHaveBeenCalledOnce();
    expect(music.play).toHaveBeenCalled();
  });

  it("is unavailable when developerToken is null", () => {
    const { result } = renderHook(() =>
      useAppleMusicDriver({ developerToken: null }),
    );
    expect(result.current.available).toBe(false);
  });
});
