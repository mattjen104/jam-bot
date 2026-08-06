/**
 * Unit tests for the KEXP duration backfill job.
 *
 * Mocks @workspace/db and global fetch so these run without a real database
 * or MusicBrainz endpoint.
 *
 * Covered scenarios:
 *   - Completion ledger prevents a second run (no-op idempotency)
 *   - A recording MB reports without a length stays null (never written)
 *   - Completion ledger row is written after a successful run
 *   - Rate limiting: ≥1100ms gate is respected between successive MB fetches
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — hoisted automatically by Vitest
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      execute: vi.fn(),
      select: vi.fn(),
      selectDistinct: vi.fn(),
      update: vi.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports — after vi.mock so the mocked seams are wired
// ---------------------------------------------------------------------------

import { runKexpDurationBackfill } from "../src/lore/kexp-duration-backfill.js";
import { db } from "@workspace/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wire db.execute to simulate a NOT-yet-done ledger (empty rows). */
function setupLedgerNotDone() {
  vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never);
}

/** Wire db.execute to simulate an already-done ledger (one row found). */
function setupLedgerDone() {
  vi.mocked(db.execute).mockResolvedValue({ rows: [{}] } as never);
}

/** Wire db.select to return one fake KEXP station. */
function setupKexpStation() {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: 42 }]),
    }),
  } as never);
}

/** Wire db.update chain to succeed silently. */
function setupUpdateOk() {
  vi.mocked(db.update).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  } as never);
}

/** Build a minimal MB recording response body with an optional length. */
function mbBody(lengthMs: number | null): unknown {
  if (lengthMs === null) return { id: "test-mbid" };
  return { id: "test-mbid", length: lengthMs };
}

