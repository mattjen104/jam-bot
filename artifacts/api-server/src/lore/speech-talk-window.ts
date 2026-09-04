/**
 * Pure ranking for short speech samples.  It deliberately has no quota or
 * capture state: observing speech can make a station more interesting, but
 * cannot itself authorize an expensive capture.
 */
export interface TalkObservation {
  stationId: number;
  startedAt: Date;
  endedAt: Date;
  /** 0..1, from a local VAD/classifier. */
  speechConfidence: number;
}

export interface TalkWindowEstimate {
  stationId: number;
  score: number;
  speechMs: number;
  observations: number;
}

/** Estimate recent talk density, weighting newer observations more highly. */
export function estimateTalkWindows(
  observations: readonly TalkObservation[],
  now: Date,
  lookbackMs = 30 * 60_000,
): TalkWindowEstimate[] {
  const byStation = new Map<number, TalkWindowEstimate>();
  for (const observation of observations) {
    const end = observation.endedAt.getTime();
    const age = now.getTime() - end;
    if (age < 0 || age > lookbackMs || !Number.isFinite(observation.speechConfidence)) continue;
    const duration = Math.max(0, end - observation.startedAt.getTime());
    const confidence = Math.min(1, Math.max(0, observation.speechConfidence));
    const recency = 1 - age / lookbackMs;
    const prior = byStation.get(observation.stationId) ?? {
      stationId: observation.stationId, score: 0, speechMs: 0, observations: 0,
    };
    prior.score += duration * confidence * recency;
    prior.speechMs += duration * confidence;
    prior.observations++;
    byStation.set(observation.stationId, prior);
  }
  return [...byStation.values()].sort((a, b) => b.score - a.score || a.stationId - b.stationId);
}