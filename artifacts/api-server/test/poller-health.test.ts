import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
  };
});

import {
  classifyPollerHeartbeat,
  clearPollerHealthForTests,
  getPollerHealth,
  markPollerRosterEnrolled,
  POLLER_CYCLE_STALE_THRESHOLD_MS,
  POLLER_STALE_THRESHOLD_MS,
  recordPollerAttempt,
  recordPollerCompletion,
  startPollerHeartbeat,
} from "../src/lore/poller-health.js";

afterEach(() => {
  clearPollerHealthForTests();
});

describe("poller heartbeat classification", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  it("labels an active scheduler whose heartbeat stopped advancing as stalled", () => {
    const result = classifyPollerHeartbeat(
      {
        active: true,
        heartbeatAt: new Date(now.getTime() - POLLER_STALE_THRESHOLD_MS - 1),
        recoveryState: "healthy",
        cycleStartedAt: now,
        expectedStationCount: 10,
        enrolledStationCount: 10,
      },
      now,
    );

    expect(result.stale).toBe(true);
    expect(result.status).toBe("stalled");
  });

  it("keeps a freshly restarted scheduler in recovery until observations resume", () => {
    const result = classifyPollerHeartbeat(
      {
        active: true,
        heartbeatAt: new Date(now.getTime() - 1_000),
        recoveryState: "recovering",
        cycleStartedAt: now,
        expectedStationCount: 10,
        enrolledStationCount: 10,
      },
      now,
    );

    expect(result.stale).toBe(false);
    expect(result.status).toBe("recovering");
  });

  it("distinguishes a clean stop from a stale active process", () => {
    const result = classifyPollerHeartbeat(
      {
        active: false,
        heartbeatAt: new Date(now.getTime() - POLLER_STALE_THRESHOLD_MS * 2),
        recoveryState: "stopped",
        cycleStartedAt: now,
        expectedStationCount: 10,
        enrolledStationCount: 10,
      },
      now,
    );

    expect(result.stale).toBe(false);
    expect(result.status).toBe("stopped");
  });

  it("labels an overdue fleet cycle as stalled even while timer heartbeats are fresh", () => {
    const result = classifyPollerHeartbeat(
      {
        active: true,
        heartbeatAt: new Date(now.getTime() - 1_000),
        recoveryState: "healthy",
        cycleStartedAt: new Date(
          now.getTime() - POLLER_CYCLE_STALE_THRESHOLD_MS - 1,
        ),
        expectedStationCount: 14,
        enrolledStationCount: 14,
      },
      now,
    );

    expect(result.stale).toBe(true);
    expect(result.status).toBe("stalled");
  });

  it("publishes a completed fleet cycle only after every enrolled station finishes", async () => {
    await startPollerHeartbeat([10, 20, 30]);
    markPollerRosterEnrolled([10, 20, 30]);

    recordPollerAttempt(10);
    recordPollerCompletion(10, true);
    recordPollerCompletion(20, false);

    const partial = await getPollerHealth();
    expect(partial.lastCycleCompletedAt).toBeNull();
    expect(partial.currentAttemptedStationCount).toBe(2);

    recordPollerCompletion(30, true);

    const complete = await getPollerHealth();
    expect(complete.lastCycleCompletedAt).toBeInstanceOf(Date);
    expect(complete.attemptedStationCount).toBe(3);
    expect(complete.successfulStationCount).toBe(2);
    expect(complete.currentAttemptedStationCount).toBe(0);
    expect(complete.rosterComplete).toBe(true);
  });
});