import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const VERIFIED_STATION_SOURCE_PROBES = [
  {
    slug: "dublab",
    probeKind: "icy",
    outcome: "blank_metadata",
    detail:
      "GET + Icy-MetaData:1 reached the direct TLS Icecast mount; StreamTitle was a blank delimiter during this probe.",
    resolvedUrl: null,
    sampleArtist: null,
    sampleTitle: null,
    probedAt: new Date("2026-08-19T21:36:00.538Z"),
  },
  {
    slug: "rinse-fm",
    probeKind: "icy",
    outcome: "blank_metadata",
    detail:
      "GET + Icy-MetaData:1 reached the official Rinse UK mount; StreamTitle was the placeholder 'Now Playing info goes here', not a usable artist/title pair.",
    resolvedUrl: null,
    sampleArtist: null,
    sampleTitle: null,
    probedAt: new Date("2026-08-19T21:36:00.538Z"),
  },
  {
    slug: "nts-1",
    probeKind: "icy",
    outcome: "blank_metadata",
    detail:
      "GET + Icy-MetaData:1 reached the official NTS 1 stream through its redirect chain; the ICY metadata block had an empty StreamTitle. The NTS live API supplies programme context only, not a live artist/title pair.",
    resolvedUrl: null,
    sampleArtist: null,
    sampleTitle: null,
    probedAt: new Date("2026-09-02T16:20:00.000Z"),
  },
  {
    slug: "nts-2",
    probeKind: "icy",
    outcome: "blank_metadata",
    detail:
      "GET + Icy-MetaData:1 reached the official NTS 2 stream through its redirect chain; the ICY metadata block had an empty StreamTitle. The NTS live API supplies programme context only, not a live artist/title pair.",
    resolvedUrl: null,
    sampleArtist: null,
    sampleTitle: null,
    probedAt: new Date("2026-09-02T16:20:00.000Z"),
  },
  {
    slug: "wrek",
    probeKind: "icy",
    outcome: "blank_metadata",
    detail:
      "GET + Icy-MetaData:1 reached WREK's official 128 kbps stream; the sampled ICY metadata block had an empty StreamTitle, so no artist/title pair was inferred.",
    resolvedUrl: null,
    sampleArtist: null,
    sampleTitle: null,
    probedAt: new Date("2026-09-02T16:20:00.000Z"),
  },
  {
    slug: "wmbr",
    probeKind: "icy",
    outcome: "blank_metadata",
    detail:
      "GET + Icy-MetaData:1 reached WMBR's official high-quality stream; StreamTitle contained only the programme name 'Lost and Found', not an artist/title pair.",
    resolvedUrl: null,
    sampleArtist: null,
    sampleTitle: null,
    probedAt: new Date("2026-09-02T16:20:00.000Z"),
  },
  {
    slug: "ckut",
    probeKind: "icy",
    outcome: "blank_metadata",
    detail:
      "GET + Icy-MetaData:1 reached CKUT's direct live broadcast mount; the sampled ICY metadata block had an empty StreamTitle. Backup mounts were rejected because they publish only the 'CKUT (BACKUP ONLY!)' automation label.",
    resolvedUrl: null,
    sampleArtist: null,
    sampleTitle: null,
    probedAt: new Date("2026-09-02T16:20:00.000Z"),
  },
  {
    slug: "balamii",
    probeKind: "icy",
    outcome: "unreachable",
    detail:
      "The former public audio host and the official site's matching Airtime live-info host both failed DNS resolution; no replacement direct stream is published.",
    resolvedUrl: null,
    sampleArtist: null,
    sampleTitle: null,
    probedAt: new Date("2026-08-19T21:36:00.538Z"),
  },
  {
    slug: "wbgo",
    probeKind: "icy",
    outcome: "usable_pair",
    detail:
      "GET + Icy-MetaData:1 reached the replacement MP3 stream published on WBGO's official listening page.",
    resolvedUrl: "https://ais-sa8.cdnstream1.com/3629_128.mp3",
    sampleArtist: "Lakecia Benjamin",
    sampleTitle: "My Only",
    probedAt: new Date("2026-08-19T21:36:00.538Z"),
  },
] as const;

/**
 * Boot migration: create the station_source_probes table.
 *
 * Persists the most recent free public-metadata probe outcome per station
 * (the source-coverage ledger) so probe evidence survives restarts and the
 * admin coverage surface can distinguish "never probed" from "probed, no
 * public track source". The table is also declared in
 * lib/db/src/schema/lore.ts (stationSourceProbesTable) so drizzle-kit push
 * does not try to drop it.
 *
 * Idempotent — CREATE TABLE IF NOT EXISTS.
 */
export async function applyStationSourceProbeMigration(): Promise<void> {
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

  // Seed the verified 2026-08-19 source audit into fresh databases. A later
  // operator probe is authoritative, so conflicts are intentionally ignored
  // rather than overwriting newer live evidence on every API restart.
  for (const probe of VERIFIED_STATION_SOURCE_PROBES) {
    await db.execute(sql`
      INSERT INTO station_source_probes (
        station_id,
        probe_kind,
        outcome,
        detail,
        resolved_url,
        sample_artist,
        sample_title,
        probed_at,
        updated_at
      )
      SELECT
        id,
        ${probe.probeKind},
        ${probe.outcome},
        ${probe.detail},
        ${probe.resolvedUrl},
        ${probe.sampleArtist},
        ${probe.sampleTitle},
        ${probe.probedAt},
        now()
      FROM stations
      WHERE slug = ${probe.slug}
      ON CONFLICT (station_id) DO NOTHING
    `);
  }
}
