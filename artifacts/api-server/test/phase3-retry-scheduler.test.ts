/**
 * Unit tests for the off-peak Phase 3 retry SCHEDULER gate.
 *
 * Confirms that the setInterval callback inside startPhase3RetryScheduler:
 *   1. Calls runPhase3RetryPass when the UTC hour is inside [2, 6).
 *   2. Is a no-op when the UTC hour is outside [2, 6).
 *
 * Uses vi.useFakeTimers / vi.setSystemTime — no real waiting, no real DB.
 * The db mock returns [] from every select chain so runPhase3RetryPass
 * exits immediately after the first query; db.select call-count is the
 * observable proxy for "did the scheduler actually invoke the pass?"
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state — must be created before vi.mock() calls below.
// ---------------------------------------------------------------------------

const { mockDbSelect } = vi.hoisted(() => {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn().mockResolvedValue([]),
  };
  // Each method returns the same chain object so the fluent call
  // db.select({}).from(t).where(c).orderBy(e).limit(n) resolves to [].
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);

  const mockDbSelect = vi.fn().mockReturnValue(chain);
  return { mockDbSelect };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Replace only the `db` object; keep real table exports so drizzle-orm
// expression builders (eq, and, …) can still construct proper SQL objects.
vi.mock("@workspace/db", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...orig,
    db: {
      select: mockDbSelect,
      // insert / update / delete are not reached in the timer tests because
      // runPhase3RetryPass returns early when select returns [].
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn().mockResolvedValue([]),
    },
  };
});

// Stubs required by the me-router at module evaluation time.
vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

vi.mock("../src/lore/serviceConnector.js", () => ({
  getConnector: vi.fn().mockReturnValue({ importLibrary: vi.fn() }),
  getFreshServiceToken: vi.fn(),
  refreshServiceToken: vi.fn(),
}));

vi.mock("../src/lore/resolve.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lore/resolve.js")>();
  return { ...orig, resolveToMbid: vi.fn() };
});

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...orig,
    createMbResolver: vi.fn().mockReturnValue({
      resolveByIsrc: vi.fn().mockResolvedValue(null),
      resolveByText: vi.fn().mockResolvedValue(null),
    }),
  };
});

vi.mock("../src/lore/userSession.js", () => ({
  getUserFromSession: vi.fn(),
  getOrCreateAnonymousUser: vi.fn(),
  recoverUserByServiceId: vi.fn(),
  sidFromRequest: vi.fn(),
  upsertLoreUserForSid: vi.fn(),
  SID_COOKIE: "lore_sid",
  SID_MAX_AGE_MS: 0,
  cookieSidOpts: vi.fn().mockReturnValue({}),
}));

vi.mock("../src/lore/spotifyConnect.js", () => ({
  fetchProfile: vi.fn(),
  resolveSpotifyTrack: vi.fn(),
  trackIdFromUri: vi.fn(),
}));

vi.mock("../src/lore/for-you.js", () => ({
  getForYouStations: vi.fn(),
  getForYouBlogs: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Deferred import — after all mocks are registered.
// ---------------------------------------------------------------------------

import { startPhase3RetryScheduler } from "../src/routes/me/index.js";

// ---------------------------------------------------------------------------
// Constants (mirrors the values in me/index.ts — not exported so duplicated).
// ---------------------------------------------------------------------------

/** Must match PHASE3_RETRY_POLL_MS in me/index.ts (15 min). */
const SCHEDULER_POLL_MS = 15 * 60_000;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Build a Date whose UTC hour is exactly `utcHour` (minutes/seconds zeroed).
 */
function utcDate(utcHour: number): Date {
  const d = new Date("2026-07-31T00:00:00Z");
  d.setUTCHours(utcHour, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startPhase3RetryScheduler — off-peak gate (via fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDbSelect.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ── In-range hours: should invoke runPhase3RetryPass ─────────────────────

  it("calls runPhase3RetryPass at UTC hour 3 (mid-window)", async () => {
    vi.setSystemTime(utcDate(3));
    startPhase3RetryScheduler();

    // Advance by one full poll interval to fire the setInterval callback.
    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS);

    // runPhase3RetryPass queries the DB first; select being called confirms
    // the pass was invoked (it exits immediately on the empty [] result).
    expect(mockDbSelect).toHaveBeenCalled();
  });

  it("calls runPhase3RetryPass at UTC hour 2 (inclusive window start)", async () => {
    vi.setSystemTime(utcDate(2));
    startPhase3RetryScheduler();

    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS);

    expect(mockDbSelect).toHaveBeenCalled();
  });

  it("calls runPhase3RetryPass at UTC hour 5 (last in-range hour)", async () => {
    vi.setSystemTime(utcDate(5));
    startPhase3RetryScheduler();

    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS);

    expect(mockDbSelect).toHaveBeenCalled();
  });

  // ── Out-of-range hours: should be a no-op ────────────────────────────────

  it("is a no-op at UTC hour 12 (business hours)", async () => {
    vi.setSystemTime(utcDate(12));
    startPhase3RetryScheduler();

    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS);

    // The callback returned early before reaching runPhase3RetryPass,
    // so db.select must never have been called.
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("is a no-op at UTC hour 6 (exclusive window end)", async () => {
    vi.setSystemTime(utcDate(6));
    startPhase3RetryScheduler();

    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS);

    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("is a no-op at UTC hour 1 (just before the window)", async () => {
    vi.setSystemTime(utcDate(1));
    startPhase3RetryScheduler();

    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS);

    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("is a no-op at UTC hour 0 (midnight)", async () => {
    vi.setSystemTime(utcDate(0));
    startPhase3RetryScheduler();

    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS);

    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  // ── Multiple ticks confirm behaviour is repeatable ────────────────────────

  it("calls runPhase3RetryPass on every tick while inside the window", async () => {
    vi.setSystemTime(utcDate(3));
    startPhase3RetryScheduler();

    // Fire three poll intervals.
    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS * 3);

    // Each tick should have triggered a DB select.
    expect(mockDbSelect).toHaveBeenCalledTimes(3);
  });

  it("never calls runPhase3RetryPass across multiple ticks during the day", async () => {
    vi.setSystemTime(utcDate(14));
    startPhase3RetryScheduler();

    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS * 3);

    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
