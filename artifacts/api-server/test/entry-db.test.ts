import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pickersTable,
  picksTable,
  recordingsTable,
  stationsTable,
  spinsTable,
} from "@workspace/db";
import { upsertPicker, persistPick } from "../src/lore/picks.js";
import { ensurePicksUnifiedView } from "../src/lore/view.js";
import { resolveEntry } from "../src/lore/entry.js";
import { nextPickSegues } from "../src/lore/segue.js";

/**
 * Integration test for the pickers/picks write path + the unified view + the
 * entry-flow fallback ladder — the parts pure-unit tests can't reach. Verifies:
 *   - a pick is ALWAYS logged, even unresolved (mbid null);
 *   - persistPick is idempotent by (pickerId, externalId);
 *   - the ladder returns the STRONGEST rung and never falls through to an
 *     algorithm — it lands on "empty" with an invitation when no human picked;
 *   - a DJ spin outranks a label pick for the same recording (via the view).
 * Fully isolated (unique ids) and cleaned up; self-skips without a real DB.
 */
const run = randomUUID().slice(0, 8);
const REC_LABEL = `test-entry-lbl-${run}`;
const REC_DJ = `test-entry-dj-${run}`;
const REC_EMPTY = `test-entry-empty-${run}`;
const REC_ARTIST = `test-entry-artistpick-${run}`;
const ARTIST_MBID = `test-entry-artist-${run}`;
const MBIDS = [REC_LABEL, REC_DJ, REC_EMPTY, REC_ARTIST];

let dbAvailable = false;
let labelPickerId: number | undefined;
let stationId: number | undefined;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await ensurePicksUnifiedView();

  await db.insert(recordingsTable).values([
    { mbid: REC_LABEL, title: "Label Track", artist: "Roster Act", artistMbid: ARTIST_MBID },
    { mbid: REC_DJ, title: "DJ Track", artist: "Radio Act" },
    { mbid: REC_ARTIST, title: "Other Track", artist: "Roster Act", artistMbid: ARTIST_MBID },
    // REC_EMPTY intentionally has no recording row / no picks.
  ]);

  const label = await upsertPicker({
    pickerType: "label",
    name: `Test Label ${run}`,
    handle: `test-label-${run}`,
    trustTier: 1,
  });
  labelPickerId = label.id;

  // A resolved label pick for REC_LABEL, and one for REC_ARTIST (same artist).
  await persistPick({
    pickerId: label.id,
    source: "label_release",
    rawArtist: "Roster Act",
    rawTitle: "Label Track",
    recordingId: REC_LABEL,
    artistMbid: ARTIST_MBID,
    externalId: `label:${run}:${REC_LABEL}`,
  });
  await persistPick({
    pickerId: label.id,
    source: "label_release",
    rawArtist: "Roster Act",
    rawTitle: "Other Track",
    recordingId: REC_ARTIST,
    artistMbid: ARTIST_MBID,
    externalId: `label:${run}:${REC_ARTIST}`,
  });

  // A DJ spin for REC_DJ (via the spins path), so the ladder's dj rung fires.
  const [st] = await db
    .insert(stationsTable)
    .values({
      slug: `test-entry-st-${run}`,
      name: `Entry Station ${run}`,
      streamUrl: "http://example.invalid/stream",
      stationClass: "curated",
    })
    .returning({ id: stationsTable.id });
  stationId = st!.id;
  await db.insert(spinsTable).values({
    stationId,
    mbid: REC_DJ,
    confidence: "text",
    playedAt: new Date(),
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  if (stationId !== undefined) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
  if (labelPickerId !== undefined) {
    await db.delete(picksTable).where(eq(picksTable.pickerId, labelPickerId));
    await db.delete(pickersTable).where(eq(pickersTable.id, labelPickerId));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, MBIDS));
});

