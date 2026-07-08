// @vitest-environment node
/**
 * Integration tests for the blog-poller health state machine.
 *
 * These tests run against the real database (guarded by dbAvailable) and verify
 * that:
 *   - writeHealthFail correctly increments consecutive_failures from the DB
 *     (not from a stale in-memory snapshot)
 *   - After MAX_FAILURES consecutive failures, the picker is demoted to
 *     active=false and writeHealthFail returns true
 *   - writeHealthOk resets consecutive_failures to 0 and returns without error
 *   - Recovery (ok after prior failures) is correctly detected from DB state
 *   - Active flag is NOT automatically re-set to true by writeHealthOk —
 *     re-activation requires human review
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";

import { db, pickersTable, type PickerHealth } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

import {
  writeHealthOk,
  writeHealthFail,
  MAX_FAILURES,
} from "../src/lore/blog-poller.js";

let dbAvailable = false;
let testPickerId = -1;

const TEST_HANDLE = `blog-health-test-${Date.now()}`;

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Insert a fresh inactive blog picker for this test run.
  const [inserted] = await db
    .insert(pickersTable)
    .values({
      pickerType: "blog",
      name: "Health Test Blog",
      handle: TEST_HANDLE,
      homeUrl: "https://health-test.example",
      sourceRef: { feedUrl: "https://health-test.example/feed" },
      trustTier: 2,
      active: true,
    })
    .returning({ id: pickersTable.id });
  testPickerId = inserted!.id;
});

afterAll(async () => {
  if (!dbAvailable || testPickerId < 0) return;
  await db.delete(pickersTable).where(eq(pickersTable.id, testPickerId)).catch(() => {
    /* best-effort cleanup */
  });
});

afterEach(async () => {
  if (!dbAvailable || testPickerId < 0) return;
  // Reset to clean healthy state between tests.
  await db
    .update(pickersTable)
    .set({
      active: true,
      health: null,
      updatedAt: new Date(),
    })
    .where(eq(pickersTable.id, testPickerId));
});

// ---------------------------------------------------------------------------
// writeHealthFail — consecutive_failures accumulates from DB
// ---------------------------------------------------------------------------

describe("writeHealthFail — consecutive_failures accumulates from DB state", () => {
  it("reads fresh health from DB and increments consecutive_failures on each call", async () => {
    if (!dbAvailable) return;

    await writeHealthFail(testPickerId, "timeout 1");
    await writeHealthFail(testPickerId, "timeout 2");

    const [row] = await db
      .select({ health: pickersTable.health })
      .from(pickersTable)
      .where(eq(pickersTable.id, testPickerId))
      .limit(1);

    const health = row!.health as PickerHealth;
    expect(health.consecutive_failures).toBe(2);
    expect(health.last_error).toBe("timeout 2");
  });

  it("does NOT demote picker before MAX_FAILURES threshold", async () => {
    if (!dbAvailable) return;

    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      await writeHealthFail(testPickerId, `fail ${i + 1}`);
    }

    const [row] = await db
      .select({ active: pickersTable.active, health: pickersTable.health })
      .from(pickersTable)
      .where(eq(pickersTable.id, testPickerId))
      .limit(1);

    expect(row!.active).toBe(true);
    expect((row!.health as PickerHealth).consecutive_failures).toBe(MAX_FAILURES - 1);
  });

  it("demotes picker to active=false on the Nth (MAX_FAILURES) failure", async () => {
    if (!dbAvailable) return;

    let lastResult = false;
    for (let i = 0; i < MAX_FAILURES; i++) {
      lastResult = await writeHealthFail(testPickerId, `fail ${i + 1}`);
    }

    // writeHealthFail should return true (demoted) on the last call.
    expect(lastResult).toBe(true);

    const [row] = await db
      .select({ active: pickersTable.active, health: pickersTable.health })
      .from(pickersTable)
      .where(eq(pickersTable.id, testPickerId))
      .limit(1);

    expect(row!.active).toBe(false);
    expect((row!.health as PickerHealth).consecutive_failures).toBe(MAX_FAILURES);
  });

  it("continues incrementing past MAX_FAILURES without further side-effects", async () => {
    if (!dbAvailable) return;

    for (let i = 0; i < MAX_FAILURES + 2; i++) {
      await writeHealthFail(testPickerId, "fail");
    }

    const [row] = await db
      .select({ health: pickersTable.health })
      .from(pickersTable)
      .where(eq(pickersTable.id, testPickerId))
      .limit(1);

    expect((row!.health as PickerHealth).consecutive_failures).toBe(MAX_FAILURES + 2);
  });
});

