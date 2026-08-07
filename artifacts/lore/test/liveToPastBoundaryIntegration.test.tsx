// @vitest-environment jsdom
/**
 * Integration tests for the live-to-past boundary, device continuity, and
 * buffer-outrun state — exercising the ACTUAL PlayerProvider wiring.
 *
 * Covers:
 *  - interstitialArmed becomes true on live→past crossing, NOT on idle→past
 *  - checkDeviceContinuity is wired: device mismatch fires spotify.showNotice
 *  - A matching pinned device skips the notice
 *  - No pinned device skips the notice
 *  - The session flag (deviceContinuityCheckedRef) suppresses a second prompt
 *  - bufferOutrun is true when the current item's previewUrl is undefined
 *  - bufferOutrun is false when previewUrl resolves to null
 *  - RideBar renders "Finding this on…" when bufferOutrun is true
 *  - Prefetch fires in past/replay orientation, not in live orientation
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { useRef, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Hoist mock variables so they are defined BEFORE vi.mock factories run
// ---------------------------------------------------------------------------
const { mockGetSpotifyDevices, mockSpotifyPlay, mockSpotifyQueueRun } = vi.hoisted(() => ({
  mockSpotifyQueueRun: vi.fn(async () => ({ queued: 1 })),
  mockGetSpotifyDevices: vi.fn(async () => ({
    devices: [] as Array<{
      id: string;
      name: string;
      type: string;
      isActive: boolean;
      isRestricted?: boolean;
      volumePercent: number | null;
    }>,
  })),
  mockSpotifyPlay: vi.fn(async () => ({ trackUri: "spotify:track:test-uri-abc" })),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    getSpotifyStatus: vi.fn(async () => ({
      configured: true,
      connected: true,
      displayName: "Test User",
      product: "premium",
    })),
    getSpotifyDevices: mockGetSpotifyDevices,
    spotifyLogout: vi.fn(async () => {}),
    spotifyPlay: mockSpotifyPlay,
    spotifyQueueRun: mockSpotifyQueueRun,
    spotifyPause: vi.fn(async () => {}),
    spotifyResume: vi.fn(async () => {}),
    getSpotifyPlayer: vi.fn(async () => ({
      trackUri: "spotify:track:test-uri-abc",
      isPlaying: true,
      active: true,
      progressMs: 5000,
    })),
    getRecording: vi.fn(async () => ({ links: [] })),
    getRecordingSegues: vi.fn(async () => ({ next: [] })),
    // Default: never resolves → previewUrl stays undefined → bufferOutrun=true
    getRecordingPreview: vi.fn(() => new Promise(() => {})),
    getStationNowPlaying: vi.fn(async () => null),
    getGetStationNowPlayingQueryKey: vi.fn(() => ["station-now-playing"]),
  });
});

vi.mock("../src/hooks/useRadioPlayer", () => ({
  useRadioPlayer: vi.fn(() => ({
    status: "idle",
    station: null,
    volume: 0.85,
    error: null,
    setVolume: vi.fn(),
    toggle: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  })),
}));

vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const { makeWebplayerHooksMock } = await import("./helpers/webplayerHooksMock");
  return makeWebplayerHooksMock(importOriginal, {
    useWpOnAir: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      dataUpdatedAt: 0,
    })),
    useWpLoreCounts: vi.fn(() => ({ data: undefined })),
    useWpRecordingSpins: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })),
  });
});

// Comprehensive meHooks mock — stubs ALL hooks so KeepButton etc. work without
// a real QueryClientProvider.
vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useAppConfig: vi.fn(() => ({ data: null, isLoading: false })),
  });
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { PlayerProvider, usePlayer, type RideSeed } from "../src/player/PlayerProvider";
import { getRecordingPreview } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
let seedSeq = 0;
function makeSeed(tag: string): RideSeed {
  return {
    mbid: `mbid-${tag}-${++seedSeq}`,
    title: `Track ${tag}`,
    artist: "Test Artist",
    artworkUrl: null,
    links: [],
  };
}

const PINNED_DEVICE = {
  id: "device-kitchen",
  name: "Kitchen Speaker",
  type: "Speaker" as const,
  isActive: false,
  isRestricted: false,
  volumePercent: 70,
};
const ACTIVE_DEVICE_MISMATCH = {
  id: "device-bedroom",
  name: "Bedroom Speaker",
  type: "Speaker" as const,
  isActive: true,
  isRestricted: false,
  volumePercent: 80,
};
const ACTIVE_DEVICE_MATCH = {
  ...PINNED_DEVICE,
  isActive: true,
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  mockGetSpotifyDevices.mockResolvedValue({ devices: [] });
  mockSpotifyPlay.mockClear();
  (getRecordingPreview as Mock).mockReturnValue(new Promise(() => {}));
  // Clear localStorage so pinned-device state from one test does NOT leak into
  // the next. useSpotifyConnect reads localStorage on mount to restore a pinned
  // device, so any test that calls spotify.pinDevice() would otherwise contaminate
  // subsequent tests.
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// flush: advance fake timers and flush all microtasks within act()
// ---------------------------------------------------------------------------
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Multiple short flushes so each round of state-updates + effects settles
// before the next async step fires.
async function flushAll(rounds = 5, ms = 10) {
  for (let i = 0; i < rounds; i++) {
    await flush(ms);
  }
}

// ---------------------------------------------------------------------------
// Observer: captures the latest ride + spotify state for assertion
// ---------------------------------------------------------------------------
let latestPlayer: ReturnType<typeof usePlayer> | null = null;

function StateCapture() {
  const player = usePlayer();
  latestPlayer = player;

  // Arm-count: count transitions from false → true so tests can verify a
  // crossing happened even after the interstitial auto-dismisses.
  const armCountRef = useRef(0);
  const [armCount, setArmCount] = useState(0);
  useEffect(() => {
    if (player.ride.interstitialArmed) {
      armCountRef.current += 1;
      setArmCount(armCountRef.current);
    }
  }, [player.ride.interstitialArmed]);

  return (
    <div>
      <span data-testid="interstitial">{player.ride.interstitialArmed ? "armed" : "idle"}</span>
      <span data-testid="arm-count">{armCount}</span>
      <span data-testid="device-mismatch">{player.ride.deviceMismatch ? "mismatch" : "ok"}</span>
      <span data-testid="buffer-outrun">{player.ride.bufferOutrun ? "outrun" : "ok"}</span>
      <span data-testid="spotify-notice">{player.spotify.notice ?? ""}</span>
      <span data-testid="ride-active">{player.ride.active ? "yes" : "no"}</span>
    </div>
  );
}

function renderWithProvider(children: React.ReactNode) {
  latestPlayer = null;
  return render(<PlayerProvider>{children}</PlayerProvider>);
}

// ---------------------------------------------------------------------------
// 1. interstitialArmed — fires on live→past, NOT on idle→past or past→past
// ---------------------------------------------------------------------------
describe("interstitialArmed crossing detection (provider integration)", () => {
  it("does NOT arm when starting a past ride from idle (no prior live audio)", async () => {
    const SEED = makeSeed("idle-past");
    function Observer() {
      const { ride, spotify } = usePlayer();
      const started = useRef(false);
      useEffect(() => {
        if (started.current || !spotify.connected || !spotify.premium) return;
        started.current = true;
        ride.startReplay([SEED], "Test Run");
      }, [spotify.connected, spotify.premium]); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    renderWithProvider(<><Observer /><StateCapture /></>);
    await flushAll(6, 20);
    expect(screen.getByTestId("interstitial").textContent).toBe("idle");
  });

  it("arms the interstitial when crossing from a live-orientation ride to past", async () => {
    // The interstitial auto-dismisses quickly (0ms silence placeholder), so we
    // check the arm-count (tracks transitions false→true) rather than the
    // transient armed state. arm-count === "1" confirms the crossing fired.
    const SEED_LIVE = makeSeed("live");
    const SEED_PAST = makeSeed("past");
    function Observer() {
      const { ride, spotify } = usePlayer();
      const step = useRef<"init" | "live" | "past">("init");
      useEffect(() => {
        if (step.current !== "init" || !spotify.connected || !spotify.premium) return;
        step.current = "live";
        ride.startReplay([SEED_LIVE], "Live Set", { timeOrientation: "live" as any });
      }, [spotify.connected, spotify.premium]); // eslint-disable-line react-hooks/exhaustive-deps
      // No deps: runs after every render so we react as soon as ride.active is true.
      useEffect(() => {
        if (step.current !== "live" || !ride.active) return;
        step.current = "past";
        ride.startReplay([SEED_PAST], "Past Run");
      }); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    renderWithProvider(<><Observer /><StateCapture /></>);
    await flushAll(8, 20);
    // arm-count counts false→true transitions; exactly 1 live→past crossing occurred.
    expect(screen.getByTestId("arm-count").textContent).toBe("1");
    // No device mismatch gate — interstitial auto-dismissed after the crossing.
    expect(screen.getByTestId("device-mismatch").textContent).toBe("ok");
  });

  it("does NOT arm on past→past transition (two consecutive past rides)", async () => {
    const SEED1 = makeSeed("pp1");
    const SEED2 = makeSeed("pp2");
    function Observer() {
      const { ride, spotify } = usePlayer();
      const step = useRef<"init" | "first" | "second">("init");
      useEffect(() => {
        if (step.current !== "init" || !spotify.connected || !spotify.premium) return;
        step.current = "first";
        ride.startReplay([SEED1], "Run 1");
      }, [spotify.connected, spotify.premium]); // eslint-disable-line react-hooks/exhaustive-deps
      useEffect(() => {
        if (step.current !== "first" || !ride.active) return;
        step.current = "second";
        ride.startReplay([SEED2], "Run 2");
      }); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    renderWithProvider(<><Observer /><StateCapture /></>);
    await flushAll(8, 20);
    expect(screen.getByTestId("interstitial").textContent).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// 2. Device continuity — checkDeviceContinuity wired into the crossing
// ---------------------------------------------------------------------------
describe("device continuity at live→past crossing (provider integration)", () => {
  /**
   * Render a component that: connects Spotify, pins an optional device,
   * starts a live ride, then crosses to past.
   *
   * `devicesToReturn` controls the exact device list returned by getSpotifyDevices.
   * To test a genuine mismatch (pin reachable but not active), include BOTH the
   * pinned device (isActive:false) AND the different-room active device.
   * To test "unreachable pin", include ONLY the non-pinned active device.
   */
  function LiveThenPastCrosser({
    deviceToPin,
    devicesToReturn,
    pastSeed,
  }: {
    deviceToPin: typeof PINNED_DEVICE | null;
    devicesToReturn: Array<typeof PINNED_DEVICE>;
    /** Optional seed for the past run (e.g. with a Spotify link for Tier-1). */
    pastSeed?: RideSeed;
  }) {
    const { ride, spotify } = usePlayer();
    const step = useRef<"init" | "live" | "past">("init");

    useEffect(() => {
      if (step.current !== "init" || !spotify.connected || !spotify.premium) return;
      step.current = "live";
      mockGetSpotifyDevices.mockResolvedValue({ devices: devicesToReturn });
      if (deviceToPin) spotify.pinDevice(deviceToPin);
      ride.setPlaybackMode("resolve_to_service");
      ride.startReplay([makeSeed("dev-live")], "Live", {
        timeOrientation: "live" as any,
      });
    }, [spotify.connected, spotify.premium]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (step.current !== "live" || !ride.active) return;
      step.current = "past";
      ride.startReplay([pastSeed ?? makeSeed("dev-past")], "Past Run");
    }); // eslint-disable-line react-hooks/exhaustive-deps

    return null;
  }

  it("sets deviceMismatch when the pinned device is reachable but a different device is active", async () => {
    // Mismatch scenario: kitchen is pinned AND in the device list (reachable),
    // but bedroom is the currently active device.
    // deviceMismatch=true holds the interstitial gate open.
    renderWithProvider(
      <>
        <LiveThenPastCrosser
          deviceToPin={PINNED_DEVICE}
          devicesToReturn={[{ ...PINNED_DEVICE, isActive: false }, ACTIVE_DEVICE_MISMATCH]}
        />
        <StateCapture />
      </>,
    );
    await flushAll(10, 20);
    // deviceMismatch=true blocks the auto-dismiss, so interstitial stays armed.
    expect(screen.getByTestId("interstitial").textContent).toBe("armed");
    expect(screen.getByTestId("device-mismatch").textContent).toBe("mismatch");
  });

  it("does NOT set deviceMismatch when the active device matches the pinned device", async () => {
    // ACTIVE_DEVICE_MATCH has the same id as PINNED_DEVICE but isActive=true.
    // pinnedReachable=true (id found in list) and it IS the active device → no mismatch.
    renderWithProvider(
      <>
        <LiveThenPastCrosser
          deviceToPin={PINNED_DEVICE}
          devicesToReturn={[ACTIVE_DEVICE_MATCH]}
        />
        <StateCapture />
      </>,
    );
    await flushAll(10, 20);
    // Advance past the interstitial tone duration so the gate dismisses.
    await flush(1600);
    // The crossing DID happen (arm-count = 1) but devices matched so no mismatch gate.
    expect(screen.getByTestId("arm-count").textContent).toBe("1");
    expect(screen.getByTestId("device-mismatch").textContent).toBe("ok");
    // Interstitial dismissed after the tone played (no deviceMismatch to block it).
    expect(screen.getByTestId("interstitial").textContent).toBe("idle");
  });

  it("does NOT set deviceMismatch when no device is pinned (Connect not configured)", async () => {
    // No pin → pinnedIdAtCrossing=null → early return → no mismatch.
    renderWithProvider(
      <>
        <LiveThenPastCrosser
          deviceToPin={null}
          devicesToReturn={[ACTIVE_DEVICE_MISMATCH]}
        />
        <StateCapture />
      </>,
    );
    await flushAll(10, 20);
    // Advance past the interstitial tone duration so the gate dismisses.
    await flush(1600);
    // Crossing happened but no mismatch gate (no pinned device → skip check).
    expect(screen.getByTestId("arm-count").textContent).toBe("1");
    expect(screen.getByTestId("device-mismatch").textContent).toBe("ok");
    expect(screen.getByTestId("interstitial").textContent).toBe("idle");
  });

  it("does NOT set deviceMismatch when the pinned device is unreachable (not in device list)", async () => {
    // Unreachable-pin scenario: kitchen is pinned but NOT in the device list
    // (fetchDevices clears the pin and shows its own toast).
    // Our crossing handler must not additionally show the mismatch gate.
    renderWithProvider(
      <>
        <LiveThenPastCrosser
          deviceToPin={PINNED_DEVICE}
          devicesToReturn={[ACTIVE_DEVICE_MISMATCH]} // kitchen absent → unreachable
        />
        <StateCapture />
      </>,
    );
    await flushAll(10, 20);
    // Advance past the interstitial tone duration so the gate dismisses.
    await flush(1600);
    // Crossing happened but no mismatch (pin unreachable → fetchDevices toast, not us).
    expect(screen.getByTestId("arm-count").textContent).toBe("1");
    expect(screen.getByTestId("device-mismatch").textContent).toBe("ok");
    expect(screen.getByTestId("interstitial").textContent).toBe("idle");
  });

  it("session flag: getSpotifyDevices called at most once across two live→past crossings", async () => {
    // deviceContinuityCheckedRef.current prevents a second fetchDevices call.
    function MultiCrosser() {
      const { ride, spotify } = usePlayer();
      const step = useRef<"init" | "live1" | "past1" | "live2" | "past2" | "done">("init");

      useEffect(() => {
        if (step.current !== "init" || !spotify.connected || !spotify.premium) return;
        step.current = "live1";
        // Return both devices: pinned (reachable, not active) + active (different room)
        mockGetSpotifyDevices.mockResolvedValue({
          devices: [{ ...PINNED_DEVICE, isActive: false }, ACTIVE_DEVICE_MISMATCH],
        });
        spotify.pinDevice(PINNED_DEVICE);
        ride.setPlaybackMode("resolve_to_service");
        ride.startReplay([makeSeed("mc-live1")], "Live 1", {
          timeOrientation: "live" as any,
        });
      }, [spotify.connected, spotify.premium]); // eslint-disable-line react-hooks/exhaustive-deps

      useEffect(() => {
        if (step.current !== "live1" || !ride.active) return;
        step.current = "past1";
        ride.startReplay([makeSeed("mc-past1")], "Past 1"); // 1st crossing
      }); // eslint-disable-line react-hooks/exhaustive-deps

      useEffect(() => {
        if (step.current !== "past1" || !ride.active) return;
        step.current = "live2";
        ride.startReplay([makeSeed("mc-live2")], "Live 2", {
          timeOrientation: "live" as any,
        });
      }); // eslint-disable-line react-hooks/exhaustive-deps

      useEffect(() => {
        if (step.current !== "live2" || !ride.active) return;
        step.current = "past2";
        ride.startReplay([makeSeed("mc-past2")], "Past 2"); // 2nd crossing — flag should block
      }); // eslint-disable-line react-hooks/exhaustive-deps

      return <span data-testid="mc-step">{step.current}</span>;
    }

    renderWithProvider(<><MultiCrosser /><StateCapture /></>);
    await flushAll(20, 20);

    // Session flag: getSpotifyDevices called AT MOST ONCE even across two crossings.
    const deviceFetchCalls = mockGetSpotifyDevices.mock.calls.length;
    expect(deviceFetchCalls).toBeLessThanOrEqual(1);
    // At least one crossing happened (arm-count >= 1).
    const armCount = parseInt(screen.getByTestId("arm-count").textContent ?? "0", 10);
    expect(armCount).toBeGreaterThanOrEqual(1);
    // Note: in the rapid multi-crossing scenario the stale device check is
    // discarded (ride token changed), so deviceMismatch may be false by the
    // time we assert. The important invariant is deviceFetchCalls <= 1 above.
  });

  it("no Spotify audio command while interstitialArmed; the Tier-1 queue-run fires after dismissDeviceMismatch clears the gate", async () => {
    // This test verifies the CORE SAFETY INVARIANT: no Spotify audio command
    // (per-track spotifyPlay OR Tier-1 bulk spotifyQueueRun) may fire while the
    // interstitial gate is armed and the crossing tone is playing.
    //
    // Mechanism:
    //   - useSpotifyDriver receives `active && !interstitialArmed` as its `active`
    //     prop → its play effect is suppressed during the crossing.
    //   - The Tier-1 queue-run effect returns early while interstitialArmed.
    //   - dismissDeviceMismatch() clears deviceMismatch → the crossing tone plays
    //     out → interstitialArmed clears → the Tier-1 queue-run fires (past
    //     replay at Tier 1 uses one bulk uris-array call, not per-track plays).

    // Add a "Confirm" button that calls dismissDeviceMismatch from inside the tree.
    function ConfirmButton() {
      const { ride } = usePlayer();
      return (
        <button
          type="button"
          data-testid="confirm-dismiss"
          onClick={() => ride.dismissDeviceMismatch()}
        />
      );
    }

    // Give the past seed a real Spotify link so the Tier-1 queue-run has a URI
    // for every queue item (missing URIs are a hard stop by design).
    const pastSeed: RideSeed = {
      ...makeSeed("dev-past-linked"),
      links: [
        {
          url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
          kind: "spotify",
        } as any,
      ],
    };

    // Track the audio-element play spy so we can assert the crossing tone
    // actually played during the armed window.
    const mediaPlaySpy = window.HTMLMediaElement.prototype.play as Mock;

    renderWithProvider(
      <>
        <LiveThenPastCrosser
          deviceToPin={PINNED_DEVICE}
          // Kitchen (pinned) is reachable but not active; bedroom is active.
          devicesToReturn={[{ ...PINNED_DEVICE, isActive: false }, ACTIVE_DEVICE_MISMATCH]}
          pastSeed={pastSeed}
        />
        <StateCapture />
        <ConfirmButton />
      </>,
    );

    // Let the crossing happen and device check settle.
    await flushAll(10, 20);
    expect(screen.getByTestId("interstitial").textContent).toBe("armed");
    expect(screen.getByTestId("device-mismatch").textContent).toBe("mismatch");

    // Reset call counters after the crossing — commands may have fired for the
    // preceding live ride. We care only about calls during the armed window.
    mockSpotifyPlay.mockClear();
    mockSpotifyQueueRun.mockClear();
    mediaPlaySpy.mockClear();

    // Flush a few more rounds while still armed — no audio command may fire.
    await flushAll(6, 20);

    // ── Critical assertions: NO Spotify audio command while gate is armed. ──
    expect(mockSpotifyPlay).not.toHaveBeenCalled();
    expect(mockSpotifyQueueRun).not.toHaveBeenCalled();

    // User confirms the device — clears deviceMismatch → the crossing tone plays.
    act(() => {
      screen.getByTestId("confirm-dismiss").click();
    });
    // The tone is now playing but has not finished: the gate must still be
    // armed and the queue-run still suppressed.
    await flushAll(5, 20);
    expect(mediaPlaySpy).toHaveBeenCalled(); // the interstitial tone started
    expect(screen.getByTestId("interstitial").textContent).toBe("armed");
    expect(mockSpotifyQueueRun).not.toHaveBeenCalled();

    // Let the interstitial tone play out (fallback timer ≥ asset duration).
    await flush(1600);
    // Extra settle rounds so the now-unsuppressed queue-run effect fires.
    await flushAll(10, 20);

    // Gate should be clear now.
    expect(screen.getByTestId("interstitial").textContent).toBe("idle");
    expect(screen.getByTestId("device-mismatch").textContent).toBe("ok");

    // ── Past replay actually starts: the Tier-1 bulk queue-run was called ──
    // with the past seed's URI after the gate cleared.
    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);
    expect(mockSpotifyQueueRun.mock.calls[0][0]).toMatchObject({
      uris: ["spotify:track:4uLU6hMCjMI75M1A2tKUQC"],
    });
  });
});