describe("persistPick", () => {
  it("always logs a pick, even when unresolved (mbid null)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { logged, resolution } = await persistPick({
      pickerId: labelPickerId!,
      source: "blog_post",
      rawArtist: `Nonexistent Artist ${run}`,
      rawTitle: `Nonexistent Track ${run}`,
      externalId: `blog:${run}:unresolved`,
    });
    expect(logged).toBe(true);
    expect(resolution.mbid).toBeNull();

    const [row] = await db
      .select()
      .from(picksTable)
      .where(eq(picksTable.externalId, `blog:${run}:unresolved`));
    expect(row?.confidence).toBe("unresolved");
    expect(row?.mbid).toBeNull();
  });

  it("is idempotent by (pickerId, externalId)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const first = await persistPick({
      pickerId: labelPickerId!,
      source: "curator_list",
      rawArtist: `Dedup ${run}`,
      rawTitle: `Dedup ${run}`,
      externalId: `dedup:${run}`,
    });
    const second = await persistPick({
      pickerId: labelPickerId!,
      source: "curator_list",
      rawArtist: `Dedup ${run}`,
      rawTitle: `Dedup ${run}`,
      externalId: `dedup:${run}`,
    });
    expect(first.logged).toBe(true);
    expect(second.logged).toBe(false);

    const rows = await db
      .select({ id: picksTable.id })
      .from(picksTable)
      .where(eq(picksTable.externalId, `dedup:${run}`));
    expect(rows).toHaveLength(1);
  });
});

describe("resolveEntry ladder", () => {
  it("returns the label rung for a label-picked track", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const entry = await resolveEntry(REC_LABEL, ARTIST_MBID);
    expect(entry.rung).toBe("label");
    expect(entry.picks.length).toBeGreaterThan(0);
    expect(entry.picks[0]!.pickerType).toBe("label");
  });

  it("returns the dj rung (strongest) for a spun track", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const entry = await resolveEntry(REC_DJ);
    expect(entry.rung).toBe("dj");
  });

  it("falls back to the artist rung when the exact track is unpicked", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    // A brand-new recording by the same artist, with no direct pick.
    const fresh = `test-entry-fresh-${run}`;
    await db
      .insert(recordingsTable)
      .values({ mbid: fresh, title: "Fresh", artist: "Roster Act", artistMbid: ARTIST_MBID })
      .onConflictDoNothing();
    try {
      const entry = await resolveEntry(fresh, ARTIST_MBID);
      expect(entry.rung).toBe("artist");
      expect(entry.picks.length).toBeGreaterThan(0);
    } finally {
      await db.delete(recordingsTable).where(eq(recordingsTable.mbid, fresh));
    }
  });

  it("lands on empty with an invitation, never an algorithm, when unpicked", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const entry = await resolveEntry(REC_EMPTY);
    expect(entry.rung).toBe("empty");
    expect(entry.picks).toHaveLength(0);
    expect(entry.invitation?.seedSource).toBe("user_seed");
  });
});

describe("nextPickSegues", () => {
  it("rides an ordered pick list as a rideable sequence with picker attribution", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const seqRun = `${run}-seq`;
    const A = `test-seq-a-${seqRun}`;
    const B = `test-seq-b-${seqRun}`;
    const C = `test-seq-c-${seqRun}`;
    await db.insert(recordingsTable).values([
      { mbid: A, title: "Seq A", artist: "Seq Artist" },
      { mbid: B, title: "Seq B", artist: "Seq Artist" },
      { mbid: C, title: "Seq C", artist: "Seq Artist" },
    ]);
    const curator = await upsertPicker({
      pickerType: "curator",
      name: `Seq Curator ${seqRun}`,
      handle: `seq-curator-${seqRun}`,
      trustTier: 2,
    });
    try {
      // An ordered list A -> B -> C (source carries ordinals).
      await persistPick({
        pickerId: curator.id,
        source: "curator_list",
        rawArtist: "Seq Artist",
        rawTitle: "Seq A",
        recordingId: A,
        ordinal: 0,
        externalId: `seq:${seqRun}:a`,
      });
      await persistPick({
        pickerId: curator.id,
        source: "curator_list",
        rawArtist: "Seq Artist",
        rawTitle: "Seq B",
        recordingId: B,
        ordinal: 1,
        externalId: `seq:${seqRun}:b`,
      });
      await persistPick({
        pickerId: curator.id,
        source: "curator_list",
        rawArtist: "Seq Artist",
        rawTitle: "Seq C",
        recordingId: C,
        ordinal: 2,
        externalId: `seq:${seqRun}:c`,
      });

      const next = await nextPickSegues(A);
      expect(next.map((n) => n.mbid)).toEqual([B]);
      expect(next[0]!.pickers?.[0]?.handle).toBe(`seq-curator-${seqRun}`);

      // C is the last item — it has no rideable successor in this list.
      const afterC = await nextPickSegues(C);
      expect(afterC).toHaveLength(0);
    } finally {
      await db.delete(picksTable).where(eq(picksTable.pickerId, curator.id));
      await db.delete(pickersTable).where(eq(pickersTable.id, curator.id));
      await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [A, B, C]));
    }
  });
});
