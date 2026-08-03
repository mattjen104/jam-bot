import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  recordingsTable,
  replayResolutionJobsTable,
  serviceTrackMapTable,
  stationQualityTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import {
  canonicalReplayService,
  getReplayMaterializer,
  registerReplayMaterializer,
  resolveRecording,
  runReplayResolutionWorker,
  upsertServiceTrackMap,
  upsertServiceTrackMapMiss,
} from "../src/lore/replay-resolution.js";
import { applyReplayResolutionMigration } from "../src/lore/replay-resolution-migration.js";

const run = randomUUID().slice(0, 8);
const mbid = `test-replay-resolution-${run}`;
const slug = `test-replay-resolution-${run}`;
let stationId: number | undefined;
let resolvedSpinId: number | undefined;
let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    await applyReplayResolutionMigration();
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
  await db.delete(stationQualityTable).where(eq(stationQualityTable.stationId, stationId));
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

describe("Ghost Replay resolution negative-cache", () => {
  const ncRun = randomUUID().slice(0, 8);
  const noLinksMbid = `test-rr-no-links-${ncRun}`;
  const noVectorMbid = `test-rr-no-vector-${ncRun}`;
  const expiredMbid = `test-rr-expired-${ncRun}`;

  const revivedMbid = `test-rr-revived-${ncRun}`;
  const networkErrorMbid = `test-rr-net-error-${ncRun}`;

  beforeAll(async () => {
    if (!dbAvailable) return;
    // Recordings need to exist because serviceTrackMapTable.recordingMbid has a FK.
    await db.insert(recordingsTable).values([
      { mbid: noLinksMbid, title: "No Links Track", artist: "No Links Artist", isrc: "USNC12345678" },
      { mbid: noVectorMbid, title: "No Vector Track", artist: "No Vector Artist", isrc: null, links: [] },
      { mbid: expiredMbid, title: "Expired Miss Track", artist: "Expired Miss Artist", isrc: "USXX98765432" },
      { mbid: networkErrorMbid, title: "Network Error Track", artist: "Network Error Artist", isrc: "USNE11223344" },
    ]);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await db.delete(serviceTrackMapTable).where(
      inArray(serviceTrackMapTable.recordingMbid, [noLinksMbid, noVectorMbid, expiredMbid, networkErrorMbid]),
    );
    await db.delete(recordingsTable).where(
      inArray(recordingsTable.mbid, [noLinksMbid, noVectorMbid, expiredMbid, networkErrorMbid]),
    );
    vi.unstubAllGlobals();
  });

  it("writes a no_links miss row and skips Odesli on the second call", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const odesliEmpty = vi.fn(async () =>
      new Response(JSON.stringify({ linksByPlatform: {}, entitiesByUniqueId: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", odesliEmpty);

    // First call — Odesli returns nothing → should record a miss.
    const first = await resolveRecording(networkErrorMbid, {
      title: "Network Error Track",
      artist: "Network Error Artist",
      isrc: "USNE11223344",
      links: null,
    });
    expect(first).toBe("missing");
    expect(odesliThrows).toHaveBeenCalledTimes(1);

    // A miss row with reason "network_error" must have been written.
    const [missRow] = await db
      .select()
      .from(serviceTrackMapTable)
      .where(
        and(
          eq(serviceTrackMapTable.recordingMbid, networkErrorMbid),
          eq(serviceTrackMapTable.service, "odesli"),
        ),
      )
      .limit(1);
    expect(missRow).toBeDefined();
    expect(missRow!.missReason).toBe("network_error");
    expect(missRow!.missedAt).toBeInstanceOf(Date);

    // TTL must be well below 30 days — a row that is 2 hours old should still block.
    // (The real TTL is 1 hour, so a fresh row definitely blocks a second call.)
    odesliThrows.mockClear();
    const second = await resolveRecording(networkErrorMbid, {
      title: "Network Error Track",
      artist: "Network Error Artist",
      isrc: "USNE11223344",
      links: null,
    });
    expect(second).toBe("missing");
    expect(odesliEmpty).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("writes a no_vector miss row without ever calling Odesli", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const odesliSpy = vi.fn(async () =>
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", odesliSpy);

      const result = await resolveRecording(revivedMbid, {
        title: "Revived Track",
        artist: "Revived Artist",
        isrc: "USRV11223344",
        links: null,
      });

    const deadDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [spotifyRow] = await db
        .select()
        .from(serviceTrackMapTable)
        .where(
          and(
            eq(serviceTrackMapTable.recordingMbid, revivedMbid),
            eq(serviceTrackMapTable.service, "spotify"),
          ),
        )
        .limit(1);
    expect(result).toBe("missing");
    // Odesli must not have been touched — there was nothing to query.
    expect(odesliSpy).not.toHaveBeenCalled();

    const [missRow] = await db
      .select()
      .from(serviceTrackMapTable)
      .where(
        and(
          eq(serviceTrackMapTable.recordingMbid, networkErrorMbid),
          eq(serviceTrackMapTable.service, "odesli"),
        ),
      )
      .limit(1);
    expect(missRow).toBeDefined();
    expect(missRow!.missReason).toBe("no_vector");
    expect(missRow!.missedAt).toBeInstanceOf(Date);

    vi.unstubAllGlobals();
  });

  it("treats a network error as missing, writes a short-lived miss row, and skips on the next call", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const odesliThrows = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", odesliThrows);

    // First call — fetch throws → resolveRecording should return "missing", not throw.
    const first = await resolveRecording(networkErrorMbid, {
      title: "Network Error Track",
      artist: "Network Error Artist",
      isrc: "USNE11223344",
      links: null,
    });
    expect(first).toBe("missing");
    expect(odesliThrows).toHaveBeenCalledTimes(1);

    // A miss row with reason "network_error" must have been written.
    const [missRow] = await db
      .select()
      .from(serviceTrackMapTable)
      .where(
        and(
          eq(serviceTrackMapTable.recordingMbid, networkErrorMbid),
          eq(serviceTrackMapTable.service, "odesli"),
        ),
      )
      .limit(1);
    expect(missRow).toBeDefined();
    expect(missRow!.missReason).toBe("network_error");
    expect(missRow!.missedAt).toBeInstanceOf(Date);

    // TTL must be well below 30 days — a row that is 2 hours old should still block.
    // (The real TTL is 1 hour, so a fresh row definitely blocks a second call.)
    odesliThrows.mockClear();
    const second = await resolveRecording(networkErrorMbid, {
      title: "Network Error Track",
      artist: "Network Error Artist",
      isrc: "USNE11223344",
      links: null,
    });
    expect(second).toBe("missing");
    expect(odesliThrows).not.toHaveBeenCalled();

    // Once the network_error row is older than 1 hour, Odesli is retried.
    const staleNetDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    await db
      .update(serviceTrackMapTable)
      .set({ missedAt: staleNetDate, updatedAt: staleNetDate })
      .where(
        and(
          eq(serviceTrackMapTable.recordingMbid, networkErrorMbid),
          eq(serviceTrackMapTable.service, "odesli"),
        ),
      );

    const odesliEmpty = vi.fn(async () =>
      new Response(JSON.stringify({ linksByPlatform: {}, entitiesByUniqueId: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", odesliEmpty);

    const third = await resolveRecording(networkErrorMbid, {
      title: "Network Error Track",
      artist: "Network Error Artist",
      isrc: "USNE11223344",
      links: null,
    });
    expect(third).toBe("missing");
    expect(odesliEmpty).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("calls Odesli again once the miss row is older than 30 days", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Plant a stale miss row (31 days old) directly.
    const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await upsertServiceTrackMapMiss(expiredMbid, "no_links");
    // Backdate the missedAt so it falls outside the 30-day window.
    await db
      .update(serviceTrackMapTable)
      .set({ missedAt: staleDate, updatedAt: staleDate })
      .where(
        and(
          eq(serviceTrackMapTable.recordingMbid, expiredMbid),
          eq(serviceTrackMapTable.service, "odesli"),
        ),
      );

    const odesliRetry = vi.fn(async () =>
      new Response(JSON.stringify({ linksByPlatform: {}, entitiesByUniqueId: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", odesliRetry);

      const result = await resolveRecording(revivedMbid, {
        title: "Revived Track",
        artist: "Revived Artist",
        isrc: "USRV11223344",
        links: null,
      });

    const deadDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [spotifyRow] = await db
        .select()
        .from(serviceTrackMapTable)
        .where(
          and(
            eq(serviceTrackMapTable.recordingMbid, revivedMbid),
            eq(serviceTrackMapTable.service, "spotify"),
          ),
        )
        .limit(1);
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

describe("upsertServiceTrackMap rank guard", () => {
  const rgRun = randomUUID().slice(0, 8);
  const strongMbid = `test-rr-rank-strong-${rgRun}`;
  const weakMbid = `test-rr-rank-weak-${rgRun}`;

  beforeAll(async () => {
    if (!dbAvailable) return;
    await db.insert(recordingsTable).values([
      { mbid: strongMbid, title: "Rank Guard Strong Track", artist: "Rank Guard Artist" },
      { mbid: weakMbid, title: "Rank Guard Weak Track", artist: "Rank Guard Artist 2" },
    ]);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await db.delete(serviceTrackMapTable).where(
      inArray(serviceTrackMapTable.recordingMbid, [strongMbid, weakMbid]),
    );
    await db.delete(recordingsTable).where(
      inArray(recordingsTable.mbid, [strongMbid, weakMbid]),
    );
  });

  it("does not overwrite a high-rank row (recording_id/exact) with a lower-rank one (odesli/search)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Seed a strong row: method=recording_id, confidence=exact → rank 40.
    await upsertServiceTrackMap({
      recordingMbid: strongMbid,
      service: "spotify",
      externalId: "StrongId001",
      url: "https://open.spotify.com/track/StrongId001",
      method: "recording_id",
      confidence: "exact",
      verification: "verified",
    });

    // Attempt to overwrite with a weak row: method=odesli, confidence=search → rank 10.
    await upsertServiceTrackMap({
      recordingMbid: strongMbid,
      service: "spotify",
      externalId: "WeakId999",
      url: "https://open.spotify.com/track/WeakId999",
      method: "odesli",
      confidence: "search",
      verification: "unverified",
    });

    const [row] = await db
      .select()
      .from(serviceTrackMapTable)
      .where(
        and(
          eq(serviceTrackMapTable.recordingMbid, strongMbid),
          eq(serviceTrackMapTable.service, "spotify"),
        ),
      )
      .limit(1);

    expect(row).toBeDefined();
    expect(row!.url).toBe("https://open.spotify.com/track/StrongId001");
    expect(row!.method).toBe("recording_id");
    expect(row!.confidence).toBe("exact");
  });

  it("does overwrite a low-rank row (odesli/search) with an equal-or-higher-rank one (recording_id/exact)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Seed a weak row: method=odesli, confidence=search → rank 10.
    await upsertServiceTrackMap({
      recordingMbid: weakMbid,
      service: "spotify",
      externalId: "WeakFirst999",
      url: "https://open.spotify.com/track/WeakFirst999",
      method: "odesli",
      confidence: "search",
      verification: "unverified",
    });

    // Overwrite with a strong row: method=recording_id, confidence=exact → rank 40.
    await upsertServiceTrackMap({
      recordingMbid: weakMbid,
      service: "spotify",
      externalId: "StrongWinner001",
      url: "https://open.spotify.com/track/StrongWinner001",
      method: "recording_id",
      confidence: "exact",
      verification: "verified",
    });

    const [row] = await db
      .select()
      .from(serviceTrackMapTable)
      .where(
        and(
          eq(serviceTrackMapTable.recordingMbid, weakMbid),
          eq(serviceTrackMapTable.service, "spotify"),
        ),
      )
      .limit(1);

    expect(row).toBeDefined();
    expect(row!.url).toBe("https://open.spotify.com/track/StrongWinner001");
    expect(row!.method).toBe("recording_id");
    expect(row!.confidence).toBe("exact");
  });
});
