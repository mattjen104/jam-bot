import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
  resolutionCacheTable,
} from "@workspace/db";
import {
  logSpinIfChanged,
  normalizeKey,
  spinEvents,
  type SpinChangedEvent,
  type SpinRawEvent,
  type SpinRawFailedEvent,
} from "../src/lore/resolve.js";

/**
 * Integration tests for the provisional now-playing fast path:
 *  (a) a genuinely-new track emits `spin-raw` BEFORE the resolved
 *      `spin-changed`;
 *  (b) an unchanged track emits neither;
 *  (c) a rapid second change for the same station while the first is still
 *      in flight queues behind it, so events leave in strict observation
 *      order (rawA → changedA → rawB → changedB) — a stale resolved event
 *      can never arrive after a fresher provisional one.
 *  (d) when the pipeline ends without persisting (write declined), a terminal
 *      `spin-raw-failed` event closes out the provisional display — clients
 *      are never left stuck "resolving" an unpersisted track.
 *  (e) a post-persist failure (metadata lookup or a throwing SSE listener)
 *      never reports the persisted track as failed — spin-raw-failed is
 *      reserved for tracks that never reached the spine.
 *
 * The resolution cache and recording rows are pre-seeded so the whole path is
 * DB-only — no MusicBrainz/Spotify/Odesli network calls fire. Skips
 * gracefully when no DB is reachable.
 */
const run = randomUUID().slice(0, 8);
const SLUG = `test-spinraw-${run}`;
const ARTIST_A = `SpinRaw ArtistA ${run}`;
const TITLE_A = `SpinRaw TitleA ${run}`;
const ARTIST_B = `SpinRaw ArtistB ${run}`;
const TITLE_B = `SpinRaw TitleB ${run}`;
const MBID_A = `spinraw-mbid-a-${run}`;
const MBID_B = `spinraw-mbid-b-${run}`;
// Test (c) needs its own track pair: the vitest DB is shared within a file,
// so re-firing A/B there would hit the dedup path from test (a)'s writes.
const ARTIST_C = `SpinRaw ArtistC ${run}`;
const TITLE_C = `SpinRaw TitleC ${run}`;
const ARTIST_D = `SpinRaw ArtistD ${run}`;
const TITLE_D = `SpinRaw TitleD ${run}`;
const MBID_C = `spinraw-mbid-c-${run}`;
const MBID_D = `spinraw-mbid-d-${run}`;
// Test (d) terminal-failure path: a pre-existing spin with the same
// (station, externalId) makes persistSpin decline the write.
const ARTIST_E = `SpinRaw ArtistE ${run}`;
const TITLE_E = `SpinRaw TitleE ${run}`;
const MBID_E = `spinraw-mbid-e-${run}`;
const EXT_E = `spinraw-ext-e-${run}`;
// Test (e) post-persist guarantee: a throwing listener simulates post-write
// work blowing up — the persisted track must never be reported as failed.
const ARTIST_F = `SpinRaw ArtistF ${run}`;
const TITLE_F = `SpinRaw TitleF ${run}`;
const MBID_F = `spinraw-mbid-f-${run}`;

