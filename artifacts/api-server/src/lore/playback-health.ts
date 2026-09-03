/**
 * Privacy-safe playback telemetry. This stores only aggregate station/source
 * rollups and bounded latency samples; it intentionally stores no listener
 * identifiers, request addresses, session data, or device data.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const PLAYBACK_SAMPLE_LIMIT = 128;
export const PLAYBACK_HEALTH_RETENTION_DAYS = 30;
export const PLAYBACK_HEALTH_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const PLAYBACK_STARTUP_DEGRADED_P95_MS = 8_000;
export const PLAYBACK_FAILURE_DEGRADED_RATE = 0.15;

export type PlaybackEvent = {
  stationSlug: string;
  transport: "https" | "http" | "relay";
  format: "aac" | "mp3" | "hls" | "flac" | "unknown";
  event: "playing" | "startup_failure" | "stall" | "recovered" | "terminal_failure";
  startupMs?: number;
  stallMs?: number;
  warmed?: boolean;
};

type RollupRow = {
  station_slug: string;
  transport: PlaybackEvent["transport"];
  format: PlaybackEvent["format"];
  warmed: boolean;
  bucket_started_at: Date | string;
  playing_count: number;
  startup_failure_count: number;
  stall_count: number;
  recovery_count: number;
  terminal_failure_count: number;
  startup_samples: number[];
  stall_samples: number[];
  first_sample_at: Date | string;
  last_sample_at: Date | string;
};

type WindowRow = {
  window_started_at: Date | string;
};

type Aggregate = {
  stationSlug: string;
  transport: PlaybackEvent["transport"];
  format: PlaybackEvent["format"];
  warmed: boolean;
  startupMs: number[];
  stallMs: number[];
  playingCount: number;
  startupFailureCount: number;
  stallCount: number;
  recoveryCount: number;
  terminalFailureCount: number;
  lastSampleAt: string;
};

/** Process start is retained as a compatibility export; the API reports the durable window. */
export const playbackMonitoringSince = new Date();

