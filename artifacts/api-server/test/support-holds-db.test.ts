// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  pendingKeepsTable,
  recordingsTable,
  supportHoldsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { bandcampFridayInfo } from "../src/lore/support-ladder.js";

const run = randomUUID().slice(0, 8);
const deviceKey = `support-hold-test-${run}`;
const mbid = `support-hold-recording-${run}`;

let dbAvailable = false;
let userId: number | undefined;
let server: Server | undefined;
let baseUrl = "";

async function request(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      cookie: `lore_sid=${deviceKey}`,
    },
  });
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
    .values({ deviceKey })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;
  await db.insert(recordingsTable).values({
    mbid,
    title: "Support hold test",
    artist: "Support hold test artist",
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (!dbAvailable) return;
  await db.delete(supportHoldsTable).where(eq(supportHoldsTable.recordingMbid, mbid));
  await db.delete(pendingKeepsTable).where(eq(pendingKeepsTable.userId, userId!));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId!));
});

describe("support hold persistence", () => {
  it("is idempotent per user/recording/date and never creates a pending keep", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const first = await request(`/api/me/support-holds/${mbid}`, { method: "POST" });
    const second = await request(`/api/me/support-holds/${mbid}`, { method: "POST" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({
      mbid,
      bandcampFridayDate: bandcampFridayInfo().date,
      held: true,
    });
    expect(await second.json()).toMatchObject({
      mbid,
      bandcampFridayDate: bandcampFridayInfo().date,
      held: true,
    });

    const [holds] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportHoldsTable)
      .where(
        and(
          eq(supportHoldsTable.userId, userId!),
          eq(supportHoldsTable.recordingMbid, mbid),
        ),
      );
    const [pending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pendingKeepsTable)
      .where(eq(pendingKeepsTable.userId, userId!));
    expect(holds?.count).toBe(1);
    expect(pending?.count).toBe(0);

    const released = await request(`/api/me/support-holds/${mbid}`, { method: "DELETE" });
    const releasedAgain = await request(`/api/me/support-holds/${mbid}`, { method: "DELETE" });
    expect(released.status).toBe(200);
    expect(releasedAgain.status).toBe(200);
    expect((await released.json()).held).toBe(false);
    expect((await releasedAgain.json()).held).toBe(false);

    const [afterRelease] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportHoldsTable)
      .where(eq(supportHoldsTable.recordingMbid, mbid));
    expect(afterRelease?.count).toBe(0);
  });

  it("returns hold state only for the requesting session on the public ladder", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    await request(`/api/me/support-holds/${mbid}`, { method: "POST" });
    const authenticated = await request(`/api/recordings/${mbid}/support`);
    const anonymous = await fetch(`${baseUrl}/api/recordings/${mbid}/support`);
    expect(authenticated.status).toBe(200);
    expect(anonymous.status).toBe(200);
    expect((await authenticated.json()).held).toBe(true);
    expect((await anonymous.json()).held).toBe(false);
  });
});