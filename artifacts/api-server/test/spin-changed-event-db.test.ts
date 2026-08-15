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
} from "../src/lore/resolve.js";

/**
 * Integration test for the SSE push channel's source event: a spin logged by
 * logSpinIfChanged must emit exactly ONE well-formed `spin-changed` event
 * carrying the resolved MBID, the resolution confidence tier, and an ISO
 * observedAt timestamp (the fields the browser's now-playing push layer
 * consumes without a follow-up request).
 *
 * The resolution cache and the recording row are pre-seeded so the whole path
 * is DB-only — no MusicBrainz/Spotify/Odesli network calls fire. Skips
 * gracefully when no DB is reachable.
 */
const run = randomUUID().slice(0, 8);
const SLUG = `test-spinev-${run}`;
const MBID = `spinev-mbid-${run}`;
const ARTIST = `SpinEv Artist ${run}`;
const TITLE = `SpinEv Title ${run}`;

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
      name: `Test SpinEvent ${run}`,
      streamUrl: "http://example.invalid/spinev",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  // Pre-seed the text-resolution cache so resolveToMbid is a pure DB hit.
  await db.insert(resolutionCacheTable).values({
    key: normalizeKey(ARTIST, TITLE),
    mbid: MBID,
    confidence: "text",
  });

  // Pre-seed the recording with links + enrichment markers so upsertRecording
  // never reaches out to Spotify/Odesli/MusicBrainz.
  await db.insert(recordingsTable).values({
    mbid: MBID,
    title: TITLE,
    artist: ARTIST,
    artworkUrl: "http://example.invalid/art.jpg",
    links: [{ name: "Spotify", url: "http://example.invalid/sp", kind: "stream" }],
    genres: ["test"],
    releaseYear: 1977,
    genreEnrichedAt: new Date(),
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  if (stationId) {
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, [stationId]));
    await db.execute(sql`DELETE FROM station_quality WHERE station_id = ${stationId}`);
    await db.delete(stationsTable).where(inArray(stationsTable.id, [stationId]));
  }
  await db.delete(resolutionCacheTable).where(
    inArray(resolutionCacheTable.key, [normalizeKey(ARTIST, TITLE)]),
  );
  await db.execute(sql`DELETE FROM recording_release_groups WHERE recording_mbid = ${MBID}`);
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
});

describe("logSpinIfChanged — spin-changed push event", () => {
  it("emits exactly one well-formed event when a new spin is persisted", async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    const events: SpinChangedEvent[] = [];
    const capture = (ev: SpinChangedEvent) => {
      if (ev.stationSlug === SLUG) events.push(ev);
    };
    spinEvents.on("spin-changed", capture);

    try {
      const station = { id: stationId!, slug: SLUG } as Parameters<
        typeof logSpinIfChanged
      >[0];
      const before = Date.now();
      const wrote = await logSpinIfChanged(station, {
        rawArtist: ARTIST,
        rawTitle: TITLE,
      });

      expect(wrote).toBe(true);
      expect(events).toHaveLength(1);
      const ev = events[0]!;
      expect(ev.stationId).toBe(stationId);
      expect(ev.stationSlug).toBe(SLUG);
      expect(ev.rawArtist).toBe(ARTIST);
      expect(ev.rawTitle).toBe(TITLE);
      expect(ev.mbid).toBe(MBID);
      expect(ev.confidence).toBe("text");
      // observedAt is a parseable ISO timestamp from around the write moment.
      const observed = Date.parse(ev.observedAt);
      expect(Number.isNaN(observed)).toBe(false);
      expect(observed).toBeGreaterThanOrEqual(before - 1_000);
      expect(observed).toBeLessThanOrEqual(Date.now() + 1_000);

      // A repeat of the same track is deduped — no second event.
      const wroteAgain = await logSpinIfChanged(station, {
        rawArtist: ARTIST,
        rawTitle: TITLE,
      });
      expect(wroteAgain).toBe(false);
      expect(events).toHaveLength(1);
    } finally {
      spinEvents.off("spin-changed", capture);
    }
  });
});