function utcBucketStartSql(): ReturnType<typeof sql> {
  return sql`date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
}

function utcWindowStartSql(): ReturnType<typeof sql> {
  return sql`${utcBucketStartSql()} - ${PLAYBACK_HEALTH_RETENTION_DAYS - 1} * interval '1 day'`;
}

function sampleArray(value: number | undefined): ReturnType<typeof sql> {
  return value == null
    ? sql`ARRAY[]::integer[]`
    : sql`ARRAY[${value}]::integer[]`;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]!);
}

function asSamples(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((sample): sample is number => typeof sample === "number" && Number.isFinite(sample))
    : [];
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function eventCounts(event: PlaybackEvent): {
  playing: number;
  startupFailure: number;
  stall: number;
  recovered: number;
  terminalFailure: number;
} {
  return {
    playing: event.event === "playing" ? 1 : 0,
    startupFailure: event.event === "startup_failure" ? 1 : 0,
    stall: event.event === "stall" ? 1 : 0,
    recovered: event.event === "recovered" ? 1 : 0,
    terminalFailure: event.event === "terminal_failure" ? 1 : 0,
  };
}

/**
 * Persist one event with a single atomic upsert. PostgreSQL evaluates the
 * increment and sample merge while holding the conflicting row lock, so two
 * API instances cannot lose each other's contribution.
 */
export async function recordPlaybackEvent(event: PlaybackEvent): Promise<void> {
  const counts = eventCounts(event);
  const startupSamples = sampleArray(event.startupMs);
  const stallSamples = sampleArray(event.stallMs);
  await db.execute(sql`
    INSERT INTO playback_health_rollups (
      station_slug,
      transport,
      format,
      warmed,
      bucket_started_at,
      playing_count,
      startup_failure_count,
      stall_count,
      recovery_count,
      terminal_failure_count,
      startup_samples,
      stall_samples,
      first_sample_at,
      last_sample_at
    )
    VALUES (
      ${event.stationSlug},
      ${event.transport},
      ${event.format},
      ${event.warmed === true},
      ${utcBucketStartSql()},
      ${counts.playing},
      ${counts.startupFailure},
      ${counts.stall},
      ${counts.recovered},
      ${counts.terminalFailure},
      ${startupSamples},
      ${stallSamples},
      now(),
      now()
    )
    ON CONFLICT (station_slug, transport, format, warmed, bucket_started_at)
    DO UPDATE SET
      playing_count = playback_health_rollups.playing_count + EXCLUDED.playing_count,
      startup_failure_count = playback_health_rollups.startup_failure_count + EXCLUDED.startup_failure_count,
      stall_count = playback_health_rollups.stall_count + EXCLUDED.stall_count,
      recovery_count = playback_health_rollups.recovery_count + EXCLUDED.recovery_count,
      terminal_failure_count = playback_health_rollups.terminal_failure_count + EXCLUDED.terminal_failure_count,
      startup_samples = CASE
        WHEN cardinality(playback_health_rollups.startup_samples || EXCLUDED.startup_samples) > ${PLAYBACK_SAMPLE_LIMIT}
        THEN (playback_health_rollups.startup_samples || EXCLUDED.startup_samples)[
          cardinality(playback_health_rollups.startup_samples || EXCLUDED.startup_samples) - ${PLAYBACK_SAMPLE_LIMIT} + 1:
          cardinality(playback_health_rollups.startup_samples || EXCLUDED.startup_samples)
        ]
        ELSE playback_health_rollups.startup_samples || EXCLUDED.startup_samples
      END,
      stall_samples = CASE
        WHEN cardinality(playback_health_rollups.stall_samples || EXCLUDED.stall_samples) > ${PLAYBACK_SAMPLE_LIMIT}
        THEN (playback_health_rollups.stall_samples || EXCLUDED.stall_samples)[
          cardinality(playback_health_rollups.stall_samples || EXCLUDED.stall_samples) - ${PLAYBACK_SAMPLE_LIMIT} + 1:
          cardinality(playback_health_rollups.stall_samples || EXCLUDED.stall_samples)
        ]
        ELSE playback_health_rollups.stall_samples || EXCLUDED.stall_samples
      END,
      last_sample_at = now()
  `);

}

/** Delete rows outside the same UTC window used by reads and writes. */
export async function prunePlaybackHealthRollups(): Promise<void> {
  await db.execute(sql`
    DELETE FROM playback_health_rollups
    WHERE bucket_started_at < ${utcWindowStartSql()}
  `);
}

let pruneTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Keep physical retention bounded even when no new playback events arrive.
 * Boot calls the prune once before arming this periodic backstop.
 */
export function startPlaybackHealthRetentionJob(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    void prunePlaybackHealthRollups().catch((error: unknown) => {
      console.error("[lore] playback-health retention prune failed", error);
    });
  }, PLAYBACK_HEALTH_PRUNE_INTERVAL_MS);
  pruneTimer.unref();
}

export async function getPlaybackHealth() {
  const [windowRow] = (await db.execute<WindowRow>(sql`
    SELECT ${utcWindowStartSql()} AS window_started_at
  `)).rows;
  if (!windowRow) {
    throw new Error("Playback-health window query returned no rows");
  }
  const windowStartedAt = asIso(windowRow.window_started_at);

  const rows = (await db.execute<RollupRow>(sql`
    SELECT
      station_slug,
      transport,
      format,
      warmed,
      bucket_started_at,
      playing_count,
      startup_failure_count,
      stall_count,
      recovery_count,
      terminal_failure_count,
      startup_samples,
      stall_samples,
      first_sample_at,
      last_sample_at
    FROM playback_health_rollups
    WHERE bucket_started_at >= ${utcWindowStartSql()}
    ORDER BY bucket_started_at ASC
  `)).rows;

  const aggregates = new Map<string, Aggregate>();
  let lastSampleAt: string | null = null;
  for (const row of rows) {
    const key = `${row.station_slug}\u0000${row.transport}\u0000${row.format}\u0000${row.warmed}`;
    let aggregate = aggregates.get(key);
    if (!aggregate) {
      aggregate = {
        stationSlug: row.station_slug,
        transport: row.transport,
        format: row.format,
        warmed: row.warmed,
        startupMs: [],
        stallMs: [],
        playingCount: 0,
        startupFailureCount: 0,
        stallCount: 0,
        recoveryCount: 0,
        terminalFailureCount: 0,
        lastSampleAt: asIso(row.last_sample_at),
      };
      aggregates.set(key, aggregate);
    }
    aggregate.startupMs.push(...asSamples(row.startup_samples));
    if (aggregate.startupMs.length > PLAYBACK_SAMPLE_LIMIT) {
      aggregate.startupMs.splice(0, aggregate.startupMs.length - PLAYBACK_SAMPLE_LIMIT);
    }
    aggregate.stallMs.push(...asSamples(row.stall_samples));
    if (aggregate.stallMs.length > PLAYBACK_SAMPLE_LIMIT) {
      aggregate.stallMs.splice(0, aggregate.stallMs.length - PLAYBACK_SAMPLE_LIMIT);
    }
    aggregate.playingCount += Number(row.playing_count);
    aggregate.startupFailureCount += Number(row.startup_failure_count);
    aggregate.stallCount += Number(row.stall_count);
    aggregate.recoveryCount += Number(row.recovery_count);
    aggregate.terminalFailureCount += Number(row.terminal_failure_count);
    aggregate.lastSampleAt = asIso(row.last_sample_at);
    if (lastSampleAt == null || aggregate.lastSampleAt > lastSampleAt) {
      lastSampleAt = aggregate.lastSampleAt;
    }
  }

  const summaries = [...aggregates.values()].map((aggregate) => {
    // terminal_failure is an extra exhaustion marker for an attempt already
    // counted as startup_failure; including it again would double-count.
    const attempts = aggregate.playingCount + aggregate.startupFailureCount;
    const failureRate = attempts ? aggregate.startupFailureCount / attempts : 0;
    const startupP95Ms = percentile(aggregate.startupMs, 0.95);
    return {
      stationSlug: aggregate.stationSlug,
      transport: aggregate.transport,
      format: aggregate.format,
      warmed: aggregate.warmed,
      sampleCount: aggregate.startupMs.length,
      startupP50Ms: percentile(aggregate.startupMs, 0.5),
      startupP95Ms,
      stallP50Ms: percentile(aggregate.stallMs, 0.5),
      stallP95Ms: percentile(aggregate.stallMs, 0.95),
      playingCount: aggregate.playingCount,
      startupFailureCount: aggregate.startupFailureCount,
      stallCount: aggregate.stallCount,
      recoveryCount: aggregate.recoveryCount,
      terminalFailureCount: aggregate.terminalFailureCount,
      failureRate,
      health: (startupP95Ms != null && startupP95Ms > PLAYBACK_STARTUP_DEGRADED_P95_MS) ||
        failureRate >= PLAYBACK_FAILURE_DEGRADED_RATE ? "degraded" : "healthy",
    };
  });

  return {
    // Kept for existing consumers; it now identifies the durable window rather
    // than this API process's start time.
    monitoringSince: windowStartedAt,
    windowStartedAt,
    lastSampleAt,
    rollupWindowDays: PLAYBACK_HEALTH_RETENTION_DAYS,
    thresholds: {
      startupP95DegradedMs: PLAYBACK_STARTUP_DEGRADED_P95_MS,
      failureRateDegraded: PLAYBACK_FAILURE_DEGRADED_RATE,
      sampleLimit: PLAYBACK_SAMPLE_LIMIT,
    },
    summaries,
  };
}

export async function _testOnly_resetPlaybackHealth(): Promise<void> {
  await db.execute(sql`DELETE FROM playback_health_rollups`);
}