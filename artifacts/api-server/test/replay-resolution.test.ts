import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  recordingsTable,
  replayResolutionJobsTable,
  serviceTrackMapTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import {
  canonicalReplayService,
  getReplayMaterializer,
  registerReplayMaterializer,
  runReplayResolutionWorker,
} from "../src/lore/replay-resolution.js";

const run = randomUUID().slice(0, 8);
const mbid = `test-replay-resolution-${run}`;
const slug = `test-replay-resolution-${run}`;
let stationId: number | undefined;
let resolvedSpinId: number | undefined;
let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [station] = await db.insert(stationsTable).values({
    slug,
    name: `Replay resolution station ${run}`,
    streamUrl: "http://example.invalid/replay-resolution",
    stationClass: "curated",
  }).returning({ id: stationsTable.id });
  stationId = station!.id;
  await db.insert(recordingsTable).values({
    mbid,
    title: "Replay Resolution Track",
    artist: "Replay Resolution Artist",
    links: [{ name: "Spotify", url: "https://open.spotify.com/track/ReplayTrack001", kind: "exact" }],
  });
  const spins = await db.insert(spinsTable).values([
    {
      stationId: stationId!,
      mbid,
      rawArtist: "Replay Resolution Artist",
      rawTitle: "Replay Resolution Track",
      source: "test",
      confidence: "text",
      playedAt: new Date(),
    },
    {
      stationId: stationId!,
      mbid: null,
      rawArtist: "Still Unresolved",
      rawTitle: "Manifest Row",
      source: "test",
      confidence: "unresolved",
      playedAt: new Date(Date.now() + 60_000),
    },
  ]).returning({ id: spinsTable.id });
  resolvedSpinId = spins[0]!.id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (!dbAvailable || stationId == null) return;
  await db.delete(replayResolutionJobsTable)
    .where(eq(replayResolutionJobsTable.replayId, resolvedSpinId!));
  await db.delete(serviceTrackMapTable).where(eq(serviceTrackMapTable.recordingMbid, mbid));
  await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
});

describe("Ghost Replay resolution registry", () => {
  it("canonicalizes Odesli platform keys consistently", () => {
    expect(canonicalReplayService("appleMusic")).toBe("apple_music");
    expect(canonicalReplayService("bandcamp")).toBe("bandcamp");
    expect(canonicalReplayService("youtubeMusic")).toBe("youtube_music");
    expect(canonicalReplayService("spotify")).toBe("spotify");
    expect(canonicalReplayService("anIndependentService")).toBe("an_independent_service");
  });

  it("keeps materializers optional and removable for future service writers", () => {
    const remove = registerReplayMaterializer({
      service: "spotify",
      canMaterialize: (map) => map.service === "spotify",
    });
    expect(getReplayMaterializer("spotify")?.canMaterialize({ service: "spotify" })).toBe(true);
    remove();
    expect(getReplayMaterializer("spotify")).toBeUndefined();
  });

  it("does not model terminal job status as a unique key", async () => {
    // Completed resolution jobs are historical receipts.  A listener can retry
    // the same replay later (for dead-link re-verification), so the persisted
    // schema must not constrain `(user, replay, status)` globally.
    const { replayResolutionJobsTable } = await import("@workspace/db");
    const uniqueIndexes = Object.values(replayResolutionJobsTable)
      .filter((value): value is { config?: { name?: string } } => typeof value === "object" && value !== null)
      .map((value) => value.config?.name)
      .filter(Boolean);
    expect(uniqueIndexes).not.toContain("replay_resolution_jobs_active_uq");
  });
});

describe("Ghost Replay resolution worker", () => {
  it("fans a cache miss into durable service maps without changing unresolved manifest rows", async (ctx) => {
    if (!dbAvailable || resolvedSpinId == null) return ctx.skip();

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      entitiesByUniqueId: {
        spotify: { id: "ReplayTrack001", apiProvider: "spotify" },
        apple: { id: "123456", apiProvider: "appleMusic" },
      },
      linksByPlatform: {
        spotify: { url: "https://open.spotify.com/track/ReplayTrack001" },
        appleMusic: { url: "https://music.apple.com/us/album/replay/123456?i=654321" },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    const [job] = await db.insert(replayResolutionJobsTable).values({
      userId: (await db.select({ id: sql<number>`min(id)` }).from(
        (await import("@workspace/db")).loreUsersTable,
      ))[0]!.id,
      replayId: resolvedSpinId,
      total: 2,
    }).returning();
    await runReplayResolutionWorker(job!.id);

    const [finished] = await db.select().from(replayResolutionJobsTable)
      .where(eq(replayResolutionJobsTable.id, job!.id));
    expect(finished).toMatchObject({ status: "done", resolved: 1, missing: 1, processed: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);

    const maps = await db.select().from(serviceTrackMapTable)
      .where(eq(serviceTrackMapTable.recordingMbid, mbid));
    expect(maps.map((map) => map.service).sort()).toEqual(["apple_music", "spotify"]);
    expect(maps.every((map) => map.method === "odesli" && map.confidence === "exact")).toBe(true);

    const manifestRows = await db.select({ id: spinsTable.id, mbid: spinsTable.mbid })
      .from(spinsTable)
      .where(eq(spinsTable.stationId, stationId!))
      .orderBy(spinsTable.playedAt);
    expect(manifestRows).toEqual([
      { id: resolvedSpinId, mbid },
      { id: expect.any(Number), mbid: null },
    ]);
    vi.unstubAllGlobals();
  });
});