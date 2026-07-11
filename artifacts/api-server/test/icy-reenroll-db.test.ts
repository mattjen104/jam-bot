/**
 * HTTP integration test for POST /api/admin/radio-browser/stations/:id/reenroll.
 *
 * Stands up a real Express server with the admin router, inserts a real DB row
 * in suspended (error) state, sends an authenticated HTTP POST, and asserts:
 *   - 200 response with the expected JSON schema
 *   - icyStatus reset to "active" and consecutiveErrors reset to 0 in the DB
 *   - in-memory backoff entry cleared (pre-populated then confirmed absent)
 *   - 404 when the station id does not exist
 *   - idempotent: reenrolling an already-active station still returns 200
 *
 * The test self-skips when no real Postgres DB is reachable (CI without PG sidecar).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { AddressInfo } from "node:net";
import express from "express";
import { createServer } from "node:http";
import {
  db,
  stationsTable,
  radioBrowserStationsTable,
} from "@workspace/db";
import {
  _testOnlySetIcyBackoff,
  _testOnlyIcyBackoffHas,
} from "../src/lore/adapters.js";

// ---------------------------------------------------------------------------
// Admin token — must be set before adminRouter is imported so the middleware
// reads the correct value when the server first handles a request.
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = `test-reenroll-${randomUUID().slice(0, 8)}`;
process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

// ---------------------------------------------------------------------------
// Test-isolation identifiers
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);
const STATION_NAME = `Test Reenroll Station ${run}`;
const STATION_UUID = `reenroll-uuid-${run}`;
const STREAM_URL = `https://stream.example.com/reenroll-${run}`;

let dbAvailable = false;
let testStationId: number | null = null;
let testRbId: number | null = null;
let serverUrl = "";
let server: ReturnType<typeof createServer> | null = null;

// ---------------------------------------------------------------------------
// Server + DB setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Import admin router after setting the env var.
  const { default: adminRouter } = await import("../src/routes/lore/admin.js");

  const app = express();
  app.use(express.json());
  app.use(adminRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;

  // Insert a canonical station row.
  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: `reenroll-${run}`,
      name: STATION_NAME,
      streamUrl: STREAM_URL,
      streamFormat: "mp3",
      mode: "live",
      active: true,
      nowPlayingSource: "radio_browser_icy",
      source: "radio_browser",
      tier: "longtail",
      tags: [],
    })
    .returning({ id: stationsTable.id });

  testStationId = station!.id;

  // Insert a radio_browser_stations row in suspended (error) state.
  const [rbRow] = await db
    .insert(radioBrowserStationsTable)
    .values({
      stationId: testStationId,
      radioBrowserUuid: STATION_UUID,
      name: STATION_NAME,
      streamUrl: STREAM_URL,
      icyStatus: "error",
      consecutiveErrors: 3,
    })
    .returning({ id: radioBrowserStationsTable.id });

  testRbId = rbRow!.id;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  if (testRbId !== null) {
    await db
      .delete(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.id, testRbId));
  }
  if (testStationId !== null) {
    await db
      .delete(stationsTable)
      .where(eq(stationsTable.id, testStationId));
  }
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function reenrollUrl(id: number) {
  return `${serverUrl}/admin/radio-browser/stations/${id}/reenroll`;
}

async function postReenroll(id: number) {
  return fetch(reenrollUrl(id), {
    method: "POST",
    headers: { "x-admin-token": ADMIN_TOKEN },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /admin/radio-browser/stations/:id/reenroll (HTTP + DB integration)", () => {
  it("returns 200 with the expected JSON schema", async () => {
    if (!dbAvailable) return;

    const res = await postReenroll(testRbId!);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(testRbId);
    expect(body.icyStatus).toBe("active");
    expect(body.consecutiveErrors).toBe(0);
    expect(typeof body.updatedAt).toBe("string");
    // Verify the updatedAt is a valid ISO timestamp.
    expect(Number.isNaN(new Date(body.updatedAt as string).getTime())).toBe(false);
  });

  it("resets icyStatus to 'active' and consecutiveErrors to 0 in the DB", async () => {
    if (!dbAvailable) return;

    // Reset the row back to error state so this test is independent.
    await db
      .update(radioBrowserStationsTable)
      .set({ icyStatus: "error", consecutiveErrors: 3 })
      .where(eq(radioBrowserStationsTable.id, testRbId!));

    const res = await postReenroll(testRbId!);
    expect(res.status).toBe(200);

    const [row] = await db
      .select({
        icyStatus: radioBrowserStationsTable.icyStatus,
        consecutiveErrors: radioBrowserStationsTable.consecutiveErrors,
      })
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.id, testRbId!));

    expect(row!.icyStatus).toBe("active");
    expect(row!.consecutiveErrors).toBe(0);
  });

  it("clears the in-memory backoff entry so the next poll tick probes immediately", async () => {
    if (!dbAvailable) return;

    const rbId = testRbId!;

    // Pre-populate the backoff map using the test helper (simulates what would
    // happen after the adapter recorded a re-probe attempt during a poll tick).
    _testOnlySetIcyBackoff(rbId, Date.now());
    expect(_testOnlyIcyBackoffHas(rbId)).toBe(true); // confirm entry is present

    // Call the reenroll endpoint — handler calls clearIcyErrorBackoff(rbId).
    const res = await postReenroll(rbId);
    expect(res.status).toBe(200);

    // Entry must be gone: the next poll tick will probe immediately rather than
    // waiting out the 30-minute window.
    expect(_testOnlyIcyBackoffHas(rbId)).toBe(false);
  });

  it("returns 404 when the station id does not exist", async () => {
    if (!dbAvailable) return;

    const res = await postReenroll(999_999_999);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("is idempotent: reenrolling an already-active station still returns 200", async () => {
    if (!dbAvailable) return;

    // First call: resets to active.
    await postReenroll(testRbId!);
    // Second call: already active — must still succeed.
    const res = await postReenroll(testRbId!);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.icyStatus).toBe("active");
    expect(body.consecutiveErrors).toBe(0);
  });

  it("returns 401 when the admin token is wrong", async () => {
    if (!dbAvailable) return;

    const res = await fetch(reenrollUrl(testRbId!), {
      method: "POST",
      headers: { "x-admin-token": "wrong-token" },
    });
    expect(res.status).toBe(401);
  });
});
