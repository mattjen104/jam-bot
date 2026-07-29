import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { sql, eq } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  libraryItemsTable,
  recordingsTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Regression test: calling POST /spotify/logout must NOT clear the lore_sid
 * cookie (the durable Lore device identity). A user who keeps tracks and then
 * disconnects Spotify playback should still be able to access their library on
 * the next request.
 *
 * This covers the identity regression introduced when lore_sid changed from
 * a Spotify-playback token to the durable device key — logout must only clear
 * the playback-only `spotify_playback_sid` cookie.
 */

const run = randomUUID().slice(0, 8);
/** Stable device key used as the lore_sid cookie value throughout. */
const DEVICE_KEY = `test-logout-ident-${run}`;
const RECORDING_MBID = `test-logout-rec-${run}`;

let dbAvailable = false;
let userId: number | null = null;
let server: Server | undefined;
let baseUrl = "";

async function request(
  method: string,
  path: string,
  cookies: Record<string, string> = {},
) {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    redirect: "manual", // don't follow redirects (logout is 204, library is JSON)
  });
  return res;
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Seed a lore_users row whose deviceKey matches the test cookie value.
  const [user] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: DEVICE_KEY })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  // Seed a recording so the library_items FK is satisfied.
  await db
    .insert(recordingsTable)
    .values({ mbid: RECORDING_MBID, title: "Logout Test Track", artist: "Test Artist" })
    .onConflictDoNothing();

  // Seed one library item for the user (simulates a prior Keep).
  await db
    .insert(libraryItemsTable)
    .values({
      userId: userId!,
      mbid: RECORDING_MBID,
      provenance: { kind: "keep" },
      addedAt: new Date(),
    })
    .onConflictDoNothing();

  // Start the full app server.
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = (server as Server).address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable || userId == null) return;
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, RECORDING_MBID));
});

describe("POST /spotify/logout — identity preservation", () => {
  it("does not clear lore_sid: library is still accessible after logout", async () => {
    if (!dbAvailable) return;

    // Verify library is accessible before logout.
    const before = await request("GET", "/api/me/library", {
      lore_sid: DEVICE_KEY,
    });
    expect(before.status).toBe(200);
    const beforeBody = await before.json() as { items: { mbid: string }[] };
    expect(beforeBody.items.map((i) => i.mbid)).toContain(RECORDING_MBID);

    // Disconnect Spotify playback. Spotify connector is not configured in the
    // test environment, so the endpoint skips the deleteConnection call and
    // returns 204 (or 503 if the server enforces config). Either way, the
    // important assertion is about the Set-Cookie header.
    const logoutRes = await request("POST", "/spotify/logout", {
      lore_sid: DEVICE_KEY,
    });

    // logout must NOT send a Set-Cookie that expires/clears lore_sid.
    const setCookieHeader = logoutRes.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).not.toMatch(/lore_sid.*Max-Age=0/i);
    expect(setCookieHeader).not.toMatch(/lore_sid.*expires=Thu, 01 Jan 1970/i);

    // Library must still be accessible with the same lore_sid after logout.
    const after = await request("GET", "/api/me/library", {
      lore_sid: DEVICE_KEY,
    });
    expect(after.status).toBe(200);
    const afterBody = await after.json() as { items: { mbid: string }[] };
    expect(afterBody.items.map((i) => i.mbid)).toContain(RECORDING_MBID);
  });
});
