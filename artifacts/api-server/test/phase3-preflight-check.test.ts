/**
 * Unit tests for the pre-flight window estimate and multi-pass forward
 * progress of runPhase3RetryPass.
 *
 * Pre-flight suite: confirms that when uncachedEntries.length ×
 * IMPORT_RESOLVE_DELAY_MS exceeds the remaining window, the candidate is
 * skipped without starting resolution.
 *
 * Multi-pass suite: confirms that entries resolved on night 1 are excluded
 * from night 2's uncachedEntries (via the resolution-cache check), so the
 * nightly scheduler always makes forward progress rather than re-processing
 * the same entries each night.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const { mockDbSelect, mockDbInsert, mockDbUpdate, mockResolveByIsrc, mockResolveByText } =
  vi.hoisted(() => {
    const mockResolveByIsrc = vi.fn().mockResolvedValue(null);
    const mockResolveByText = vi.fn().mockResolvedValue(null);

    /**
     * Build a fluent Drizzle-like chain that resolves to `value` when awaited
     * at any step (.from, .where, .orderBy, .limit).  This covers both:
     *   - queries that end with .limit(n)  (candidates / snapshot selects)
     *   - queries awaited directly after .where()  (inArray cache-check)
     */
    function makeChain(value: unknown) {
      const resolved = Promise.resolve(value);
      const chain: Record<string, unknown> = {
        // Make the chain itself awaitable (thenable).
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          resolved.then(res, rej),
        catch: (rej: (e: unknown) => unknown) => resolved.catch(rej),
        finally: (fin: () => void) => resolved.finally(fin),
        limit: vi.fn().mockResolvedValue(value),
      };
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      return chain;
    }

    const mockDbSelect = vi.fn().mockReturnValue(makeChain([]));
    const mockDbInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        // Return a synthetic retry job so the resolution loop actually runs.
        returning: vi.fn().mockResolvedValue([{ id: 999 }]),
        onConflictDoNothing: vi.fn().mockReturnValue({
          catch: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    });
    const mockDbUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    return { mockDbSelect, mockDbInsert, mockDbUpdate, mockResolveByIsrc, mockResolveByText };
  });

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...orig,
    db: {
      select: mockDbSelect,
      insert: mockDbInsert,
      update: mockDbUpdate,
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
      execute: vi.fn().mockResolvedValue([]),
    },
  };
});

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
      resolveByIsrc: mockResolveByIsrc,
      resolveByText: mockResolveByText,
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

import { runPhase3RetryPass } from "../src/routes/me/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a large fake buffer with `count` entries, none of which will be in
 * the resolution cache (mockDbSelect returns [] for the cache check).
 */
function makeLargeBuffer(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    externalId: `spotify${i}`,
    artist: `Artist ${i}`,
    title: `Track ${i}`,
    isrc: null,
  }));
}

/**
 * Wire mockDbSelect so the first call returns `candidates` and all subsequent
 * calls return [] (simulating an empty resolution-cache lookup).
 * Both chains are thenable so they can be awaited at any point in the fluent
 * call chain (including after .where() for the inArray cache-check query).
 */
