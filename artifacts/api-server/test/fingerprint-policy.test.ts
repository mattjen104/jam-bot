import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateFingerprintPolicy,
  markFingerprintRun,
  tryReserveFingerprint,
  releaseFingerprintReservation,
  isAcrAllowlisted,
  FINGERPRINT_COOLDOWN_MS,
  _testOnly_resetFingerprintCooldowns,
  type FingerprintPolicyStation,
} from "../src/lore/fingerprint-policy.js";

/**
 * Unit tests for the centralized ACR fingerprint trigger policy:
 * each trigger condition (explicit, allowlist, metadata-less, stale),
 * the healthy-metadata block, and the per-station cooldown that applies
 * to every trigger.
 */

function station(over: Partial<FingerprintPolicyStation> = {}): FingerprintPolicyStation {
  return {
    id: 1,
    streamUrl: "https://example.invalid/stream",
    nowPlayingSource: null,
    nowPlayingConfig: null,
    ...over,
  };
}

const NOW = new Date("2026-08-15T12:00:00Z");
/** A fresh ICY observation (cadence 30s → fresh budget 60s). */
const freshSpin = { source: "radio_browser_icy", observedAt: new Date(NOW.getTime() - 10_000) };
/** A stale ICY observation (past 6× cadence = 180s). */
const staleSpin = { source: "radio_browser_icy", observedAt: new Date(NOW.getTime() - 10 * 60_000) };

beforeEach(() => {
  _testOnly_resetFingerprintCooldowns();
});

describe("evaluateFingerprintPolicy — trigger conditions", () => {
  it("explicit trigger is always eligible (subject to cooldown)", () => {
    const s = station({ nowPlayingSource: "radio_browser_icy" });
    expect(evaluateFingerprintPolicy(s, freshSpin, "explicit", NOW)).toEqual({
      eligible: true,
      reason: "explicit",
    });
  });

  it("auto: metadata-less station (no now-playing source) is eligible", () => {
    expect(evaluateFingerprintPolicy(station(), null, "auto", NOW)).toEqual({
      eligible: true,
      reason: "no_metadata_source",
    });
  });

  it("auto: stale observation is eligible", () => {
    const s = station({ nowPlayingSource: "radio_browser_icy" });
    expect(evaluateFingerprintPolicy(s, staleSpin, "auto", NOW)).toEqual({
      eligible: true,
      reason: "stale_metadata",
    });
  });

  it("auto: configured source that never produced a spin is eligible", () => {
    const s = station({ nowPlayingSource: "radio_browser_icy" });
    expect(evaluateFingerprintPolicy(s, null, "auto", NOW)).toEqual({
      eligible: true,
      reason: "stale_metadata",
    });
  });

  it("auto: allowlist flag makes even a fresh station eligible", () => {
    const s = station({
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { acrAllowlist: true },
    });
    expect(isAcrAllowlisted(s)).toBe(true);
    expect(evaluateFingerprintPolicy(s, freshSpin, "auto", NOW)).toEqual({
      eligible: true,
      reason: "allowlist",
    });
  });

  it("auto: healthy metadata (fresh, no allowlist) is BLOCKED", () => {
    const s = station({ nowPlayingSource: "radio_browser_icy" });
    expect(evaluateFingerprintPolicy(s, freshSpin, "auto", NOW)).toEqual({
      eligible: false,
      reason: "healthy_metadata",
    });
  });

  it("auto: aging (not yet stale) metadata is also blocked", () => {
    const s = station({ nowPlayingSource: "radio_browser_icy" });
    const aging = { source: "radio_browser_icy", observedAt: new Date(NOW.getTime() - 2 * 60_000) };
    expect(evaluateFingerprintPolicy(s, aging, "auto", NOW)).toEqual({
      eligible: false,
      reason: "healthy_metadata",
    });
  });

  it("missing stream URL blocks every trigger", () => {
    const s = station({ streamUrl: "" });
    expect(evaluateFingerprintPolicy(s, null, "explicit", NOW).eligible).toBe(false);
    expect(evaluateFingerprintPolicy(s, null, "auto", NOW).eligible).toBe(false);
  });
});

describe("evaluateFingerprintPolicy — per-station cooldown", () => {
  it("blocks every trigger within the cooldown window, then re-allows", () => {
    const s = station();
    markFingerprintRun(s.id, NOW);

    const during = new Date(NOW.getTime() + FINGERPRINT_COOLDOWN_MS / 2);
    const explicit = evaluateFingerprintPolicy(s, null, "explicit", during);
    expect(explicit).toMatchObject({ eligible: false, reason: "cooldown" });
    expect(
      explicit.eligible === false && (explicit.retryAfterMs ?? 0),
    ).toBeGreaterThan(0);
    expect(evaluateFingerprintPolicy(s, null, "auto", during)).toMatchObject({
      eligible: false,
      reason: "cooldown",
    });

    const after = new Date(NOW.getTime() + FINGERPRINT_COOLDOWN_MS + 1);
    expect(evaluateFingerprintPolicy(s, null, "auto", after).eligible).toBe(true);
  });

  it("cooldown is per-station — another station is unaffected", () => {
    markFingerprintRun(1, NOW);
    const other = station({ id: 2 });
    const during = new Date(NOW.getTime() + 1_000);
    expect(evaluateFingerprintPolicy(other, null, "auto", during).eligible).toBe(true);
  });
});

describe("in-flight reservation — atomic admission", () => {
  it("only one concurrent request can hold a station's reservation", () => {
    expect(tryReserveFingerprint(7)).toBe(true);
    expect(tryReserveFingerprint(7)).toBe(false); // concurrent second request
    expect(tryReserveFingerprint(8)).toBe(true); // other stations unaffected

    releaseFingerprintReservation(7);
    expect(tryReserveFingerprint(7)).toBe(true); // re-admittable after release
    releaseFingerprintReservation(7);
    releaseFingerprintReservation(8);
  });
});
