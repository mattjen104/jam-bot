/**
 * Ephemeral, privacy-safe playback telemetry. This intentionally stores no
 * listener identifiers, request addresses, session data, or device data.
 */
export const PLAYBACK_SAMPLE_LIMIT = 128;
export const PLAYBACK_STARTUP_DEGRADED_P95_MS = 8_000;
export const PLAYBACK_FAILURE_DEGRADED_RATE = 0.15;

export type PlaybackEvent = {
  stationSlug: string;
  transport: "https" | "http" | "relay";
  format: "aac" | "mp3" | "hls" | "flac" | "unknown";
  event: "playing" | "startup_failure" | "stall" | "recovered" | "terminal_failure";
  startupMs?: number;
  stallMs?: number;
};

type Bucket = {
  startupMs: number[];
  stallMs: number[];
  events: Record<PlaybackEvent["event"], number>;
};

const buckets = new Map<string, Bucket>();
export const playbackMonitoringSince = new Date();

function keyOf(event: PlaybackEvent): string {
  return `${event.stationSlug}\u0000${event.transport}\u0000${event.format}`;
}

function pushBounded(values: number[], value: number): void {
  values.push(value);
  if (values.length > PLAYBACK_SAMPLE_LIMIT) values.splice(0, values.length - PLAYBACK_SAMPLE_LIMIT);
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]!);
}

export function recordPlaybackEvent(event: PlaybackEvent): void {
  const key = keyOf(event);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      startupMs: [],
      stallMs: [],
      events: { playing: 0, startup_failure: 0, stall: 0, recovered: 0, terminal_failure: 0 },
    };
    buckets.set(key, bucket);
  }
  bucket.events[event.event]++;
  if (event.startupMs != null) pushBounded(bucket.startupMs, event.startupMs);
  if (event.stallMs != null) pushBounded(bucket.stallMs, event.stallMs);
}

export function getPlaybackHealth() {
  const summaries = [...buckets.entries()].map(([key, bucket]) => {
    const [stationSlug, transport, format] = key.split("\u0000");
    // terminal_failure is an extra exhaustion marker for an attempt already
    // counted as startup_failure; including it again would double-count.
    const attempts = bucket.events.playing + bucket.events.startup_failure;
    const failures = bucket.events.startup_failure;
    const failureRate = attempts ? failures / attempts : 0;
    const startupP95Ms = percentile(bucket.startupMs, 0.95);
    return {
      stationSlug: stationSlug!,
      transport: transport!,
      format: format!,
      sampleCount: bucket.startupMs.length,
      startupP50Ms: percentile(bucket.startupMs, 0.5),
      startupP95Ms,
      stallP50Ms: percentile(bucket.stallMs, 0.5),
      stallP95Ms: percentile(bucket.stallMs, 0.95),
      playingCount: bucket.events.playing,
      startupFailureCount: bucket.events.startup_failure,
      stallCount: bucket.events.stall,
      recoveryCount: bucket.events.recovered,
      terminalFailureCount: bucket.events.terminal_failure,
      failureRate,
      health: (startupP95Ms != null && startupP95Ms > PLAYBACK_STARTUP_DEGRADED_P95_MS) ||
        failureRate >= PLAYBACK_FAILURE_DEGRADED_RATE ? "degraded" : "healthy",
    };
  });
  return {
    monitoringSince: playbackMonitoringSince.toISOString(),
    thresholds: {
      startupP95DegradedMs: PLAYBACK_STARTUP_DEGRADED_P95_MS,
      failureRateDegraded: PLAYBACK_FAILURE_DEGRADED_RATE,
      sampleLimit: PLAYBACK_SAMPLE_LIMIT,
    },
    summaries,
  };
}

export function _testOnly_resetPlaybackHealth(): void {
  buckets.clear();
}