/** Stub global fetch to return a single MB response body. */
function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(body),
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runKexpDurationBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Completion ledger — re-run is a no-op
  // -------------------------------------------------------------------------

  it("skips immediately when the completion ledger row exists", async () => {
    setupLedgerDone();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const report = await runKexpDurationBackfill();

    expect(report.skippedAlreadyDone).toBe(true);
    expect(report.mbidsQueried).toBe(0);
    expect(report.mbidsUpdated).toBe(0);
    // No MB requests, no DB updates — nothing was done.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it("is idempotent: calling twice produces no-op on the second call", async () => {
    // First call: ledger not done
    setupLedgerNotDone();
    setupKexpStation();
    setupUpdateOk();
    stubFetch(mbBody(230_000));

    // Run first time with a single test MBID
    const first = await runKexpDurationBackfill(["mbid-aaa"]);
    expect(first.skippedAlreadyDone).toBe(false);
    expect(first.mbidsUpdated).toBe(1);

    // Second call: simulate ledger now present
    vi.clearAllMocks();
    setupLedgerDone();

    const second = await runKexpDurationBackfill(["mbid-aaa"]);
    expect(second.skippedAlreadyDone).toBe(true);
    expect(second.mbidsQueried).toBe(0);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // No-length recording stays null
  // -------------------------------------------------------------------------

  it("leaves duration_ms null when MB returns no length for a recording", async () => {
    setupLedgerNotDone();
    setupKexpStation();
    setupUpdateOk();
    // MB response with no `length` field
    stubFetch(mbBody(null));

    const report = await runKexpDurationBackfill(["mbid-no-length"]);

    expect(report.skippedAlreadyDone).toBe(false);
    expect(report.mbidsQueried).toBe(1);
    expect(report.mbidsNoLength).toBe(1);
    expect(report.mbidsUpdated).toBe(0);
    // DB update must never be called — null duration is never written
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it("leaves duration_ms null when MB returns length: 0", async () => {
    setupLedgerNotDone();
    setupKexpStation();
    setupUpdateOk();
    // length: 0 is treated as no-length (parseDurationMs returns null for <= 0)
    stubFetch({ id: "mbid-zero", length: 0 });

    const report = await runKexpDurationBackfill(["mbid-zero"]);

    expect(report.mbidsNoLength).toBe(1);
    expect(report.mbidsUpdated).toBe(0);
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Successful update path
  // -------------------------------------------------------------------------

  it("writes duration_ms to recordings when MB returns a positive length", async () => {
    setupLedgerNotDone();
    setupKexpStation();

    let capturedDuration: number | undefined;
    vi.mocked(db.update).mockImplementation(() => ({
      set: vi.fn().mockImplementation((vals: { durationMs?: number }) => {
        capturedDuration = vals.durationMs;
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    } as never));

    stubFetch(mbBody(240_000));

    const report = await runKexpDurationBackfill(["mbid-bbb"]);

    expect(report.mbidsUpdated).toBe(1);
    expect(report.mbidsNoLength).toBe(0);
    expect(capturedDuration).toBe(240_000);
  });

  it("writes the completion ledger row after a successful run", async () => {
    setupLedgerNotDone();
    setupKexpStation();
    setupUpdateOk();
    stubFetch(mbBody(180_000));

    await runKexpDurationBackfill(["mbid-ccc"]);

    // db.execute is called twice: once for the ledger check, once for the INSERT
    const executeCalls = vi.mocked(db.execute).mock.calls;
    expect(executeCalls.length).toBeGreaterThanOrEqual(2);
    // The last execute call should be the INSERT into migration_completions
    const lastCall = executeCalls[executeCalls.length - 1]?.[0];
    expect(lastCall).toBeTruthy();
    expect(typeof lastCall).toBe("object"); // Drizzle SQL object, not a raw string
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  it("respects the ≥1100ms rate-limit gate between successive MB fetches", async () => {
    setupLedgerNotDone();
    setupKexpStation();
    setupUpdateOk();

    vi.useFakeTimers();

    const fetchTimestamps: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        fetchTimestamps.push(Date.now());
        return { ok: true, json: async () => mbBody(200_000) };
      }),
    );

    // Run with 2 MBIDs — the second fetch must wait ≥1100ms after the first
    const backfillPromise = runKexpDurationBackfill(["mbid-r1", "mbid-r2"]);
    // Drain all pending timers (setTimeout calls from the rate-limit gate)
    await vi.runAllTimersAsync();
    await backfillPromise;

    expect(fetchTimestamps).toHaveLength(2);
    const gap = fetchTimestamps[1]! - fetchTimestamps[0]!;
    expect(gap).toBeGreaterThanOrEqual(1100);
  });

  // -------------------------------------------------------------------------
  // Error isolation — a failed MBID does not abort the batch
  // -------------------------------------------------------------------------

  it("counts a failed fetch as mbidsFailed and continues the batch", async () => {
    setupLedgerNotDone();
    setupKexpStation();
    setupUpdateOk();

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("network error");
        return { ok: true, json: async () => mbBody(180_000) };
      }),
    );

    const report = await runKexpDurationBackfill(["mbid-fail", "mbid-ok"]);

    expect(report.mbidsFailed).toBe(1);
    expect(report.mbidsUpdated).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Partial-failure → ledger NOT written → rerun retries failed MBIDs
  // -------------------------------------------------------------------------

  it("does NOT write the completion ledger when any MBID fails", async () => {
    setupLedgerNotDone();
    setupKexpStation();
    setupUpdateOk();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    const report = await runKexpDurationBackfill(["mbid-fail"]);

    expect(report.mbidsFailed).toBe(1);

    // db.execute should have been called exactly once: the ledger CHECK.
    // The ledger INSERT must NOT be present because failures occurred.
    const executeCalls = vi.mocked(db.execute).mock.calls;
    // All calls should only be the initial ledger check (SELECT 1 …)
    // — no INSERT into migration_completions.
    expect(executeCalls).toHaveLength(1);
  });

  it("allows a rerun to retry MBIDs that failed in a previous partial run", async () => {
    // First run: fetch fails for the target MBID.
    setupLedgerNotDone();
    setupKexpStation();
    setupUpdateOk();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("timeout")),
    );

    const first = await runKexpDurationBackfill(["mbid-retry"]);
    expect(first.mbidsFailed).toBe(1);
    // Ledger was NOT written — next call is not a no-op.
    expect(vi.mocked(db.execute).mock.calls).toHaveLength(1);

    // Second run: ledger still empty (not done), fetch now succeeds.
    vi.clearAllMocks();
    setupLedgerNotDone();
    setupKexpStation();
    setupUpdateOk();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mbBody(210_000)),
    }));

    const second = await runKexpDurationBackfill(["mbid-retry"]);
    expect(second.skippedAlreadyDone).toBe(false);
    expect(second.mbidsFailed).toBe(0);
    expect(second.mbidsUpdated).toBe(1);
    // Ledger IS written on the clean second run.
    const executeCalls = vi.mocked(db.execute).mock.calls;
    expect(executeCalls.length).toBeGreaterThanOrEqual(2);
  });
});
