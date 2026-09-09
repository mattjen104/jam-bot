// @vitest-environment node
/**
 * Integration tests for POST /api/me/library/release-metadata — the server-side
 * replacement for the crate's old browser→MusicBrainz trickle.
 *
 * Covers:
 *   1. Cached primary rows are served straight from recording_release_groups
 *      (no MB fetch at all).
 *   2. A miss is hydrated via ONE batched rid: search, persisted to the
 *      bridge table, and returned; a second request is a pure cache hit.
 *   3. A recording MB answers but can't place is negatively cached — the next
 *      request does not re-hit MB.
 *   4. A failed MB fetch is NOT negatively cached — the next request retries.
 *   5. MBIDs with no recordings row never reach MB (bridge-table FK guard).
 *   6. Body validation rejects malformed payloads.
 *
 * The MB network layer is swapped via __setReleaseMetadataFetchForTests; the
 * pacing gate is real but the fake responds instantly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  recordingsTable,
  recordingReleaseGroupsTable,
} from "@workspace/db";
import app from "../src/app.js";
import {
  __setReleaseMetadataFetchForTests,
  __clearReleaseMetadataCaches,
} from "../src/lore/release-metadata.js";

const run = randomUUID().slice(0, 8);
const SID = `test-rm-${run}`;
// Real-UUID-shaped ids so the MBID format gate lets them through.
const MBID_CACHED = randomUUID();
const MBID_HYDRATED = randomUUID();
const MBID_UNKNOWN = randomUUID();
const MBID_FLAKY = randomUUID();
const MBID_NOT_HELD = randomUUID();
const MBID_SPARSE = randomUUID();
const RG_CACHED = randomUUID();
const RG_HYDRATED = randomUUID();
const RG_SPARSE = randomUUID();

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";

interface MbCall { url: string }
const mbCalls: MbCall[] = [];
let mbHandler: (mbid: string) => unknown = () => undefined;

/** Minimal MB search-response builder driven by the per-test handler. */
function fakeMbFetch(url: string): Promise<Response> {
  mbCalls.push({ url });
  const query = decodeURIComponent(new URL(url).searchParams.get("query") ?? "");
  const requested = [...query.matchAll(/rid:([0-9a-f-]{36})/gi)].map((m) => m[1]!);
  const recordings = requested
    .map((mbid) => {
      const body = mbHandler(mbid);
      return body === undefined ? undefined : { id: mbid, ...(body as object) };
    })
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  return Promise.resolve(new Response(JSON.stringify({ recordings }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `lore_sid=${SID}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  try {
    await db.execute("SELECT 1");
    dbAvailable = true;
  } catch {
    console.warn("[release-metadata-db] DB unavailable, skipping");
    return;
  }
  process.env["MUSICBRAINZ_CONTACT"] = "lore-test/1.0 (test@example.com)";
  __setReleaseMetadataFetchForTests(fakeMbFetch);

  await db.insert(loreUsersTable).values({ deviceKey: SID }).onConflictDoNothing();
  await db.insert(recordingsTable).values([
    { mbid: MBID_CACHED, title: `Cached ${run}`, artist: `RM Artist ${run}` },
    { mbid: MBID_HYDRATED, title: `Hydrated ${run}`, artist: `RM Artist ${run}` },
    { mbid: MBID_UNKNOWN, title: `Unknown ${run}`, artist: `RM Artist ${run}` },
    { mbid: MBID_FLAKY, title: `Flaky ${run}`, artist: `RM Artist ${run}` },
    { mbid: MBID_SPARSE, title: `Sparse ${run}`, artist: `RM Artist ${run}` },
    // MBID_NOT_HELD deliberately has no recordings row.
  ]).onConflictDoNothing();
  await db.insert(recordingReleaseGroupsTable).values({
    recordingMbid: MBID_CACHED,
    releaseGroupMbid: RG_CACHED,
    isPrimary: true,
    title: `Cached Album ${run}`,
    primaryType: "Album",
    releaseYear: 1990,
  }).onConflictDoNothing();

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server!.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => {
  mbCalls.length = 0;
  mbHandler = () => undefined;
  __clearReleaseMetadataCaches();
});

afterAll(async () => {
  __setReleaseMetadataFetchForTests(null);
  delete process.env["MUSICBRAINZ_CONTACT"];
  if (dbAvailable) {
    const mbids = [MBID_CACHED, MBID_HYDRATED, MBID_UNKNOWN, MBID_FLAKY, MBID_NOT_HELD];
    await db.delete(recordingReleaseGroupsTable)
      .where(inArray(recordingReleaseGroupsTable.recordingMbid, mbids));
    await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, mbids));
    await db.delete(loreUsersTable).where(inArray(loreUsersTable.deviceKey, [SID]));
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("POST /api/me/library/release-metadata", () => {
  it("serves cached primary rows without touching MusicBrainz", async () => {
    if (!dbAvailable) return;
    const { status, body } = await post("/api/me/library/release-metadata", {
      mbids: [MBID_CACHED],
    });
    expect(status).toBe(200);
    expect((body.metadata as Record<string, unknown>)[MBID_CACHED]).toEqual({
      title: `Cached Album ${run}`,
      releaseGroupMbid: RG_CACHED,
    });
    expect(mbCalls).toHaveLength(0);
  });

  it("hydrates a miss in one batched query, persists it, and caches it", async () => {
    if (!dbAvailable) return;
    mbHandler = (mbid) => mbid === MBID_HYDRATED
      ? { releases: [{ date: "1997-06-16", status: "Official", "release-group": {
          id: RG_HYDRATED, title: `Hydrated Album ${run}`, "primary-type": "Album",
          "secondary-types": [], "first-release-date": "1997-05-21",
        } }] }
      : undefined;

    const first = await post("/api/me/library/release-metadata", {
      mbids: [MBID_CACHED, MBID_HYDRATED],
    });
    expect(first.status).toBe(200);
    expect((first.body.metadata as Record<string, unknown>)[MBID_HYDRATED]).toEqual({
      title: `Hydrated Album ${run}`,
      releaseGroupMbid: RG_HYDRATED,
    });
    // One batched query for the single missing id, none for the cached one.
    expect(mbCalls).toHaveLength(1);
    expect(mbCalls[0]!.url).toContain(`rid%3A${MBID_HYDRATED}`);
    expect(mbCalls[0]!.url).not.toContain(MBID_CACHED);

    // Persisted to the bridge table with the primary flag.
    const rows = await db
      .select({
        releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
        isPrimary: recordingReleaseGroupsTable.isPrimary,
        releaseYear: recordingReleaseGroupsTable.releaseYear,
      })
      .from(recordingReleaseGroupsTable);
    const mine = rows.filter((r) => r.releaseGroupMbid === RG_HYDRATED);
    expect(mine).toEqual([{ releaseGroupMbid: RG_HYDRATED, isPrimary: true, releaseYear: 1997 }]);

    // Second request: pure cache hit, no further MB traffic.
    mbCalls.length = 0;
    const second = await post("/api/me/library/release-metadata", { mbids: [MBID_HYDRATED] });
    expect((second.body.metadata as Record<string, unknown>)[MBID_HYDRATED]).toEqual({
      title: `Hydrated Album ${run}`,
      releaseGroupMbid: RG_HYDRATED,
    });
    expect(mbCalls).toHaveLength(0);
  });

  it("negatively caches a definitive miss instead of re-hitting MB", async () => {
    if (!dbAvailable) return;
    const first = await post("/api/me/library/release-metadata", { mbids: [MBID_UNKNOWN] });
    expect((first.body.metadata as Record<string, unknown>)[MBID_UNKNOWN]).toBeNull();
    expect(mbCalls).toHaveLength(1);

    mbCalls.length = 0;
    const second = await post("/api/me/library/release-metadata", { mbids: [MBID_UNKNOWN] });
    expect((second.body.metadata as Record<string, unknown>)[MBID_UNKNOWN]).toBeNull();
    expect(mbCalls).toHaveLength(0);
  });

  it("does not negatively cache a failed fetch — the next request retries", async () => {
    if (!dbAvailable) return;
    __setReleaseMetadataFetchForTests(() =>
      Promise.resolve(new Response("boom", { status: 503 })),
    );
    try {
      const first = await post("/api/me/library/release-metadata", { mbids: [MBID_FLAKY] });
      expect((first.body.metadata as Record<string, unknown>)[MBID_FLAKY]).toBeNull();
    } finally {
      __setReleaseMetadataFetchForTests(fakeMbFetch);
    }
    mbCalls.length = 0;
    mbHandler = (mbid) => mbid === MBID_FLAKY
      ? { releases: [{ status: "Official", "release-group": {
          id: randomUUID(), title: `Recovered Album ${run}`,
          "primary-type": "Album", "secondary-types": [],
          "first-release-date": "2001",
        } }] }
      : undefined;
    const second = await post("/api/me/library/release-metadata", { mbids: [MBID_FLAKY] });
    expect(mbCalls).toHaveLength(1);
    expect(
      (second.body.metadata as Record<string, unknown>)[MBID_FLAKY],
    ).toMatchObject({ title: `Recovered Album ${run}` });
  });

  it("hydrates a sparse search hit (no nested group title/date) via the release's own fields", async () => {
    if (!dbAvailable) return;
    // The real recording-search projection: title/date live on the RELEASE,
    // the nested release-group carries only id + type fields.
    mbHandler = (mbid) => mbid === MBID_SPARSE
      ? { releases: [{
          title: `Sparse Album ${run}`,
          date: "1997-05-21",
          status: "Official",
          "release-group": { id: RG_SPARSE, "primary-type": "Album" },
        }] }
      : undefined;

    const first = await post("/api/me/library/release-metadata", { mbids: [MBID_SPARSE] });
    expect(first.status).toBe(200);
    expect((first.body.metadata as Record<string, unknown>)[MBID_SPARSE]).toEqual({
      title: `Sparse Album ${run}`,
      releaseGroupMbid: RG_SPARSE,
    });
    expect(mbCalls).toHaveLength(1);

    const rows = await db
      .select({
        releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
        isPrimary: recordingReleaseGroupsTable.isPrimary,
        title: recordingReleaseGroupsTable.title,
        releaseYear: recordingReleaseGroupsTable.releaseYear,
      })
      .from(recordingReleaseGroupsTable);
    expect(rows.filter((r) => r.releaseGroupMbid === RG_SPARSE)).toEqual([{
      releaseGroupMbid: RG_SPARSE,
      isPrimary: true,
      title: `Sparse Album ${run}`,
      releaseYear: 1997,
    }]);

    // Next call is served from the bridge table without another upstream hit.
    mbCalls.length = 0;
    const second = await post("/api/me/library/release-metadata", { mbids: [MBID_SPARSE] });
    expect((second.body.metadata as Record<string, unknown>)[MBID_SPARSE]).toEqual({
      title: `Sparse Album ${run}`,
      releaseGroupMbid: RG_SPARSE,
    });
    expect(mbCalls).toHaveLength(0);
  });

  it("never sends MB an id with no recordings row (FK guard)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await post("/api/me/library/release-metadata", {
      mbids: [MBID_NOT_HELD],
    });
    expect(status).toBe(200);
    expect((body.metadata as Record<string, unknown>)[MBID_NOT_HELD]).toBeNull();
    expect(mbCalls).toHaveLength(0);
  });

  it("rejects malformed bodies", async () => {
    if (!dbAvailable) return;
    expect((await post("/api/me/library/release-metadata", {})).status).toBe(400);
    expect((await post("/api/me/library/release-metadata", { mbids: ["  "] })).status).toBe(400);
    expect((await post("/api/me/library/release-metadata", {
      mbids: Array.from({ length: 101 }, () => randomUUID()),
    })).status).toBe(400);
  });
});