function setupSelectsForCandidates(candidates: unknown[]) {
  function makeChain(value: unknown) {
    const resolved = Promise.resolve(value);
    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        resolved.then(res, rej),
      catch: (rej: (e: unknown) => unknown) => resolved.catch(rej),
      finally: (fin: () => void) => resolved.finally(fin),
      limit: vi.fn().mockResolvedValue(value),
    };
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    return chain;
  }

  mockDbSelect
    .mockReturnValueOnce(makeChain(candidates)) // candidates query
    .mockReturnValue(makeChain([])); // all subsequent (cache check, etc.)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPhase3RetryPass — pre-flight window estimate", () => {
  const IMPORT_RESOLVE_DELAY_MS = 1100; // mirrors the constant in library.ts

  beforeEach(() => {
    mockDbSelect.mockClear();
    mockResolveByIsrc.mockClear();
    mockResolveByText.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips a candidate when estimated time exceeds the remaining window", async () => {
    // 200 tracks × 1 100 ms = 220 000 ms ≫ 500 ms remaining window.
    const buffer = makeLargeBuffer(200);
    const candidate = {
      id: 42,
      userId: "user-abc",
      service: "spotify",
      total: 200,
      resolved: 0,
      bufferJson: buffer,
      retryAttempts: 0,
    };

    setupSelectsForCandidates([candidate]);

    // Deadline 500 ms from now — far too tight for 200 tracks.
    const deadline = new Date(Date.now() + 500);

    await runPhase3RetryPass(deadline);

    // Resolution must not have been attempted.
    expect(mockResolveByIsrc).not.toHaveBeenCalled();
    expect(mockResolveByText).not.toHaveBeenCalled();
  });

  it("does not skip when estimated time fits within the remaining window", async () => {
    // 1 track × 1 100 ms = 1 100 ms ≪ 60 000 ms remaining window.
    const buffer = makeLargeBuffer(1);
    const candidate = {
      id: 43,
      userId: "user-def",
      service: "spotify",
      total: 1,
      resolved: 0,
      bufferJson: buffer,
      retryAttempts: 0,
    };

    setupSelectsForCandidates([candidate]);

    // Ample deadline (60 s) — well above the 1 100 ms estimate.
    const deadline = new Date(Date.now() + 60_000);

    await runPhase3RetryPass(deadline);

    // Resolution should have been attempted for the single entry.
    expect(mockResolveByIsrc).not.toHaveBeenCalled(); // no isrc on these entries
    expect(mockResolveByText).toHaveBeenCalled();
  });

  it("processes a partial slice when buffer exceeds remaining window but at least one entry fits", async () => {
    // 2 tracks × 1 100 ms = 2 200 ms, but only 2 199 ms remain.
    // maxFit = Math.floor(2199 / 1100) = 1 → should process 1 track, not skip.
    const buffer = makeLargeBuffer(2);
    const candidate = {
      id: 44,
      userId: "user-ghi",
      service: "spotify",
      total: 2,
      resolved: 0,
      bufferJson: buffer,
      retryAttempts: 0,
    };

    setupSelectsForCandidates([candidate]);

    // Remaining window = 2 tracks × 1100ms - 1ms = 2199ms → maxFit = 1.
    const deadline = new Date(Date.now() + 2 * IMPORT_RESOLVE_DELAY_MS - 1);

    await runPhase3RetryPass(deadline);

    // Resolution must have been attempted for the partial slice (1 entry).
    expect(mockResolveByText).toHaveBeenCalled();
  });

  it("skips without resolution when window is too small for even one entry", async () => {
    // 5 tracks × 1 100 ms = 5 500 ms, but remaining < 1 100 ms.
    // maxFit = Math.floor(remaining / 1100) = 0 → skip entirely, no retry attempt counted.
    const buffer = makeLargeBuffer(5);
    const candidate = {
      id: 46,
      userId: "user-mno",
      service: "spotify",
      total: 5,
      resolved: 0,
      bufferJson: buffer,
      retryAttempts: 0,
    };

    setupSelectsForCandidates([candidate]);

    // Remaining < one track's worth of delay → cannot process even one entry.
    const deadline = new Date(Date.now() + IMPORT_RESOLVE_DELAY_MS - 1);

    await runPhase3RetryPass(deadline);

    // Must not have attempted resolution.
    expect(mockResolveByIsrc).not.toHaveBeenCalled();
    expect(mockResolveByText).not.toHaveBeenCalled();
  });

  it("processes first 3 of 10 uncached entries when window fits exactly 3", async () => {
    // 10 entries × 1 100 ms = 11 000 ms, but window = 3 × 1 100 + 50 = 3 350 ms.
    // maxFit = Math.floor(3350 / 1100) = 3  →  exactly 3 resolution attempts.
    const buffer = makeLargeBuffer(10);
    const candidate = {
      id: 51,
      userId: "user-vwx",
      service: "spotify",
      total: 10,
      resolved: 0,
      bufferJson: buffer,
      retryAttempts: 0,
    };

    setupSelectsForCandidates([candidate]);

    const deadline = new Date(Date.now() + 3 * IMPORT_RESOLVE_DELAY_MS + 50);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runPhase3RetryPass(deadline);

    // Exactly 3 resolution attempts (one resolveByText per entry; no isrcs).
    expect(mockResolveByText).toHaveBeenCalledTimes(3);

    // The truncation warn log must mention both the slice count and total count.
    const allWarnArgs = warnSpy.mock.calls.flat().join(" ");
    expect(allWarnArgs).toMatch(/slicing to 3/);
    expect(allWarnArgs).toMatch(/10 valid entries/);

    warnSpy.mockRestore();
  });

  it("does not increment retry exhaustion counter when a truncated pass resolves at least one track", async () => {
    // Window fits 2 of 10 entries; the first resolves successfully.
    // retryResolved > 0 → exhaustion counter must be reset, not incremented.
    mockResolveByText.mockResolvedValueOnce("a1b2c3d4-e5f6-7890-1234-567890abcdef");

    const localSetMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });
    mockDbUpdate.mockReturnValue({ set: localSetMock });

    const buffer = makeLargeBuffer(10);
    const candidate = {
      id: 52,
      userId: "user-yz1",
      service: "spotify",
      total: 10,
      resolved: 0,
      bufferJson: buffer,
      retryAttempts: 0,
    };

    setupSelectsForCandidates([candidate]);

    // Window fits 2 entries — truncated pass, but first entry resolves.
    const deadline = new Date(Date.now() + 2 * IMPORT_RESOLVE_DELAY_MS + 50);

    await runPhase3RetryPass(deadline);

    // No set() call should have incremented retryAttempts.
    const hadExhaustionIncrement = localSetMock.mock.calls.some(
      ([args]) =>
        args != null &&
        typeof (args as Record<string, unknown>).retryAttempts === "number" &&
        (args as Record<string, unknown>).retryAttempts > 0,
    );
    expect(hadExhaustionIncrement).toBe(false);

    // The productive-pass reset (retryAttempts: 0) should have been called.
    const hadReset = localSetMock.mock.calls.some(
      ([args]) =>
        args != null &&
        (args as Record<string, unknown>).retryAttempts === 0,
    );
    expect(hadReset).toBe(true);
  });

  it("processes the candidate normally when no deadline is given", async () => {
    const buffer = makeLargeBuffer(1);
    const candidate = {
      id: 45,
      userId: "user-jkl",
      service: "spotify",
      total: 1,
      resolved: 0,
      bufferJson: buffer,
      retryAttempts: 0,
    };

    setupSelectsForCandidates([candidate]);

    // No deadline → pre-flight check is bypassed.
    await runPhase3RetryPass(/* deadline= */ undefined);

    expect(mockResolveByText).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Multi-pass forward-progress tests
  // ---------------------------------------------------------------------------

  it("night 2 excludes entries resolved on night 1 — no double-work across two consecutive passes", async () => {
    // NOTE: Two passes of N=3 entries each produce 6 × 1100ms sleeps (the MB
    // rate-limit delay after each resolve attempt).  The default vitest timeout
    // of 5s is not enough; this test is explicitly granted 20s.
    // Buffer: 2N entries (N=3), none with ISRC.
    // Night 1: cache empty → 6 uncached → window fits N=3 → resolveByText ×3.
    // Night 2: first N entries are now cached → 3 uncached (entries 3-5) →
    //          window fits N=3 → resolveByText ×3 more.
    // Total unique resolution attempts = 2N = 6 (no entry retried twice).
    const N = 3;
    const buffer = makeLargeBuffer(2 * N); // externalId: spotify0..spotify5

    const candidate = {
      id: 70,
      userId: "user-multipass",
      service: "spotify",
      total: 2 * N,
      resolved: 0,
      bufferJson: buffer,
      retryAttempts: 0,
    };

    function makeChain(value: unknown) {
      const resolved = Promise.resolve(value);
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          resolved.then(res, rej),
        catch: (rej: (e: unknown) => unknown) => resolved.catch(rej),
        finally: (fin: () => void) => resolved.finally(fin),
        limit: vi.fn().mockResolvedValue(value),
      };
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      return chain;
    }

    // Keys the resolution cache would hold after night 1 resolves entries 0..N-1.
    // normalizeKey("Artist i", "Track i") strips to lowercase ASCII + U+001F sep:
    //   "artist 0\u001ftrack 0", "artist 1\u001ftrack 1", "artist 2\u001ftrack 2"
    const night1CachedKeys = Array.from({ length: N }, (_, i) => ({
      key: `artist ${i}\u001ftrack ${i}`,
    }));

    // Select call sequence (4 calls per pass):
    //   1. candidates query
    //   2. cache check (inArray on resolutionCacheTable)
    //   3. newer snapshot query
    //   4. active job check
    mockDbSelect
      // ── Night 1 ──
      .mockReturnValueOnce(makeChain([candidate])) // 1. candidates
      .mockReturnValueOnce(makeChain([]))           // 2. cache check → empty
      .mockReturnValueOnce(makeChain([]))           // 3. newer snapshot → none
      .mockReturnValueOnce(makeChain([]))           // 4. active job check
      // ── Night 2 ──
      .mockReturnValueOnce(makeChain([candidate])) // 1. candidates (same job, still unresolved)
      .mockReturnValueOnce(makeChain(night1CachedKeys)) // 2. cache check → entries 0-2 cached
      .mockReturnValueOnce(makeChain([]))           // 3. newer snapshot → none
      .mockReturnValue(makeChain([]));              // 4. active job check + any further calls

    // Night 1: window fits exactly N entries (sliced by the pre-flight cap).
    const deadline1 = new Date(Date.now() + N * IMPORT_RESOLVE_DELAY_MS + 50);
    await runPhase3RetryPass(deadline1);

    const pass1Attempts = mockResolveByText.mock.calls.length;
    expect(pass1Attempts).toBe(N);

    // Night 2: uncachedEntries = entries 3-5 (entries 0-2 excluded by cache).
    // Window fits all remaining N entries.
    const deadline2 = new Date(Date.now() + N * IMPORT_RESOLVE_DELAY_MS + 50);
    await runPhase3RetryPass(deadline2);

    const totalAttempts = mockResolveByText.mock.calls.length;
    const pass2Attempts = totalAttempts - pass1Attempts;

    // Night 2 must have resolved exactly N new (previously uncached) entries.
    expect(pass2Attempts).toBe(N);

    // Grand total across both passes = 2N — no double-work.
    expect(totalAttempts).toBe(2 * N);

    // No artist+title pair appears in both passes.
    const pass1Args = mockResolveByText.mock.calls
      .slice(0, N)
      .map(([artist, title]: [string, string]) => `${artist}|${title}`);
    const pass2Args = mockResolveByText.mock.calls
      .slice(N)
      .map(([artist, title]: [string, string]) => `${artist}|${title}`);
    const uniqueAttempts = new Set([...pass1Args, ...pass2Args]);
    expect(uniqueAttempts.size).toBe(2 * N);
  }, 20_000);

  it("resolves valid entries deeper in the buffer when front entries are filtered by the snapshot", async () => {
    // Regression: with the old order (cap-then-filter), a window of 2 would
    // slice entries [0,1], the snapshot would filter both out, leaving nothing
    // to process — entries [2,3,4] would never be reached.
    //
    // With the correct order (filter-then-cap), the snapshot removes [0,1]
    // first, then the window cap takes [2,3] from the valid remainder.
    const buffer = makeLargeBuffer(5);

    const candidate = {
      id: 47,
      userId: "user-pqr",
      service: "spotify",
      total: 5,
      resolved: 0,
      bufferJson: buffer,
      retryAttempts: 0,
    };

    // Newer snapshot: only entries 2-4 are still in the user's library.
    const snapshotBuffer = buffer.slice(2);

    function makeChain(value: unknown) {
      const resolved = Promise.resolve(value);
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          resolved.then(res, rej),
        catch: (rej: (e: unknown) => unknown) => resolved.catch(rej),
        finally: (fin: () => void) => resolved.finally(fin),
        limit: vi.fn().mockResolvedValue(value),
      };
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      return chain;
    }

    // Select call order inside runPhase3RetryPass for the first candidate:
    //   1. candidates query
    //   2. cache check (inArray on resolutionCacheTable)
    //   3. newer snapshot query → snapshot with entries 2-4 only (entries 0-1 removed)
    //   4+ active job check and anything else
    mockDbSelect
      .mockReturnValueOnce(makeChain([candidate]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([{ id: 100, bufferJson: snapshotBuffer }]))
      .mockReturnValue(makeChain([]));

    // Window fits 2 entries — entries 0 and 1 (the filtered-out ones) would
    // consume the full slice under the old approach, leaving nothing to process.
    const deadline = new Date(Date.now() + 2 * IMPORT_RESOLVE_DELAY_MS + 50);

    await runPhase3RetryPass(deadline);

    // Resolution must have been attempted for valid entries from deeper in the buffer.
    expect(mockResolveByText).toHaveBeenCalled();
  });
});