let dbAvailable = false;
let stationId: number | undefined;

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
      slug: SLUG,
      name: `Test SpinRaw ${run}`,
      streamUrl: "http://example.invalid/spinraw",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  // Pre-seed the text-resolution cache so resolveToMbid is a pure DB hit.
  await db.insert(resolutionCacheTable).values([
    { key: normalizeKey(ARTIST_A, TITLE_A), mbid: MBID_A, confidence: "text" },
    { key: normalizeKey(ARTIST_B, TITLE_B), mbid: MBID_B, confidence: "text" },
    { key: normalizeKey(ARTIST_C, TITLE_C), mbid: MBID_C, confidence: "text" },
    { key: normalizeKey(ARTIST_D, TITLE_D), mbid: MBID_D, confidence: "text" },
    { key: normalizeKey(ARTIST_E, TITLE_E), mbid: MBID_E, confidence: "text" },
    { key: normalizeKey(ARTIST_F, TITLE_F), mbid: MBID_F, confidence: "text" },
  ]);

  // Pre-seed recordings with links + enrichment markers so upsertRecording
  // never reaches out to Spotify/Odesli/MusicBrainz.
  await db.insert(recordingsTable).values([
    {
      mbid: MBID_A,
      title: TITLE_A,
      artist: ARTIST_A,
      artworkUrl: "http://example.invalid/art.jpg",
      links: [{ name: "Spotify", url: "http://example.invalid/sp", kind: "stream" }],
      genres: ["test"],
      releaseYear: 1977,
      genreEnrichedAt: new Date(),
    },
    {
      mbid: MBID_B,
      title: TITLE_B,
      artist: ARTIST_B,
      artworkUrl: "http://example.invalid/art.jpg",
      links: [{ name: "Spotify", url: "http://example.invalid/sp", kind: "stream" }],
      genres: ["test"],
      releaseYear: 1978,
      genreEnrichedAt: new Date(),
    },
    {
      mbid: MBID_C,
      title: TITLE_C,
      artist: ARTIST_C,
      artworkUrl: "http://example.invalid/art.jpg",
      links: [{ name: "Spotify", url: "http://example.invalid/sp", kind: "stream" }],
      genres: ["test"],
      releaseYear: 1979,
      genreEnrichedAt: new Date(),
    },
    {
      mbid: MBID_D,
      title: TITLE_D,
      artist: ARTIST_D,
      artworkUrl: "http://example.invalid/art.jpg",
      links: [{ name: "Spotify", url: "http://example.invalid/sp", kind: "stream" }],
      genres: ["test"],
      releaseYear: 1980,
      genreEnrichedAt: new Date(),
    },
    {
      mbid: MBID_E,
      title: TITLE_E,
      artist: ARTIST_E,
      artworkUrl: "http://example.invalid/art.jpg",
      links: [{ name: "Spotify", url: "http://example.invalid/sp", kind: "stream" }],
      genres: ["test"],
      releaseYear: 1981,
      genreEnrichedAt: new Date(),
    },
    {
      mbid: MBID_F,
      title: TITLE_F,
      artist: ARTIST_F,
      artworkUrl: "http://example.invalid/art.jpg",
      links: [{ name: "Spotify", url: "http://example.invalid/sp", kind: "stream" }],
      genres: ["test"],
      releaseYear: 1982,
      genreEnrichedAt: new Date(),
    },
  ]);
});

afterAll(async () => {
  if (!dbAvailable) return;
  if (stationId) {
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, [stationId]));
    await db.execute(sql`DELETE FROM station_quality WHERE station_id = ${stationId}`);
    await db.delete(stationsTable).where(inArray(stationsTable.id, [stationId]));
  }
  await db.delete(resolutionCacheTable).where(
    inArray(resolutionCacheTable.key, [
      normalizeKey(ARTIST_A, TITLE_A),
      normalizeKey(ARTIST_B, TITLE_B),
      normalizeKey(ARTIST_C, TITLE_C),
      normalizeKey(ARTIST_D, TITLE_D),
      normalizeKey(ARTIST_E, TITLE_E),
      normalizeKey(ARTIST_F, TITLE_F),
    ]),
  );
  await db.execute(
    sql`DELETE FROM recording_release_groups WHERE recording_mbid IN (${MBID_A}, ${MBID_B}, ${MBID_C}, ${MBID_D}, ${MBID_E}, ${MBID_F})`,
  );
  await db
    .delete(recordingsTable)
    .where(
      inArray(recordingsTable.mbid, [
        MBID_A,
        MBID_B,
        MBID_C,
        MBID_D,
        MBID_E,
        MBID_F,
      ]),
    );
});

