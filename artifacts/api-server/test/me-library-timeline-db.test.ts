import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  spotifyLibraryItemsTable,
  recordingsTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests for the Library timeline read model:
 *  - deterministic added-order keyset paging when rows share an addedAt
 *    timestamp (no skipped or duplicated rows across pages), including
 *    ties that span the resolved (library_items) and soft
 *    (spotify_library_items) tables — the global tie key is each row's own
 *    identifier (mbid or spotifyId), so a boundary on one table must not
 *    skip rows on the other
 *  - legacy plain-ISO cursors still page (timestamp-only fallback)
 *  - dualSource flag on keep rows whose track also has an import trace
 *    (promoted spotify_library_items row for the same recording)
 */
const run = randomUUID().slice(0, 8);
// Separate q-token for the From Lore lens rows so they never leak into the
// tie-paging expectations above (q filters on title/artist substrings).
const loreRun = randomUUID().slice(0, 8);
const SID = `test-tl-sid-${run}`;
const MBIDS = {
  tieA: `test-tl-tie-a-${run}`,
  tieB: `test-tl-tie-b-${run}`,
  tieC: `test-tl-tie-c-${run}`,
  dual: `test-tl-dual-${run}`,
  plainKeep: `test-tl-plain-${run}`,
};
// Unresolved soft rows (mbid null) sharing the tie timestamp with the
// resolved tie rows — exercises cross-table equal-addedAt paging.
const SOFT_IDS = {
  softA: `test-tl-soft-a-${run}`,
  softZ: `zz-test-tl-soft-z-${run}`,
};
// From Lore lens rows: newest keeps are PLAIN (no radio provenance); the
// radio-provenance keeps sit behind them — a client-side filter over the
// generic keep feed would show an empty first page and strand these.
const LORE_MBIDS = {
  plainNew1: `test-tl-lens-plain1-${loreRun}`,
  plainNew2: `test-tl-lens-plain2-${loreRun}`,
  radioStation: `test-tl-lens-radio1-${loreRun}`,
  radioPicker: `test-tl-lens-radio2-${loreRun}`,
};

let dbAvailable = false;
let userId: number | null = null;
let server: Server | undefined;
let baseUrl = "";

async function getLibrary(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl}/api/me/library?${qs}`, {
    headers: { cookie: `lore_sid=${SID}` },
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "t",
    refreshToken: "r",
    expiresAt: new Date(Date.now() + 3600_000),
  });
  const [user] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `test-tl-user-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  await db.insert(recordingsTable).values([
    ...Object.values(MBIDS).map((mbid, i) => ({
      mbid,
      title: `Timeline Track ${i}`,
      artist: `Timeline Artist ${run}`,
    })),
    ...Object.values(LORE_MBIDS).map((mbid, i) => ({
      mbid,
      title: `Lens Track ${i}`,
      artist: `Lens Artist ${loreRun}`,
    })),
  ]);

  const base = Date.now();
  const tieTime = new Date(base - 1000);
  await db.insert(libraryItemsTable).values([
    // Newest row, unique timestamp.
    { userId, mbid: MBIDS.dual, provenance: { kind: "keep" }, addedAt: new Date(base) },
    // Three rows sharing the exact same addedAt — the tie-break case.
    { userId, mbid: MBIDS.tieA, provenance: { kind: "keep" }, addedAt: tieTime },
    { userId, mbid: MBIDS.tieB, provenance: { kind: "import", service: "spotify" }, addedAt: tieTime },
    { userId, mbid: MBIDS.tieC, provenance: { kind: "keep" }, addedAt: tieTime },
    // Oldest row.
    { userId, mbid: MBIDS.plainKeep, provenance: { kind: "keep" }, addedAt: new Date(base - 2000) },
    // From Lore lens scenario: the two NEWEST keeps are plain, the two
    // radio-provenance keeps are older (would land on page 2 of a limit=2
    // unscoped keep feed).
    { userId, mbid: LORE_MBIDS.plainNew1, provenance: { kind: "keep" }, addedAt: new Date(base - 10_000) },
    { userId, mbid: LORE_MBIDS.plainNew2, provenance: { kind: "keep" }, addedAt: new Date(base - 11_000) },
    {
      userId,
      mbid: LORE_MBIDS.radioStation,
      provenance: { kind: "keep", stationSlug: "kexp", stationName: "KEXP" },
      addedAt: new Date(base - 12_000),
    },
    {
      userId,
      mbid: LORE_MBIDS.radioPicker,
      provenance: { kind: "keep", pickerHandle: "dj-x", pickerName: "DJ X" },
      addedAt: new Date(base - 13_000),
    },
  ]);

  await db.insert(spotifyLibraryItemsTable).values([
    // Import trace for the dual-source track: a promoted (resolved) Spotify
    // library row pointing at the same recording.
    {
      userId,
      spotifyId: `test-tl-sp-dual-${run}`,
      mbid: MBIDS.dual,
      title: "Timeline Track dual",
      artist: `Timeline Artist ${run}`,
      addedAt: new Date(base),
    },
    // Two unresolved soft rows sharing the exact tie timestamp with the
    // resolved tie rows; ids chosen to sort on both sides of the mbids.
    {
      userId,
      spotifyId: SOFT_IDS.softA,
      title: "Timeline Soft A",
      artist: `Timeline Artist ${run}`,
      addedAt: tieTime,
    },
    {
      userId,
      spotifyId: SOFT_IDS.softZ,
      title: "Timeline Soft Z",
      artist: `Timeline Artist ${run}`,
      addedAt: tieTime,
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;
  if (userId != null) {
    await db.delete(spotifyLibraryItemsTable).where(eq(spotifyLibraryItemsTable.userId, userId));
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.delete(recordingsTable).where(
    inArray(recordingsTable.mbid, [...Object.values(MBIDS), ...Object.values(LORE_MBIDS)]),
  );
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
});

describe("Library timeline keyset paging", () => {
  it("pages through equal-addedAt rows spanning both tables without skips or duplicates", async () => {
    if (!dbAvailable) return;
    // Expected identity set: 5 resolved rows + 2 soft rows, where the
    // 3 resolved tie rows and both soft rows share one addedAt timestamp.
    const expected = new Set<string>([...Object.values(MBIDS), ...Object.values(SOFT_IDS)]);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = { q: run, limit: "2" };
      if (cursor) params.cursor = cursor;
      const { status, body } = await getLibrary(params);
      expect(status).toBe(200);
      expect(body.items.length).toBeLessThanOrEqual(2);
      seen.push(
        ...body.items.map((i: { mbid: string | null; spotifyId?: string }) => i.mbid ?? i.spotifyId!),
      );
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    // All seven rows exactly once — a timestamp-only cursor (or a
    // cross-table-inconsistent tie key) would skip or repeat tie rows.
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen)).toEqual(expected);
    // Newest first overall: dual first, plainKeep last.
    expect(seen[0]).toBe(MBIDS.dual);
    expect(seen[seen.length - 1]).toBe(MBIDS.plainKeep);
  });

  it("still accepts a legacy plain-ISO addedAt cursor", async () => {
    if (!dbAvailable) return;
    const p1 = await getLibrary({ q: run, limit: "1" });
    expect(p1.body.items[0].mbid).toBe(MBIDS.dual);
    // Legacy cursor: bare timestamp of the last item (old client/server contract).
    const legacyCursor = p1.body.items[0].addedAt;
    const p2 = await getLibrary({ q: run, limit: "50", cursor: legacyCursor });
    expect(p2.status).toBe(200);
    const mbids = p2.body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).not.toContain(MBIDS.dual);
    expect(mbids).toContain(MBIDS.plainKeep);
  });
});

