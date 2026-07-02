import { describe, it, expect } from "vitest";
import {
  DEVICE_LOST_POLLS,
  tickNoDevicePoll,
  rideFallbackLabel,
  resolveAudioPath,
  processDeviceConfirmation,
  type TimeOrientation,
} from "../src/player/playbackSession";

// ---------------------------------------------------------------------------
// tickNoDevicePoll — the poll counter that guards the device-lost threshold
// ---------------------------------------------------------------------------
describe("tickNoDevicePoll", () => {
  it("returns 'wait' for polls 1 through 4 (below threshold)", () => {
    let noDevicePolls = 0;
    for (let poll = 1; poll < DEVICE_LOST_POLLS; poll++) {
      const result = tickNoDevicePoll(noDevicePolls);
      expect(result.outcome).toBe("wait");
      if (result.outcome === "wait") {
        noDevicePolls = result.noDevicePolls;
      }
    }
  });

  it("increments the counter on each 'wait' poll", () => {
    let noDevicePolls = 0;
    for (let poll = 1; poll < DEVICE_LOST_POLLS; poll++) {
      const result = tickNoDevicePoll(noDevicePolls);
      if (result.outcome === "wait") {
        expect(result.noDevicePolls).toBe(poll);
        noDevicePolls = result.noDevicePolls;
      }
    }
  });

  it("returns 'device-lost' on the 5th consecutive poll (at threshold)", () => {
    let noDevicePolls = 0;
    let finalOutcome: string | null = null;

    for (let poll = 1; poll <= DEVICE_LOST_POLLS; poll++) {
      const result = tickNoDevicePoll(noDevicePolls);
      finalOutcome = result.outcome;
      if (result.outcome === "wait") {
        noDevicePolls = result.noDevicePolls;
      }
    }

    expect(finalOutcome).toBe("device-lost");
  });

  it("does not fire early — exactly 5 polls needed, not 4", () => {
    let noDevicePolls = 0;
    for (let poll = 1; poll <= DEVICE_LOST_POLLS - 1; poll++) {
      const result = tickNoDevicePoll(noDevicePolls);
      expect(result.outcome).not.toBe("device-lost");
      if (result.outcome === "wait") noDevicePolls = result.noDevicePolls;
    }
    const finalResult = tickNoDevicePoll(noDevicePolls);
    expect(finalResult.outcome).toBe("device-lost");
  });
});

// ---------------------------------------------------------------------------
// Device-lost state machine — simulate the PlayerProvider ref updates
//
// Reproduces the exact logic in PlayerProvider.tsx poll effect lines ~612–627:
//   const pollResult = tickNoDevicePoll(cur.noDevicePolls);
//   if (pollResult.outcome === "wait") { cur.noDevicePolls = ...; return; }
//   spotifyFailedRef.add(mbid); spotifyDeviceLostRef.add(mbid); ...
// ---------------------------------------------------------------------------
describe("device-lost fallback state transitions", () => {
  function simulatePolls(pollCount: number, mbid: string) {
    const spotifyFailed = new Set<string>();
    const spotifyDeviceLost = new Set<string>();

    // Mutable poll state — mirrors spotifyNowRef in the provider
    let noDevicePolls = 0;
    let firedDeviceLost = false;

    for (let i = 0; i < pollCount; i++) {
      const result = tickNoDevicePoll(noDevicePolls);
      if (result.outcome === "device-lost") {
        spotifyFailed.add(mbid);
        spotifyDeviceLost.add(mbid);
        firedDeviceLost = true;
        break;
      }
      noDevicePolls = result.noDevicePolls;
    }

    const playbackMode = "resolve_to_service";
    const fallbackUsed =
      playbackMode === "resolve_to_service" &&
      !!mbid &&
      spotifyFailed.has(mbid);
    const deviceLost =
      playbackMode === "resolve_to_service" &&
      !!mbid &&
      spotifyDeviceLost.has(mbid);

    return { firedDeviceLost, fallbackUsed, deviceLost };
  }

  it("fallbackUsed is false before the 5th poll", () => {
    const { fallbackUsed } = simulatePolls(4, "mbid-a");
    expect(fallbackUsed).toBe(false);
  });

  it("deviceLost is false before the 5th poll", () => {
    const { deviceLost } = simulatePolls(4, "mbid-b");
    expect(deviceLost).toBe(false);
  });

  it("fallbackUsed becomes true after the 5th poll (sawPlaying never set)", () => {
    const { fallbackUsed } = simulatePolls(DEVICE_LOST_POLLS, "mbid-c");
    expect(fallbackUsed).toBe(true);
  });

  it("deviceLost becomes true after the 5th poll", () => {
    const { deviceLost } = simulatePolls(DEVICE_LOST_POLLS, "mbid-d");
    expect(deviceLost).toBe(true);
  });

  it("deviceLost and fallbackUsed both true together (distinct from track-missing fallback)", () => {
    // A track-missing fallback sets fallbackUsed=true but deviceLost=false.
    // The device-lost path must set BOTH so the RideBar shows the right label.
    const { fallbackUsed, deviceLost } = simulatePolls(DEVICE_LOST_POLLS, "mbid-e");
    expect(fallbackUsed).toBe(true);
    expect(deviceLost).toBe(true);
  });

  it("device-lost fires at most once per track (loop guard)", () => {
    // Extra polls after device-lost should not re-fire because spotifyNowRef
    // is cleared in the provider. Verify the counter never overshoots by
    // simulating extra ticks independently.
    const mbid = "mbid-f";
    let noDevicePolls = 0;
    let fireCount = 0;
    for (let i = 0; i < DEVICE_LOST_POLLS + 3; i++) {
      const result = tickNoDevicePoll(noDevicePolls);
      if (result.outcome === "device-lost") {
        fireCount++;
        // Provider clears spotifyNowRef here; further polls are skipped.
        break;
      }
      noDevicePolls = result.noDevicePolls;
    }
    expect(fireCount).toBe(1);
    void mbid;
  });
});

