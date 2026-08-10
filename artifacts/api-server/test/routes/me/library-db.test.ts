import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql, and, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  pendingKeepsTable,
  recordingsTable,
} from "@workspace/db";
import app from "../../../src/app.js";

/**
 * Route-level integration tests for the key /api/me library surfaces:
 *
 *   - GET  /api/me/library          — response shape, empty state, pagination
 *   - POST /api/me/keep             — valid / invalid body, unknown mbid
 *   - GET  /api/me/library/export   — downloadable payload + format validation
 *   - session behaviour             — /me/* auto-provisions an anonymous
 *     device identity (there is deliberately NO 401 login wall); the test
 *     asserts a cookieless request never sees another user's rows.
 *
 * Setup requirements: runs under `server-db-tests` (vitest.db.config.ts,
 * real shared Postgres, globalSetup migrations). Fully self-contained —
 * unique per-run ids, cleanup in afterAll, self-skips without a DB.
 * The `lore_sid` cookie is resolved against lore_users.deviceKey.
 */
const run = randomUUID().slice(0, 8);
const SID = `test-rt-lib-sid-${run}`;
const MBIDS = {
  first: `test-rt-lib-a-${run}`,
  second: `test-rt-lib-b-${run}`,
  third: `test-rt-lib-c-${run}`,
  keepTarget: `test-rt-lib-keep-${run}`,
};

let dbAvailable = false;
let userId: number | null = null;
let emptyUserId: number | null = null;
const EMPTY_SID = `test-rt-lib-empty-${run}`;
let server: Server | undefined;
let baseUrl = "";
const anonUserCookies: string[] = [];

function authed(params: Record<string, string> = {}, sid = SID) {
  const qs = new URLSearchParams(params).toString();
  return fetch(`${baseUrl}/api/me/library${qs ? `?${qs}` : ""}`, {
    headers: { cookie: `lore_sid=${sid}` },
  });
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
    .values({ spotifyUserId: `test-rt-lib-user-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  const [emptyUser] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: EMPTY_SID })
    .returning({ id: loreUsersTable.id });
  emptyUserId = emptyUser!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBIDS.first, title: "First Song", artist: `RT Lib Artist ${run}` },
    { mbid: MBIDS.second, title: "Second Song", artist: `RT Lib Artist ${run}` },
    { mbid: MBIDS.third, title: "Third Song", artist: `RT Lib Artist ${run}` },
    { mbid: MBIDS.keepTarget, title: "Keep Me", artist: `RT Lib Keeper ${run}` },
  ]);

  const base = Date.now();
  await db.insert(libraryItemsTable).values([
    { userId, mbid: MBIDS.first, provenance: { kind: "keep" }, addedAt: new Date(base) },
    { userId, mbid: MBIDS.second, provenance: { kind: "import", service: "spotify" }, addedAt: new Date(base - 1000) },
    { userId, mbid: MBIDS.third, provenance: { kind: "keep" }, addedAt: new Date(base - 2000) },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;
  const ids = [userId, emptyUserId].filter((v): v is number => v != null);
  if (ids.length > 0) {
    await db.delete(pendingKeepsTable).where(inArray(pendingKeepsTable.userId, ids));
    await db.delete(libraryItemsTable).where(inArray(libraryItemsTable.userId, ids));
    await db.delete(loreUsersTable).where(inArray(loreUsersTable.id, ids));
  }
  // Anonymous identities provisioned by the cookieless-session test.
  if (anonUserCookies.length > 0) {
    await db
      .delete(loreUsersTable)
      .where(inArray(loreUsersTable.deviceKey, anonUserCookies));
  }
  for (const mbid of Object.values(MBIDS)) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
});

describe("session behaviour on /api/me/library", () => {
  it("auto-provisions an anonymous identity for cookieless requests and never leaks another user's rows", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/me/library`);
    expect(res.status).toBe(200);

    // A fresh device identity is set via lore_sid — there is no 401 wall.
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = setCookie.match(/lore_sid=([^;]+)/);
    expect(match).toBeTruthy();
    if (match) anonUserCookies.push(decodeURIComponent(match[1]!));

    // The anonymous identity starts empty — no cross-user data.
    const body = await res.json();
    expect(body.items).toEqual([]);
    const ours = (body.items as { mbid: string }[]).filter((i) => i.mbid.includes(run));
    expect(ours).toHaveLength(0);
  });
});

