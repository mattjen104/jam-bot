export interface LandingTimingSample {
  stationId: number;
  stationSlug: string;
  source: string;
  observationAgeMs: number | null;
  mismatch: boolean | null;
  confirmationLatencyMs: number | null;
  landingId?: string | null;
}

export interface BoundaryTimingSample {
  stationId: number;
  stationSlug: string;
  source: string;
  countdownErrorMs: number;
}

interface Profile {
  stationId: number;
  stationSlug: string;
  source: string;
  landings: number;
  mismatches: number;
  confirmations: number;
  observationAges: number[];
  confirmationLatencies: number[];
  boundaryErrors: number[];
  landingIds: Set<string>;
  confirmedLandingIds: Set<string>;
}

const profiles = new Map<string, Profile>();
const MAX_SAMPLES = 32;

function profileFor(stationId: number, stationSlug: string, source: string): Profile {
  const key = `${stationId}\u001f${source}`;
  let profile = profiles.get(key);
  if (!profile) {
    profile = {
      stationId,
      stationSlug,
      source,
      landings: 0,
      mismatches: 0,
      confirmations: 0,
      observationAges: [],
      confirmationLatencies: [],
      boundaryErrors: [],
      landingIds: new Set(),
      confirmedLandingIds: new Set(),
    };
    profiles.set(key, profile);
  }
  return profile;
}

function append(values: number[], value: number | null): void {
  if (value == null || !Number.isFinite(value)) return;
  values.push(value);
  if (values.length > MAX_SAMPLES) values.shift();
}

export function recordLandingTiming(sample: LandingTimingSample): void {
  const profile = profileFor(sample.stationId, sample.stationSlug, sample.source);
  const landingId =
    sample.landingId ??
    `${sample.stationId}:${profile.landings}:${Date.now()}`;
  if (!profile.landingIds.has(landingId)) {
    profile.landingIds.add(landingId);
    profile.landings += 1;
    if (sample.mismatch === true) profile.mismatches += 1;
    append(profile.observationAges, sample.observationAgeMs);
  }
  if (
    sample.confirmationLatencyMs != null &&
    !profile.confirmedLandingIds.has(landingId)
  ) {
    profile.confirmedLandingIds.add(landingId);
    profile.confirmations += 1;
    append(profile.confirmationLatencies, sample.confirmationLatencyMs);
  }
}

export function recordBoundaryTiming(sample: BoundaryTimingSample): void {
  append(
    profileFor(sample.stationId, sample.stationSlug, sample.source).boundaryErrors,
    sample.countdownErrorMs,
  );
}

function mean(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

export function getLiveTimingDiagnostics(): Array<{
  stationId: number;
  stationSlug: string;
  source: string;
  landingMismatchRate: number | null;
  meanObservationAgeMs: number | null;
  meanConfirmationLatencyMs: number | null;
  meanAbsoluteBoundaryErrorMs: number | null;
  boundarySamples: number;
}> {
  return [...profiles.values()].map((profile) => ({
    stationId: profile.stationId,
    stationSlug: profile.stationSlug,
    source: profile.source,
    landingMismatchRate: profile.landings
      ? profile.mismatches / profile.landings
      : null,
    meanObservationAgeMs: mean(profile.observationAges),
    meanConfirmationLatencyMs: mean(profile.confirmationLatencies),
    meanAbsoluteBoundaryErrorMs: mean(
      profile.boundaryErrors.map((value) => Math.abs(value)),
    ),
    boundarySamples: profile.boundaryErrors.length,
  }));
}

export function _testOnly_resetLiveTimingDiagnostics(): void {
  profiles.clear();
}