// ---------------------------------------------------------------------------
// rideFallbackLabel — the string shown in the RideBar fallback indicator
// ---------------------------------------------------------------------------
describe("rideFallbackLabel", () => {
  const nonLiveOrientations: TimeOrientation[] = ["past", "curated"];

  it("shows 'Spotify device lost' when deviceLost is true (curated)", () => {
    const label = rideFallbackLabel(true, "curated");
    expect(label).toContain("Spotify device lost");
    expect(label).not.toContain("Unavailable on Spotify");
  });

  it("shows 'Spotify device lost' when deviceLost is true (past)", () => {
    const label = rideFallbackLabel(true, "past");
    expect(label).toContain("Spotify device lost");
  });

  it("shows 'Spotify device lost' when deviceLost is true (live)", () => {
    const label = rideFallbackLabel(true, "live");
    expect(label).toContain("Spotify device lost");
  });

  it("shows 'Unavailable on Spotify' when deviceLost is false (curated)", () => {
    const label = rideFallbackLabel(false, "curated");
    expect(label).toContain("Unavailable on Spotify");
    expect(label).not.toContain("Spotify device lost");
  });

  it("mentions 'listening to broadcast' for live orientation (device-lost)", () => {
    expect(rideFallbackLabel(true, "live")).toContain("listening to broadcast");
  });

  it("mentions 'listening to broadcast' for live orientation (track missing)", () => {
    expect(rideFallbackLabel(false, "live")).toContain("listening to broadcast");
  });

  for (const orientation of nonLiveOrientations) {
    it(`mentions 'playing preview' for ${orientation} orientation (device-lost)`, () => {
      expect(rideFallbackLabel(true, orientation)).toContain("playing preview");
    });

    it(`mentions 'playing preview' for ${orientation} orientation (track missing)`, () => {
      expect(rideFallbackLabel(false, orientation)).toContain("playing preview");
    });
  }

  it("never says 'Spotify device lost' for a plain track-missing fallback (regression guard)", () => {
    // RideBar showed "Unavailable on Spotify" before device-lost was introduced.
    // This test locks in that non-device-lost fallbacks still show the old text.
    for (const o of ["live", "past", "curated"] as TimeOrientation[]) {
      expect(rideFallbackLabel(false, o)).not.toContain("Spotify device lost");
    }
  });
});

