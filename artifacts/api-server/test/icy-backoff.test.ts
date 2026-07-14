/**
 * Unit tests for the ICY error-backoff gate in the radio_browser_icy adapter.
 *
 * The adapter is accessed via getNowPlayingAdapter("radio_browser_icy") so
 * the same code path used in production is exercised.  @workspace/db and the
 * ICY fetcher are mocked so these tests run without a real DB or network.
 *
 * Three cases:
 *  1. icyStatus="error" within the 30-minute window → adapter returns null
 *     and fetchIcyMetadata is NOT called.
 *  2. icyStatus="error" after the window expires → adapter DOES probe
 *     (fetchIcyMetadata called) and records the attempt time.
 *  3. A successful fetch resets icyStatus → "active" in the DB and clears
 *     the in-memory backoff entry so the next tick is not throttled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getNowPlayingAdapter,
  clearIcyErrorBackoff,
} from "../src/lore/adapters.js";

// ---------------------------------------------------------------------------
// Module mocks — hoisted automatically by Vitest
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn(),
      update: vi.fn(),
    },
  };
});

vi.mock("../src/lore/icy.js", () => ({
  fetchIcyMetadata: vi.fn(),
  parseStreamTitle: vi.fn((s: string) => {
    const parts = s.split(" - ");
    return parts.length >= 2
      ? { rawArtist: parts[0], rawTitle: parts[1] }
      : { rawArtist: parts[0], rawTitle: parts[0] };
  }),
  isJunkMetadata: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RB_ID = 99_001; // unique id to avoid cross-test backoff collisions
const STREAM_URL = "https://stream.example.com/test-icy";
const ADAPTER_CONFIG = { streamUrl: STREAM_URL, radioBrowserId: RB_ID };

/** Build the drizzle-shaped DB mock for select().from().where().limit() */
function mockSelectRow(row: Record<string, unknown> | null) {
  const rows = row ? [row] : [];
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

/** Build the drizzle-shaped DB mock for update().set().where().catch() */
function mockUpdate() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        catch: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

function makeErrorRow(overrides: Record<string, unknown> = {}) {
  return {
    icyStatus: "error",
    consecutiveErrors: 3,
    stationId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockDb: Awaited<ReturnType<typeof import("@workspace/db")>>["db"];
let mockFetchIcy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const { db } = await import("@workspace/db");
  mockDb = db;

  const icyModule = await import("../src/lore/icy.js");
  mockFetchIcy = icyModule.fetchIcyMetadata as ReturnType<typeof vi.fn>;

  vi.clearAllMocks();
  // Always clear the backoff entry for our test id so tests are independent.
  clearIcyErrorBackoff(RB_ID);
});

afterEach(() => {
  vi.useRealTimers();
  clearIcyErrorBackoff(RB_ID);
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ICY error-backoff gate", () => {
  it("skips fetchIcyMetadata within the 30-minute window after first probe", async () => {
    const adapter = getNowPlayingAdapter("radio_browser_icy");
    expect(adapter).not.toBeNull();

    // Arrange: DB always returns an error-status row.
    (mockDb.select as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockSelectRow(makeErrorRow()));
    (mockDb.update as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockUpdate());
    // ICY fetch returns a transient error so the adapter stays in error state.
    mockFetchIcy.mockResolvedValue({ ok: false, kind: "transient_error", message: "timeout" });

    // First call: no map entry → elapsed = enormous → probe attempt made.
    await adapter!(ADAPTER_CONFIG);
    const callsAfterFirst = mockFetchIcy.mock.calls.length;
    expect(callsAfterFirst).toBe(1); // confirmed probed once

    // Second call immediately: elapsed ≈ 0 → within 30-min window → SKIPPED.
    vi.clearAllMocks();
    // Re-configure mocks (clearAllMocks wipes them).
    (mockDb.select as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockSelectRow(makeErrorRow()));
    (mockDb.update as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockUpdate());

    await adapter!(ADAPTER_CONFIG);

    // fetchIcyMetadata must NOT have been called on the second tick.
    expect(mockFetchIcy).not.toHaveBeenCalled();
  });

  it("probes again once the 30-minute window has expired", async () => {
    vi.useFakeTimers();

    const adapter = getNowPlayingAdapter("radio_browser_icy");
    expect(adapter).not.toBeNull();

    (mockDb.select as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockSelectRow(makeErrorRow()));
    (mockDb.update as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockUpdate());
    mockFetchIcy.mockResolvedValue({ ok: false, kind: "transient_error", message: "timeout" });

    // First call populates the backoff map entry.
    await adapter!(ADAPTER_CONFIG);
    expect(mockFetchIcy).toHaveBeenCalledTimes(1);

    // Advance time past the 30-minute window (30 min + 1 ms).
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);

    vi.clearAllMocks();
    (mockDb.select as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockSelectRow(makeErrorRow()));
    (mockDb.update as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockUpdate());
    mockFetchIcy.mockResolvedValue({ ok: false, kind: "transient_error", message: "timeout" });

    // Second call after expiry → window elapsed → SHOULD probe.
    await adapter!(ADAPTER_CONFIG);

    expect(mockFetchIcy).toHaveBeenCalledTimes(1);
  });

  it("a successful fetch resets icyStatus to 'active' in the DB and clears the backoff entry", async () => {
    const adapter = getNowPlayingAdapter("radio_browser_icy");
    expect(adapter).not.toBeNull();

    // DB returns error status on select.
    (mockDb.select as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockSelectRow(makeErrorRow()));

    let updateSetArgs: Record<string, unknown> | null = null;
    (mockDb.update as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      set: vi.fn().mockImplementation((args: Record<string, unknown>) => {
        updateSetArgs = args;
        return {
          where: vi.fn().mockReturnValue({
            catch: vi.fn().mockResolvedValue(undefined),
          }),
        };
      }),
    }));

    // ICY fetch succeeds with a valid StreamTitle.
    mockFetchIcy.mockResolvedValue({
      ok: true,
      streamTitle: "Portishead - Glory Box",
      icyMetaint: 8192,
    });

    const result = await adapter!(ADAPTER_CONFIG);

    // Should return the parsed track.
    expect(result).not.toBeNull();
    expect(result?.rawTitle).toBe("Glory Box");

    // DB update should have been called with icyStatus "active".
    expect(mockDb.update).toHaveBeenCalled();
    expect(updateSetArgs).toMatchObject({
      icyStatus: "active",
      consecutiveErrors: 0,
    });

    // The in-memory backoff entry must have been cleared: a second call should
    // probe immediately (i.e. fetchIcyMetadata is called again), not skip.
    // To prove this, change the DB row to still show "error" and verify probe.
    vi.clearAllMocks();
    (mockDb.select as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockSelectRow(makeErrorRow()));
    (mockDb.update as ReturnType<typeof vi.fn>)
      .mockReturnValue(mockUpdate());
    mockFetchIcy.mockResolvedValue({
      ok: true,
      streamTitle: "Portishead - Glory Box",
      icyMetaint: 8192,
    });

    await adapter!(ADAPTER_CONFIG);
    // If backoff was NOT cleared, fetchIcyMetadata would be skipped (0 calls).
    // A call count of 1 confirms the entry was cleared by the successful fetch.
    expect(mockFetchIcy).toHaveBeenCalledTimes(1);
  });
});
