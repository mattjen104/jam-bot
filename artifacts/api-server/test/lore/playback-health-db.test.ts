import { beforeEach, describe, expect, it } from "vitest";
import {
  PLAYBACK_HEALTH_RETENTION_DAYS,
  PLAYBACK_SAMPLE_LIMIT,
  _testOnly_resetPlaybackHealth,
  getPlaybackHealth,
  prunePlaybackHealthRollups,
  recordPlaybackEvent,
} from "../../src/lore/playback-health.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

describe("playback health aggregation", () => {
  beforeEach(async () => {
    await _testOnly_resetPlaybackHealth();
  });

  it("groups non-identifying events and exposes percentile health", async () => {
    await recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "playing", startupMs: 200 });
    await recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "playing", startupMs: 9_000 });
    await recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "stall", stallMs: 500 });
    const [summary] = (await getPlaybackHealth()).summaries;
    expect(summary).toMatchObject({
      stationSlug: "kexp", sampleCount: 2, startupP50Ms: 200,
      startupP95Ms: 9000, stallP95Ms: 500, health: "degraded",
    });
  });

  it("keeps duration samples bounded", async () => {
    for (let i = 0; i < PLAYBACK_SAMPLE_LIMIT + 5; i++) {
      await recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "playing", startupMs: i });
    }
    expect((await getPlaybackHealth()).summaries[0]!.sampleCount).toBe(PLAYBACK_SAMPLE_LIMIT);
  });

  it("does not double-count a terminal marker in the failure rate", async () => {
    await recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "startup_failure" });
    await recordPlaybackEvent({ stationSlug: "kexp", transport: "https", format: "aac", event: "terminal_failure" });
    expect((await getPlaybackHealth()).summaries[0]).toMatchObject({
      failureRate: 1,
      startupFailureCount: 1,
      terminalFailureCount: 1,
    });
  });

  it("keeps warmed and ordinary startup samples comparable without listener data", async () => {
    await recordPlaybackEvent({
      stationSlug: "kexp",
      transport: "https",
      format: "aac",
      event: "playing",
      startupMs: 120,
      warmed: true,
    });
    await recordPlaybackEvent({
      stationSlug: "kexp",
      transport: "https",
      format: "aac",
      event: "playing",
      startupMs: 320,
      warmed: false,
    });

    expect((await getPlaybackHealth()).summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warmed: true, startupP50Ms: 120 }),
        expect.objectContaining({ warmed: false, startupP50Ms: 320 }),
      ]),
    );
  });

  it("reports durable window metadata and survives a fresh read", async () => {
    await recordPlaybackEvent({
      stationSlug: "wdet",
      transport: "relay",
      format: "mp3",
      event: "playing",
      startupMs: 250,
    });
    const health = await getPlaybackHealth();
    expect(health).toMatchObject({
      rollupWindowDays: PLAYBACK_HEALTH_RETENTION_DAYS,
      lastSampleAt: expect.any(String),
      windowStartedAt: expect.any(String),
    });
    const windowStartedAt = new Date(health.windowStartedAt);
    expect([
      windowStartedAt.getUTCHours(),
      windowStartedAt.getUTCMinutes(),
      windowStartedAt.getUTCSeconds(),
      windowStartedAt.getUTCMilliseconds(),
    ]).toEqual([0, 0, 0, 0]);
    expect(health.summaries[0]).toMatchObject({
      stationSlug: "wdet",
      playingCount: 1,
    });
  });

  it("merges concurrent instance contributions without lost or duplicate counts", async () => {
    await Promise.all(
      Array.from({ length: 24 }, (_, startupMs) =>
        recordPlaybackEvent({
          stationSlug: "wfmu",
          transport: "https",
          format: "mp3",
          event: "playing",
          startupMs,
        }),
      ),
    );

    expect((await getPlaybackHealth()).summaries[0]).toMatchObject({
      stationSlug: "wfmu",
      playingCount: 24,
      sampleCount: 24,
    });
  });

  it("prunes expired buckets without waiting for another playback event", async () => {
    await db.execute(sql`
      INSERT INTO playback_health_rollups (
        station_slug,
        transport,
        format,
        bucket_started_at,
        playing_count,
        startup_samples,
        stall_samples,
        first_sample_at,
        last_sample_at
      )
      VALUES (
        'expired-playback-health-test',
        'https',
        'mp3',
        now() - ${PLAYBACK_HEALTH_RETENTION_DAYS + 2} * interval '1 day',
        1,
        ARRAY[100]::integer[],
        ARRAY[]::integer[],
        now() - ${PLAYBACK_HEALTH_RETENTION_DAYS + 2} * interval '1 day',
        now() - ${PLAYBACK_HEALTH_RETENTION_DAYS + 2} * interval '1 day'
      )
    `);

    await prunePlaybackHealthRollups();

    const result = await db.execute<{ count: number }>(sql`
      SELECT count(*)::integer AS count
      FROM playback_health_rollups
      WHERE station_slug = 'expired-playback-health-test'
    `);
    expect(result.rows[0]?.count).toBe(0);
  });
});