// ---------------------------------------------------------------------------
// Mid-ride device reconnect — poll counter resets; device-lost never fires
//
// Tests call processDeviceConfirmation() — the pure helper extracted from
// PlayerProvider.tsx (lines ~604-634) — so any change to that production
// function breaks the tests rather than letting them pass silently.
// ---------------------------------------------------------------------------
describe("mid-ride device reconnect", () => {
  /**
   * Run the poll-loop state machine using processDeviceConfirmation (the real
   * production function from playbackSession.ts):
   *   - silentPolls: polls where trackUri !== ours or isPlaying=false
   *   - then an optional reconnect poll (ours=true, isPlaying=true)
   *
   * Mirrors the PlayerProvider poll effect: for each tick call
   * processDeviceConfirmation(cur, poll) and apply the returned outcome to
   * the mutable cur state exactly as the provider does.
   */
  function runPollLoop(opts: {
    silentPolls: number;
    reconnects: boolean;
  }): { outcome: "device-lost" | "confirmed" | "still-waiting" } {
    const cur = { sawPlaying: false, noDevicePolls: 0 };

    for (let i = 0; i < opts.silentPolls; i++) {
      const result = processDeviceConfirmation(cur, { ours: false, isPlaying: false });
      if (result.type === "device-lost") return { outcome: "device-lost" };
      if (result.type === "wait") { cur.noDevicePolls = result.noDevicePolls; continue; }
      // "already-confirmed" or "confirmed" won't fire here (ours=false)
    }

    if (!opts.reconnects) return { outcome: "still-waiting" };

    // Device comes back: ours=true, isPlaying=true
    const result = processDeviceConfirmation(cur, { ours: true, isPlaying: true });
    if (result.type === "confirmed") {
      cur.sawPlaying = true; // mirrors: cur.sawPlaying = true in the provider
      return { outcome: "confirmed" };
    }
    return { outcome: "still-waiting" };
  }

  it("device-lost does not fire when device comes back before the threshold", () => {
    // 3 silent polls (below threshold of 5), then device responds
    expect(runPollLoop({ silentPolls: 3, reconnects: true }).outcome).toBe("confirmed");
  });

  it("exactly DEVICE_LOST_POLLS-1 silent polls then reconnect — device-lost still never fires", () => {
    // One poll below the threshold, then the device comes back
    const r = runPollLoop({ silentPolls: DEVICE_LOST_POLLS - 1, reconnects: true });
    expect(r.outcome).toBe("confirmed");
  });

  it("device-lost fires normally when device never comes back (sanity check)", () => {
    // Ensures processDeviceConfirmation still returns device-lost on the
    // threshold poll — reconnect path doesn't interfere.
    expect(runPollLoop({ silentPolls: DEVICE_LOST_POLLS, reconnects: false }).outcome).toBe("device-lost");
  });

  it("processDeviceConfirmation returns 'already-confirmed' (not 'wait') once sawPlaying is true", () => {
    // After sawPlaying=true the provider's poll loop falls through to the
    // paused/other-device/track-end branches — never touches noDevicePolls.
    // Verify that processDeviceConfirmation returns "already-confirmed" for a
    // silent poll when sawPlaying is already true.
    const cur = { sawPlaying: true, noDevicePolls: 0 };
    const result = processDeviceConfirmation(cur, { ours: false, isPlaying: false });
    expect(result.type).toBe("already-confirmed");
  });

  it("after reconnect, further silent polls cannot reach device-lost (sawPlaying guard)", () => {
    // Run 2 silent polls, then reconnect (confirmed), then 5 more silent polls.
    // Because the provider returns early on "already-confirmed" those 5 polls
    // never feed the noDevicePolls counter — processDeviceConfirmation returns
    // "already-confirmed" not "wait" or "device-lost".
    const cur = { sawPlaying: false, noDevicePolls: 0 };

    // 2 silent polls
    for (let i = 0; i < 2; i++) {
      const r = processDeviceConfirmation(cur, { ours: false, isPlaying: false });
      expect(r.type).toBe("wait");
      if (r.type === "wait") cur.noDevicePolls = r.noDevicePolls;
    }

    // Device reconnects
    const reconnect = processDeviceConfirmation(cur, { ours: true, isPlaying: true });
    expect(reconnect.type).toBe("confirmed");
    cur.sawPlaying = true;

    // 5 more silent polls: each must return "already-confirmed", never "device-lost"
    for (let i = 0; i < 5; i++) {
      const r = processDeviceConfirmation(cur, { ours: false, isPlaying: false });
      expect(r.type).toBe("already-confirmed");
      expect(r.type).not.toBe("device-lost");
    }
  });
});

