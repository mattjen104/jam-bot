import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, eq, desc, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
  resolutionCacheTable,
} from "@workspace/db";
import app from "../src/app.js";
import {
  _testOnly_setFingerprintRunner,
  _testOnly_setStage1Refresh,
} from "../src/routes/lore/stations.js";
import { _testOnly_resetFingerprintCooldowns } from "../src/lore/fingerprint-policy.js";
import { normalizeKey } from "../src/lore/resolve.js";
import type { AcrMatch } from "../src/lore/stream-fingerprint.js";

/**
 * Integration tests for POST /api/stations/:slug/fingerprint — the targeted
 * ACR fallback with the shared trigger policy and two-stage flow:
 *
 *  - auto trigger on a healthy (fresh-metadata) station → 409, no capture;
 *  - stage-1-first ordering: the fresh metadata read runs BEFORE any capture,
 *    and a fresh stage-1 result short-circuits the fingerprint entirely;
 *  - fingerprint-derived spins carry provenance: source="acr_fingerprint",
 *    playedAt = capture time minus the match's play offset;
 *  - cooldown enforcement: an immediate second fingerprint for the same
 *    station returns 429.
 *
 * The ffmpeg+ACR runner and the stage-1 poll are swapped via _testOnly seams;
 * MusicBrainz is never hit because the match's artist+title resolution is
 * pre-seeded into resolution_cache and the recording row is pre-converged
 * (links + artwork + genreEnrichedAt set) so upsertRecording skips all
 * external enrichment. Unique slugs; cleaned up; skips without a DB.
 */
const run = randomUUID().slice(0, 8);
const MBID = `test-acr-${run}`;
const ACR_ARTIST = `Acr Artist ${run}`;
const ACR_TITLE = `Acr Title ${run}`;

const noSourceSlug = `test-acr-nosrc-${run}`; // metadata-less → stage 2 direct
const healthySlug = `test-acr-healthy-${run}`; // fresh metadata
const staleSlug = `test-acr-stale-${run}`; // stale metadata + source
const allowSlug = `test-acr-allow-${run}`; // allowlisted, aging metadata

let dbAvailable = false;
let stationIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";
const restores: Array<() => void> = [];

const events: string[] = [];
let fingerprintResult: AcrMatch | null = null;
let stage1Impl: () => Promise<void> = async () => {};

