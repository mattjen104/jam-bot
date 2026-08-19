/**
 * DB-backed tests for the source-coverage ledger and the probe persistence /
 * verified-repair path.
 *
 *   - ledger excludes longtail + test/placeholder rows and classifies the
 *     real roster stations we insert
 *   - persistProbeResult upserts one row per station and the ledger reflects
 *     the latest probe outcome
 *   - applyVerifiedRepair writes the verified config (direct stream, health
 *     row, radioBrowserId) and enrolls the live poller via the injected seam
 *   - repair preserves operator overrides (sourceLocked) and hidden stations
 *
 * Self-skips when no real Postgres is reachable (CI without PG sidecar).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  spinsTable,
  radioBrowserStationsTable,
  stationSourceProbesTable,
  type Station,
} from "@workspace/db";
import { getSourceCoverageLedger } from "../src/lore/source-coverage.js";
import {
  persistProbeResult,
  applyVerifiedRepair,
  type ProbeResult,
} from "../src/lore/source-probe.js";

const run = randomUUID().slice(0, 8);
// Unique, deliberately NON-test-like slugs/hosts (the ledger must include
// these) plus deliberately test-like rows (the ledger must exclude them).
const SLUGS = {
  healthy: `scov-${run}-healthy`,
  noSourceStream: `scov-${run}-nosrc`,
  noSourceBare: `scov-${run}-bare`,
  locked: `scov-${run}-locked`,
  hidden: `scov-${run}-hidden`,
  longtail: `scov-${run}-longtail`,
  testLike: `test-scov-${run}`,
} as const;

const stream = (key: string) => `https://scov-${run}.example.com/${key}`;

let dbAvailable = false;
const stationIds: number[] = [];

async function insertStation(
  slug: string,
  fields: Partial<typeof stationsTable.$inferInsert> = {},
): Promise<Station> {
  const [row] = await db
    .insert(stationsTable)
    .values({
      slug,
      name: `SCOV ${slug}`,
      streamUrl: stream(slug),
      streamFormat: "mp3",
      ...fields,
    })
    .returning();
  stationIds.push(row!.id);
  return row!;
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    // The probe ledger table is created by a boot migration, which does not
    // run under vitest — create it here (idempotent).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS station_source_probes (
        station_id integer PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
        probe_kind text NOT NULL,
        outcome text NOT NULL,
        detail text,
        resolved_url text,
        sample_artist text,
        sample_title text,
        probed_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
    return;
  }

  // Healthy: source configured + a recent usable spin.
  const healthy = await insertStation(SLUGS.healthy, {
    nowPlayingSource: "radio_browser_icy",
    nowPlayingConfig: { streamUrl: stream("healthy") },
  });
  await db.insert(spinsTable).values({
    stationId: healthy.id,
    rawArtist: `SCOV Artist ${run}`,
    rawTitle: `SCOV Title ${run}`,
    source: "radio_browser_icy",
    observedAt: new Date(),
  });

  // Recoverable: no source, has a stream.
  await insertStation(SLUGS.noSourceStream);
  // No source, no stream at all.
  await insertStation(SLUGS.noSourceBare, { streamUrl: "" });
  // Operator-locked override.
  await insertStation(SLUGS.locked, {
    nowPlayingConfig: { sourceLocked: true },
  });
  // Hidden station (documented manual-restore path).
  await insertStation(SLUGS.hidden, { hidden: true });
  // Longtail discovery — excluded from the ledger.
  await insertStation(SLUGS.longtail, { tier: "longtail" });
  // Test-like placeholder — excluded from the ledger.
  await insertStation(SLUGS.testLike, { streamUrl: "http://example.invalid/x" });
});

afterAll(async () => {
  if (!dbAvailable) return;
  // RB rows have no ON DELETE CASCADE on station_id — remove them first.
  await db
    .delete(radioBrowserStationsTable)
    .where(inArray(radioBrowserStationsTable.stationId, stationIds));
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  // station_source_probes cascades with the station delete.
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
});

describe("getSourceCoverageLedger", () => {
  it("excludes longtail and test-like rows, includes the real roster", async () => {
    if (!dbAvailable) return;
    const ledger = await getSourceCoverageLedger();
    const bySlug = new Map(ledger.stations.map((s) => [s.slug, s]));

    expect(bySlug.has(SLUGS.longtail)).toBe(false);
    expect(bySlug.has(SLUGS.testLike)).toBe(false);
    expect(bySlug.has(SLUGS.healthy)).toBe(true);
    expect(bySlug.has(SLUGS.noSourceStream)).toBe(true);
    expect(bySlug.has(SLUGS.noSourceBare)).toBe(true);
  });

  it("classifies a station with a fresh usable spin as healthy", async () => {
    if (!dbAvailable) return;
    const ledger = await getSourceCoverageLedger();
    const entry = ledger.stations.find((s) => s.slug === SLUGS.healthy)!;
    expect(entry.class).toBe("healthy");
    expect(entry.lastUsableAt).not.toBeNull();
    expect(entry.lastArtist).toBe(`SCOV Artist ${run}`);
    expect(entry.lastTitle).toBe(`SCOV Title ${run}`);
  });

  it("classifies no-source stations from their configuration shape", async () => {
    if (!dbAvailable) return;
    const ledger = await getSourceCoverageLedger();
    const withStream = ledger.stations.find(
      (s) => s.slug === SLUGS.noSourceStream,
    )!;
    const bare = ledger.stations.find((s) => s.slug === SLUGS.noSourceBare)!;
    expect(withStream.class).toBe("recoverable");
    expect(bare.class).toBe("no_source");
    expect(bare.fingerprintCandidate).toBe(false);
  });
});

describe("persistProbeResult", () => {
  it("upserts one row per station and the ledger reflects the outcome", async () => {
    if (!dbAvailable) return;
    const station = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, SLUGS.noSourceStream))
      .limit(1);
    const id = station[0]!.id;

    const blank: ProbeResult = {
      kind: "icy",
      outcome: "blank_metadata",
      detail: "StreamTitle empty",
    };
    await persistProbeResult(id, blank);
    // Second probe overwrites the first — one row, latest outcome.
    const unreachable: ProbeResult = {
      kind: "icy",
      outcome: "unreachable",
      detail: "connect timeout",
    };
    await persistProbeResult(id, unreachable);

    const rows = await db
      .select()
      .from(stationSourceProbesTable)
      .where(eq(stationSourceProbesTable.stationId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("unreachable");

    const ledger = await getSourceCoverageLedger();
    const entry = ledger.stations.find((s) => s.slug === SLUGS.noSourceStream)!;
    expect(entry.class).toBe("unavailable");
    expect(entry.probe?.outcome).toBe("unreachable");
    expect(entry.probe?.detail).toBe("connect timeout");
  });

  it("a blank-metadata probe marks the station a fingerprint candidate", async () => {
    if (!dbAvailable) return;
    const station = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, SLUGS.noSourceStream))
      .limit(1);
    await persistProbeResult(station[0]!.id, {
      kind: "icy",
      outcome: "blank_metadata",
      detail: "StreamTitle empty",
    });
    const ledger = await getSourceCoverageLedger();
    const entry = ledger.stations.find((s) => s.slug === SLUGS.noSourceStream)!;
    expect(entry.class).toBe("no_source");
    expect(entry.fingerprintCandidate).toBe(true);
    expect(ledger.fingerprintCandidateCount).toBeGreaterThanOrEqual(1);
  });
});

describe("applyVerifiedRepair", () => {
  it("repairs a verified ICY station: direct stream, source, health row, live enroll", async () => {
    if (!dbAvailable) return;
    const station = (
      await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.slug, SLUGS.noSourceStream))
        .limit(1)
    )[0]!;
    const directUrl = `http://direct-${run}.example.com:8000/stream`;
    const enrolled: number[] = [];

    const outcome = await applyVerifiedRepair(
      station,
      {
        kind: "icy",
        outcome: "usable_pair",
        resolvedUrl: directUrl,
        sampleArtist: "Probe Artist",
        sampleTitle: "Probe Title",
      },
      { enroll: (s) => enrolled.push(s.id) },
    );
    expect(outcome).toBe("repaired");
    expect(enrolled).toEqual([station.id]);

    const [updated] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, station.id))
      .limit(1);
    expect(updated!.nowPlayingSource).toBe("radio_browser_icy");
    expect(updated!.streamUrl).toBe(directUrl);
    const cfg = updated!.nowPlayingConfig as Record<string, unknown>;
    expect(cfg.streamUrl).toBe(directUrl);
    expect(cfg.repairedBy).toBe("source-coverage-probe");
    expect(cfg.previousStreamUrl).toBe(stream(SLUGS.noSourceStream));
    expect(typeof cfg.radioBrowserId).toBe("number");

    const rbRows = await db
      .select()
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.stationId, station.id));
    expect(rbRows).toHaveLength(1);
    expect(rbRows[0]!.streamUrl).toBe(directUrl);
    expect(rbRows[0]!.icyStatus).toBe("active");
  });

  it("preserves an operator-locked configuration", async () => {
    if (!dbAvailable) return;
    const station = (
      await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.slug, SLUGS.locked))
        .limit(1)
    )[0]!;
    const outcome = await applyVerifiedRepair(
      station,
      { kind: "icy", outcome: "usable_pair" },
      { enroll: () => {} },
    );
    expect(outcome).toBe("skipped-override");
    const [after] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, station.id))
      .limit(1);
    expect(after!.nowPlayingSource).toBeNull();
  });

  it("never repairs a hidden station (manual restore procedure governs it)", async () => {
    if (!dbAvailable) return;
    const station = (
      await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.slug, SLUGS.hidden))
        .limit(1)
    )[0]!;
    const outcome = await applyVerifiedRepair(
      station,
      { kind: "icy", outcome: "usable_pair" },
      { enroll: () => {} },
    );
    expect(outcome).toBe("skipped-hidden");
    const [after] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, station.id))
      .limit(1);
    expect(after!.nowPlayingSource).toBeNull();
  });

  it("ignores non-usable probe outcomes", async () => {
    if (!dbAvailable) return;
    const station = (
      await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.slug, SLUGS.noSourceBare))
        .limit(1)
    )[0]!;
    const outcome = await applyVerifiedRepair(
      station,
      { kind: "icy", outcome: "blank_metadata" },
      { enroll: () => {} },
    );
    expect(outcome).toBe("skipped-healthy-source");
  });
});