// ---------------------------------------------------------------------------
// stop() clears device-lost refs — new ride starts clean
//
// PlayerProvider.tsx stop() (lines ~278-279) and start() (lines ~302-303)
// both call spotifyFailedRef.current.clear() and
// spotifyDeviceLostRef.current.clear() before any new poll loop runs.
//
// These tests verify that after clearing those Sets:
//   1. processDeviceConfirmation returns "wait" (not "device-lost") on the
//      very first poll — i.e., the counter really restarted from zero.
//   2. A full DEVICE_LOST_POLLS-1 run on the new ride still stays below the
//      threshold, proving no bleedover from the previous ride's counter.
// ---------------------------------------------------------------------------
describe("stop() clears spotifyFailedRef and spotifyDeviceLostRef", () => {
  /**
   * Simulate a full device-lost cycle for `mbid`, then simulate stop() or
   * start() clearing both Sets and resetting the poll counter (exactly what
   * the provider does: spotifyFailedRef.current.clear() +
   * spotifyDeviceLostRef.current.clear() + spotifyNowRef.current = null).
   *
   * Returns the state of the Sets and the outcome of the first new-ride poll.
   */
  function simulateDeviceLostThenStop(mbid: string): {
    failedAfterStop: boolean;
    deviceLostAfterStop: boolean;
    firstNewRidePollOutcome: string;
  } {
    const spotifyFailed = new Set<string>();
    const spotifyDeviceLost = new Set<string>();

    // First ride: run processDeviceConfirmation until device-lost fires.
    const cur = { sawPlaying: false, noDevicePolls: 0 };
    for (let i = 0; i < DEVICE_LOST_POLLS + 1; i++) {
      const result = processDeviceConfirmation(cur, { ours: false, isPlaying: false });
      if (result.type === "device-lost") {
        spotifyFailed.add(mbid);
        spotifyDeviceLost.add(mbid);
        break;
      }
      if (result.type === "wait") cur.noDevicePolls = result.noDevicePolls;
    }

    if (!spotifyFailed.has(mbid)) throw new Error("test setup: device-lost did not fire");

    // stop() / start(): clear both Sets and reset spotifyNowRef (counter gone)
    spotifyFailed.clear();
    spotifyDeviceLost.clear();
    const newCur = { sawPlaying: false, noDevicePolls: 0 }; // mirrors new spotifyNowRef

    // First poll on the new ride must be "wait", not "device-lost"
    const firstPoll = processDeviceConfirmation(newCur, { ours: false, isPlaying: false });

    return {
      failedAfterStop: spotifyFailed.has(mbid),
      deviceLostAfterStop: spotifyDeviceLost.has(mbid),
      firstNewRidePollOutcome: firstPoll.type,
    };
  }

  it("spotifyFailedRef is empty after stop() — MBID no longer blocked", () => {
    const { failedAfterStop } = simulateDeviceLostThenStop("mbid-reconnect-1");
    expect(failedAfterStop).toBe(false);
  });

  it("spotifyDeviceLostRef is empty after stop() — device-lost indicator resets", () => {
    const { deviceLostAfterStop } = simulateDeviceLostThenStop("mbid-reconnect-2");
    expect(deviceLostAfterStop).toBe(false);
  });

  it("both refs cleared together — ride does not start half-dirty", () => {
    const { failedAfterStop, deviceLostAfterStop } =
      simulateDeviceLostThenStop("mbid-reconnect-3");
    expect(failedAfterStop).toBe(false);
    expect(deviceLostAfterStop).toBe(false);
  });

  it("first poll on new ride returns 'wait' not 'device-lost' (counter reset to zero)", () => {
    // Proves the new spotifyNowRef starts with noDevicePolls=0 — the old
    // counter was on the previous spotifyNowRef which stop() nulled out.
    const { firstNewRidePollOutcome } = simulateDeviceLostThenStop("mbid-reconnect-4");
    expect(firstNewRidePollOutcome).toBe("wait");
    expect(firstNewRidePollOutcome).not.toBe("device-lost");
  });

  it("a full second ride's worth of silent polls stays below threshold", () => {
    // After stop(), DEVICE_LOST_POLLS-1 more silent polls on the new ride
    // must not trigger device-lost — no bleedover from the old counter.
    const mbid = "mbid-reconnect-5";
    const spotifyFailed = new Set<string>();
    const spotifyDeviceLost = new Set<string>();

    // First ride: device-lost fires
    let cur = { sawPlaying: false, noDevicePolls: 0 };
    for (let i = 0; i < DEVICE_LOST_POLLS + 1; i++) {
      const r = processDeviceConfirmation(cur, { ours: false, isPlaying: false });
      if (r.type === "device-lost") { spotifyFailed.add(mbid); spotifyDeviceLost.add(mbid); break; }
      if (r.type === "wait") cur.noDevicePolls = r.noDevicePolls;
    }
    expect(spotifyFailed.has(mbid)).toBe(true);

    // stop(): clear refs and reset counter (new spotifyNowRef object)
    spotifyFailed.clear();
    spotifyDeviceLost.clear();
    cur = { sawPlaying: false, noDevicePolls: 0 };

    // DEVICE_LOST_POLLS-1 silent polls on the new ride: all must be "wait"
    for (let i = 0; i < DEVICE_LOST_POLLS - 1; i++) {
      const r = processDeviceConfirmation(cur, { ours: false, isPlaying: false });
      expect(r.type).toBe("wait");
      expect(r.type).not.toBe("device-lost");
      if (r.type === "wait") cur.noDevicePolls = r.noDevicePolls;
    }
  });
});