async function post(slug: string, body?: object) {
  return fetch(`${baseUrl}/api/stations/${slug}/fingerprint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  restores.push(
    _testOnly_setFingerprintRunner(async () => {
      events.push("fingerprint");
      return fingerprintResult;
    }),
    _testOnly_setStage1Refresh(async () => {
      events.push("stage1");
      await stage1Impl();
    }),
  );

  const stations = await db
    .insert(stationsTable)
    .values([
      {
        slug: noSourceSlug,
        name: `Test ACR NoSrc ${run}`,
        streamUrl: "http://example.invalid/acr-nosrc",
        stationClass: "community",
      },
      {
        slug: healthySlug,
        name: `Test ACR Healthy ${run}`,
        streamUrl: "http://example.invalid/acr-healthy",
        stationClass: "community",
        nowPlayingSource: "radio_browser_icy",
      },
      {
        slug: staleSlug,
        name: `Test ACR Stale ${run}`,
        streamUrl: "http://example.invalid/acr-stale",
        stationClass: "community",
        nowPlayingSource: "radio_browser_icy",
      },
      {
        slug: allowSlug,
        name: `Test ACR Allow ${run}`,
        streamUrl: "http://example.invalid/acr-allow",
        stationClass: "community",
        nowPlayingSource: "radio_browser_icy",
        nowPlayingConfig: { acrAllowlist: true },
      },
    ])
    .returning({ id: stationsTable.id, slug: stationsTable.slug });
  stationIds = stations.map((s) => s.id);

  // Pre-converged recording so upsertRecording makes zero external calls.
  await db.insert(recordingsTable).values({
    mbid: MBID,
    title: ACR_TITLE,
    artist: ACR_ARTIST,
    links: [{ platform: "spotify", url: "https://example.invalid/sp" }],
    artworkUrl: "https://example.invalid/art.jpg",
    genreEnrichedAt: new Date(),
  });
  // Pre-seeded resolution so resolveToMbid is a pure cache hit.
  await db
    .insert(resolutionCacheTable)
    .values({ key: normalizeKey(ACR_ARTIST, ACR_TITLE), mbid: MBID, confidence: "text" })
    .onConflictDoNothing();

  const now = Date.now();
  const healthyId = stations.find((s) => s.slug === healthySlug)!.id;
  const staleId = stations.find((s) => s.slug === staleSlug)!.id;
  const allowId = stations.find((s) => s.slug === allowSlug)!.id;
  await db.insert(spinsTable).values([
    // Healthy: observed seconds ago — inside the 2×30s ICY fresh budget.
    {
      stationId: healthyId,
      confidence: "unresolved",
      source: "radio_browser_icy",
      rawArtist: "Healthy Artist",
      rawTitle: "Healthy Track",
      playedAt: new Date(now - 5_000),
      observedAt: new Date(now - 5_000),
    },
    // Stale: observed 30 minutes ago — far past the ICY stale threshold.
    {
      stationId: staleId,
      confidence: "unresolved",
      source: "radio_browser_icy",
      rawArtist: "Stale Artist",
      rawTitle: "Stale Track",
      playedAt: new Date(now - 30 * 60_000),
      observedAt: new Date(now - 30 * 60_000),
    },
    // Allowlisted: observed 100s ago — AGING for ICY (past 2×30s fresh
    // budget, inside the 6×30s stale threshold). Not eligible for plain
    // auto, but the allowlist admits it.
    {
      stationId: allowId,
      confidence: "unresolved",
      source: "radio_browser_icy",
      rawArtist: "Allow Artist",
      rawTitle: "Allow Track",
      playedAt: new Date(now - 100_000),
      observedAt: new Date(now - 100_000),
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  for (const restore of restores) restore();
  _testOnly_resetFingerprintCooldowns();
  if (!dbAvailable || stationIds.length === 0) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  await db.execute(sql`DELETE FROM embed_resolution_queue WHERE recording_mbid = ${MBID}`).catch(() => {});
  await db.delete(resolutionCacheTable).where(
    eq(resolutionCacheTable.key, normalizeKey(ACR_ARTIST, ACR_TITLE)),
  );
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
  await db.execute(sql`DELETE FROM station_quality WHERE station_id = ANY(ARRAY[${sql.join(stationIds.map((i) => sql`${i}`), sql`, `)}]::integer[])`).catch(() => {});
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
}, 90_000);

beforeEach(() => {
  events.length = 0;
  fingerprintResult = null;
  stage1Impl = async () => {};
  _testOnly_resetFingerprintCooldowns();
});

describe("POST /api/stations/:slug/fingerprint", () => {
  it("auto trigger on a healthy station → 409, no stage 1, no capture", async () => {
    if (!dbAvailable) return;
    const res = await post(healthySlug, { trigger: "auto" });
    expect(res.status).toBe(409);
    expect(events).toEqual([]);
  }, 90_000);

  it("explicit trigger on a healthy station runs stage 1 first and short-circuits without capturing", async () => {
    if (!dbAvailable) return;
    // Stage-1 "refresh" leaves the already-fresh spin in place.
    const res = await post(healthySlug, { trigger: "explicit" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logged: boolean };
    expect(body.logged).toBe(false);
    // Metadata read ran; fingerprint never did.
    expect(events).toEqual(["stage1"]);
  }, 90_000);

  it("stale station: stage 1 runs BEFORE capture; a fresh stage-1 result suppresses the fingerprint", async () => {
    if (!dbAvailable) return;
    const staleId = stationIds[2]!;
    // Stage 1 refreshes the stale spin's observation to "now" (fresh).
    stage1Impl = async () => {
      await db
        .update(spinsTable)
        .set({ observedAt: new Date() })
        .where(eq(spinsTable.stationId, staleId));
    };
    const res = await post(staleSlug, { trigger: "auto" });
    expect(res.status).toBe(200);
    expect(events).toEqual(["stage1"]); // never reached the capture stage

    // Restore staleness for the next test.
    await db
      .update(spinsTable)
      .set({ observedAt: new Date(Date.now() - 30 * 60_000) })
      .where(eq(spinsTable.stationId, staleId));
  }, 90_000);

  it("stale station whose stage 1 stays stale falls through to the fingerprint (stage order preserved)", async () => {
    if (!dbAvailable) return;
    fingerprintResult = {
      title: ACR_TITLE,
      artist: ACR_ARTIST,
      album: "",
      playOffsetMs: 90_000,
      score: 92,
    };
    const before = Date.now();
    const res = await post(staleSlug, { trigger: "auto" });
    expect(res.status).toBe(200);
    expect(events).toEqual(["stage1", "fingerprint"]);
    const body = (await res.json()) as { logged: boolean; mbid: string | null };
    expect(body.logged).toBe(true);
    expect(body.mbid).toBe(MBID);

    // Provenance on the written spin: fingerprint source tag, capture-time
    // minus play offset as playedAt, fresh observation timestamp.
    const staleId = stationIds[2]!;
    const [spin] = await db
      .select()
      .from(spinsTable)
      .where(eq(spinsTable.stationId, staleId))
      .orderBy(desc(spinsTable.playedAt))
      .limit(1);
    expect(spin!.source).toBe("acr_fingerprint");
    expect(spin!.mbid).toBe(MBID);
    expect(spin!.confidence).toBe("text");
    const expectedPlayedAt = before - 90_000;
    expect(Math.abs(spin!.playedAt.getTime() - expectedPlayedAt)).toBeLessThan(30_000);
    expect(Date.now() - (spin!.observedAt ?? spin!.createdAt).getTime()).toBeLessThan(60_000);
  }, 90_000);

  it("metadata-less station skips stage 1 entirely and honest no-match stays {logged:false}", async () => {
    if (!dbAvailable) return;
    fingerprintResult = null; // ACR found nothing
    const res = await post(noSourceSlug, { trigger: "auto" });
    expect(res.status).toBe(200);
    expect(events).toEqual(["fingerprint"]); // no stage1 — nothing to re-read
    const body = (await res.json()) as { logged: boolean; mbid: string | null };
    expect(body).toMatchObject({ logged: false, mbid: null });
  }, 90_000);

  it("cooldown: an immediate second fingerprint for the same station → 429", async () => {
    if (!dbAvailable) return;
    fingerprintResult = null;
    const first = await post(noSourceSlug, { trigger: "explicit" });
    expect(first.status).toBe(200);
    const second = await post(noSourceSlug, { trigger: "explicit" });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    // Only the first request reached the capture stage.
    expect(events).toEqual(["fingerprint"]);
  }, 90_000);

  it("allowlisted station with AGING metadata is admitted for auto and fingerprints after stage 1", async () => {
    if (!dbAvailable) return;
    fingerprintResult = null; // no match needed — admission is what's under test
    const res = await post(allowSlug, { trigger: "auto" });
    expect(res.status).toBe(200);
    // Stage 1 still ran first (station has a source); stage 2 followed
    // because the observation stayed aging (non-fresh).
    expect(events).toEqual(["stage1", "fingerprint"]);
  }, 90_000);

  it("unknown station → 404", async () => {
    if (!dbAvailable) return;
    const res = await post(`no-such-${run}`, { trigger: "explicit" });
    expect(res.status).toBe(404);
  }, 90_000);
});
