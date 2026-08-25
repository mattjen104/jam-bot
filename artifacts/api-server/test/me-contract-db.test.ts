import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  libraryItemsTable,
  listensTable,
  loreUsersTable,
  recordingsTable,
  trackClaimsTable,
} from "@workspace/db";
import {
  KeepRecordingResponse,
  ListMyLibraryResponse,
  ListMyListensResponse,
} from "@workspace/api-zod";
import app from "../src/app.js";

/**
 * Contract smoke tests for the high-traffic listener routes. These intentionally
 * parse successful responses with the generated Zod models so a route change
 * cannot silently drift from the OpenAPI/client surface.
 *
 * HTTP JSON carries ISO strings for date-time fields, so these parse calls
 * intentionally validate the response body without a client-side reviver.
 */
const run = randomUUID().slice(0, 8);
const SID = `test-me-contract-${run}`;
const MBID_ONE = `test-me-contract-one-${run}`;
const MBID_TWO = `test-me-contract-two-${run}`;

let dbAvailable = false;
let userId: number | null = null;
let server: Server | undefined;
let baseUrl = "";
/** Device keys auto-provisioned by anonymous-request tests; cleaned in afterAll. */
const provisionedSids: string[] = [];

function headers() {
  return { cookie: `lore_sid=${SID}` };
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  });
  const body = response.status === 204 ? null : await response.json();
  return { status: response.status, body };
}

function parseListens(body: unknown) {
  return ListMyListensResponse.parse(body);
}

function parseLibrary(body: unknown) {
  return ListMyLibraryResponse.parse(body);
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [user] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBID_ONE, title: `Contract One ${run}`, artist: `Contract Artist ${run}` },
    { mbid: MBID_TWO, title: `Contract Two ${run}`, artist: `Contract Artist ${run}` },
  ]);

  await db.insert(libraryItemsTable).values([
    { userId, mbid: MBID_ONE, provenance: { kind: "keep" }, addedAt: new Date(Date.now() - 1000) },
    { userId, mbid: MBID_TWO, provenance: { kind: "import", service: "spotify" }, addedAt: new Date() },
  ]);

  await db.insert(listensTable).values([
    {
      userId,
      mbid: MBID_ONE,
      context: "broadcast",
      outputService: "broadcast",
      startedAt: new Date(Date.now() - 2000),
    },
    {
      userId,
      mbid: null,
      context: "ride",
      outputService: "spotify",
      startedAt: new Date(Date.now() - 1000),
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server!.address();
  if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (!dbAvailable || userId == null) return;
  await db.delete(listensTable).where(eq(listensTable.userId, userId));
  // Delete library/claim rows by MBID as well as by user: the anonymous
  // auto-provision test lands /me/keep on freshly provisioned users, which a
  // userId-scoped delete would miss — and the recordings deletes below would
  // then hit the library_items_mbid / track_claims_mbid foreign keys.
  await db
    .delete(libraryItemsTable)
    .where(inArray(libraryItemsTable.mbid, [MBID_ONE, MBID_TWO]));
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  await db
    .delete(trackClaimsTable)
    .where(inArray(trackClaimsTable.mbid, [MBID_ONE, MBID_TWO]));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  for (const sid of provisionedSids) {
    await db.delete(loreUsersTable).where(eq(loreUsersTable.deviceKey, sid));
  }
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_ONE));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_TWO));
});

describe("listener route contracts", () => {
  it("returns a Keep response matching the generated model", async () => {
    if (!dbAvailable) return;
    const response = await request("/api/me/keep", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mbid: MBID_ONE, provenance: { surface: "contract-test" } }),
    });
    expect(response.status).toBe(200);
    expect(KeepRecordingResponse.parse(response.body)).toMatchObject({
      keptToLore: true,
      mirrors: [],
    });
  });

  it("keeps nullable listen fields and cursor pagination aligned", async () => {
    if (!dbAvailable) return;
    const first = await request("/api/me/listens?limit=1");
    expect(first.status).toBe(200);
    const firstPage = parseListens(first.body);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.items[0]?.mbid).toBeNull();
    expect(firstPage.items[0]?.recording).toBeNull();

    const second = await request(`/api/me/listens?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`);
    expect(second.status).toBe(200);
    const secondPage = parseListens(second.body);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.mbid).toBe(MBID_ONE);
    expect(secondPage.items[0]?.recording).toMatchObject({
      title: `Contract One ${run}`,
      artist: `Contract Artist ${run}`,
    });
    expect(secondPage.nextCursor).toBeNull();
  });

  it("keeps nullable library recording fields and cursor pagination aligned", async () => {
    if (!dbAvailable) return;
    const first = await request("/api/me/library?limit=1&sort=added");
    expect(first.status).toBe(200);
    const firstPage = parseLibrary(first.body);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();

    const second = await request(`/api/me/library?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`);
    expect(second.status).toBe(200);
    const secondPage = parseLibrary(second.body);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.items[0]?.recording).not.toBeNull();
    expect(secondPage.items[0]?.recording?.artworkUrl).toBeNull();
  });

  it("auto-provisions a device identity for anonymous requests (no login wall)", async () => {
    if (!dbAvailable) return;
    const [listens, library, keep] = await Promise.all([
      fetch(`${baseUrl}/api/me/listens`),
      fetch(`${baseUrl}/api/me/library`),
      fetch(`${baseUrl}/api/me/keep`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mbid: MBID_ONE }),
      }),
    ]);
    // requireUserMiddleware provisions a fresh anonymous device identity and
    // sets the lore_sid cookie rather than rejecting with 401.
    for (const response of [listens, library, keep]) {
      expect(response.status).toBe(200);
      const match = /lore_sid=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
      expect(match).not.toBeNull();
      provisionedSids.push(match![1]!);
    }
  });
});