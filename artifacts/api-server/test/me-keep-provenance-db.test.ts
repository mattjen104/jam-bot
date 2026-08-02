import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  libraryItemsTable,
  pendingKeepsTable,
  pickersTable,
  recordingsTable,
  showsTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * The keep endpoint must treat the validated spin join as the provenance
 * authority. This suite asserts the stored JSON, rather than just the
 * response, because the security boundary is the write.
 */
const run = randomUUID().slice(0, 8);
const SID = `test-keep-prov-sid-${run}`;
const MBID_RESOLVED = `test-keep-prov-resolved-${run}`;
const MBID_OTHER = `test-keep-prov-other-${run}`;

let dbAvailable = false;
let userId: number | undefined;
let stationId: number | undefined;
let otherStationId: number | undefined;
let showId: number | undefined;
let pickerId: number | undefined;
let resolvedSpinId: number | undefined;
let unresolvedSpinId: number | undefined;
let mismatchedSpinId: number | undefined;
let server: Server | undefined;
let baseUrl = "";

function cookie() {
  return `lore_sid=${SID}`;
}

async function postKeep(body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/me/keep`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function stored(mbid: string) {
  const [row] = await db
    .select({
      provenance: libraryItemsTable.provenance,
      spinId: libraryItemsTable.spinId,
    })
    .from(libraryItemsTable)
    .where(
      and(
        eq(libraryItemsTable.userId, userId!),
        eq(libraryItemsTable.mbid, mbid),
      ),
    )
    .limit(1);
  return row;
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
    {
      mbid: MBID_RESOLVED,
      title: "Resolved Keep",
      artist: `Keep Artist ${run}`,
    },
    { mbid: MBID_OTHER, title: "Other Keep", artist: `Other Artist ${run}` },
  ]);

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: `test-keep-prov-station-${run}`,
      name: `Trusted Station ${run}`,
      streamUrl: "http://example.invalid/keep-provenance",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  const [otherStation] = await db
    .insert(stationsTable)
    .values({
      slug: `test-keep-prov-other-station-${run}`,
      name: `Other Station ${run}`,
      streamUrl: "http://example.invalid/keep-provenance-other",
    })
    .returning({ id: stationsTable.id });
  otherStationId = otherStation!.id;

  const [picker] = await db
    .insert(pickersTable)
    .values({
      pickerType: "dj",
      name: `Trusted DJ ${run}`,
      handle: `trusted-dj-${run}`,
    })
    .returning({ id: pickersTable.id });
  pickerId = picker!.id;

  const [show] = await db
    .insert(showsTable)
    .values({
      stationId: stationId!,
      name: `Trusted Show ${run}`,
      djName: `Trusted DJ ${run}`,
      pickerId: pickerId!,
    })
    .returning({ id: showsTable.id });
  showId = show!.id;

  const spinRows = await db
    .insert(spinsTable)
    .values([
      {
        stationId: stationId!,
        showId: showId!,
        mbid: MBID_RESOLVED,
        rawArtist: "Keep Artist",
        rawTitle: "Resolved Keep",
        confidence: "recording_id",
        playedAt: new Date("2026-07-31T12:34:56.000Z"),
      },
      {
        stationId: stationId!,
        showId: showId!,
        mbid: null,
        rawArtist: "Unresolved Artist",
        rawTitle: "Unresolved Keep",
        confidence: "unresolved",
        playedAt: new Date("2026-07-31T13:34:56.000Z"),
      },
      {
        stationId: otherStationId!,
        mbid: MBID_OTHER,
        confidence: "recording_id",
        playedAt: new Date("2026-07-31T14:34:56.000Z"),
      },
    ])
    .returning({ id: spinsTable.id });
  resolvedSpinId = spinRows[0]!.id;
  unresolvedSpinId = spinRows[1]!.id;
  mismatchedSpinId = spinRows[2]!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (address && typeof address === "object")
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (!dbAvailable) return;

  if (userId != null) {
    await db
      .delete(pendingKeepsTable)
      .where(eq(pendingKeepsTable.userId, userId));
    await db
      .delete(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  if (
    resolvedSpinId != null ||
    unresolvedSpinId != null ||
    mismatchedSpinId != null
  ) {
    await db
      .delete(spinsTable)
      .where(
        inArray(spinsTable.id, [
          resolvedSpinId!,
          unresolvedSpinId!,
          mismatchedSpinId!,
        ]),
      );
  }
  if (showId != null)
    await db.delete(showsTable).where(eq(showsTable.id, showId));
  if (pickerId != null)
    await db.delete(pickersTable).where(eq(pickersTable.id, pickerId));
  if (stationId != null)
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  if (otherStationId != null) {
    await db.delete(stationsTable).where(eq(stationsTable.id, otherStationId));
  }
  await db
    .delete(recordingsTable)
    .where(inArray(recordingsTable.mbid, [MBID_RESOLVED, MBID_OTHER]));
});

describe("POST /api/me/keep provenance", () => {
  it("derives all attribution from a resolved spin and keeps only approved context", async () => {
    if (!dbAvailable) return;

    const { status } = await postKeep({
      mbid: MBID_RESOLVED,
      spinId: resolvedSpinId,
      provenance: {
        kind: "station",
        surface: "now-playing",
        entryPoint: "hero-keep",
        stationSlug: "attacker-station",
        stationName: "Attacker Station",
        showName: "Attacker Show",
        djName: "Attacker DJ",
        pickerHandle: "attacker-picker",
        pickerName: "Attacker Picker",
        playedAt: "2099-01-01T00:00:00.000Z",
        pickerId: 99999,
        arbitrary: "discard me",
      },
    });
    expect(status).toBe(200);

    const row = await stored(MBID_RESOLVED);
    expect(row).toMatchObject({ spinId: resolvedSpinId });
    expect(row?.provenance).toEqual({
      kind: "keep",
      surface: "now-playing",
      entryPoint: "hero-keep",
      stationSlug: `test-keep-prov-station-${run}`,
      stationName: `Trusted Station ${run}`,
      showName: `Trusted Show ${run}`,
      djName: `Trusted DJ ${run}`,
      pickerHandle: `trusted-dj-${run}`,
      pickerName: `Trusted DJ ${run}`,
      playedAt: "2026-07-31T12:34:56.000Z",
    });
  });

  it("applies the same server-derived provenance when promoting an unresolved spin", async () => {
    if (!dbAvailable) return;

    const { status, body } = await postKeep({
      spinId: unresolvedSpinId,
      provenance: {
        surface: "dial",
        stationSlug: "fake",
        showName: "fake",
        djName: "fake",
        playedAt: "2099-01-01T00:00:00.000Z",
        extra: true,
      },
    });
    expect(status).toBe(200);
    expect(body.keptToLore).toBe(false);

    const [pending] = await db
      .select({ spinId: pendingKeepsTable.spinId })
      .from(pendingKeepsTable)
      .where(
        and(
          eq(pendingKeepsTable.userId, userId!),
          eq(pendingKeepsTable.spinId, unresolvedSpinId!),
        ),
      );
    expect(pending?.spinId).toBe(unresolvedSpinId);
  });

  it("stores no attribution for a direct keep or a mismatched spin", async () => {
    if (!dbAvailable) return;

    const direct = await postKeep({
      mbid: MBID_OTHER,
      provenance: {
        surface: "library",
        entryPoint: "search",
        stationSlug: "fake",
        pickerName: "fake",
        playedAt: "2099-01-01T00:00:00.000Z",
        arbitrary: "discard me",
      },
    });
    expect(direct.status).toBe(200);
    expect(await stored(MBID_OTHER)).toEqual({
      provenance: { kind: "keep", surface: "library", entryPoint: "search" },
      spinId: null,
    });

    const mismatched = await postKeep({
      mbid: MBID_RESOLVED,
      spinId: mismatchedSpinId,
      provenance: {
        surface: "dial",
        stationSlug: "fake",
        showName: "fake",
        arbitrary: "discard me",
      },
    });
    expect(mismatched.status).toBe(200);
    const row = await stored(MBID_RESOLVED);
    expect(row?.spinId).toBe(resolvedSpinId);
    expect(row?.provenance).toEqual({
      kind: "keep",
      surface: "dial",
    });
  });
});
