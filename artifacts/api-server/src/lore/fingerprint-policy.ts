import type { Station } from "@workspace/db";
import { classifyFreshness } from "./freshness.js";

/**
 * Centralized trigger policy for ACR fingerprinting — the single place every
 * fingerprint entry point (the explicit "Identify this station" action, the
 * ListeningLogger's automatic fallback, the /fingerprint route) consults
 * before any audio is captured.
 *
 * Fingerprinting is precise but not free: every call runs ffmpeg (~8s of
 * stream capture) plus a billed ACRCloud identification. The policy keeps it
 * a targeted fallback, never a scan-hop default:
 *
 *   explicit           — a listener pressed "Identify this station".
 *   allowlist          — the station record carries `acrAllowlist: true` in
 *                        nowPlayingConfig (high-value, chronically unreliable
 *                        metadata; hand-curated, tiny).
 *   no_metadata_source — the station has no now-playing source at all, so
 *                        metadata can never arrive on its own.
 *   stale_metadata     — the newest spin is past the source's freshness
 *                        budget (classifyFreshness → "stale"), or the station
 *                        has never logged a spin.
 *
 * A healthy station (fresh/aging metadata, no allowlist flag) is NEVER
 * eligible for automatic fingerprinting — ordinary scanning costs stay zero.
 *
 * A per-station cooldown bounds spend for every trigger, explicit included:
 * even a listener mashing "Identify" can't run more than one capture per
 * station per cooldown window. The cooldown is in-memory (process-local) —
 * that is deliberate: it protects the ACR budget of THIS process's ffmpeg
 * runner, and a restart forgiving the window is harmless.
 */

export type FingerprintTrigger = "explicit" | "auto";

export type FingerprintEligibleReason =
  | "explicit"
  | "allowlist"
  | "no_metadata_source"
  | "stale_metadata";

export type FingerprintBlockedReason =
  | "no_stream_url"
  | "cooldown"
  | "healthy_metadata";

export type FingerprintDecision =
  | { eligible: true; reason: FingerprintEligibleReason }
  | { eligible: false; reason: FingerprintBlockedReason; retryAfterMs?: number };

/** Minimum gap between fingerprint captures of one station (any trigger). */
export const FINGERPRINT_COOLDOWN_MS = 2 * 60_000;

/** The station fields the policy needs — a full Station row satisfies this. */
export type FingerprintPolicyStation = Pick<
  Station,
  "id" | "streamUrl" | "nowPlayingSource" | "nowPlayingConfig"
>;

/** The newest spin's freshness inputs; null when the station has no spins. */
export interface LatestSpinObservation {
  source: string | null;
  observedAt: Date;
}

const lastRunAt = new Map<number, number>();

// Stations with a fingerprint request currently in flight. Admission must be
// atomic: two concurrent requests could otherwise both pass the cooldown
// check, both finish stage 1, and both bill an ACR capture. JS is
// single-threaded, so a synchronous check-and-add on this Set is a real lock
// across the request's async phases.
const inFlight = new Set<number>();

/**
 * Atomically reserve the station for one fingerprint request. Returns false
 * when another request already holds the reservation — the caller should
 * treat that exactly like a cooldown. On success the caller MUST call
 * `releaseFingerprintReservation` when the request finishes (any outcome).
 */
export function tryReserveFingerprint(stationId: number): boolean {
  if (inFlight.has(stationId)) return false;
  inFlight.add(stationId);
  return true;
}

/** Release the in-flight reservation taken by `tryReserveFingerprint`. */
export function releaseFingerprintReservation(stationId: number): void {
  inFlight.delete(stationId);
}

/** Whether the station record opts into the high-value ACR allowlist. */
export function isAcrAllowlisted(station: FingerprintPolicyStation): boolean {
  return station.nowPlayingConfig?.["acrAllowlist"] === true;
}

/**
 * Decide whether a fingerprint attempt may proceed for this station.
 * Pure aside from reading the cooldown map — call `markFingerprintRun`
 * only when a capture actually starts.
 */
export function evaluateFingerprintPolicy(
  station: FingerprintPolicyStation,
  latestSpin: LatestSpinObservation | null,
  trigger: FingerprintTrigger,
  now: Date = new Date(),
): FingerprintDecision {
  if (!station.streamUrl) {
    return { eligible: false, reason: "no_stream_url" };
  }

  // Cooldown applies to EVERY trigger — spend stays bounded per station.
  const last = lastRunAt.get(station.id);
  if (last != null) {
    const elapsed = now.getTime() - last;
    if (elapsed < FINGERPRINT_COOLDOWN_MS) {
      return {
        eligible: false,
        reason: "cooldown",
        retryAfterMs: FINGERPRINT_COOLDOWN_MS - elapsed,
      };
    }
  }

  if (trigger === "explicit") {
    return { eligible: true, reason: "explicit" };
  }

  if (isAcrAllowlisted(station)) {
    return { eligible: true, reason: "allowlist" };
  }

  if (!station.nowPlayingSource) {
    return { eligible: true, reason: "no_metadata_source" };
  }

  if (!latestSpin) {
    // A configured source that has never produced a spin is as good as no
    // metadata — the freshness classifier has nothing to classify.
    return { eligible: true, reason: "stale_metadata" };
  }

  const freshness = classifyFreshness(latestSpin.source, latestSpin.observedAt, now);
  if (freshness === "stale") {
    return { eligible: true, reason: "stale_metadata" };
  }

  return { eligible: false, reason: "healthy_metadata" };
}

/** Record that a fingerprint capture started for this station (arms the cooldown). */
export function markFingerprintRun(stationId: number, now: Date = new Date()): void {
  lastRunAt.set(stationId, now.getTime());
}

/** Tests only: clear all per-station cooldowns and in-flight reservations. */
export function _testOnly_resetFingerprintCooldowns(): void {
  lastRunAt.clear();
  inFlight.clear();
}
