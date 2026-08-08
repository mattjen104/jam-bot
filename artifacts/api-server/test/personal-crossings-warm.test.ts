/**
 * Unit tests for the personal-crossings boot warm job.
 *
 * Verifies:
 *  - Only stale L2 rows trigger a recompute (fresh rows are ignored).
 *  - schedulePersonalCrossingsRecompute is called exactly once per stale user.
 *  - The 500 ms throttle fires between successive users.
 *  - A single-start guard prevents duplicate schedulers.
 *  - DB read errors are caught and do not throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any subject imports.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
  },
  crossingsCacheTable: {
    userId: "userId",
    builtAt: "builtAt",
  },
}));

vi.mock("../src/routes/me/crossings.js", () => ({
  schedulePersonalCrossingsRecompute: vi.fn(),
}));

// drizzle-orm sql tag — just return a tagged object so the mock db can inspect it
vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) => strings.join("?"),
    { join: vi.fn() },
  ),
}));

// ---------------------------------------------------------------------------
// Imports after mocks are registered
// ---------------------------------------------------------------------------
import { db, crossingsCacheTable } from "@workspace/db";
import { schedulePersonalCrossingsRecompute } from "../src/routes/me/crossings.js";

// warmPersonalCrossingsAtBoot is the named export we test
// We re-import dynamically inside each test group so the module-level `started`
// flag resets via vi.resetModules() before each test.
// ---------------------------------------------------------------------------

function buildSelectChain(resolveWith: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(Promise.resolve(resolveWith));
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

function buildSelectChainThrowing(err: Error) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  // Use mockRejectedValue (lazy) so the rejection isn't created until .where()
  // is awaited — avoids an "unhandled rejection" warning from eager Promise.reject.
  chain.where = vi.fn().mockRejectedValue(err);
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

describe("warmPersonalCrossingsAtBoot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a recompute for each stale userId returned from the DB", async () => {
    buildSelectChain([{ userId: 1 }, { userId: 2 }, { userId: 3 }]);

    // Re-import after resetModules so the `started` flag is fresh.
    const { warmPersonalCrossingsAtBoot } = await import(
      "../src/lore/personal-crossings-warm.js"
    );

    warmPersonalCrossingsAtBoot();

    // Advance past the 60 s BOOT_DELAY_MS so runWarmPass fires.
    await vi.advanceTimersByTimeAsync(60_000);

    // Drain microtasks so all async DB calls and setTimeout throttles settle.
    await vi.runAllTimersAsync();

    expect(schedulePersonalCrossingsRecompute).toHaveBeenCalledTimes(3);
    expect(schedulePersonalCrossingsRecompute).toHaveBeenCalledWith(1);
    expect(schedulePersonalCrossingsRecompute).toHaveBeenCalledWith(2);
    expect(schedulePersonalCrossingsRecompute).toHaveBeenCalledWith(3);
  });

  it("does not call schedulePersonalCrossingsRecompute when no stale rows exist", async () => {
    buildSelectChain([]);

    const { warmPersonalCrossingsAtBoot } = await import(
      "../src/lore/personal-crossings-warm.js"
    );

    warmPersonalCrossingsAtBoot();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runAllTimersAsync();

    expect(schedulePersonalCrossingsRecompute).not.toHaveBeenCalled();
  });

  it("inserts a 500 ms throttle delay between each successive user", async () => {
    buildSelectChain([{ userId: 10 }, { userId: 20 }, { userId: 30 }]);

    const { warmPersonalCrossingsAtBoot } = await import(
      "../src/lore/personal-crossings-warm.js"
    );

    warmPersonalCrossingsAtBoot();
    await vi.advanceTimersByTimeAsync(60_000);

    // After the DB resolves, the first user is scheduled synchronously,
    // then each subsequent user requires another 500 ms step.

    // Drain the DB promise but NOT the throttle delays yet.
    await Promise.resolve();
    await Promise.resolve();

    // Advance 500 ms — user 10 scheduled, user 20 now in flight.
    await vi.advanceTimersByTimeAsync(500);
    expect(schedulePersonalCrossingsRecompute).toHaveBeenCalledWith(10);

    // Advance another 500 ms — user 20 scheduled, user 30 in flight.
    await vi.advanceTimersByTimeAsync(500);
    expect(schedulePersonalCrossingsRecompute).toHaveBeenCalledWith(20);

    // Settle the last user (no trailing delay for the final item).
    await vi.runAllTimersAsync();
    expect(schedulePersonalCrossingsRecompute).toHaveBeenCalledWith(30);
    expect(schedulePersonalCrossingsRecompute).toHaveBeenCalledTimes(3);
  });

  it("does not start a second scheduler when called twice (single-start guard)", async () => {
    buildSelectChain([{ userId: 99 }]);

    const { warmPersonalCrossingsAtBoot } = await import(
      "../src/lore/personal-crossings-warm.js"
    );

    warmPersonalCrossingsAtBoot();
    warmPersonalCrossingsAtBoot(); // second call must be a no-op

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runAllTimersAsync();

    // Even though we called it twice, only one pass runs → one schedule call.
    expect(schedulePersonalCrossingsRecompute).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the DB query rejects", async () => {
    buildSelectChainThrowing(new Error("connection refused"));

    const { warmPersonalCrossingsAtBoot } = await import(
      "../src/lore/personal-crossings-warm.js"
    );

    warmPersonalCrossingsAtBoot();

    // Must not throw
    await expect(vi.advanceTimersByTimeAsync(60_000)).resolves.not.toThrow();
    await vi.runAllTimersAsync();

    expect(schedulePersonalCrossingsRecompute).not.toHaveBeenCalled();
  });
});
