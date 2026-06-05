import { describe, it, expect, vi, beforeEach } from "vitest";

// Deterministic, seed-independent fixtures: mock the curated seed so the
// lookup/gate tests don't break when the real seed is edited. The timing
// logic (selectDueInsights / InsightScheduler) takes insights directly and
// doesn't touch the seed at all.
vi.mock("../../../lib/song-enrichment/src/insights-seed.js", () => ({
  seedTrackInsights: [
    {
      label: "Track One",
      isrc: "AAAA11110001",
      insights: [
        { positionMs: 5000, text: "second" },
        { positionMs: 1000, text: "first" },
      ],
    },
    {
      label: "Track Two (both ids)",
      isrc: "BBBB22220002",
      recordingId: "mb-rec-2",
      insights: [{ positionMs: 2000, text: "two" }],
    },
    {
      label: "Track Three (recording id only)",
      recordingId: "mb-rec-3",
      insights: [{ positionMs: 3000, text: "three" }],
    },
  ],
}));

// insights.ts now lives in @workspace/song-enrichment and reads config/logger by
// the lib's own relative paths, so the mocks must target the lib modules. The
// logger mock also re-provides setEnrichmentLogger so the lib's barrel (and the
// test-setup wiring) keep their named export.
vi.mock("../../../lib/song-enrichment/src/config.js", () => ({
  config: {
    TRACK_INSIGHTS_ENABLED: true,
    TRACK_INSIGHTS_POLL_MS: 1000,
    TRACK_INSIGHTS_MIN_GAP_MS: 8000,
  },
}));

vi.mock("../../../lib/song-enrichment/src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  setEnrichmentLogger: vi.fn(),
}));

const {
  insightsEnabled,
  hasSeedData,
  getInsightsFor,
  selectDueInsights,
  InsightScheduler,
} = await import("../../../lib/song-enrichment/src/insights.js");
const { config } = await import("../../../lib/song-enrichment/src/config.js");

type Insight = { positionMs: number; text: string };

beforeEach(() => {
  (config as { TRACK_INSIGHTS_ENABLED: boolean }).TRACK_INSIGHTS_ENABLED = true;
});

describe("insightsEnabled / data gate", () => {
  it("is enabled with the flag on and curated seed present", () => {
    expect(hasSeedData()).toBe(true);
    expect(insightsEnabled()).toBe(true);
  });

  it("is disabled when the master flag is off, even with seed data", () => {
    (config as { TRACK_INSIGHTS_ENABLED: boolean }).TRACK_INSIGHTS_ENABLED =
      false;
    expect(hasSeedData()).toBe(true);
    expect(insightsEnabled()).toBe(false);
  });
});

describe("getInsightsFor", () => {
  it("matches by ISRC, case-insensitively, sorted by position", () => {
    const out = getInsightsFor({ isrc: "aaaa11110001" });
    expect(out.map((i) => i.text)).toEqual(["first", "second"]);
    expect(out.map((i) => i.positionMs)).toEqual([1000, 5000]);
  });

  it("matches by MusicBrainz recording id", () => {
    expect(getInsightsFor({ recordingId: "mb-rec-3" }).map((i) => i.text)).toEqual(
      ["three"],
    );
  });

  it("dedupes when both ids point at the same curated track", () => {
    const out = getInsightsFor({ isrc: "BBBB22220002", recordingId: "mb-rec-2" });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("two");
  });

  it("returns [] for unknown ids and for no ids", () => {
    expect(getInsightsFor({ isrc: "NOPE" })).toEqual([]);
    expect(getInsightsFor({ recordingId: "nope" })).toEqual([]);
    expect(getInsightsFor({})).toEqual([]);
  });
});

const sample: Insight[] = [
  { positionMs: 1000, text: "a" },
  { positionMs: 2000, text: "b" },
  { positionMs: 3000, text: "c" },
];

describe("selectDueInsights (pure timing)", () => {
  it("returns insights crossed in (baseline, cur], sorted", () => {
    const due = selectDueInsights(sample, 0, 2000, new Set());
    expect(due.map((i) => i.text)).toEqual(["a", "b"]);
  });

  it("never fires a note at or before the baseline (joined mid-track)", () => {
    // Baseline 1500: the note at 1000 is already passed and must be skipped.
    const due = selectDueInsights(sample, 1500, 3000, new Set());
    expect(due.map((i) => i.text)).toEqual(["b", "c"]);
  });

  it("excludes already-fired positions", () => {
    const due = selectDueInsights(sample, 0, 3000, new Set([2000]));
    expect(due.map((i) => i.text)).toEqual(["a", "c"]);
  });

  it("fires a note exactly at the baseline (right now, not backfill)", () => {
    // Joined exactly at 2000: the note at 2000 is "now" and fires; earlier
    // notes are skipped, later ones aren't due yet.
    expect(selectDueInsights(sample, 2000, 2000, new Set()).map((i) => i.text)).toEqual(
      ["b"],
    );
  });

  it("fires a 0:00 note on a track started from the top (baseline 0)", () => {
    const fromTop: Insight[] = [
      { positionMs: 0, text: "intro" },
      { positionMs: 1000, text: "verse" },
    ];
    expect(selectDueInsights(fromTop, 0, 0, new Set()).map((i) => i.text)).toEqual([
      "intro",
    ]);
  });

  it("returns nothing when the clock is before the baseline (backward jump)", () => {
    expect(selectDueInsights(sample, 2000, 1500, new Set())).toEqual([]);
  });
});

