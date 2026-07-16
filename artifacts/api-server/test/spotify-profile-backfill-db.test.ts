import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, spotifyConnectionsTable } from "@workspace/db";
import { backfillConnectionProfile } from "../src/lore/spotifyConnect.js";

/**
 * Integration test for the status-endpoint self-heal: a connection row whose
 * product tier was never captured (profile fetch failed at connect time) gets
 * backfilled from /v1/me — and a failed re-fetch leaves the row untouched so
 * a later attempt can still succeed.
 */
const run = randomUUID().slice(0, 8);
const SID = `test-backfill-${run}`;

let dbAvailable = false;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  try {
    await db.select().from(spotifyConnectionsTable).limit(1);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
    return;
  }
  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3_600_000),
    displayName: null,
    product: null,
    spotifyUserId: null,
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db
    .delete(spotifyConnectionsTable)
    .where(eq(spotifyConnectionsTable.sid, SID));
});

async function loadRow() {
  const rows = await db
    .select()
    .from(spotifyConnectionsTable)
    .where(eq(spotifyConnectionsTable.sid, SID))
    .limit(1);
  return rows[0];
}

describe("backfillConnectionProfile", () => {
  it("leaves the row unchanged when the profile fetch fails", async () => {
    if (!dbAvailable) return;
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 500 }),
    ) as typeof fetch;

    const conn = await loadRow();
    const profile = await backfillConnectionProfile(conn);
    expect(profile).toBeNull();

    const after = await loadRow();
    expect(after.product).toBeNull();
  });

  it("persists the product tier and display name when the re-fetch succeeds", async () => {
    if (!dbAvailable) return;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "user-123",
          display_name: "Backfilled User",
          product: "premium",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as typeof fetch;

    const conn = await loadRow();
    const profile = await backfillConnectionProfile(conn);
    expect(profile?.product).toBe("premium");

    const after = await loadRow();
    expect(after.product).toBe("premium");
    expect(after.displayName).toBe("Backfilled User");
    expect(after.spotifyUserId).toBe("user-123");
  });
});