type Frame =
  | { kind: "raw"; ev: SpinRawEvent }
  | { kind: "changed"; ev: SpinChangedEvent }
  | { kind: "raw-failed"; ev: SpinRawFailedEvent };

function captureFrames(frames: Frame[]) {
  const onRaw = (ev: SpinRawEvent) => {
    if (ev.stationSlug === SLUG) frames.push({ kind: "raw", ev });
  };
  const onChanged = (ev: SpinChangedEvent) => {
    if (ev.stationSlug === SLUG) frames.push({ kind: "changed", ev });
  };
  const onRawFailed = (ev: SpinRawFailedEvent) => {
    if (ev.stationSlug === SLUG) frames.push({ kind: "raw-failed", ev });
  };
  spinEvents.on("spin-raw", onRaw);
  spinEvents.on("spin-changed", onChanged);
  spinEvents.on("spin-raw-failed", onRawFailed);
  return () => {
    spinEvents.off("spin-raw", onRaw);
    spinEvents.off("spin-changed", onChanged);
    spinEvents.off("spin-raw-failed", onRawFailed);
  };
}

describe("logSpinIfChanged — provisional spin-raw fast path", () => {
  it("(a) emits spin-raw before spin-changed for a new track, and (b) emits neither for an unchanged track", async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    const frames: Frame[] = [];
    const release = captureFrames(frames);
    try {
      const station = { id: stationId!, slug: SLUG } as Parameters<
        typeof logSpinIfChanged
      >[0];
      const wrote = await logSpinIfChanged(station, {
        rawArtist: ARTIST_A,
        rawTitle: TITLE_A,
      });
      expect(wrote).toBe(true);

      // (a) raw first, resolved second — exactly two frames.
      expect(frames.map((f) => f.kind)).toEqual(["raw", "changed"]);
      const raw = frames[0]!.ev as SpinRawEvent;
      expect(raw.stationId).toBe(stationId);
      expect(raw.stationSlug).toBe(SLUG);
      expect(raw.rawArtist).toBe(ARTIST_A);
      expect(raw.rawTitle).toBe(TITLE_A);
      expect(raw.confidence).toBe("unresolved");
      expect(raw.provisional).toBe(true);
      expect(Number.isNaN(Date.parse(raw.observedAt))).toBe(false);
      const changed = frames[1]!.ev as SpinChangedEvent;
      expect(changed.mbid).toBe(MBID_A);
      expect(changed.confidence).toBe("text");
      expect(changed.provisional ?? false).toBe(false);

      // (b) an unchanged repeat of the same track emits nothing new.
      const wroteAgain = await logSpinIfChanged(station, {
        rawArtist: ARTIST_A,
        rawTitle: TITLE_A,
      });
      expect(wroteAgain).toBe(false);
      expect(frames).toHaveLength(2);
    } finally {
      release();
    }
  });

  it("(c) a rapid second change queues behind the in-flight one — strict raw→changed order per track", async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    const frames: Frame[] = [];
    const release = captureFrames(frames);
    try {
      const station = { id: stationId!, slug: SLUG } as Parameters<
        typeof logSpinIfChanged
      >[0];
      // Fire both without awaiting: D arrives while C's pipeline is still
      // running and must queue behind it on the per-station chain.
      const pC = logSpinIfChanged(station, {
        rawArtist: ARTIST_C,
        rawTitle: TITLE_C,
      });
      const pD = logSpinIfChanged(station, {
        rawArtist: ARTIST_D,
        rawTitle: TITLE_D,
      });
      const [wroteC, wroteD] = await Promise.all([pC, pD]);
      expect(wroteC).toBe(true);
      expect(wroteD).toBe(true);

      expect(frames.map((f) => f.kind)).toEqual([
        "raw",
        "changed",
        "raw",
        "changed",
      ]);
      expect((frames[0]!.ev as SpinRawEvent).rawTitle).toBe(TITLE_C);
      expect((frames[1]!.ev as SpinChangedEvent).mbid).toBe(MBID_C);
      expect((frames[2]!.ev as SpinRawEvent).rawTitle).toBe(TITLE_D);
      expect((frames[3]!.ev as SpinChangedEvent).mbid).toBe(MBID_D);

      // Exactly one persisted spin per track — the serialised dedup read
      // means D saw C committed and neither double-writes. (Scoped to C/D:
      // test (a) already persisted A for this shared-file station.)
      const rows = await db
        .select({ id: spinsTable.id })
        .from(spinsTable)
        .where(inArray(spinsTable.mbid, [MBID_C, MBID_D]));
      expect(rows).toHaveLength(2);
    } finally {
      release();
    }
  });

  it("(d) emits a terminal spin-raw-failed (and no spin-changed) when the write is declined", async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    // Pre-plant a spin with a stable externalId: persistSpin's
    // onConflictDoNothing on (station, externalId) will decline the new write,
    // so the provisional event has no resolved successor to pair with.
    await db.insert(spinsTable).values({
      stationId: stationId!,
      rawArtist: `SpinRaw Preexisting ${run}`,
      rawTitle: `SpinRaw Preexisting ${run}`,
      source: "test",
      externalId: EXT_E,
      confidence: "text",
    });

    const frames: Frame[] = [];
    const release = captureFrames(frames);
    try {
      const station = { id: stationId!, slug: SLUG } as Parameters<
        typeof logSpinIfChanged
      >[0];
      const wrote = await logSpinIfChanged(station, {
        rawArtist: ARTIST_E,
        rawTitle: TITLE_E,
        externalId: EXT_E,
      });
      expect(wrote).toBe(false);

      // Raw first, then the terminal failure — and NO spin-changed.
      expect(frames.map((f) => f.kind)).toEqual(["raw", "raw-failed"]);
      const failed = frames[1]!.ev as SpinRawFailedEvent;
      expect(failed.rawArtist).toBe(ARTIST_E);
      expect(failed.rawTitle).toBe(TITLE_E);
      expect(failed.reason).toBe("persist-declined");
      expect(failed.provisional).toBe(true);

      // The declined write really left no new spin row.
      const rows = await db
        .select({ id: spinsTable.id })
        .from(spinsTable)
        .where(inArray(spinsTable.mbid, [MBID_E]));
      expect(rows).toHaveLength(0);
    } finally {
      release();
    }
  });

  it("(e) a post-persist failure never reports the persisted track as spin-raw-failed", async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    // Simulate post-persist work blowing up: a spin-changed listener that
    // throws. Registered BEFORE captureFrames, so the throw also aborts
    // captureFrames' own listener — proving the exception propagates out of
    // emit() into the ingest path, the exact shape of a failing SSE client.
    const throwingListener = (ev: SpinChangedEvent) => {
      if (ev.stationSlug === SLUG) throw new Error("simulated listener failure");
    };
    spinEvents.on("spin-changed", throwingListener);
    const frames: Frame[] = [];
    const release = captureFrames(frames);
    try {
      const station = { id: stationId!, slug: SLUG } as Parameters<
        typeof logSpinIfChanged
      >[0];
      const wrote = await logSpinIfChanged(station, {
        rawArtist: ARTIST_F,
        rawTitle: TITLE_F,
      });
      // The exception propagated past the successful write.
      expect(wrote).toBe(false);

      // Raw fired; spin-changed delivery blew up — but crucially NO
      // spin-raw-failed: the track IS persisted, and reverting it client-side
      // would contradict the spine.
      expect(frames.map((f) => f.kind)).toEqual(["raw"]);
      const rows = await db
        .select({ id: spinsTable.id })
        .from(spinsTable)
        .where(inArray(spinsTable.mbid, [MBID_F]));
      expect(rows).toHaveLength(1);
    } finally {
      spinEvents.off("spin-changed", throwingListener);
      release();
    }
  });
});
