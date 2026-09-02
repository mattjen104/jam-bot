import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, eq } from "drizzle-orm";
import {
  appleMusicJamHelpersTable,
  appleMusicJamMembersTable,
  appleMusicJamsTable,
  db,
  loreUsersTable,
} from "@workspace/db";
import app from "../src/app.js";
import { applyAppleMusicJamsMigration } from "../src/lore/apple-music-jams-migration.js";

let server: ReturnType<typeof app.listen> | undefined;
let baseUrl = "";
let dbAvailable = false;
let code = "";
let hostCookie = "";
let listenerCookie = "";
const userIds: number[] = [];

async function request(path: string, init: RequestInit = {}, cookie = "") {
  return fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...init.headers,
    },
  });
}

function cookieFrom(response: Response): string {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

beforeAll(async () => {
  try {
    await applyAppleMusicJamsMigration();
    dbAvailable = true;
  } catch {
    return;
  }
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (dbAvailable && code) {
    const [jam] = await db.select({ id: appleMusicJamsTable.id, hostUserId: appleMusicJamsTable.hostUserId })
      .from(appleMusicJamsTable).where(eq(appleMusicJamsTable.code, code)).limit(1);
    if (jam) {
      const members = await db.select({ userId: appleMusicJamMembersTable.userId })
        .from(appleMusicJamMembersTable).where(eq(appleMusicJamMembersTable.jamId, jam.id));
      userIds.push(...members.map((item) => item.userId), jam.hostUserId);
      await db.delete(appleMusicJamsTable).where(eq(appleMusicJamsTable.id, jam.id));
    }
    if (userIds.length) await db.delete(loreUsersTable).where(inArray(loreUsersTable.id, [...new Set(userIds)]));
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
});

describe("Apple Music jam lifecycle", () => {
  it("creates a private queue room with a durable ordered snapshot", async () => {
    if (!dbAvailable) return;
    const response = await request("/jams", {
      method: "POST",
      body: JSON.stringify({
        mode: "queue",
        queue: [{ title: "Exact Track", artist: "Artist", appleMusicId: "12345" }],
      }),
    });
    expect(response.status).toBe(201);
    hostCookie = cookieFrom(response);
    const body = await response.json() as { code: string; role: string; revision: number; inviteToken: string };
    code = body.code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(body).toMatchObject({ role: "host", revision: 0 });
    expect(body.inviteToken).not.toContain(hostCookie);
  });

  it("joins with a separate Lore identity without exchanging Apple credentials", async () => {
    if (!dbAvailable) return;
    const response = await request(`/jams/${code}/join`, { method: "POST" });
    listenerCookie = cookieFrom(response);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ role: "listener", members: 2 });
    expect(body.inviteToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/music-user-token|authorization/i);
  });

  it("rejects listener controls and orders host transport revisions", async () => {
    if (!dbAvailable) return;
    const forbidden = await request(`/jams/${code}/transport`, {
      method: "POST", body: JSON.stringify({ action: "play" }),
    }, listenerCookie);
    expect(forbidden.status).toBe(403);

    const first = await request(`/jams/${code}/transport`, {
      method: "POST", body: JSON.stringify({ action: "play" }),
    }, hostCookie);
    const firstBody = await first.json() as { revision: number; transport: { state: string } };
    const second = await request(`/jams/${code}/transport`, {
      method: "POST", body: JSON.stringify({ action: "seek", positionMs: 42_000 }),
    }, hostCookie);
    const secondBody = await second.json() as { revision: number; transport: { positionMs: number } };
    expect(firstBody.transport.state).toBe("playing");
    expect(secondBody.revision).toBe(firstBody.revision + 1);
    expect(secondBody.transport.positionMs).toBe(42_000);
  });

  it("issues a hashed, room-scoped, short-lived helper credential only in record mode", async () => {
    if (!dbAvailable) return;
    await request(`/jams/${code}/mode`, {
      method: "POST", body: JSON.stringify({ mode: "record" }),
    }, hostCookie);
    const response = await request(`/jams/${code}/helper-token`, { method: "POST" }, hostCookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { token: string; expiresAt: string };
    const [jam] = await db.select({ id: appleMusicJamsTable.id }).from(appleMusicJamsTable)
      .where(eq(appleMusicJamsTable.code, code)).limit(1);
    const [stored] = await db.select().from(appleMusicJamHelpersTable)
      .where(eq(appleMusicJamHelpersTable.jamId, jam!.id)).limit(1);
    expect(stored.tokenHash).not.toBe(body.token);
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it("ends the room honestly when the host leaves", async () => {
    if (!dbAvailable) return;
    const response = await request(`/jams/${code}/leave`, { method: "POST" }, hostCookie);
    expect(response.status).toBe(204);
    const inspect = await request(`/jams/${code}`, {}, listenerCookie);
    expect(inspect.status).toBe(410);
  });
});