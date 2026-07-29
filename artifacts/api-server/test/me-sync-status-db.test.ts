/**
 * Integration tests for GET /api/me/library/sync/:jobId
 *
 * Covers cross-user isolation: a user who guesses another user's jobId must
 * receive 404, not the other user's progress data.
 *
 * Done looks like:
 *   - Two users, each with their own sync job.
 *   - user1 requesting user2's jobId → 404.
 *   - user2 requesting user1's jobId → 404.
 *   - Each user can read their own job successfully.
 *
 * Follows the same DB-integration pattern as me-sync-unavailable-db.test.ts.
 * Self-skips when no real DB is available.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  librarySyncJobsTable,
  type SyncReceipt,
} from "@workspace/db";
import app from "../src/app.js";

const run = randomUUID().slice(0, 8);
const SID1 = `test-sync-status-sid1-${run}`;
const SID2 = `test-sync-status-sid2-${run}`;

let dbAvailable = false;
let userId1: number | null = null;
let userId2: number | null = null;
let jobIdUser1 = -1;
let jobIdUser2 = -1;
let server: Server | undefined;
let baseUrl = "";

function authHeaders1() {
  return { cookie: `lore_sid=${SID1}` };
}

function authHeaders2() {
  return { cookie: `lore_sid=${SID2}` };
}

async function getSyncStatus(jobId: number | string, headers: Record<string, string>) {
  const res = await fetch(`${baseUrl}/api/me/library/sync/${jobId}`, { headers });
  return { status: res.status, res };
}

async function getSyncStatusJson(jobId: number | string, headers: Record<string, string>) {
  const { status, res } = await getSyncStatus(jobId, headers);
  const body = await res.json().catch(() => null);
  return { status, body };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const minimalReceipt: SyncReceipt = {
    synced: 1,
    searchMatched: 0,
    alreadySaved: 0,
    unavailable: 0,
    unavailableItems: [],
    unavailableMbids: [],
    searchMatchedItems: [],
  };

  // ── User 1 ─────────────────────────────────────────────────────────────────
  await db.insert(spotifyConnectionsTable).values({
    sid: SID1,
    accessToken: "tok-status-1",
    refreshToken: "tok-refresh-1",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [user1] = await db
    .insert(loreUsersTable)
    .values({
      spotifyUserId: `test-sync-status-u1-${run}`,
      spotifyConnectionId: SID1,
      deviceKey: SID1,
    })
    .returning({ id: loreUsersTable.id });
  userId1 = user1!.id;

  const [job1] = await db
    .insert(librarySyncJobsTable)
    .values({
      userId: userId1!,
      service: "spotify",
      status: "done",
      total: 1,
      processed: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      results: minimalReceipt,
    })
    .returning({ id: librarySyncJobsTable.id });
  jobIdUser1 = job1!.id;

  // ── User 2 ─────────────────────────────────────────────────────────────────
  await db.insert(spotifyConnectionsTable).values({
    sid: SID2,
    accessToken: "tok-status-2",
    refreshToken: "tok-refresh-2",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [user2] = await db
    .insert(loreUsersTable)
    .values({
      spotifyUserId: `test-sync-status-u2-${run}`,
      spotifyConnectionId: SID2,
      deviceKey: SID2,
    })
    .returning({ id: loreUsersTable.id });
  userId2 = user2!.id;

  const [job2] = await db
    .insert(librarySyncJobsTable)
    .values({
      userId: userId2!,
      service: "spotify",
      status: "done",
      total: 1,
      processed: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      results: minimalReceipt,
    })
    .returning({ id: librarySyncJobsTable.id });
  jobIdUser2 = job2!.id;

  // ── Start the app server ───────────────────────────────────────────────────
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  const jobIds = [jobIdUser1, jobIdUser2].filter((id) => id > 0);
  if (jobIds.length > 0) {
    await db.delete(librarySyncJobsTable).where(
      sql`${librarySyncJobsTable.id} = ANY(ARRAY[${sql.join(
        jobIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::integer[])`,
    );
  }

  if (userId2 != null) {
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId2));
  }
  if (userId1 != null) {
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId1));
  }
  await db.delete(spotifyConnectionsTable).where(
    inArray(spotifyConnectionsTable.sid, [SID1, SID2]),
  );
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/me/library/sync/:jobId — cross-user isolation", () => {
  it("user1 can read their own job and gets a well-formed response", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getSyncStatusJson(jobIdUser1, authHeaders1());
    expect(status).toBe(200);
    expect(body).toHaveProperty("jobId", jobIdUser1);
    expect(body).toHaveProperty("status", "done");
  });

  it("user2 can read their own job and gets a well-formed response", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getSyncStatusJson(jobIdUser2, authHeaders2());
    expect(status).toBe(200);
    expect(body).toHaveProperty("jobId", jobIdUser2);
    expect(body).toHaveProperty("status", "done");
  });

  it("user1 requesting user2's jobId gets 404 (not user2's data)", async () => {
    if (!dbAvailable) return;
    const { status } = await getSyncStatusJson(jobIdUser2, authHeaders1());
    expect(status).toBe(404);
  });

  it("user2 requesting user1's jobId gets 404 (not user1's data)", async () => {
    if (!dbAvailable) return;
    const { status } = await getSyncStatusJson(jobIdUser1, authHeaders2());
    expect(status).toBe(404);
  });

  it("returns 400 for a non-numeric jobId", async () => {
    if (!dbAvailable) return;
    const { status } = await getSyncStatusJson("not-a-number", authHeaders1());
    expect(status).toBe(400);
  });

  it("returns 404 for a fabricated jobId that belongs to no one", async () => {
    if (!dbAvailable) return;
    const { status } = await getSyncStatusJson(9_999_999, authHeaders1());
    expect(status).toBe(404);
  });
});
