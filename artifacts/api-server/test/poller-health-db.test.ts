// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { applyPollerHealthMigration } from "../src/lore/poller-health-migration.js";

const healthKey = `poller-health-test-${randomUUID()}`;
let dbAvailable = false;

async function readRow() {
  const result = await db.execute(sql`
    SELECT
      owner_id AS "ownerId",
      process_started_at AS "processStartedAt",
      heartbeat_at AS "heartbeatAt",
      active,
      last_cycle_completed_at AS "lastCycleCompletedAt",
      attempted_station_count AS "attemptedStationCount",
      successful_station_count AS "successfulStationCount"
    FROM lore_poller_health
    WHERE key = ${healthKey}
  `);
  return result.rows[0] as
    | {
        ownerId: string;
        processStartedAt: Date | string;
        heartbeatAt: Date;
        active: boolean;
        lastCycleCompletedAt: Date | string | null;
        attemptedStationCount: number;
        successfulStationCount: number;
      }
    | undefined;
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    await applyPollerHealthMigration();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  vi.useRealTimers();
  if (dbAvailable) {
    await db.execute(sql`DELETE FROM lore_poller_health WHERE key = ${healthKey}`);
  }
});

describe("poller health rolling restart persistence", () => {
  it("keeps one deterministic owner when starts share the same timestamp", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00.000Z"));

    let releaseWinningOwner!: () => void;
    const winningOwnerGate = new Promise<void>((resolve) => {
      releaseWinningOwner = resolve;
    });

    vi.resetModules();
    const winningOwner = await import("../src/lore/poller-health.js");
    winningOwner.setPollerHealthKeyForTests(healthKey);
    winningOwner.setPollerOwnerIdForTests("owner-b");
    winningOwner.setPollerOwnershipGateForTests(winningOwnerGate);
    const winningOwnerStart = winningOwner.startPollerHeartbeat([10]);

    vi.resetModules();
    const losingOwner = await import("../src/lore/poller-health.js");
    losingOwner.setPollerHealthKeyForTests(healthKey);
    losingOwner.setPollerOwnerIdForTests("owner-a");
    await losingOwner.startPollerHeartbeat([10]);
    expect((await readRow())?.ownerId).toBe("owner-a");

    releaseWinningOwner();
    await winningOwnerStart;
    const stableWinner = await readRow();
    expect(stableWinner?.ownerId).toBe("owner-b");

    await losingOwner.persistPollerHeartbeatForTests(
      new Date("2026-09-07T10:01:00.000Z"),
    );
    await losingOwner.stopPollerHeartbeat();
    expect(await readRow()).toEqual(stableWinner);

    await winningOwner.stopPollerHeartbeat();
    await db.execute(sql`DELETE FROM lore_poller_health WHERE key = ${healthKey}`);
  });

  it("rejects an older owner's initial claim when its database write arrives late", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T11:00:00.000Z"));

    let releaseOwnerA!: () => void;
    const ownerAGate = new Promise<void>((resolve) => {
      releaseOwnerA = resolve;
    });

    vi.resetModules();
    const ownerA = await import("../src/lore/poller-health.js");
    ownerA.setPollerHealthKeyForTests(healthKey);
    ownerA.setPollerOwnershipGateForTests(ownerAGate);
    const ownerAStart = ownerA.startPollerHeartbeat([10]);

    await vi.advanceTimersByTimeAsync(1);
    vi.setSystemTime(new Date("2026-09-07T11:02:00.000Z"));
    vi.resetModules();
    const ownerB = await import("../src/lore/poller-health.js");
    ownerB.setPollerHealthKeyForTests(healthKey);
    await ownerB.startPollerHeartbeat([10]);

    const claimedByB = await readRow();
    expect(new Date(claimedByB!.processStartedAt)).toEqual(
      new Date("2026-09-07T11:02:00.000Z"),
    );

    releaseOwnerA();
    await ownerAStart;

    expect(await readRow()).toEqual(claimedByB);

    await ownerA.stopPollerHeartbeat();
    await ownerB.stopPollerHeartbeat();
    await db.execute(sql`DELETE FROM lore_poller_health WHERE key = ${healthKey}`);
  });

  it("rejects a retiring owner's late writes and carries cycle counters into the replacement", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00.000Z"));

    vi.resetModules();
    const ownerA = await import("../src/lore/poller-health.js");
    ownerA.setPollerHealthKeyForTests(healthKey);
    await ownerA.startPollerHeartbeat([10, 20, 30]);
    ownerA.markPollerRosterEnrolled([10, 20, 30]);
    ownerA.recordPollerCompletion(10, true);
    ownerA.recordPollerCompletion(20, false);
    ownerA.recordPollerCompletion(30, true);
    await ownerA.persistPollerHeartbeatForTests();

    const completedByA = await readRow();
    expect(completedByA?.attemptedStationCount).toBe(3);
    expect(completedByA?.successfulStationCount).toBe(2);
    expect(completedByA?.lastCycleCompletedAt).not.toBeNull();

    vi.setSystemTime(new Date("2026-09-07T12:02:00.000Z"));
    vi.resetModules();
    const ownerB = await import("../src/lore/poller-health.js");
    ownerB.setPollerHealthKeyForTests(healthKey);
    await ownerB.startPollerHeartbeat([10, 20, 30]);

    const takenOverByB = await readRow();
    expect(takenOverByB?.ownerId).not.toBe(completedByA?.ownerId);
    expect(takenOverByB?.active).toBe(true);
    expect(takenOverByB?.attemptedStationCount).toBe(3);
    expect(takenOverByB?.successfulStationCount).toBe(2);
    expect(takenOverByB?.lastCycleCompletedAt).toEqual(
      completedByA?.lastCycleCompletedAt,
    );

    vi.setSystemTime(new Date("2026-09-07T12:03:00.000Z"));
    await ownerA.persistPollerHeartbeatForTests();
    await ownerA.stopPollerHeartbeat();

    const afterLateOwnerA = await readRow();
    expect(afterLateOwnerA).toEqual(takenOverByB);

    await ownerB.persistPollerHeartbeatForTests();
    const afterOwnerBHeartbeat = await readRow();
    expect(afterOwnerBHeartbeat?.ownerId).toBe(takenOverByB?.ownerId);
    expect(afterOwnerBHeartbeat?.active).toBe(true);
    expect(afterOwnerBHeartbeat?.attemptedStationCount).toBe(3);
    expect(afterOwnerBHeartbeat?.successfulStationCount).toBe(2);
    expect(afterOwnerBHeartbeat?.lastCycleCompletedAt).toEqual(
      completedByA?.lastCycleCompletedAt,
    );

    await ownerB.stopPollerHeartbeat();
  });
});