// ---------------------------------------------------------------------------
// 3. bufferOutrun state — true when preview is unresolved for current item
// ---------------------------------------------------------------------------
describe("bufferOutrun (provider integration)", () => {
  it("is false when ride is idle", async () => {
    renderWithProvider(<StateCapture />);
    await flush(0);
    expect(screen.getByTestId("buffer-outrun").textContent).toBe("ok");
  });

  it("is true when the current queue item has previewUrl undefined (in-flight fetch)", async () => {
    // getRecordingPreview never resolves (default) → previewUrl stays undefined
    // → active && !driverActive && currentMbid != null && currentPreview === undefined
    // → bufferOutrun = true.
    // Does NOT wait for Spotify to connect — startReplay works without it.
    const SEED_NOW = makeSeed("bufout");
    const SEED_NEXT = makeSeed("bufout-b");
    function DirectStarter() {
      const { ride } = usePlayer();
      const started = useRef(false);
      useEffect(() => {
        if (started.current) return;
        started.current = true;
        ride.startReplay([SEED_NOW, SEED_NEXT], "Test Run");
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    renderWithProvider(<><DirectStarter /><StateCapture /></>);
    await flushAll(4, 10);
    expect(screen.getByTestId("ride-active").textContent).toBe("yes");
    // With a never-resolving preview, previewUrl === undefined → bufferOutrun.
    expect(screen.getByTestId("buffer-outrun").textContent).toBe("outrun");
  });

  it("is false when previewUrl resolves to null (no preview — not in-flight)", async () => {
    (getRecordingPreview as Mock).mockResolvedValue({ previewUrl: null, artworkUrl: null });
    const SEED_NOW = makeSeed("bufnull");
    function DirectStarter() {
      const { ride } = usePlayer();
      const started = useRef(false);
      useEffect(() => {
        if (started.current) return;
        started.current = true;
        ride.startReplay([SEED_NOW], "Test Run");
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    renderWithProvider(<><DirectStarter /><StateCapture /></>);
    await flushAll(5, 10);
    expect(screen.getByTestId("ride-active").textContent).toBe("yes");
    // previewUrl resolved to null — bufferOutrun must be false (null ≠ undefined).
    expect(screen.getByTestId("buffer-outrun").textContent).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 4. RideBar renders "Finding this on [Service]…" when bufferOutrun is true
// ---------------------------------------------------------------------------
describe("RideBar buffer-outrun UI rendering", () => {
  it("renders 'Finding this…' chip when bufferOutrun is true", async () => {
    (getRecordingPreview as Mock).mockReturnValue(new Promise(() => {}));
    const { RideBar } = await import("../src/components/RideBar");

    // Does NOT wait for Spotify — startReplay works without it.
    const SEED_RB = makeSeed("ridebar-out");
    const SEED_RB2 = makeSeed("ridebar-out-b");
    function TestScene() {
      const { ride, spotify } = usePlayer();
      const started = useRef(false);
      useEffect(() => {
        if (started.current) return;
        started.current = true;
        ride.startReplay([SEED_RB, SEED_RB2], "Test Run");
      }, []); // eslint-disable-line react-hooks/exhaustive-deps

      if (!ride.active) return null;
      return <RideBar ride={ride} spotify={spotify} onStop={() => {}} />;
    }

    renderWithProvider(<TestScene />);
    await flushAll(4, 10);

    // The ride-buffer-outrun chip must be rendered with "Finding this" text.
    const el = screen.queryByTestId("ride-buffer-outrun");
    expect(el).not.toBeNull();
    expect(el!.textContent).toMatch(/Finding this/);
  });

  it("does NOT render buffer-outrun chip when previewUrl resolves", async () => {
    (getRecordingPreview as Mock).mockResolvedValue({
      previewUrl: "https://preview.example.com/track.mp3",
      artworkUrl: null,
    });
    const { RideBar } = await import("../src/components/RideBar");

    const SEED_OK = makeSeed("ridebar-ok");
    function TestScene() {
      const { ride, spotify } = usePlayer();
      const started = useRef(false);
      useEffect(() => {
        if (started.current) return;
        started.current = true;
        ride.startReplay([SEED_OK], "Test Run");
      }, []); // eslint-disable-line react-hooks/exhaustive-deps

      if (!ride.active) return null;
      return <RideBar ride={ride} spotify={spotify} onStop={() => {}} />;
    }

    renderWithProvider(<TestScene />);
    await flushAll(5, 10);

    // previewUrl resolved — chip must not appear.
    expect(screen.queryByTestId("ride-buffer-outrun")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Adaptive prefetch orientation gate — past/replay fires, live does not
// ---------------------------------------------------------------------------
describe("adaptive prefetch orientation gate (provider integration)", () => {
  beforeEach(() => {
    // Reset call count before each sub-test to avoid cross-test accumulation.
    (getRecordingPreview as Mock).mockClear();
  });

  it("calls getRecordingPreview ahead-of-index in past/replay orientation", async () => {
    (getRecordingPreview as Mock).mockResolvedValue({
      previewUrl: "https://preview.example.com/track.mp3",
      artworkUrl: null,
    });
    const SEED = makeSeed("pref-past");
    function Observer() {
      const { ride, spotify } = usePlayer();
      const started = useRef(false);
      useEffect(() => {
        if (started.current || !spotify.connected || !spotify.premium) return;
        started.current = true;
        ride.startReplay([SEED, makeSeed("pref-past-b")], "Test Run");
      }, [spotify.connected, spotify.premium]); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    renderWithProvider(<Observer />);
    await flushAll(5, 20);
    // Prefetch should have called getRecordingPreview for the next item.
    expect((getRecordingPreview as Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it("does NOT call getRecordingPreview for ahead-of-index items in live orientation (gate blocks prefetch)", async () => {
    (getRecordingPreview as Mock).mockResolvedValue({
      previewUrl: "https://preview.example.com/track.mp3",
      artworkUrl: null,
    });
    // Create both seeds before the component so we know their MBIDs.
    const SEED_CURRENT = makeSeed("pref-live-curr");
    const SEED_AHEAD = makeSeed("pref-live-next");
    function Observer() {
      const { ride, spotify } = usePlayer();
      const started = useRef(false);
      useEffect(() => {
        if (started.current || !spotify.connected || !spotify.premium) return;
        started.current = true;
        // Live orientation — the prefetch effect gate must block ahead-of-index fetches.
        ride.startReplay([SEED_CURRENT, SEED_AHEAD], "Live Set", {
          timeOrientation: "live" as any,
        });
      }, [spotify.connected, spotify.premium]); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    renderWithProvider(<Observer />);
    await flushAll(5, 20);
    // The AHEAD item must NOT have been prefetched in live orientation.
    // (The current item may be fetched by the playback effect for degradation,
    //  but the prefetch effect's orientation gate must block SEED_AHEAD.)
    const fetchedMbids = (getRecordingPreview as Mock).mock.calls.map(
      ([mbid]: [string]) => mbid,
    );
    expect(fetchedMbids).not.toContain(SEED_AHEAD.mbid);
  });
});

// ---------------------------------------------------------------------------
// 5. Tier-1 prefetch ownership — stale link lookups must not mark items as
//    fetched for a REPLACEMENT ride that reuses the same MBID.
// ---------------------------------------------------------------------------
describe("Tier-1 prefetch ownership across ride replacement", () => {
  it("re-fetches links for a replacement ride's item when the prior ride's lookup was still pending", async () => {
    const SHARED_MBID = "mbid-shared-replacement";
    const seedA: RideSeed = {
      mbid: SHARED_MBID, title: "Track A", artist: "Test Artist", artworkUrl: null, links: [],
    };
    const seedB: RideSeed = {
      mbid: SHARED_MBID, title: "Track B", artist: "Test Artist", artworkUrl: null, links: [],
    };

    // First getRecording call (ride A): a deferred promise we settle AFTER
    // ride B replaces the ride. Subsequent calls (ride B) resolve immediately
    // with a real Spotify link so the Tier-1 queue-run can fire.
    let resolveStale!: (v: { links: unknown[] }) => void;
    const stale = new Promise<{ links: unknown[] }>((res) => { resolveStale = res; });
    const { getRecording } = await import("@workspace/api-client-react");
    (getRecording as Mock)
      .mockImplementationOnce(() => stale)
      .mockImplementation(async () => ({
        links: [{ url: "https://open.spotify.com/track/7ouMYWpwJ422jRcDASZB7P", kind: "spotify" }],
      }));

    function Replacer() {
      const { ride, spotify } = usePlayer();
      const step = useRef<"init" | "pinned" | "rideA" | "rideB">("init");
      useEffect(() => {
        if (step.current !== "init" || !spotify.connected || !spotify.premium) return;
        step.current = "pinned";
        spotify.pinDevice(PINNED_DEVICE); // Tier 1 requires an active/pinned device
        ride.setPlaybackMode("resolve_to_service");
      }, [spotify.connected, spotify.premium]); // eslint-disable-line react-hooks/exhaustive-deps
      useEffect(() => {
        // Start ride A only once the pin has propagated to state, so the tier
        // selector sees hasActiveDevice=true and picks Tier 1.
        if (step.current !== "pinned" || !spotify.pinnedDevice) return;
        step.current = "rideA";
        ride.startReplay([seedA], "Ride A");
      }); // eslint-disable-line react-hooks/exhaustive-deps
      return (
        <button
          type="button"
          data-testid="start-ride-b"
          onClick={() => ride.startReplay([seedB], "Ride B")}
        />
      );
    }

    renderWithProvider(<><Replacer /><StateCapture /></>);
    // Ride A starts; its link lookup for SHARED_MBID is now pending (deferred).
    await flushAll(6, 20);
    expect((getRecording as Mock).mock.calls.some(([m]: [string]) => m === SHARED_MBID)).toBe(true);
    mockSpotifyQueueRun.mockClear();

    // Replace the ride while the lookup is still in flight.
    act(() => { screen.getByTestId("start-ride-b").click(); });
    await flushAll(2, 10);
    // NOW settle the stale ride-A request — after ride B reset the per-ride sets.
    await act(async () => { resolveStale({ links: [] }); await vi.advanceTimersByTimeAsync(10); });
    await flushAll(10, 20);

    // Ride B's item must NOT have been treated as already-fetched by the stale
    // settle: its own lookup runs, gets the Spotify link, and the Tier-1
    // queue-run fires with that URI instead of hard-stopping on a missing URI.
    expect(mockSpotifyQueueRun).toHaveBeenCalledTimes(1);
    expect(mockSpotifyQueueRun.mock.calls[0][0]).toMatchObject({
      uris: ["spotify:track:7ouMYWpwJ422jRcDASZB7P"],
    });
  });
});