// ---------------------------------------------------------------------------
// writeHealthOk — resets consecutive_failures; does NOT re-activate
// ---------------------------------------------------------------------------

describe("writeHealthOk — reset and recovery detection", () => {
  it("resets consecutive_failures to 0 and sets last_ok_at", async () => {
    if (!dbAvailable) return;

    // Simulate prior failures.
    await writeHealthFail(testPickerId, "fail 1");
    await writeHealthFail(testPickerId, "fail 2");

    await writeHealthOk(testPickerId);

    const [row] = await db
      .select({ health: pickersTable.health })
      .from(pickersTable)
      .where(eq(pickersTable.id, testPickerId))
      .limit(1);

    const health = row!.health as PickerHealth;
    expect(health.consecutive_failures).toBe(0);
    expect(health.last_ok_at).not.toBeNull();
    expect(health.last_error).toBeNull();
  });

  it("does NOT auto-re-activate a picker that was demoted to active=false", async () => {
    if (!dbAvailable) return;

    // Demote the picker by reaching MAX_FAILURES.
    for (let i = 0; i < MAX_FAILURES; i++) {
      await writeHealthFail(testPickerId, "fail");
    }

    // Now recovery — health resets but active stays false (needs human review).
    await writeHealthOk(testPickerId);

    const [row] = await db
      .select({ active: pickersTable.active, health: pickersTable.health })
      .from(pickersTable)
      .where(eq(pickersTable.id, testPickerId))
      .limit(1);

    // Active must stay false — re-activation is a manual admin action.
    expect(row!.active).toBe(false);
    // But the health snapshot is reset.
    expect((row!.health as PickerHealth).consecutive_failures).toBe(0);
  });

  it("works correctly on a picker with no prior health record (null health)", async () => {
    if (!dbAvailable) return;

    // Health is null from afterEach reset.
    await writeHealthOk(testPickerId);

    const [row] = await db
      .select({ health: pickersTable.health })
      .from(pickersTable)
      .where(eq(pickersTable.id, testPickerId))
      .limit(1);

    const health = row!.health as PickerHealth;
    expect(health.consecutive_failures).toBe(0);
    expect(health.last_ok_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Health state machine: full cycle
// ---------------------------------------------------------------------------

describe("health state machine — full demotion + recovery cycle", () => {
  it("demotes after MAX_FAILURES then records recovery stats correctly", async () => {
    if (!dbAvailable) return;

    // Step 1: accumulate MAX_FAILURES failures → demoted
    for (let i = 0; i < MAX_FAILURES; i++) {
      await writeHealthFail(testPickerId, `fail ${i + 1}`);
    }

    const [afterDemotion] = await db
      .select({ active: pickersTable.active, health: pickersTable.health })
      .from(pickersTable)
      .where(eq(pickersTable.id, testPickerId))
      .limit(1);
    expect(afterDemotion!.active).toBe(false);

    // Step 2: recovery — consecutive_failures resets, active stays false
    await writeHealthOk(testPickerId);

    const [afterRecovery] = await db
      .select({ active: pickersTable.active, health: pickersTable.health })
      .from(pickersTable)
      .where(eq(pickersTable.id, testPickerId))
      .limit(1);

    expect(afterRecovery!.active).toBe(false); // requires human review
    expect((afterRecovery!.health as PickerHealth).consecutive_failures).toBe(0);
    expect((afterRecovery!.health as PickerHealth).last_ok_at).not.toBeNull();
  });
});