describe("GET /api/me/library", () => {
  it("returns the items + cursor + page-1 total shape", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await authed({ q: run, limit: "50" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body).toHaveProperty("nextCursor");
    expect(typeof body.total).toBe("number");
    const mbids = body.items.map((i: { mbid: string }) => i.mbid);
    // Newest-first addedAt order.
    expect(mbids).toEqual([MBIDS.first, MBIDS.second, MBIDS.third]);
    for (const item of body.items) {
      expect(typeof item.mbid).toBe("string");
      expect(item).toHaveProperty("provenance");
      expect(item).toHaveProperty("addedAt");
    }
  });

  it("returns an empty state for a user with no library", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await authed({}, EMPTY_SID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.nextCursor).toBeNull();
  });

  it("pages with the cursor: disjoint pages, terminal null", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const p1 = await (await authed({ q: run, limit: "2" })).json();
    expect(p1.items.map((i: { mbid: string }) => i.mbid)).toEqual([MBIDS.first, MBIDS.second]);
    expect(p1.nextCursor).toBeTruthy();

    const p2 = await (await authed({ q: run, limit: "2", cursor: p1.nextCursor })).json();
    expect(p2.items.map((i: { mbid: string }) => i.mbid)).toEqual([MBIDS.third]);
    expect(p2.nextCursor).toBeNull();
    // Page 2+ omits the (page-1-only) total.
    expect(p2.total).toBeUndefined();
  });
});

describe("POST /api/me/keep", () => {
  async function keep(body: unknown) {
    const res = await fetch(`${baseUrl}/api/me/keep`, {
      method: "POST",
      headers: { cookie: `lore_sid=${SID}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it("rejects a body with neither mbid nor spinId", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status, body } = await keep({});
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("404s for an mbid not on the spine", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status } = await keep({ mbid: `test-rt-lib-missing-${run}` });
    expect(status).toBe(404);
  });

  it("keeps a known recording and the row lands in library_items", async (ctx) => {
    if (!dbAvailable || userId == null) return ctx.skip();
    const { status, body } = await keep({ mbid: MBIDS.keepTarget });
    expect(status).toBe(200);
    expect(body.keptToLore).toBe(true);
    expect(Array.isArray(body.mirrors)).toBe(true);

    const rows = await db
      .select()
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, userId), eq(libraryItemsTable.mbid, MBIDS.keepTarget)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provenance.kind).toBe("keep");
    expect(rows[0]!.removedAt).toBeNull();
  });
});

describe("GET /api/me/library/export", () => {
  it("400s on a missing or unknown format", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const missing = await fetch(`${baseUrl}/api/me/library/export`, {
      headers: { cookie: `lore_sid=${SID}` },
    });
    expect(missing.status).toBe(400);
    const bogus = await fetch(`${baseUrl}/api/me/library/export?format=xml`, {
      headers: { cookie: `lore_sid=${SID}` },
    });
    expect(bogus.status).toBe(400);
  });

  it("returns a downloadable JSON payload with the library rows", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/me/library/export?format=json`, {
      headers: { cookie: `lore_sid=${SID}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="lore-library-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const body = JSON.parse(await res.text());
    expect(body.format).toBe("lore.library.v1");
    expect(typeof body.exported_at).toBe("string");
    expect(body.count).toBe(body.items.length);
    const ours = (body.items as { mbid: string }[]).filter((i) => i.mbid.includes(run));
    expect(ours.map((i) => i.mbid)).toContain(MBIDS.first);
  });

  it("returns CSV with the exact header for format=csv", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/me/library/export?format=csv`, {
      headers: { cookie: `lore_sid=${SID}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text.startsWith("title,artist,album,isrc")).toBe(true);
  });
});