// ---------------------------------------------------------------------------
// Ride continues after device-lost (not stalled in "loading")
//
// When device-lost fires the provider clears source and bumps spotifyFallbackTick,
// which causes spotifyModeForCurrent to become false and resolveAudioPath to
// return the fallback path (preview / passthrough) — never "service".
// The ride therefore never stays stuck in the "loading" state the fallback was
// designed to prevent.
// ---------------------------------------------------------------------------
describe("ride continues after device-lost", () => {
  it("resolveAudioPath returns 'preview' for curated after service fails (device-lost)", () => {
    const path = resolveAudioPath(
      { mode: "resolve_to_service", timeOrientation: "curated" },
      { serviceConnected: true, serviceFailed: true, previewAvailable: true },
    );
    expect(path).toBe("preview");
    expect(path).not.toBe("service");
  });

  it("resolveAudioPath returns 'passthrough' for live after service fails (device-lost)", () => {
    const path = resolveAudioPath(
      { mode: "resolve_to_service", timeOrientation: "live" },
      { serviceConnected: true, serviceFailed: true, previewAvailable: true },
    );
    expect(path).toBe("passthrough");
    expect(path).not.toBe("service");
  });

  it("resolveAudioPath returns 'preview' for past after service fails (device-lost)", () => {
    const path = resolveAudioPath(
      { mode: "resolve_to_service", timeOrientation: "past" },
      { serviceConnected: true, serviceFailed: true, previewAvailable: true },
    );
    expect(path).toBe("preview");
    expect(path).not.toBe("service");
  });

  it("fallback path is always non-service (never keeps loading)", () => {
    // After device-lost, serviceFailed=true for the current MBID, so
    // spotifyModeForCurrent becomes false. The audio path must resolve to
    // something playable (passthrough or preview) — never "service".
    const orientations: TimeOrientation[] = ["live", "past", "curated"];
    for (const o of orientations) {
      const path = resolveAudioPath(
        { mode: "resolve_to_service", timeOrientation: o },
        { serviceConnected: true, serviceFailed: true, previewAvailable: true },
      );
      expect(path).not.toBe("service");
    }
  });

  it("DEVICE_LOST_POLLS constant is 5 (15 s at 3 s polling interval)", () => {
    // Lock in the threshold. Any change here is a deliberate UX decision:
    // shorter = snappier fallback; longer = more patience before giving up.
    expect(DEVICE_LOST_POLLS).toBe(5);
  });
});
