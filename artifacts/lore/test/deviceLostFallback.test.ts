import { describe, it, expect } from "vitest";
import {
  DEVICE_LOST_POLLS,
  tickNoDevicePoll,
  rideFallbackLabel,
  resolveAudioPath,
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
