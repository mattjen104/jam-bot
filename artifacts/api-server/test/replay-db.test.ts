import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  recordingsTable,
  showsTable,
  spinsTable,
  stationsTable,
  pickersTable,
} from "@workspace/db";
import app from "../src/app.js";

const run = randomUUID().slice(0, 8);
const slug = `test-replay-${run}`;
const mbid = `test-replay-mbid-${run}`;
const base = new Date(Date.now() + 5 * 60_000);

let dbAvailable = false;
let stationId: number | undefined;
let showId: number | undefined;
let pickerId: number | undefined;
let anchorId: number | undefined;
let server: ReturnType<typeof app.listen> | undefined;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug,
      name: `Replay Station ${run}`,
      streamUrl: "http://example.invalid/replay",
      stationClass: "curated",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  const [picker] = await db
    .insert(pickersTable)
    .values({
      pickerType: "dj",
      name: `Replay DJ ${run}`,
      handle: `replay-dj-${run}`,
      trustTier: 3,
    })
    .returning({ id: pickersTable.id });
  pickerId = picker!.id;

  const [show] = await db
    .insert(showsTable)
    .values({
      stationId: stationId!,
      name: `Replay Show ${run}`,
      djName: `Replay DJ ${run}`,
      pickerId: pickerId!,
    })
    .returning({ id: showsTable.id });
  showId = show!.id;

  await db.insert(recordingsTable).values({
    mbid,
    title: "Resolved Replay Track",
    artist: "Replay Artist",
    links: [
      {
        name: "Spotify",
        url: "https://open.spotify.com/track/replay",
        kind: "exact",
      },
    ],
  });

  const spins = await db
    .insert(spinsTable)
    .values([
      {
        stationId: stationId!,
        showId: showId!,
        mbid,
        rawArtist: "Replay Artist",
        rawTitle: "Resolved Replay Track",
        source: "test",
        confidence: "text",
        playedAt: base,
      },
      {
        stationId: stationId!,
        showId: showId!,
        mbid: null,
        rawArtist: "Unknown Replay Artist",
        rawTitle: "Unresolved Replay Track",
        source: "manual",
        citation: "https://archive.example/replay",
        confidence: "unresolved",
        playedAt: new Date(base.getTime() + 60_000),
      },
    ])
    .returning({ id: spinsTable.id });
  anchorId = spins[0]!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable || stationId == null) return;
  await db.delete(spinsTable).where(eqStation(stationId));
  if (showId != null) await db.delete(showsTable).where(eqId(showsTable.id, showId));
  if (stationId != null) await db.delete(stationsTable).where(eqId(stationsTable.id, stationId));
  if (pickerId != null) await db.delete(pickersTable).where(eqId(pickersTable.id, pickerId));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [mbid]));
});

// Small typed helpers keep the cleanup predicates readable without importing
// every Drizzle operator into the test body.
function eqStation(id: number) {
  return sql`${spinsTable.stationId} = ${id}`;
}
function eqId(column: typeof stationsTable.id | typeof showsTable.id | typeof pickersTable.id, id: number) {
  return sql`${column} = ${id}`;
}

describe("GET /api/replay/:id", () => {
  it("returns a stable ordered manifest with attribution and unresolved rows", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const response = await fetch(`${baseUrl}/api/replay/${anchorId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      replayId: number;
      station: { slug: string };
      show: { name: string; djName: string | null } | null;
      picker: { handle: string; name: string } | null;
      bounds: { startedAt: string; endedAt: string };
      coverage: { total: number; resolved: number; unresolved: number };
      entries: Array<{
        position: number;
        spinId: number;
        rawTitle: string;
        citation: string | null;
        recording: { mbid: string } | null;
      }>;
    };

    expect(body.replayId).toBe(anchorId);
    expect(body.station.slug).toBe(slug);
    expect(body.show).toEqual({
      name: `Replay Show ${run}`,
      djName: `Replay DJ ${run}`,
    });
    expect(body.picker).toEqual({
      name: `Replay DJ ${run}`,
      handle: `replay-dj-${run}`,
      pickerType: "dj",
      trustTier: 3,
    });
    expect(body.coverage).toEqual({ total: 2, resolved: 1, unresolved: 1 });
    expect(body.entries.map((entry) => entry.position)).toEqual([0, 1]);
    expect(body.entries[0]!.spinId).toBe(anchorId);
    expect(body.entries[0]!.recording?.mbid).toBe(mbid);
    expect(body.entries[1]!.rawTitle).toBe("Unresolved Replay Track");
    expect(body.entries[1]!.recording).toBeNull();
    expect(body.entries[1]!.citation).toBe("https://archive.example/replay");
    expect(body.bounds.startedAt).toBe(base.toISOString());
    expect(body.bounds.endedAt).toBe(new Date(base.getTime() + 60_000).toISOString());
  });

  it("does not expose hidden stations or non-canonical member ids", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const memberId = anchorId! + 1;
    expect((await fetch(`${baseUrl}/api/replay/${memberId}`)).status).toBe(404);

    await db
      .update(stationsTable)
      .set({ hidden: true })
      .where(eqId(stationsTable.id, stationId!));
    try {
      expect((await fetch(`${baseUrl}/api/replay/${anchorId}`)).status).toBe(404);
    } finally {
      await db
        .update(stationsTable)
        .set({ hidden: false })
        .where(eqId(stationsTable.id, stationId!));
    }
  });

  it("returns a not-found response for an unknown or empty id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    expect((await fetch(`${baseUrl}/api/replay/not-an-id`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/replay/999999999`)).status).toBe(404);
  });

  it("serves the replay share contract and points humans at the replay surface", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const response = await fetch(`${baseUrl}/api/share/replays/${anchorId}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`Ghost Replay of 2 tracks as they aired on Replay Station ${run}`);
    expect(html).toContain(`location.replace("/lore/replay/${anchorId}")`);
    expect(html).toContain(`og:image`);
  });
});