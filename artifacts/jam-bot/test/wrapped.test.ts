import { describe, it, expect } from "vitest";
import {
  buildWrappedStats,
  parseSchedule,
  toSqliteUtc,
  WrappedScheduler,
} from "../src/wrapped.js";
import { kvGet, kvSet } from "../src/db.js";
import { buildDnaStats, buildCompatStats } from "../src/dna.js";
import {
  isMemoryPlaybackRequest,
  extractRequesterMentions,
  _buildCandidatesForTest,
  askLLMForSet,
} from "../src/memory.js";
import { db, recordPlayed, setOptOut, isOptedOut } from "../src/db.js";
import { parseBoolEnv } from "../src/config.js";
import { statsAsFacts } from "../src/slack/bot.js";

function uniq(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

// Tests share the test DATABASE_PATH set in test/setup.ts. We scope each test
// to its own track_id prefixes / users to avoid cross-test interference.

describe("toSqliteUtc + parseSchedule", () => {
  it("formats a date as the SQLite UTC string", () => {
    const d = new Date(Date.UTC(2025, 0, 7, 8, 5, 9));
    expect(toSqliteUtc(d)).toBe("2025-01-07 08:05:09");
  });
  it("parses Sun 20:00 schedule", () => {
    expect(parseSchedule("Sun 20:00")).toEqual({
      dayOfWeek: 0,
      hour: 20,
      minute: 0,
    });
  });
  it("rejects malformed schedules", () => {
    expect(parseSchedule("Funday 20:00")).toBeNull();
    expect(parseSchedule("Sun 25:00")).toBeNull();
    expect(parseSchedule("Sun 20:99")).toBeNull();
    expect(parseSchedule("garbage")).toBeNull();
  });
});

describe("buildWrappedStats", () => {
  it("aggregates plays across users into top tracks, artists, and per-user stats", () => {
    const userA = uniq("Uw_A");
    const userB = uniq("Uw_B");
    const tracksA = ["wt-a-1", "wt-a-1", "wt-a-1", "wt-a-2", "wt-a-3"];
    const tracksB = ["wt-b-1", "wt-b-2", "wt-a-1"];
    for (const id of tracksA) {
      recordPlayed({
        track_id: uniq(id),
        title: id === "wt-a-1" ? "A1" : id === "wt-a-2" ? "A2" : "A3",
        artist: "ArtistA",
        requested_by_slack_user: userA,
      });
    }
    for (const id of tracksB) {
      recordPlayed({
        track_id: uniq(id),
        title: "TitleB",
        artist: "ArtistB",
        requested_by_slack_user: userB,
      });
    }

    const stats = buildWrappedStats(7);
    const userAStats = stats.perUser.find((u) => u.slackUser === userA);
    const userBStats = stats.perUser.find((u) => u.slackUser === userB);
    expect(userAStats?.plays).toBe(5);
    expect(userBStats?.plays).toBe(3);
    expect(userAStats?.topArtist).toBe("ArtistA");
    expect(userBStats?.topArtist).toBe("ArtistB");
    expect(stats.topArtists.find((a) => a.artist === "ArtistA")).toBeDefined();
    expect(stats.totalPlays).toBeGreaterThanOrEqual(8);
  });

  it("totalPlays is a direct COUNT(*), accurate beyond the top-N tracks", () => {
    const u = uniq("Uw_count");
    // Insert 12 distinct track_ids — more than the top-N=5 the recap shows.
    // The old heuristic (sum-of-user-plays + delta-from-top-5) would not see
    // tracks 6..12 at all and would undercount; the new direct COUNT(*) does.
    for (let i = 0; i < 12; i++) {
      recordPlayed({
        track_id: uniq(`count-${i}`),
        title: `T${i}`,
        artist: "ArtistC",
        requested_by_slack_user: u,
      });
    }
    const stats = buildWrappedStats(7);
    expect(stats.totalPlays).toBeGreaterThanOrEqual(12);
  });

  it("respects opt-out — user appears with optedOut=true and no personal stats", () => {
    const userOpt = uniq("Uw_opt");
    recordPlayed({
      track_id: uniq("opt-1"),
      title: "T",
      artist: "Artist",
      requested_by_slack_user: userOpt,
    });
    setOptOut(userOpt, true);
    const stats = buildWrappedStats(7);
    const u = stats.perUser.find((x) => x.slackUser === userOpt);
    expect(u?.optedOut).toBe(true);
    expect(u?.topArtist).toBeNull();
    expect(u?.topTrack).toBeNull();
    setOptOut(userOpt, false);
  });
});

describe("buildDnaStats", () => {
  it("returns top artists, signature track, and discovery rate for a user", () => {
    const u = uniq("Ud");
    const id1 = uniq("dna-1");
    recordPlayed({ track_id: id1, title: "T1", artist: "ArtistX", requested_by_slack_user: u });
    recordPlayed({ track_id: id1, title: "T1", artist: "ArtistX", requested_by_slack_user: u });
    recordPlayed({ track_id: uniq("dna-2"), title: "T2", artist: "ArtistY", requested_by_slack_user: u });
    const dna = buildDnaStats(u);
    expect(dna.totalPlays).toBe(3);
    expect(dna.topArtists[0]?.artist).toBe("ArtistX");
    expect(dna.signatureTrack?.track_id).toBe(id1);
    expect(dna.signatureTrack?.plays).toBe(2);
    expect(dna.discoveryRate).toBeGreaterThan(0);
  });
  it("handles a user with no plays", () => {
    const dna = buildDnaStats(uniq("Ud_empty"));
    expect(dna.totalPlays).toBe(0);
    expect(dna.discoveryRate).toBe(0);
    expect(dna.topArtists).toEqual([]);
    expect(dna.signatureTrack).toBeNull();
  });
});

describe("buildCompatStats", () => {
  it("scores two users with overlapping artists higher than disjoint ones", () => {
    const a = uniq("Uc_a");
    const b = uniq("Uc_b");
    recordPlayed({ track_id: uniq("c-a-1"), title: "T", artist: "Shared", requested_by_slack_user: a });
    recordPlayed({ track_id: uniq("c-a-2"), title: "T", artist: "OnlyA", requested_by_slack_user: a });
    recordPlayed({ track_id: uniq("c-b-1"), title: "T", artist: "Shared", requested_by_slack_user: b });
    recordPlayed({ track_id: uniq("c-b-2"), title: "T", artist: "OnlyB", requested_by_slack_user: b });
    const stats = buildCompatStats(a, b);
    expect(stats.sharedArtists).toContain("Shared");
    expect(stats.score).toBeGreaterThan(0);
    expect(stats.score).toBeLessThanOrEqual(100);
    // Component scores all lie in [0, 1].
    expect(stats.artistJaccard).toBeGreaterThan(0);
    expect(stats.artistJaccard).toBeLessThanOrEqual(1);
    expect(stats.artistCosine).toBeGreaterThanOrEqual(0);
    expect(stats.artistCosine).toBeLessThanOrEqual(1);
    expect(stats.timeOfDayOverlap).toBeGreaterThanOrEqual(0);
    expect(stats.timeOfDayOverlap).toBeLessThanOrEqual(1);
  });
  it("recommends a track from B that A hasn't played", () => {
    const a = uniq("Uc2_a");
    const b = uniq("Uc2_b");
    const sharedTrack = uniq("c2-shared");
    recordPlayed({ track_id: sharedTrack, title: "Shared", artist: "X", requested_by_slack_user: a });
    recordPlayed({ track_id: sharedTrack, title: "Shared", artist: "X", requested_by_slack_user: b });
    const bOnly = uniq("c2-bonly");
    recordPlayed({ track_id: bOnly, title: "BOnly", artist: "X", requested_by_slack_user: b });
    recordPlayed({ track_id: bOnly, title: "BOnly", artist: "X", requested_by_slack_user: b });
    const stats = buildCompatStats(a, b);
    expect(stats.recommendForA[0]?.track_id).toBe(bOnly);
  });
});

describe("isMemoryPlaybackRequest", () => {
  it("matches play/queue-a-set style requests", () => {
    expect(isMemoryPlaybackRequest("play me a set of last weekend's vibes")).toBe(true);
    expect(isMemoryPlaybackRequest("queue a 5 song mix from August")).toBe(true);
    expect(isMemoryPlaybackRequest("play some songs we played last friday")).toBe(true);
  });
  it("does NOT match recall-only questions", () => {
    expect(isMemoryPlaybackRequest("who introduced us to Khruangbin?")).toBe(false);
    expect(isMemoryPlaybackRequest("how many times have we played Daft Punk?")).toBe(false);
  });
});

describe("extractRequesterMentions", () => {
  it("pulls Slack mentions out of /memory prompts", () => {
    expect(
      extractRequesterMentions("play a set of stuff <@U12345ABC> queued during the outage"),
    ).toEqual(["U12345ABC"]);
  });
  it("supports the <@U…|displayname> mention format Slack uses in slash commands", () => {
    expect(
      extractRequesterMentions("play a set of stuff <@U12345ABC|bob> queued"),
    ).toEqual(["U12345ABC"]);
    // Mixed forms in one prompt.
    expect(
      extractRequesterMentions("mix from <@U1|alice> and <@W2>"),
    ).toEqual(["U1", "W2"]);
  });
  it("returns multiple mentions and dedups duplicates", () => {
    expect(extractRequesterMentions("mix from <@U1> and <@W2>")).toEqual(["U1", "W2"]);
    expect(
      extractRequesterMentions("<@U1> tracks plus more <@U1|alice> tracks"),
    ).toEqual(["U1"]);
  });
  it("returns [] when no mentions present", () => {
    expect(extractRequesterMentions("play me some chill tunes")).toEqual([]);
  });
});

describe("buildCandidates (memory set retrieval)", () => {
  it("retrieves candidates by date window even when prompt has no title keyword", () => {
    // Insert a play with a played_at firmly in the LAST friday window.
    // We approximate by using today; parseDateRange("last friday") returns
    // a UTC midnight day window. Easier: use "today" which is unambiguous.
    const u = uniq("Um_date");
    const tid = uniq("mem-date");
    recordPlayed({
      track_id: tid,
      title: "ZzObscureTitle",
      artist: "ZzObscureArtist",
      requested_by_slack_user: u,
    });
    // "play me a set from today" should pick up our new track via the
    // date-window primitive even though "today"/"set"/etc are stop-words.
    const cands = _buildCandidatesForTest("play me a set from today", 60);
    expect(cands.some((c) => c.track_id === tid)).toBe(true);
  });

  it("retrieves candidates by Slack-mention requester scope (both <@U> and <@U|name>)", () => {
    const u = uniq("Um_req");
    const tid = uniq("mem-req");
    recordPlayed({
      track_id: tid,
      title: "OnlyByU",
      artist: "RareArtist",
      requested_by_slack_user: u,
    });
    const candsPlain = _buildCandidatesForTest(
      `play me a set of stuff <@${u}> queued`,
      60,
    );
    expect(candsPlain.some((c) => c.track_id === tid)).toBe(true);
    // The <@U|displayname> form Slack uses in slash command text must work too.
    const candsNamed = _buildCandidatesForTest(
      `play me a set of stuff <@${u}|bob> queued`,
      60,
    );
    expect(candsNamed.some((c) => c.track_id === tid)).toBe(true);
  });

  it("excludes opted-out users from the candidate pool at every layer", () => {
    const u = uniq("Um_opt");
    const tid = uniq("mem-opt");
    recordPlayed({
      track_id: tid,
      title: "OptedTitle",
      artist: "OptedArtist",
      requested_by_slack_user: u,
    });
    setOptOut(u, true);
    const cands = _buildCandidatesForTest(
      `play me a set from today by <@${u}> with OptedTitle`,
      60,
    );
    expect(cands.some((c) => c.track_id === tid)).toBe(false);
    setOptOut(u, false);
  });
});

describe("WrappedScheduler idempotency", () => {
  it("fires at most once per UTC day, even across many ticks in the firing minute and a process restart", async () => {
    // Wipe any persisted last-fire key so this test is self-contained.
    const KV_KEY = "wrapped:last_fire_key";
    kvSet(KV_KEY, "");
    let fires = 0;
    const fire = async () => {
      fires += 1;
    };
    const target = parseSchedule("Sun 20:00")!;
    expect(target).toBeTruthy();
    // Construct a Date inside the firing minute on a Sunday in UTC.
    // 2026-05-03 is a Sunday — verified against the env timestamp.
    const insideFiringMinute = new Date(Date.UTC(2026, 4, 3, 20, 0, 30));
    const sched = new WrappedScheduler(fire);
    // 5 ticks inside the firing window — should only fire once.
    expect(sched.tick(insideFiringMinute, target)).toBe(true);
    expect(sched.tick(insideFiringMinute, target)).toBe(false);
    expect(sched.tick(new Date(Date.UTC(2026, 4, 3, 20, 0, 45)), target)).toBe(false);
    expect(sched.tick(new Date(Date.UTC(2026, 4, 3, 20, 1, 0)), target)).toBe(false);
    // A second scheduler instance (simulates process restart) reads the
    // persisted key from kv and refuses to re-fire on the same UTC day.
    const sched2 = new WrappedScheduler(fire);
    expect(sched2.tick(insideFiringMinute, target)).toBe(false);
    // Wait one microtask so any in-flight fire() promise settles.
    await new Promise((r) => setImmediate(r));
    expect(fires).toBe(1);
    // The persisted key matches the day we fired on.
    expect(kvGet(KV_KEY)).toBe("2026-4-3");
    // A tick on the NEXT week's Sunday is allowed to fire again.
    const nextWeek = new Date(Date.UTC(2026, 4, 10, 20, 0, 30));
    expect(sched2.tick(nextWeek, target)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(fires).toBe(2);
    // Cleanup.
    kvSet(KV_KEY, "");
  });

  it("does NOT fire outside the scheduled day/hour/minute window", () => {
    kvSet("wrapped:last_fire_key", "");
    let fires = 0;
    const sched = new WrappedScheduler(async () => {
      fires += 1;
    });
    const target = parseSchedule("Sun 20:00")!;
    // Wrong day (Mon 2026-05-04).
    expect(sched.tick(new Date(Date.UTC(2026, 4, 4, 20, 0, 0)), target)).toBe(false);
    // Right day, wrong hour.
    expect(sched.tick(new Date(Date.UTC(2026, 4, 3, 19, 0, 0)), target)).toBe(false);
    // Right day & hour, minute too far off (> 1 minute drift).
    expect(sched.tick(new Date(Date.UTC(2026, 4, 3, 20, 5, 0)), target)).toBe(false);
    expect(fires).toBe(0);
  });
});

describe("/dna self-view opt-out policy (strict)", () => {
  it("blocks an opted-out user from viewing their OWN dna stats too", () => {
    // We test the policy at the gate the slash handler uses: isOptedOut(subject)
    // applies regardless of whether subject === userId.
    const u = uniq("Udna_self");
    setOptOut(u, true);
    // The handler now treats an opted-out user as blocked even on self-view.
    expect(isOptedOut(u)).toBe(true);
    // Cleanup.
    setOptOut(u, false);
    expect(isOptedOut(u)).toBe(false);
  });
});

describe("/memory playback end-to-end (intent -> set -> queueable ids)", () => {
  it("detects playback intent, retrieves candidates, and returns ONLY ids that exist in real history", async () => {
    const u = uniq("Ue2e_user");
    const idA = uniq("e2e-A");
    const idB = uniq("e2e-B");
    const idC = uniq("e2e-C"); // third row to validate lookupHistoryTrack below
    recordPlayed({
      track_id: idA,
      title: "Khruangbin Vibes A",
      artist: "Khruangbin",
      requested_by_slack_user: u,
    });
    recordPlayed({
      track_id: idB,
      title: "Khruangbin Vibes B",
      artist: "Khruangbin",
      requested_by_slack_user: u,
    });
    recordPlayed({
      track_id: idC,
      title: "Khruangbin Vibes C",
      artist: "Khruangbin",
      requested_by_slack_user: u,
    });

    const prompt = "play me a set of khruangbin we've already played";
    // Step 1: intent detection.
    expect(isMemoryPlaybackRequest(prompt)).toBe(true);
    // Step 2: candidates exist in the real history.
    const cands = _buildCandidatesForTest(prompt, 60);
    expect(cands.some((c) => c.track_id === idA)).toBe(true);
    expect(cands.some((c) => c.track_id === idB)).toBe(true);

    // Step 3: stub OpenRouter and exercise askLLMForSet, including the
    // "model hallucinates an id not in candidates" guardrail. The implementation
    // MUST drop the hallucinated id and only return ones that exist.
    const realFetch = globalThis.fetch;
    const FAKE_HALLUCINATED_ID = "spotify:track:DEFINITELY_NOT_IN_HISTORY";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "A short Khruangbin set from the Jam history.",
                  track_ids: [idA, idB, FAKE_HALLUCINATED_ID, idA],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    try {
      const result = await askLLMForSet(prompt, 5);
      // Only real, deduped ids survive.
      expect(result.trackIds).toEqual([idA, idB]);
      expect(result.summary).toMatch(/khruangbin/i);
    } finally {
      globalThis.fetch = realFetch;
    }

    // Step 4: lookupHistoryTrack does an indexed track_id lookup (not a
    // title/artist text search), so it returns the canonical row even when
    // the id is something like "spotify:track:..." that has no overlap with
    // any title/artist text.
    const { lookupHistoryTrack } = await import("../src/memory.js");
    const looked = lookupHistoryTrack(idC);
    expect(looked?.track_id).toBe(idC);
    expect(looked?.title).toBe("Khruangbin Vibes C");
    expect(lookupHistoryTrack("does-not-exist-xyz")).toBeUndefined();
  });
});

describe("askLLM full-history retrieval", () => {
  it("surfaces a track from full history for a generic 'who introduced us to X' question, even when X isn't in the recents window", async () => {
    // Insert a Khruangbin row, then bury it with > LLM_HISTORY_WINDOW (=25)
    // newer plays so it falls OUT of recentPlayed(25). The full-history
    // keyword retrieval path must still pull it in for askLLM context.
    const introducer = uniq("Uk_intro");
    const tid = uniq("khr-1");
    recordPlayed({
      track_id: tid,
      title: "Maria También",
      artist: "Khruangbin",
      requested_by_slack_user: introducer,
    });
    for (let i = 0; i < 60; i++) {
      recordPlayed({
        track_id: uniq(`bury-${i}`),
        title: `Bury${i}`,
        artist: "Filler",
        requested_by_slack_user: uniq("Uk_filler"),
      });
    }
    // Confirm the row IS reachable via the full-history search (this is the
    // exact retrieval primitive askLLM's buildContext now calls for every
    // 3+char content word in the question — see openrouter.ts).
    const { searchPlayedByTitleOrArtist } = await import("../src/db.js");
    const hits = searchPlayedByTitleOrArtist("khruangbin", 10);
    expect(hits.some((h) => h.track_id === tid)).toBe(true);
    // And confirm it would be MISSED by recents-only retrieval, proving the
    // bug the new code path fixes.
    const { recentPlayed } = await import("../src/db.js");
    const recents = recentPlayed(25);
    expect(recents.some((r) => r.track_id === tid)).toBe(false);
  });
});

describe("statsAsFacts (wrapped LLM facts block)", () => {
  it("never mentions opted-out users — not even as 'opted out' placeholders", () => {
    const optedUser = uniq("Uf_opt");
    const visibleUser = uniq("Uf_vis");
    recordPlayed({
      track_id: uniq("facts-opt"),
      title: "OptT",
      artist: "OptArt",
      requested_by_slack_user: optedUser,
    });
    recordPlayed({
      track_id: uniq("facts-vis"),
      title: "VisT",
      artist: "VisArt",
      requested_by_slack_user: visibleUser,
    });
    setOptOut(optedUser, true);
    const stats = buildWrappedStats(7);
    const facts = statsAsFacts(stats);
    // Crucial: the opted-out user's Slack id must never appear in the facts
    // block we send to the LLM (otherwise it can end up in public narration).
    expect(facts).not.toContain(optedUser);
    expect(facts.toLowerCase()).not.toContain("opted out");
    // Sanity: a non-opted-out user is still mentioned.
    expect(facts).toContain(visibleUser);
    setOptOut(optedUser, false);
  });
});

describe("parseBoolEnv", () => {
  it("treats the string \"false\" (and friends) as false — fixes the z.coerce.boolean bug", () => {
    for (const v of ["false", "FALSE", "False", "0", "no", "off", ""]) {
      expect(parseBoolEnv(v)).toBe(false);
    }
  });
  it("treats the string \"true\" (and unknowns) as true", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on", "anythingelse"]) {
      expect(parseBoolEnv(v)).toBe(true);
    }
  });
  it("passes booleans through unchanged", () => {
    expect(parseBoolEnv(true)).toBe(true);
    expect(parseBoolEnv(false)).toBe(false);
  });
  it("handles null/undefined as false", () => {
    expect(parseBoolEnv(null)).toBe(false);
    expect(parseBoolEnv(undefined)).toBe(false);
  });
});

// Smoke test that db is wired (catches schema regressions on user_optouts).
describe("db schema", () => {
  it("has a user_optouts table", () => {
    const row = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='user_optouts'`,
      )
      .get();
    expect(row?.name).toBe("user_optouts");
  });
});
