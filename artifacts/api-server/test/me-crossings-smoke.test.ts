// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import { db, loreUsersTable, spotifyConnectionsTable } from "@workspace/db";
import app from "../src/app.js";
import {
  _testOnly_clearCrossingsCache,
  _testOnly_clearBlendedCrossingsCache,
  _testOnly_clearBlendedCrossingsL2Cache,
} from "../src/routes/me/crossings.js";

/**
 * Smoke test for the crossings route file.
 *
 * The route file (src/routes/me/crossings.ts) has been damaged by bad merge
 * splices at least twice: variable names from the blended handler were spliced
 * into the personal handler (ReferenceError → 503 on every request), and the
 * blended handler's tail was scrambled around the module export.  Typecheck
 * did NOT catch every past splice, so this test boots the real app and hits
 * BOTH endpoints against a minimal fixture (one user, empty library) and
 * asserts they return 200 — never 5xx.
 *
 * Intentionally minimal: no spins/recordings seeding, no count assertions.
 * It exists purely to fail CI the moment either handler cannot execute
 * end-to-end.
 */

const run = randomUUID().slice(0, 8);
const SID = `test-cross-smoke-${run}`;

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let userId: number | null = null;

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
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `cross-smoke-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;
  if (userId !== null) {
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
});

describe("crossings route smoke (merge-splice guard)", () => {
  it("GET /api/me/crossings returns 200 (not 5xx) against a minimal fixture", async () => {
    if (!dbAvailable) return;
    // Bypass both cache layers so the full compute path actually executes —
    // that is the code past splices have corrupted.
    _testOnly_clearCrossingsCache(userId!);
    const res = await fetch(`${baseUrl}/api/me/crossings`, {
      headers: { cookie: `lore_sid=${SID}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown };
    expect(Array.isArray(body.items)).toBe(true);
  }, 120_000);

  it("GET /api/me/crossings/blended returns 200 (not 5xx) against a minimal fixture", async () => {
    if (!dbAvailable) return;
    // Clear both cache layers so this smoke request doesn't write a stale L2
    // row that concurrent DB test workers could read as a valid cache hit.
    _testOnly_clearBlendedCrossingsCache();
    await _testOnly_clearBlendedCrossingsL2Cache();
    const res = await fetch(`${baseUrl}/api/me/crossings/blended`, {
      headers: { cookie: `lore_sid=${SID}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown };
    expect(Array.isArray(body.items)).toBe(true);
    // Clear again after so the written L2 row (from the fire-and-forget write
    // above) cannot pollute parallel test workers that share the same DB.
    await _testOnly_clearBlendedCrossingsL2Cache();
    _testOnly_clearBlendedCrossingsCache();
  }, 120_000);
});