describe("InsightScheduler.tick", () => {
  function mk(opts?: { minGapMs?: number; pos?: number | null }) {
    const state = { pos: opts?.pos ?? 0 as number | null };
    const posts: Insight[] = [];
    const read = vi.fn(() => state.pos);
    const sched = new InsightScheduler(
      read,
      (ins) => {
        posts.push(ins);
      },
      { minGapMs: opts?.minGapMs ?? 0 },
    );
    return { sched, posts, read, state };
  }

  it("does nothing until armed", () => {
    const { sched, posts } = mk({ pos: 5000 });
    expect(sched.tick(0)).toEqual([]);
    expect(posts).toEqual([]);
  });

  it("arm([]) leaves the scheduler disarmed", () => {
    const { sched } = mk();
    sched.arm([], 0);
    expect(sched.isArmed()).toBe(false);
  });

  it("re-arming with [] clears a previously-armed track's pending notes", () => {
    // Guards the normal-Jam path: when the next track has no ISRC we arm([]),
    // which must drop the prior track's insights so none of them leak onto the
    // new (unidentified) track.
    const { sched, posts, state } = mk({ minGapMs: 0 });
    sched.arm(sample, 0);
    sched.arm([], 0); // next track: nothing curated / no ISRC
    expect(sched.isArmed()).toBe(false);
    state.pos = 3000; // all of the OLD notes would be "due" by position
    sched.tick(0);
    sched.tick(100);
    expect(posts).toEqual([]);
  });

  it("fires the earliest due note, one per tick, and dedupes", () => {
    const { sched, posts, state } = mk({ minGapMs: 0 });
    sched.arm(sample, 0);

    state.pos = 2500; // both a(1000) and b(2000) are due
    expect(sched.tick(0).map((i) => i.text)).toEqual(["a"]);
    expect(sched.tick(100).map((i) => i.text)).toEqual(["b"]);
    // nothing new due yet
    expect(sched.tick(200)).toEqual([]);

    state.pos = 3000;
    expect(sched.tick(300).map((i) => i.text)).toEqual(["c"]);
    // never re-fires
    expect(sched.tick(400)).toEqual([]);
    expect(posts.map((p) => p.text)).toEqual(["a", "b", "c"]);
  });

  it("honors the baseline set at arm time", () => {
    const { sched, posts, state } = mk();
    sched.arm(sample, 1500); // joined after the 1000ms note
    state.pos = 3000;
    sched.tick(0);
    sched.tick(100);
    sched.tick(200);
    expect(posts.map((p) => p.text)).toEqual(["b", "c"]);
  });

  it("throttles to at most one note per minGapMs", () => {
    const { sched, posts, state } = mk({ minGapMs: 8000 });
    sched.arm(sample, 0);
    state.pos = 3000; // all three due

    expect(sched.tick(0).map((i) => i.text)).toEqual(["a"]);
    // within the gap: suppressed
    expect(sched.tick(1000)).toEqual([]);
    expect(sched.tick(7999)).toEqual([]);
    // gap elapsed: next note
    expect(sched.tick(8000).map((i) => i.text)).toEqual(["b"]);
    expect(sched.tick(16000).map((i) => i.text)).toEqual(["c"]);
    expect(posts.map((p) => p.text)).toEqual(["a", "b", "c"]);
  });

  it("disarms when the live clock reports inactive (null)", () => {
    const { sched, posts, state } = mk();
    sched.arm(sample, 0);
    state.pos = null; // session no longer active
    expect(sched.tick(0)).toEqual([]);
    expect(sched.isArmed()).toBe(false);
    // even if the clock comes back, nothing fires until re-armed
    state.pos = 3000;
    expect(sched.tick(100)).toEqual([]);
    expect(posts).toEqual([]);
  });

  it("swallows errors thrown by the post callback", () => {
    const read = vi.fn(() => 2000 as number | null);
    const sched = new InsightScheduler(
      read,
      () => {
        throw new Error("boom");
      },
      { minGapMs: 0 },
    );
    sched.arm(sample, 0);
    expect(() => sched.tick(0)).not.toThrow();
    // it still marked the note fired (won't retry the broken post forever)
    expect(sched.tick(100).map((i) => i.text)).toEqual(["b"]);
  });
});
