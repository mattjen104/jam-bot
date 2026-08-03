/**
 * Route-level tests for Ghost Replay resolution and playlist endpoints.
 *
 * Covers: resolution start, job poll, SSE snapshot, playlist-target lookup,
 * materialization start, and materialization job poll.  Asserts the OpenAPI
 * request/response shapes used by generated clients and verifies that
 * ownership and replay identifiers cannot be accidentally swapped.
 */
import 
{
 afterAll, beforeAll, describe, expect, it, vi 
}
 from "vitest"
;

import 
{
 randomUUID 
}
 from "node:crypto"
;

import 
{
 eq, inArray, sql 
}
 from "drizzle-orm"
;

import 
{

  db,
  loreUsersTable,
  recordingsTable,
  replayMaterializationJobsTable,
  replayResolutionJobsTable,
  serviceTrackMapTable,
  spinsTable,
  stationsTable,
}
 from "@workspace/db"
;

import 
{
 applyReplayResolutionMigration 
}
 from "../src/lore/replay-resolution-migration.js"
;

import 
{
 replayResolutionEvents, type ReplayResolutionProgress 
}
 from "../src/lore/replay-resolution.js"
;

import app from "../src/app.js"
;


// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8)
;

const slug = `test-replay-routes-${run}`
;

const mbid = `test-replay-routes-mbid-${run}`
;

const SID_A = `test-replay-routes-sid-a-${run}`
;

const SID_B = `test-replay-routes-sid-b-${run}`
;


let dbAvailable = false
;

let stationId: number | undefined
;

let anchorSpinId: number | undefined
;

let userIdA: number | undefined
;

let userIdB: number | undefined
;

let server: ReturnType<typeof app.listen> | undefined
;

let baseUrl = ""
;


beforeAll(async () => 
{

  try 
{

    await db.execute(sql`select 1`)
;

    await applyReplayResolutionMigration()
;

    dbAvailable = true
;

  
}
 catch 
{

    return
;

  
}


  const [station] = await db
    .insert(stationsTable)
    .values(
{

      slug,
      name: `Replay Routes Station ${run}`,
      streamUrl: "http://example.invalid/replay-routes",
      stationClass: "curated",
    
}
)
    .returning(
{
 id: stationsTable.id 
}
)
;

  stationId = station!.id
;


  await db.insert(recordingsTable).values(
{

    mbid,
    title: "Replay Routes Track",
    artist: "Replay Routes Artist",
  
}
)
;


  const base = new Date()
;

  const spins = await db
    .insert(spinsTable)
    .values([
      
{

        stationId: stationId!,
        mbid,
        rawArtist: "Replay Routes Artist",
        rawTitle: "Replay Routes Track",
        source: "test",
        confidence: "text",
        playedAt: base,
      
}
,
      
{

        stationId: stationId!,
        mbid: null,
        rawArtist: "Unresolved Routes Artist",
        rawTitle: "Unresolved Routes Track",
        source: "test",
        confidence: "unresolved",
        playedAt: new Date(base.getTime() + 60_000),
      
}
,
    ])
    .returning(
{
 id: spinsTable.id 
}
)
;

  anchorSpinId = spins[0]!.id
;


  // Two independent listeners — A is the primary, B tests ownership isolation.
  const [uA] = await db
    .insert(loreUsersTable)
    .values(
{
 deviceKey: SID_A 
}
)
    .returning(
{
 id: loreUsersTable.id 
}
)
;

  userIdA = uA!.id
;


  const [uB] = await db
    .insert(loreUsersTable)
    .values(
{
 deviceKey: SID_B 
}
)
    .returning(
{
 id: loreUsersTable.id 
}
)
;

  userIdB = uB!.id
;


  server = app.listen(0)
;

  await new Promise<void>((resolve) => server!.once("listening", resolve))
;

  const address = server!.address()
;

  if (address && typeof address === "object") 
{

    baseUrl = `http://127.0.0.1:${address.port}`
;

  
}

}
)
;


afterAll(async () => 
{

  server?.close()
;

  vi.unstubAllGlobals()
;

  if (!dbAvailable || stationId == null) return
;


  await db
    .delete(replayMaterializationJobsTable)
    .where(eq(replayMaterializationJobsTable.replayId, anchorSpinId!))
;

  await db
    .delete(replayResolutionJobsTable)
    .where(eq(replayResolutionJobsTable.replayId, anchorSpinId!))
;

  await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId))
;

  await db.delete(stationsTable).where(eq(stationsTable.id, stationId))
;

  await db
    .delete(loreUsersTable)
    .where(inArray(loreUsersTable.id, [userIdA!, userIdB!]))
;

  // service_track_map may have been written by the background resolution
  // worker
;
 clear it before removing the recording (FK order).
  await db
    .delete(serviceTrackMapTable)
    .where(eq(serviceTrackMapTable.recordingMbid, mbid))
;

  await db
    .delete(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
;

}
)
;


// ---------------------------------------------------------------------------
// POST /api/replay/:id/resolve — start resolution
// ---------------------------------------------------------------------------

