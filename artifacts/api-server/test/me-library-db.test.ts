import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  recordingsTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests for GET /api/me/library search / sort / source filtering
 * and keyset paging. Seeds a lore user with a live sid session and four
 * library items (2 keeps, 2 imports) over distinct recordings; unique
 * mbids/ids per run; cleaned up; self-skips without a DB.
 */
const run = randomUUID().slice(0, 8);
const SID = `test-lib-sid-${run}`;
const MBIDS = {
  zebra: `test-lib-zebra-${run}`,
  apple: `test-lib-apple-${run}`,
  mango: `test-lib-mango-${run}`,
  banana: `test-lib-banana-${run}`,
  starterOne: `test-lib-starter-one-${run}`,
  starterTwo: `test-lib-starter-two-${run}`,
};
const STARTER_ENV = "MATT_LIBRARY_SOURCE_USER_ID";

let dbAvailable = false;
let userId: number | null = null;
let sourceUserId: number | null = null;
let server: Server | undefined;
let baseUrl = "";

async function getLibrary(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl}/api/me/library?${qs}`, {
    headers: { cookie: `lore_sid=${SID}` },
  });
  return { status: res.status, body: await res.json() };
}

async function starterRequest(method: "GET" | "POST", body?: unknown) {
  const res = await fetch(`${baseUrl}/api/me/library/starter`, {
    method,
    headers: {
      cookie: `lore_sid=${SID}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
    // deviceKey = SID so the test cookie `lore_sid=${SID}` is resolved by
    // getUserFromSession (which now looks up lore_users.deviceKey, not sid).
    .values({ spotifyUserId: `test-lib-user-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBIDS.zebra, title: "Zebra Crossing", artist: `Aardvark Band ${run}` },
    { mbid: MBIDS.apple, title: "Apple Blossom", artist: `Zeta Orchestra ${run}` },
    { mbid: MBIDS.mango, title: "Mango Nights", artist: `Middle Group ${run}` },
    { mbid: MBIDS.banana, title: "Banana Pancakes", artist: `Aardvark Band ${run}` },
    { mbid: MBIDS.starterOne, title: "Starter One", artist: `Starter Artist ${run}` },
    { mbid: MBIDS.starterTwo, title: "Starter Two", artist: `Starter Artist ${run}` },
  ]);

  const base = Date.now();
  await db.insert(libraryItemsTable).values([
    // Newest first by addedAt: zebra, apple, mango, banana.
    { userId, mbid: MBIDS.zebra, provenance: { kind: "keep" }, addedAt: new Date(base) },
    { userId, mbid: MBIDS.apple, provenance: { kind: "import", service: "spotify" }, addedAt: new Date(base - 1000) },
    { userId, mbid: MBIDS.mango, provenance: { kind: "keep" }, addedAt: new Date(base - 2000) },
    { userId, mbid: MBIDS.banana, provenance: { kind: "import", service: "spotify" }, addedAt: new Date(base - 3000) },
  ]);

  const [source] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `test-lib-source-${run}`, deviceKey: `test-lib-source-device-${run}` })
    .returning({ id: loreUsersTable.id });
  sourceUserId = source!.id;
  await db.insert(libraryItemsTable).values([
    { userId: sourceUserId, mbid: MBIDS.zebra, provenance: { kind: "keep" } },
    { userId: sourceUserId, mbid: MBIDS.starterOne, provenance: { kind: "import", service: "spotify" } },
    { userId: sourceUserId, mbid: MBIDS.starterTwo, provenance: { kind: "keep" } },
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
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  if (sourceUserId != null) {
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, sourceUserId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, sourceUserId));
  }
  for (const mbid of Object.values(MBIDS)) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
});

describe("Matt starter library", () => {
  afterEach(async () => {
    if (!dbAvailable || userId == null) return;
    await db.delete(libraryItemsTable).where(
      sql`${libraryItemsTable.userId} = ${userId} and ${libraryItemsTable.mbid} in (${MBIDS.starterOne}, ${MBIDS.starterTwo})`,
    );
  });

  it("is fail-closed when unconfigured", async () => {
    if (!dbAvailable) return;
    const previous = process.env[STARTER_ENV];
    delete process.env[STARTER_ENV];
    try {
      const { status, body } = await starterRequest("GET");
      expect(status).toBe(200);
      expect(body).toEqual({ available: false, addedCount: 0, totalCount: 0 });
    } finally {
      if (previous === undefined) delete process.env[STARTER_ENV];
      else process.env[STARTER_ENV] = previous;
    }
  });

  it("copies only the configured source, preserves existing rows, and is idempotent", async () => {
    if (!dbAvailable || sourceUserId == null || userId == null) return;
    const previous = process.env[STARTER_ENV];
    process.env[STARTER_ENV] = String(sourceUserId);
    try {
      const available = await starterRequest("GET");
      expect(available.status).toBe(200);
      expect(available.body).toMatchObject({ available: true, totalCount: 3 });

      // A caller-supplied sourceUserId is ignored; the server-side source wins.
      const first = await starterRequest("POST", { sourceUserId: 999999999 });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ available: true, addedCount: 2, totalCount: 3 });

      const copied = await db
        .select({
          mbid: libraryItemsTable.mbid,
          provenance: libraryItemsTable.provenance,
          spinId: libraryItemsTable.spinId,
        })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, userId));
      const copiedStarterRows = copied.filter((row) =>
        row.mbid === MBIDS.starterOne || row.mbid === MBIDS.starterTwo,
      );
      expect(copiedStarterRows).toHaveLength(2);
      expect(copiedStarterRows.every((row) =>
        row.provenance.kind === "import" &&
        row.provenance.service === "matt-starter" &&
        row.provenance.sourceLabel === "Matt’s starter library" &&
        row.spinId === null,
      )).toBe(true);
      expect(copied.some((row) => row.mbid === MBIDS.zebra && row.provenance.kind === "keep")).toBe(true);

      const second = await starterRequest("POST");
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ available: true, addedCount: 0, totalCount: 3 });
    } finally {
      if (previous === undefined) delete process.env[STARTER_ENV];
      else process.env[STARTER_ENV] = previous;
    }
  });
});

describe("GET /api/me/library search/sort/filter", () => {
  it("defaults to newest-first addedAt order", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getLibrary({ limit: "50" });
    expect(status).toBe(200);
    const mbids = body.items.map((i: { mbid: string }) => i.mbid);
    const ours = mbids.filter((m: string) => m.includes(run));
    expect(ours).toEqual([MBIDS.zebra, MBIDS.apple, MBIDS.mango, MBIDS.banana]);
  });

  it("filters by title substring, case-insensitive", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary({ q: "mango nig" });
    const ours = body.items.filter((i: { mbid: string }) => i.mbid.includes(run));
    expect(ours).toHaveLength(1);
    expect(ours[0].mbid).toBe(MBIDS.mango);
  });

  it("filters by artist substring", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary({ q: `aardvark band ${run}` });
    const ours = body.items.filter((i: { mbid: string }) => i.mbid.includes(run));
    expect(ours.map((i: { mbid: string }) => i.mbid).sort()).toEqual(
      [MBIDS.zebra, MBIDS.banana].sort(),
    );
  });

  it("treats LIKE wildcards in q as literals", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary({ q: "%" });
    const ours = body.items.filter((i: { mbid: string }) => i.mbid.includes(run));
    expect(ours).toHaveLength(0);
  });

  it("sorts by title A→Z", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary({ sort: "title", q: run });
    const ours = body.items.map((i: { mbid: string }) => i.mbid);
    expect(ours).toEqual([MBIDS.apple, MBIDS.banana, MBIDS.mango, MBIDS.zebra]);
  });

  it("sorts by artist A→Z with title tiebreak", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary({ sort: "artist", q: run });
    const ours = body.items.map((i: { mbid: string }) => i.mbid);
    // Aardvark Band: Banana before Zebra (title tiebreak), then Middle, then Zeta.
    expect(ours).toEqual([MBIDS.banana, MBIDS.zebra, MBIDS.mango, MBIDS.apple]);
  });

  it("filters by source=keep and source=import", async () => {
    if (!dbAvailable) return;
    const kept = await getLibrary({ source: "keep", q: run });
    expect(kept.body.items.map((i: { mbid: string }) => i.mbid).sort()).toEqual(
      [MBIDS.zebra, MBIDS.mango].sort(),
    );
    const imported = await getLibrary({ source: "import", q: run });
    expect(imported.body.items.map((i: { mbid: string }) => i.mbid).sort()).toEqual(
      [MBIDS.apple, MBIDS.banana].sort(),
    );
  });

  it("pages name-sorted results with the tuple cursor", async () => {
    if (!dbAvailable) return;
    const p1 = await getLibrary({ sort: "title", q: run, limit: "2" });
    expect(p1.body.items.map((i: { mbid: string }) => i.mbid)).toEqual([
      MBIDS.apple,
      MBIDS.banana,
    ]);
    expect(p1.body.nextCursor).toBeTruthy();

    const p2 = await getLibrary({
      sort: "title",
      q: run,
      limit: "2",
      cursor: p1.body.nextCursor,
    });
    expect(p2.body.items.map((i: { mbid: string }) => i.mbid)).toEqual([
      MBIDS.mango,
      MBIDS.zebra,
    ]);
    expect(p2.body.nextCursor).toBeNull();
  });

  it("pages default sort with the addedAt cursor and filters intact", async () => {
    if (!dbAvailable) return;
    const p1 = await getLibrary({ q: run, limit: "3" });
    expect(p1.body.items.map((i: { mbid: string }) => i.mbid)).toEqual([
      MBIDS.zebra,
      MBIDS.apple,
      MBIDS.mango,
    ]);
    const p2 = await getLibrary({ q: run, limit: "3", cursor: p1.body.nextCursor });
    expect(p2.body.items.map((i: { mbid: string }) => i.mbid)).toEqual([MBIDS.banana]);
    expect(p2.body.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor on name sorts", async () => {
    if (!dbAvailable) return;
    const { status } = await getLibrary({ sort: "title", cursor: "not-a-tuple" });
    expect(status).toBe(400);
  });
});