describe("Library timeline dual-source flag", () => {
  it("flags a keep row whose track also has an import trace", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary({ q: run, limit: "50" });
    const dual = body.items.find((i: { mbid: string }) => i.mbid === MBIDS.dual);
    expect(dual).toBeTruthy();
    expect(dual.dualSource).toBe(true);
    expect(dual.provenance.kind).toBe("keep");
  });

  it("does not flag keeps without an import trace or plain import rows", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary({ q: run, limit: "50" });
    const plain = body.items.find((i: { mbid: string }) => i.mbid === MBIDS.plainKeep);
    expect(plain.dualSource).toBeUndefined();
    const imported = body.items.find((i: { mbid: string }) => i.mbid === MBIDS.tieB);
    expect(imported.dualSource).toBeUndefined();
  });
});

describe("From Lore lens (source=lore)", () => {
  it("returns radio-provenance keeps even when they sit behind pages of plain keeps", async () => {
    if (!dbAvailable) return;
    // Sanity: with the generic keep feed at limit=2, page 1 is the two PLAIN
    // keeps — a client-side provenance filter would render an empty page
    // with no scroll sentinel and strand the radio keeps behind it.
    const generic = await getLibrary({ q: loreRun, limit: "2", source: "keep" });
    expect(generic.status).toBe(200);
    expect(generic.body.items.map((i: { mbid: string }) => i.mbid)).toEqual([
      LORE_MBIDS.plainNew1,
      LORE_MBIDS.plainNew2,
    ]);

    // The scoped feed returns ONLY radio-provenance keeps, first page.
    const scoped = await getLibrary({ q: loreRun, limit: "2", source: "lore" });
    expect(scoped.status).toBe(200);
    expect(scoped.body.items.map((i: { mbid: string }) => i.mbid)).toEqual([
      LORE_MBIDS.radioStation,
      LORE_MBIDS.radioPicker,
    ]);
    // Page-1 total reflects the scoped feed, not the generic keep count.
    expect(scoped.body.total).toBe(2);
    expect(scoped.body.nextCursor).toBeNull();
  });

  it("pages the scoped feed with the keyset cursor", async () => {
    if (!dbAvailable) return;
    const p1 = await getLibrary({ q: loreRun, limit: "1", source: "lore" });
    expect(p1.body.items.map((i: { mbid: string }) => i.mbid)).toEqual([LORE_MBIDS.radioStation]);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await getLibrary({ q: loreRun, limit: "1", source: "lore", cursor: p1.body.nextCursor });
    expect(p2.body.items.map((i: { mbid: string }) => i.mbid)).toEqual([LORE_MBIDS.radioPicker]);
  });
});