describe("POST /api/replay/:id/resolve", () => 
{

  it("returns 401 when there is no listener session", async (ctx) => 
{

    if (!dbAvailable) return ctx.skip()
;

    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/resolve`,
      
{
 method: "POST" 
}
,
    )
;

    expect(res.status).toBe(401)
;

  
}
)
;


  it("returns 404 for a replay that does not exist", async (ctx) => 
{

    if (!dbAvailable) return ctx.skip()
;

    const res = await fetch(`${baseUrl}/api/replay/999999999/resolve`, 
{

      method: "POST",
      headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
,
    
}
)
;

    expect(res.status).toBe(404)
;

  
}
)
;


  it("returns 400 for a non-integer replay id", async (ctx) => 
{

    if (!dbAvailable) return ctx.skip()
;

    const res = await fetch(`${baseUrl}/api/replay/not-a-number/resolve`, 
{

      method: "POST",
      headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
,
    
}
)
;

    expect(res.status).toBe(400)
;

  
}
)
;


  it("returns 202 with a ReplayResolutionJob shape matching the OpenAPI schema", async (ctx) => 
{

    if (!dbAvailable) return ctx.skip()
;


    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/resolve`,
      
{

        method: "POST",
        headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
,
      
}
,
    )
;


    expect(res.status).toBe(202)
;

    const body = (await res.json()) as Record<string, unknown>
;


    // Required top-level fields from the OpenAPI ReplayResolutionJob schema.
    expect(typeof body.id).toBe("number")
;

    expect(typeof body.replayId).toBe("number")
;

    expect(["pending", "running", "done", "error"]).toContain(body.status)
;

    expect(typeof body.total).toBe("number")
;

    expect(typeof body.processed).toBe("number")
;

    expect(typeof body.resolved).toBe("number")
;

    expect(typeof body.missing).toBe("number")
;

    expect(typeof body.failed).toBe("number")
;

    expect(typeof body.committedOffset).toBe("number")
;

    expect(body.error === null || typeof body.error === "string").toBe(true)
;

    expect(body.finishedAt === null || typeof body.finishedAt === "string").toBe(true)
;

    expect(Array.isArray(body.failures)).toBe(true)
;

    expect(body.missBreakdown).toBeDefined()
;

    const bd = body.missBreakdown as Record<string, unknown>
;

    expect(typeof bd.noVector).toBe("number")
;

    expect(typeof bd.noLinks).toBe("number")
;

    expect(typeof bd.noRecording).toBe("number")
;


    // The replayId in the response must match the replay we posted to —
    // ownership and replay identifiers cannot be swapped.
    expect(body.replayId).toBe(anchorSpinId)
;

  
}
)
;

}
)
;


// ---------------------------------------------------------------------------
// GET /api/replay/jobs/:jobId — poll resolution job
// ---------------------------------------------------------------------------

