import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
 * Integration tests for GET /api/me/library?source=lore relaxed filter.
 *
 * Confirms:
 *  - A keep row WITHOUT any station/picker attribution IS returned by source=lore
 *    (direct keep — kept from Stack without radio context).
 *  - A keep row WITH station attribution is also returned by source=lore.
 *  - An import-kind row is NOT returned by source=lore.
 *  - source=keep continues to return all keep rows (radio + direct).
 */
const run = randomUUID().slice(0, 8);
const SID = `test-lore-direct-sid-${run}`;
const MBIDS = {
  directKeep: `test-lore-direct-keep-${run}`,
  radioKeep: `test-lore-radio-keep-${run}`,
  importRow: `test-lore-import-row-${run}`,
};

let dbAvailable = false;
let userId: number | null = null;
let server: Server | undefined;
let baseUrl = "";

async function getLibrary(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl}/api/me/library?${qs}`, {
    headers: { cookie: `lore_sid=${SID}` },
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
    .values({
      spotifyUserId: `test-lore-direct-user-${run}`,
      spotifyConnectionId: SID,
      deviceKey: SID,
    })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBIDS.directKeep, title: "Direct Keep Track", artist: `Direct Artist ${run}` },
    { mbid: MBIDS.radioKeep, title: "Radio Keep Track", artist: `Radio Artist ${run}` },
    { mbid: MBIDS.importRow, title: "Import Only Track", artist: `Import Artist ${run}` },
  ]);

  const base = Date.now();
  await db.insert(libraryItemsTable).values([
    // Direct keep: kind='keep' but NO station or picker fields
    {
      userId: userId!,
      mbid: MBIDS.directKeep,
      provenance: { kind: "keep" },
      addedAt: new Date(base),
    },
    // Radio keep: kind='keep' WITH station attribution
    {
      userId: userId!,
      mbid: MBIDS.radioKeep,
      provenance: { kind: "keep", stationSlug: "wfmu", stationName: "WFMU" },
      addedAt: new Date(base - 1000),
    },
    // Import row: kind='import' — must NOT appear in source=lore
    {
      userId: userId!,
      mbid: MBIDS.importRow,
      provenance: { kind: "import", service: "spotify" },
      addedAt: new Date(base - 2000),
    },
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
  for (const mbid of Object.values(MBIDS)) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
});

describe("GET /api/me/library?source=lore — relaxed filter (direct keeps)", () => {
  it("includes a direct keep (no station/picker) in the lore lens", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getLibrary({ source: "lore" });
    expect(status).toBe(200);
    const mbids: string[] = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(MBIDS.directKeep);
  });

  it("includes a radio keep (with station) in the lore lens", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getLibrary({ source: "lore" });
    expect(status).toBe(200);
    const mbids: string[] = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(MBIDS.radioKeep);
  });

  it("excludes an import-kind row from the lore lens", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getLibrary({ source: "lore" });
    expect(status).toBe(200);
    const mbids: string[] = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).not.toContain(MBIDS.importRow);
  });

  it("returns only keep-kind rows under source=keep (direct + radio)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getLibrary({ source: "keep" });
    expect(status).toBe(200);
    const mbids: string[] = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(MBIDS.directKeep);
    expect(mbids).toContain(MBIDS.radioKeep);
    expect(mbids).not.toContain(MBIDS.importRow);
  });

  it("returns all rows (including import) under source=all (no filter)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getLibrary({});
    expect(status).toBe(200);
    const mbids: string[] = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(MBIDS.directKeep);
    expect(mbids).toContain(MBIDS.radioKeep);
    expect(mbids).toContain(MBIDS.importRow);
  });

  it("provenance of a direct keep has kind=keep and no station fields", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary({ source: "lore" });
    const direct = body.items.find((i: { mbid: string; provenance: Record<string, unknown> }) => i.mbid === MBIDS.directKeep);
    expect(direct).toBeTruthy();
    expect(direct.provenance.kind).toBe("keep");
    expect(direct.provenance.stationSlug).toBeFalsy();
    expect(direct.provenance.stationName).toBeFalsy();
    expect(direct.provenance.pickerHandle).toBeFalsy();
  });
});