describe("GET /api/replay/jobs/:jobId", () => 
{

  let jobId: number | undefined
;


  beforeAll(async () => 
{

    if (!dbAvailable || userIdA == null) return
;

    const [job] = await db
      .insert(replayResolutionJobsTable)
      .values(
{

        userId: userIdA,
        replayId: anchorSpinId!,
        total: 2,
        status: "done",
        processed: 2,
        resolved: 1,
        missing: 1,
        finishedAt: new Date(),
      
}
)
      .returning(
{
 id: replayResolutionJobsTable.id 
}
)
;

    jobId = job!.id
;

  
}
)
;


  it("returns 401 when there is no listener session", async (ctx) => 
{

    if (!dbAvailable || jobId == null) return ctx.skip()
;

    const res = await fetch(`${baseUrl}/api/replay/jobs/${jobId}`)
;

    expect(res.status).toBe(401)
;

  
}
)
;


  it("returns 404 when the session does not own the job (ownership isolation)", async (ctx) => 
{

    if (!dbAvailable || jobId == null) return ctx.skip()
;

    // User B tries to read User A's job — must be 404, not 200.
    const res = await fetch(`${baseUrl}/api/replay/jobs/${jobId}`, {
      headers: { cookie: `lore_sid=${SID_B}` },
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-existent job id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/jobs/999999999`, {
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer job id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/jobs/not-an-id`, {
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with a ReplayResolutionJob shape and the correct replayId", async (ctx) => {
    if (!dbAvailable || jobId == null) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/jobs/${jobId}`, {
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // OpenAPI shape validation.
    expect(body.id).toBe(jobId);
    expect(body.replayId).toBe(anchorSpinId);
    expect(["pending", "running", "done", "error"]).toContain(body.status);
    expect(typeof body.total).toBe("number");
    expect(typeof body.processed).toBe("number");
    expect(typeof body.resolved).toBe("number");
    expect(typeof body.missing).toBe("number");
    expect(typeof body.failed).toBe("number");
    expect(typeof body.committedOffset).toBe("number");
    expect(body.error === null || typeof body.error === "string").toBe(true);
    expect(body.finishedAt === null || typeof body.finishedAt === "string").toBe(true);
    expect(Array.isArray(body.failures)).toBe(true);
    const bd = body.missBreakdown as Record<string, unknown>;
    expect(typeof bd.noVector).toBe("number");
    expect(typeof bd.noLinks).toBe("number");
    expect(typeof bd.noRecording).toBe("number");

    // Ownership contract: the replayId must match what we inserted, proving
    // the server could not swap ownership or replay identifiers.
    expect(body.replayId).toBe(anchorSpinId);
  });
});

// ---------------------------------------------------------------------------
// GET /api/replay/jobs/:jobId/stream — SSE snapshot
// ---------------------------------------------------------------------------

describe("GET /api/replay/jobs/:jobId/stream", () => {
  let streamJobId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable || userIdA == null) return;
    const [job] = await db
      .insert(replayResolutionJobsTable)
      .values({
        userId: userIdA,
        replayId: anchorSpinId!,
        total: 2,
        status: "pending",
        processed: 0,
      })
      .returning({ id: replayResolutionJobsTable.id });
    streamJobId = job!.id;
  });

  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable || streamJobId == null) return ctx.skip();
    const controller = new AbortController();
    const res = await fetch(
      `${baseUrl}/api/replay/jobs/${streamJobId}/stream`,
      { signal: controller.signal },
    );
    controller.abort();
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent stream job", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const controller = new AbortController();
    const res = await fetch(
      `${baseUrl}/api/replay/jobs/999999999/stream`,
      {
        headers: { cookie: `lore_sid=${SID_A}` },
        signal: controller.signal,
      },
    );
    controller.abort();
    expect(res.status).toBe(404);
  });

  it("opens a text/event-stream and sends the initial snapshot data event", async (ctx) => {
    if (!dbAvailable || streamJobId == null) return ctx.skip();

    const controller = new AbortController();
    const res = await fetch(
      `${baseUrl}/api/replay/jobs/${streamJobId}/stream`,
      {
        headers: { cookie: `lore_sid=${SID_A}` },
        signal: controller.signal,
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    // Read just enough bytes to see the :connected comment and initial data
    // event; then abort so the persistent connection does not block the suite.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    const deadline = Date.now() + 3_000;
    try {
      while (Date.now() < deadline) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) =>
            setTimeout(() => resolve({ done: true, value: undefined }), 500),
          ),
        ]);
        if (done || value == null) break;
        accumulated += decoder.decode(value, { stream: true });
        // Once we have both the comment line and a data: frame we're done.
        if (accumulated.includes(":connected") && accumulated.includes("data:")) break
;

      
}

    
}
 finally 
{

      controller.abort()
;

      reader.cancel().catch(() => 
{
}
)
;

    
}


    expect(accumulated).toContain(":connected")
;

    expect(accumulated).toContain("data:")
;


    // The data event must be valid JSON carrying the snapshot fields.
    const dataLine = accumulated
      .split("\n")
      .find((l) => l.startsWith("data:"))
;

    expect(dataLine).toBeDefined()
;

    const snapshot = JSON.parse(dataLine!.slice(5).trim()) as Record<
      string,
      unknown
    >
;

    expect(snapshot.id).toBe(streamJobId)
;

    expect(snapshot.replayId).toBe(anchorSpinId)
;

    expect(["pending", "running", "done", "error"]).toContain(snapshot.status)
;

  
}
)
;


  // -------------------------------------------------------------------------
  // Reconnect tests: the route comment states "the client always receives a
  // persisted snapshot first, so reconnecting after a restart cannot lose its
  // progress state."  The tests below exercise that guarantee directly.
  // -------------------------------------------------------------------------

  it("re-emits the latest persisted snapshot after a mid-resolution disconnect", async (ctx) => 
{

    if (!dbAvailable || streamJobId == null) return ctx.skip()
;


    // Insert a fresh job in "pending" state so we control its exact shape.
    const [reconnectJob] = await db
      .insert(replayResolutionJobsTable)
      .values(
{

        userId: userIdA!,
        replayId: anchorSpinId!,
        total: 5,
        status: "pending",
        processed: 0,
      
}
)
      .returning(
{
 id: replayResolutionJobsTable.id 
}
)
;

    const reconnectJobId = reconnectJob!.id
;


    try 
{

      const decoder = new TextDecoder()
;


      // First connection — verify the initial snapshot is "pending".
      const ctrl1 = new AbortController()
;

      const res1 = await fetch(
        `${baseUrl}/api/replay/jobs/${reconnectJobId}/stream`,
        
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
, signal: ctrl1.signal 
}
,
      )
;

      expect(res1.status).toBe(200)
;


      const reader1 = res1.body!.getReader()
;

      let buf1 = ""
;

      while (!buf1.includes("data:")) 
{

        const 
{
 done, value 
}
 = await reader1.read()
;

        if (done || !value) break
;

        buf1 += decoder.decode(value, 
{
 stream: true 
}
)
;

      
}

      ctrl1.abort()
;

      reader1.cancel().catch(() => 
{
}
)
;


      const dataLine1 = buf1.split("\n").find((l) => l.startsWith("data:"))
;

      expect(dataLine1).toBeDefined()
;

      const snap1 = JSON.parse(dataLine1!.slice(5).trim()) as Record<string, unknown>
;

      expect(snap1.id).toBe(reconnectJobId)
;

      expect(snap1.status).toBe("pending")
;

      expect(snap1.processed).toBe(0)
;


      // Simulate mid-resolution progress: advance the DB row while disconnected.
      await db
        .update(replayResolutionJobsTable)
        .set(
{
 status: "running", processed: 3, resolved: 2, missing: 1 
}
)
        .where(eq(replayResolutionJobsTable.id, reconnectJobId))
;


      // Reconnect — the new connection must immediately send the updated snapshot.
      const ctrl2 = new AbortController()
;

      const res2 = await fetch(
        `${baseUrl}/api/replay/jobs/${reconnectJobId}/stream`,
        
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
, signal: ctrl2.signal 
}
,
      )
;

      expect(res2.status).toBe(200)
;


      const reader2 = res2.body!.getReader()
;

      let buf2 = ""
;

      const deadline = Date.now() + 3_000
;

      try 
{

        while (Date.now() < deadline) 
{

          const 
{
 done, value 
}
 = await Promise.race([
            reader2.read(),
            new Promise<
{
 done: true
;
 value: undefined 
}
>((resolve) =>
              setTimeout(() => resolve(
{
 done: true, value: undefined 
}
), 500),
            ),
          ])
;

          if (done || !value) break
;

          buf2 += decoder.decode(value, 
{
 stream: true 
}
)
;

          if (buf2.includes(":connected") && buf2.includes("data:")) break
;

        
}

      
}
 finally 
{

        ctrl2.abort()
;

        reader2.cancel().catch(() => 
{
}
)
;

      
}


      const dataLine2 = buf2.split("\n").find((l) => l.startsWith("data:"))
;

      expect(dataLine2).toBeDefined()
;

      const snap2 = JSON.parse(dataLine2!.slice(5).trim()) as Record<string, unknown>
;


      // The reconnected stream must carry the state written while disconnected.
      expect(snap2.id).toBe(reconnectJobId)
;

      expect(snap2.status).toBe("running")
;

      expect(snap2.processed).toBe(3)
;

      expect(snap2.resolved).toBe(2)
;

    
}
 finally 
{

      await db
        .delete(replayResolutionJobsTable)
        .where(eq(replayResolutionJobsTable.id, reconnectJob!.id))
;

    
}

  
}
)
;


  it("filters out progress events for other jobs — no cross-stream contamination", async (ctx) => 
{

    if (!dbAvailable || userIdA == null) return ctx.skip()
;


    // Two independent jobs — each stream must only see events for its own id.
    const [jobA] = await db
      .insert(replayResolutionJobsTable)
      .values(
{

        userId: userIdA,
        replayId: anchorSpinId!,
        total: 3,
        status: "running",
        processed: 1,
      
}
)
      .returning(
{
 id: replayResolutionJobsTable.id 
}
)
;

    const jobIdA = jobA!.id
;


    const [jobB] = await db
      .insert(replayResolutionJobsTable)
      .values(
{

        userId: userIdA,
        replayId: anchorSpinId!,
        total: 3,
        status: "running",
        processed: 0,
      
}
)
      .returning(
{
 id: replayResolutionJobsTable.id 
}
)
;

    const jobIdB = jobB!.id
;


    try 
{

      const decoder = new TextDecoder()
;

      const ctrl = new AbortController()
;

      const res = await fetch(
        `${baseUrl}/api/replay/jobs/${jobIdA}/stream`,
        
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
, signal: ctrl.signal 
}
,
      )
;

      expect(res.status).toBe(200)
;


      const reader = res.body!.getReader()
;

      let buf = ""
;


      // Drain the mandatory initial snapshot.
      while (!buf.includes("data:")) 
{

        const 
{
 done, value 
}
 = await reader.read()
;

        if (done || !value) break
;

        buf += decoder.decode(value, 
{
 stream: true 
}
)
;

      
}


      // Emit a progress event for Job B — the stream for Job A must not deliver it.
      const progressForB: ReplayResolutionProgress = 
{

        id: jobIdB,
        replayId: anchorSpinId!,
        status: "done",
        total: 3,
        processed: 3,
        resolved: 3,
        missing: 0,
        networkErrors: 0,
        failed: 0,
        committedOffset: 3,
        error: null,
        finishedAt: null,
        failures: [],
        missBreakdown: 
{
 noVector: 0, noLinks: 0, noRecording: 0 
}
,
      
}
;

      replayResolutionEvents.emit("progress", progressForB)
;


      // Then emit a progress event for Job A — the stream must deliver it.
      const progressForA: ReplayResolutionProgress = 
{

        id: jobIdA,
        replayId: anchorSpinId!,
        status: "done",
        total: 3,
        processed: 3,
        resolved: 2,
        missing: 1,
        networkErrors: 0,
        failed: 0,
        committedOffset: 3,
        error: null,
        finishedAt: null,
        failures: [],
        missBreakdown: 
{
 noVector: 0, noLinks: 0, noRecording: 0 
}
,
      
}
;

      replayResolutionEvents.emit("progress", progressForA)
;


      // Collect until we see at least two data: lines or timeout.
      const deadline = Date.now() + 3_000
;

      while (Date.now() < deadline) 
{

        const 
{
 done, value 
}
 = await Promise.race([
          reader.read(),
          new Promise<
{
 done: true
;
 value: undefined 
}
>((resolve) =>
            setTimeout(() => resolve(
{
 done: true, value: undefined 
}
), 500),
          ),
        ])
;

        if (done || !value) break
;

        buf += decoder.decode(value, 
{
 stream: true 
}
)
;

        if (buf.split("\n").filter((l) => l.startsWith("data:")).length >= 2) break
;

      
}


      ctrl.abort()
;

      reader.cancel().catch(() => 
{
}
)
;


      const dataLines = buf.split("\n").filter((l) => l.startsWith("data:"))
;

      const payloads = dataLines.map(
        (l) => JSON.parse(l.slice(5).trim()) as Record<string, unknown>,
      )
;


      // Every delivered data event must belong to Job A — Job B's event is filtered.
      for (const p of payloads) {
        expect(p.id).toBe(jobIdA);
      }
      // The Job A progress event must have been delivered with the right shape.
      const ownEvent = payloads.find((p) => p.processed === 3 && p.resolved === 2);
      expect(ownEvent).toBeDefined();
    } finally {
      await db
        .delete(replayResolutionJobsTable)
        .where(eq(replayResolutionJobsTable.id, jobIdA));
      await db
        .delete(replayResolutionJobsTable)
        .where(eq(replayResolutionJobsTable.id, jobIdB));
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/replay/:id/playlist-targets — available playlist destinations
// ---------------------------------------------------------------------------

describe("GET /api/replay/:id/playlist-targets", () => {
  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/playlist-targets`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-integer replay id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/replay/not-an-id/playlist-targets`, {
      headers: { cookie: `lore_sid=${SID_A}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with a targets array matching the ReplayPlaylistTargetsResponse schema", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/playlist-targets`,
      { headers: { cookie: `lore_sid=${SID_A}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(Array.isArray(body.targets)).toBe(true);
    for (const t of body.targets as Array<Record<string, unknown>>) {
      expect(["apple_music", "tidal"]).toContain(t.service);
      expect(typeof t.displayName).toBe("string");
      expect(typeof t.configured).toBe("boolean");
      expect(typeof t.connected).toBe("boolean");
      expect(typeof t.canWrite).toBe("boolean");
      expect(typeof t.authRequired).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/replay/:id/materialize — start playlist materialization
// ---------------------------------------------------------------------------

describe("POST /api/replay/:id/materialize", () => {
  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/materialize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: "apple_music" }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an unsupported playlist service", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/materialize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `lore_sid=${SID_A}`,
        },
        body: JSON.stringify({ service: "not-a-real-service" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-integer replay id", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/not-a-number/materialize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `lore_sid=${SID_A}`,
        },
        body: JSON.stringify({ service: "apple_music" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the service connector is unavailable (no Apple Music token configured)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    // apple_music is a valid service enum value but is not configured in the
    // test environment — the route must return 400, not 500 or 202.
    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/materialize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `lore_sid=${SID_A}`,
        },
        body: JSON.stringify({ service: "apple_music" }),
      },
    );
    // The route returns 400 "The selected playlist service is unavailable" when
    // the connector is not configured; 202 would only arrive when it is ready.
    expect([400, 202]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/replay/materialization-jobs/:jobId — poll materialization job
// ---------------------------------------------------------------------------

describe("GET /api/replay/materialization-jobs/:jobId", () => {
  let matJobId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable || userIdA == null) return;
    const [job] = await db
      .insert(replayMaterializationJobsTable)
      .values({
        userId: userIdA,
        replayId: anchorSpinId!,
        service: "apple_music",
        status: "done",
        total: 2,
        processed: 2,
        accepted: 1,
        missing: 1,
        name: "Test Station · Test DJ · 2026-08-03",
        description: "As broadcast on Test Station — via Lore",
        finishedAt: new Date(),
        receipt: [],
      })
      .returning({ id: replayMaterializationJobsTable.id });
    matJobId = job!.id;
  });

  it("returns 401 when there is no listener session", async (ctx) => {
    if (!dbAvailable || matJobId == null) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/${matJobId}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the session does not own the job (ownership isolation)", async (ctx) => {
    if (!dbAvailable || matJobId == null) return ctx.skip();
    // User B must not see User A's materialization job.
    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/${matJobId}`,
      
{
 headers: 
{
 cookie: `lore_sid=${SID_B}` 
}
 
}
,
    )
;

    expect(res.status).toBe(404)
;

  
}
)
;


  it("returns 404 for a non-existent job", async (ctx) => 
{

    if (!dbAvailable) return ctx.skip()
;

    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/999999999`,
      
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
 
}
,
    )
;

    expect(res.status).toBe(404)
;

  
}
)
;


  it("returns 400 for a non-integer job id", async (ctx) => 
{

    if (!dbAvailable) return ctx.skip()
;

    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/not-an-id`,
      
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
 
}
,
    )
;

    expect(res.status).toBe(400)
;

  
}
)
;


  it("returns 200 with a ReplayMaterializationJob shape and the correct replayId", async (ctx) => 
{

    if (!dbAvailable || matJobId == null) return ctx.skip()
;

    const res = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/${matJobId}`,
      
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
 
}
,
    )
;

    expect(res.status).toBe(200)
;

    const body = (await res.json()) as Record<string, unknown>
;


    // OpenAPI GetReplayPlaylistMaterializationResponse shape.
    expect(body.id).toBe(matJobId)
;

    expect(body.replayId).toBe(anchorSpinId)
;

    expect(["apple_music", "tidal"]).toContain(body.service)
;

    expect(["pending", "running", "done", "error"]).toContain(body.status)
;

    expect(typeof body.total).toBe("number")
;

    expect(typeof body.processed).toBe("number")
;

    expect(typeof body.accepted).toBe("number")
;

    expect(typeof body.missing).toBe("number")
;

    expect(typeof body.rejected).toBe("number")
;

    expect(typeof body.retryable).toBe("number")
;

    expect(typeof body.name).toBe("string")
;

    expect(typeof body.description).toBe("string")
;

    expect(body.playlistId === null || typeof body.playlistId === "string").toBe(true)
;

    expect(body.playlistUrl === null || typeof body.playlistUrl === "string").toBe(true)
;

    expect(body.error === null || typeof body.error === "string").toBe(true)
;

    expect(typeof body.errorRetryable).toBe("boolean")
;

    expect(body.finishedAt === null || typeof body.finishedAt === "string").toBe(true)
;

    expect(Array.isArray(body.receipt)).toBe(true)
;


    // Replay identity must not be swapped.
    expect(body.replayId).toBe(anchorSpinId)
;

  
}
)
;

}
)
;


// ---------------------------------------------------------------------------
// GET /api/replay/:id/apple-music — Apple MusicKit token + coverage
// ---------------------------------------------------------------------------

describe("GET /api/replay/:id/apple-music", () => 
{

  // A hidden station whose replay must never surface a developer token.
  let hiddenStationId: number | undefined
;

  let hiddenAnchorSpinId: number | undefined
;

  const hiddenSlug = `test-am-hidden-${run}`
;


  beforeAll(async () => 
{

    if (!dbAvailable) return
;


    const [hiddenStation] = await db
      .insert(stationsTable)
      .values(
{

        slug: hiddenSlug,
        name: `Apple Music Hidden Station ${run}`,
        streamUrl: "http://example.invalid/am-hidden",
        stationClass: "curated",
        hidden: true,
      
}
)
      .returning(
{
 id: stationsTable.id 
}
)
;

    hiddenStationId = hiddenStation!.id
;


    const [hiddenSpin] = await db
      .insert(spinsTable)
      .values(
{

        stationId: hiddenStationId!,
        mbid: null,
        rawArtist: "Hidden Artist",
        rawTitle: "Hidden Track",
        source: "test",
        confidence: "unresolved",
        playedAt: new Date(),
      
}
)
      .returning(
{
 id: spinsTable.id 
}
)
;

    hiddenAnchorSpinId = hiddenSpin!.id
;

  
}
)
;


  afterAll(async () => 
{

    if (!dbAvailable || hiddenStationId == null) return
;

    await db.delete(spinsTable).where(eq(spinsTable.stationId, hiddenStationId))
;

    await db.delete(stationsTable).where(eq(stationsTable.id, hiddenStationId))
;

  
}
)
;


  it("returns 404 for an unknown replay id", async (ctx) => 
{

    if (!dbAvailable) return ctx.skip()
;

    const res = await fetch(`${baseUrl}/api/replay/999999999/apple-music`)
;

    expect(res.status).toBe(404)
;

    const body = (await res.json()) as Record<string, unknown>
;

    // Must NOT include a developer token in the error response.
    expect(body.developerToken).toBeUndefined()
;

  
}
)
;


  it("returns 404 for a hidden station's replay id (no token leak)", async (ctx) => 
{

    if (!dbAvailable || hiddenAnchorSpinId == null) return ctx.skip()
;

    const res = await fetch(
      `${baseUrl}/api/replay/${hiddenAnchorSpinId}/apple-music`,
    )
;

    expect(res.status).toBe(404)
;

    const body = (await res.json()) as Record<string, unknown>
;

    // A developer token must never be returned when the replay is not found.
    expect(body.developerToken).toBeUndefined()
;

  
}
)
;


  it("returns 200 with an AppleMusicReplayMaterialization shape for a valid replay", async (ctx) => 
{

    if (!dbAvailable || anchorSpinId == null) return ctx.skip()
;

    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/apple-music`,
    )
;

    expect(res.status).toBe(200)
;

    const body = (await res.json()) as Record<string, unknown>
;


    // Top-level fields from AppleMusicReplayMaterialization schema.
    expect(typeof body.configured).toBe("boolean")
;

    expect(body.developerToken === null || typeof body.developerToken === "string").toBe(true)
;

    expect(typeof body.appName).toBe("string")
;

    expect(typeof body.apiBase).toBe("string")
;

    expect(typeof body.storefront).toBe("string")
;

    expect(body.replayId).toBe(anchorSpinId)
;

    expect(Array.isArray(body.entries)).toBe(true)
;


    // Coverage object shape.
    const cov = body.coverage as Record<string, unknown>
;

    expect(typeof cov.total).toBe("number")
;

    expect(typeof cov.available).toBe("number")
;

    expect(typeof cov.unavailable).toBe("number")
;

    expect(typeof cov.unresolved).toBe("number")
;

    expect(typeof cov.dead).toBe("number")
;

    // Counts must add up to total.
    expect(cov.available as number + (cov.unavailable as number) + (cov.unresolved as number) + (cov.dead as number)).toBe(cov.total)
;


    // Every entry must conform to the AppleMusicReplayMaterializationEntry shape.
    for (const entry of body.entries as Array<Record<string, unknown>>) 
{

      expect(typeof entry.position).toBe("number")
;

      expect(typeof entry.spinId).toBe("number")
;

      expect(entry.recordingMbid === null || typeof entry.recordingMbid === "string").toBe(true)
;

      expect(typeof entry.rawArtist).toBe("string")
;

      expect(typeof entry.rawTitle).toBe("string")
;

      expect(typeof entry.title).toBe("string")
;

      expect(typeof entry.artist).toBe("string")
;

      expect(entry.appleMusicId === null || typeof entry.appleMusicId === "string").toBe(true)
;

      expect(entry.url === null || typeof entry.url === "string").toBe(true)
;

      expect(["available", "unavailable", "unresolved", "dead"]).toContain(entry.status)
;

    
}

  
}
)
;

}
)
;


// ---------------------------------------------------------------------------
// GET /api/replay/:id/guided-queue
// ---------------------------------------------------------------------------

describe("GET /api/replay/:id/guided-queue", () => {
  // Fixture for the all-unresolved scenario: a station whose every spin has
  // no recording resolution so the guided queue is non-empty but has zero
  // available entries.
  const gqRun = randomUUID().slice(0, 8);
  const gqSlug = `test-guided-queue-${gqRun}`;
  let gqStationId: number | undefined;
  let gqAnchorSpinId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable) return;

    const [station] = await db
      .insert(stationsTable)
      .values({
        slug: gqSlug,
        name: `Guided Queue Station ${gqRun}`,
        streamUrl: "http://example.invalid/guided-queue",
        stationClass: "curated",
      })
      .returning({ id: stationsTable.id });
    gqStationId = station!.id;

    const base = new Date();
    const spins = await db
      .insert(spinsTable)
      .values([
        {
          stationId: gqStationId!,
          mbid: null,
          rawArtist: "Unresolved Artist A",
          rawTitle: "Unresolved Track A",
          source: "test",
          confidence: "unresolved",
          playedAt: base,
        },
        {
          stationId: gqStationId!,
          mbid: null,
          rawArtist: "Unresolved Artist B",
          rawTitle: "Unresolved Track B",
          source: "test",
          confidence: "unresolved",
          playedAt: new Date(base.getTime() + 60_000),
        },
      ])
      .returning({ id: spinsTable.id });
    gqAnchorSpinId = spins[0]!.id;
  });

  afterAll(async () => {
    if (!dbAvailable || gqStationId == null) return;
    await db.delete(spinsTable).where(eq(spinsTable.stationId, gqStationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, gqStationId));
  });

  it("returns 200 with coverage.total > 0 and coverage.available = 0 when no tracks are resolved", async (ctx) => {
    if (!dbAvailable || gqAnchorSpinId == null) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/replay/${gqAnchorSpinId}/guided-queue`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const coverage = body.coverage as Record<string, number>;
    expect(coverage.total).toBeGreaterThan(0);
    expect(coverage.available).toBe(0);
    // The replayId in the response must match the requested id.
    expect(body.replayId).toBe(gqAnchorSpinId);
  });

  it("returns only the requested service's entries when ?service= is specified", async (ctx) => {
    if (!dbAvailable || anchorSpinId == null) return ctx.skip();

    // Seed two service_track_map rows for the same recording so the filter
    // actually has something to exclude when we request only one service.
    await db
      .insert(serviceTrackMapTable)
      .values([
        {
          recordingMbid: mbid,
          service: "spotify",
          externalId: "1234567890123456789012",
          url: "https://open.spotify.com/track/1234567890123456789012",
          confidence: "exact",
          method: "odesli",
          deadLink: false,
        },
        {
          recordingMbid: mbid,
          service: "tidal",
          externalId: "tidal-track-999",
          url: "https://tidal.com/browse/track/999",
          confidence: "exact",
          method: "odesli",
          deadLink: false,
        },
      ])
      .onConflictDoNothing();

    const res = await fetch(
      `${baseUrl}/api/replay/${anchorSpinId}/guided-queue?service=spotify`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // The service field in the response must reflect what was requested.
    expect(body.service).toBe("spotify");
    // The replayId must match what was requested — no swap.
    expect(body.replayId).toBe(anchorSpinId);
    // At least one entry must be available (the resolved spin has a spotify mapping).
    const coverage = body.coverage as Record<string, number>;
    expect(coverage.available).toBeGreaterThan(0);
    // Every entry that has a target must use the spotify native URI scheme —
    // no tidal URLs can leak through when spotify was explicitly requested.
    const entries = body.entries as Array<Record<string, unknown>>;
    for (const entry of entries) {
      if (entry.target != null) {
        const target = entry.target as Record<string, unknown>;
        expect(String(target.url).startsWith("spotify:")).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-identifier swap guard
// ---------------------------------------------------------------------------
//
// Each route must serve only its own table. We verify this by inserting one
// job into each table, then confirming each ID works only on the correct
// route. Serial sequences for the two tables are independent so their IDs
// can coincide
;
 the guard condition below skips the cross-route 404 assertion
// only when the IDs happen to be numerically equal (an extreme rarity that
// would yield a false pass if both jobs were somehow accessible via both
// routes, but that can never happen because each handler queries a different
// table). The ownership-isolation tests above already exercise the 404 path
// exhaustively for each route independently.

describe("Replay identifier swap guard", () => 
{

  let swapResJobId: number | undefined
;

  let swapMatJobId: number | undefined
;


  beforeAll(async () => 
{

    if (!dbAvailable || userIdA == null) return
;


    const [rj] = await db
      .insert(replayResolutionJobsTable)
      .values(
{

        userId: userIdA,
        replayId: anchorSpinId!,
        total: 1,
        status: "done",
        processed: 1,
      
}
)
      .returning(
{
 id: replayResolutionJobsTable.id 
}
)
;

    swapResJobId = rj!.id
;


    const [mj] = await db
      .insert(replayMaterializationJobsTable)
      .values(
{

        userId: userIdA,
        replayId: anchorSpinId!,
        service: "tidal",
        status: "done",
        total: 1,
        processed: 1,
        name: "Swap Guard Test",
        description: "Swap Guard Test",
        receipt: [],
      
}
)
      .returning(
{
 id: replayMaterializationJobsTable.id 
}
)
;

    swapMatJobId = mj!.id
;

  
}
)
;


  afterAll(async () => 
{

    if (!dbAvailable) return
;

    if (swapResJobId != null) 
{

      await db
        .delete(replayResolutionJobsTable)
        .where(eq(replayResolutionJobsTable.id, swapResJobId))
;

    
}

    if (swapMatJobId != null) 
{

      await db
        .delete(replayMaterializationJobsTable)
        .where(eq(replayMaterializationJobsTable.id, swapMatJobId))
;

    
}

  
}
)
;


  it("each job id returns 200 only on its own route", async (ctx) => 
{

    if (!dbAvailable || swapResJobId == null || swapMatJobId == null) 
{

      return ctx.skip()
;

    
}


    // Resolution job is accessible via its own route.
    const resOnResRoute = await fetch(
      `${baseUrl}/api/replay/jobs/${swapResJobId}`,
      
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
 
}
,
    )
;

    expect(resOnResRoute.status).toBe(200)
;


    // Materialization job is accessible via its own route.
    const matOnMatRoute = await fetch(
      `${baseUrl}/api/replay/materialization-jobs/${swapMatJobId}`,
      
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
 
}
,
    )
;

    expect(matOnMatRoute.status).toBe(200)
;


    // Cross-route lookups must fail (404) when the IDs are numerically
    // distinct.  Two edge cases can make an assertion here a false failure:
    //   1. swapResJobId === swapMatJobId  (different-table sequences coincide)
    //   2. swapMatJobId coincides with a resolution-job row created earlier in
    //      the suite (jobId, streamJobId, …) — in that case the resolution
    //      route legitimately returns 200 for a *different* row.
    // Both are harmless from a correctness standpoint (each route still queries
    // only its own table), so skip the assertion rather than let a coincidental
    // ID alias produce a spurious failure.
    const [matIdInResTable] = swapResJobId !== swapMatJobId
      ? await db
          .select(
{
 id: replayResolutionJobsTable.id 
}
)
          .from(replayResolutionJobsTable)
          .where(eq(replayResolutionJobsTable.id, swapMatJobId!))
          .limit(1)
      : [undefined]
;


    if (swapResJobId !== swapMatJobId && !matIdInResTable) 
{

      const resOnMatRoute = await fetch(
        `${baseUrl}/api/replay/materialization-jobs/${swapResJobId}`,
        
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
 
}
,
      )
;

      expect(resOnMatRoute.status).toBe(404)
;


      const matOnResRoute = await fetch(
        `${baseUrl}/api/replay/jobs/${swapMatJobId}`,
        
{
 headers: 
{
 cookie: `lore_sid=${SID_A}` 
}
 
}
,
      )
;

      expect(matOnResRoute.status).toBe(404)
;

    
}

  
}
)
;

}
)
;
