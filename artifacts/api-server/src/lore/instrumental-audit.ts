import {
  db,
  instrumentalStationAuditsTable,
  recordingsTable,
  spinsTable,
  stationsTable,
  type Station,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  getLyricsEvidence,
  shouldRetryLyricsEvidence,
  type LyricsEvidenceStatus,
} from "./lrclib.js";

export type InstrumentalClassification =
  | "confirmed_instrumental"
  | "mostly_instrumental"
  | "unknown_insufficient";

export interface InstrumentalAuditTrack {
  mbid: string;
  artist: string;
  title: string;
  playedAt: string;
  genres: string[];
  lyricStatus: LyricsEvidenceStatus;
  lyricCheckedAt?: string | null;
}

export interface InstrumentalClassificationInput {
  officialFormatClaim: boolean;
  officialEvidenceSource: string | null;
  directoryHints: string[];
  tracks: InstrumentalAuditTrack[];
}

export interface InstrumentalStationReport {
  stationId: number;
  slug: string;
  name: string;
  classification: InstrumentalClassification;
  auditedAt: string;
  sampleSize: number;
  checkedCount: number;
  instrumentalCount: number;
  lyricHitCount: number;
  evidenceSources: string[];
  officialFormatClaim: boolean;
  recentGenres: Array<{ genre: string; count: number }>;
  visibility: {
    active: boolean;
    hidden: boolean;
    sleepMode: boolean;
    eraGenreMode: boolean;
    crossingEligible: boolean;
  };
  contradictoryVocalTracks: Array<{
    mbid: string;
    artist: string;
    title: string;
    playedAt: string;
  }>;
  tracks: InstrumentalAuditTrack[];
  coverage: {
    noResultCount: number;
    transientFailureCount: number;
    notCheckedCount: number;
  };
}

export interface InstrumentalAuditRun {
  auditedAt: string;
  candidateCount: number;
  confirmedCount: number;
  mostlyCount: number;
  unknownCount: number;
  lyricLookups: number;
  stations: InstrumentalStationReport[];
}

const SAMPLE_TRACKS_PER_STATION = 24;
const MAX_CANDIDATES_PER_RUN = 100;
export const MAX_LYRICS_LOOKUPS_PER_RUN = 150;
const LRCLIB_GAP_MS = 250;

/**
 * Directory hints are candidate signals only. In particular, `drone` is not
 * treated as proof: a vocal contradiction or missing evidence keeps the
 * station out of the confirmed group.
 */
export function instrumentalDirectoryHints(
  name: string | null | undefined,
  tags: string[] | null | undefined,
): string[] {
  const values = [...(tags ?? []), name ?? ""].map((value) =>
    value.trim().toLocaleLowerCase(),
  );
  return [...new Set(
    values.filter(
      (value) =>
        value === "instrumental" ||
        value === "drone" ||
        value.includes("instrumental") ||
        value.includes("drone"),
    ),
  )];
}

export function officialInstrumentalClaim(
  config: Record<string, unknown> | null | undefined,
): { source: string; note?: string } | null {
  if (!config || config.instrumentalClaim !== true) return null;
  const source =
    typeof config.evidenceUrl === "string" && config.evidenceUrl.trim()
      ? config.evidenceUrl.trim()
      : typeof config.evidenceSource === "string" && config.evidenceSource.trim()
        ? config.evidenceSource.trim()
        : "";
  if (!source) return null;
  return {
    source,
    note: typeof config.evidenceNote === "string" ? config.evidenceNote : undefined,
  };
}

/**
 * Conservative classification:
 * - confirmed requires a documented official instrumental claim, at least
 *   three checked instrumental tracks, every sampled track checked, and no
 *   lyric hit;
 * - mostly requires complete checked coverage, at least three corroborating
 *   instrumental tracks covering 75% of the sample, and no lyric hit, but does
 *   not require an official claim;
 * - any sampled lyric hit prevents a station with weak evidence from being
 *   called instrumental. No-result is never counted as instrumental evidence.
 */
export function classifyInstrumentalStation(
  input: InstrumentalClassificationInput,
): InstrumentalClassification {
  const instrumental = input.tracks.filter(
    (track) => track.lyricStatus === "instrumental",
  ).length;
  const lyricHits = input.tracks.filter(
    (track) => track.lyricStatus === "lyrics_found",
  ).length;
  const checked = input.tracks.filter((track) =>
    ["instrumental", "lyrics_found", "no_result"].includes(track.lyricStatus),
  ).length;
  const complete = input.tracks.length > 0 && checked === input.tracks.length;
  const corroborated = instrumental >= 3;
  const instrumentalShare = input.tracks.length > 0
    ? instrumental / input.tracks.length
    : 0;

  if (
    input.officialFormatClaim &&
    corroborated &&
    complete &&
    lyricHits === 0
  ) {
    return "confirmed_instrumental";
  }
  if (
    corroborated &&
    complete &&
    instrumentalShare >= 0.75 &&
    lyricHits === 0
  ) {
    return "mostly_instrumental";
  }
  return "unknown_insufficient";
}

function recentGenres(
  tracks: InstrumentalAuditTrack[],
): Array<{ genre: string; count: number }> {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    for (const genre of new Set(track.genres.map((value) => value.trim()).filter(Boolean))) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, 8);
}

function toConfig(
  config: unknown,
): Record<string, unknown> | null {
  return config && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : null;
}

function stationReport(
  station: Station,
  tracks: InstrumentalAuditTrack[],
  auditedAt: string,
): InstrumentalStationReport {
  const config = toConfig(station.nowPlayingConfig);
  const official = officialInstrumentalClaim(config);
  const hints = instrumentalDirectoryHints(station.name, station.tags);
  const classification = classifyInstrumentalStation({
    officialFormatClaim: official != null,
    officialEvidenceSource: official?.source ?? null,
    directoryHints: hints,
    tracks,
  });
  const lyricHits = tracks.filter((track) => track.lyricStatus === "lyrics_found");
  return {
    stationId: station.id,
    slug: station.slug,
    name: station.name,
    classification,
    auditedAt,
    sampleSize: tracks.length,
    checkedCount: tracks.filter((track) =>
      ["instrumental", "lyrics_found", "no_result"].includes(track.lyricStatus),
    ).length,
    instrumentalCount: tracks.filter((track) => track.lyricStatus === "instrumental").length,
    lyricHitCount: lyricHits.length,
    evidenceSources: [
      ...(official ? [official.source] : []),
      ...(hints.length > 0 ? ["radio_browser/name hint (candidate only)"] : []),
      ...(tracks.length > 0 ? ["LRCLIB track outcomes"] : []),
    ],
    officialFormatClaim: official != null,
    recentGenres: recentGenres(tracks),
    visibility: {
      active: station.active,
      hidden: station.hidden,
      sleepMode: station.sleepMode,
      eraGenreMode: station.eraGenreMode,
      crossingEligible: station.crossingEligible,
    },
    contradictoryVocalTracks: lyricHits.map((track) => ({
      mbid: track.mbid,
      artist: track.artist,
      title: track.title,
      playedAt: track.playedAt,
    })),
    tracks,
    coverage: {
      noResultCount: tracks.filter((track) => track.lyricStatus === "no_result").length,
      transientFailureCount: tracks.filter((track) => track.lyricStatus === "transient_failure").length,
      notCheckedCount: tracks.filter((track) => track.lyricStatus === "not_checked").length,
    },
  };
}

async function candidateStations(): Promise<Station[]> {
  const rows = await db
    .select()
    .from(stationsTable)
    .where(sql`
      COALESCE(${stationsTable.tags}, '[]'::jsonb) @>
        '["instrumental"]'::jsonb
      OR COALESCE(${stationsTable.tags}, '[]'::jsonb) @>
        '["drone"]'::jsonb
      OR lower(${stationsTable.name}) LIKE '%instrumental%'
      OR lower(${stationsTable.name}) LIKE '%drone%'
    `)
    .orderBy(stationsTable.id)
    .limit(MAX_CANDIDATES_PER_RUN);
  return rows;
}

async function sampledTracks(
  stationIds: number[],
): Promise<Map<number, InstrumentalAuditTrack[]>> {
  const byStation = new Map<number, InstrumentalAuditTrack[]>();
  if (stationIds.length === 0) return byStation;
  const ids = sql.join(
    stationIds.map((id) => sql.raw(String(id))),
    sql.raw(", "),
  );
  const result = await db.execute<{
    station_id: number;
    mbid: string;
    artist: string;
    title: string;
    played_at: string | Date;
    genres: string[] | null;
    lyric_status: string | null;
    lyric_checked_at: string | Date | null;
  }>(sql`
    WITH unique_tracks AS (
      SELECT DISTINCT ON (sp.station_id, sp.mbid)
        sp.station_id, sp.mbid, sp.played_at,
        r.artist, r.title, r.genres,
        r.lyric_status, r.lyric_checked_at
      FROM ${spinsTable} sp
      JOIN ${recordingsTable} r ON r.mbid = sp.mbid
      WHERE sp.station_id IN (${ids})
        AND sp.mbid IS NOT NULL
        AND sp.played_at >= now() - interval '180 days'
      ORDER BY sp.station_id, sp.mbid, sp.played_at DESC, sp.id DESC
    ),
    ranked AS (
      SELECT *, row_number() OVER (
        PARTITION BY station_id ORDER BY played_at DESC, mbid
      ) AS sample_rank
      FROM unique_tracks
    )
    SELECT station_id, mbid, artist, title, played_at, genres, lyric_status,
           lyric_checked_at
    FROM ranked
    WHERE sample_rank <= ${SAMPLE_TRACKS_PER_STATION}
    ORDER BY station_id, played_at DESC, mbid
  `);
  for (const row of result.rows) {
    const tracks = byStation.get(row.station_id) ?? [];
    tracks.push({
      mbid: row.mbid,
      artist: row.artist,
      title: row.title,
      playedAt: new Date(row.played_at).toISOString(),
      genres: row.genres ?? [],
      lyricStatus: (row.lyric_status ?? "not_checked") as LyricsEvidenceStatus,
      lyricCheckedAt: row.lyric_checked_at
        ? new Date(row.lyric_checked_at).toISOString()
        : null,
    });
    byStation.set(row.station_id, tracks);
  }
  return byStation;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run one bounded audit. Only candidate stations (instrumental/drone tags or
 * names) are sampled, only recent unique resolved tracks are considered, and
 * LRCLIB receives at most MAX_LYRICS_LOOKUPS_PER_RUN sequential requests.
 */
export async function auditInstrumentalStations(): Promise<InstrumentalAuditRun> {
  const auditedAt = new Date().toISOString();
  const stations = await candidateStations();
  const tracksByStation = await sampledTracks(stations.map((station) => station.id));
  let lyricLookups = 0;
  const reports: InstrumentalStationReport[] = [];

  for (const station of stations) {
    const tracks = tracksByStation.get(station.id) ?? [];
    for (const track of tracks) {
      if (
        shouldRetryLyricsEvidence(
          track.lyricStatus,
          track.lyricCheckedAt ? new Date(track.lyricCheckedAt) : null,
        ) &&
        lyricLookups < MAX_LYRICS_LOOKUPS_PER_RUN
      ) {
        const evidence = await getLyricsEvidence(track.mbid);
        track.lyricStatus = evidence.status;
        track.lyricCheckedAt = new Date().toISOString();
        lyricLookups++;
        await sleep(LRCLIB_GAP_MS);
      }
    }
    const report = stationReport(station, tracks, auditedAt);
    reports.push(report);
  }

  // Publish only a completed, coherent snapshot. If collection or LRCLIB work
  // throws, this transaction is never reached and the previous report remains
  // intact. Rows for stations no longer in the candidate set disappear.
  await db.transaction(async (tx) => {
    await tx.delete(instrumentalStationAuditsTable);
    if (reports.length === 0) return;
    await tx.insert(instrumentalStationAuditsTable).values(
      reports.map((report) => ({
        stationId: report.stationId,
        classification: report.classification,
        auditedAt: new Date(auditedAt),
        sampleSize: report.sampleSize,
        checkedCount: report.checkedCount,
        instrumentalCount: report.instrumentalCount,
        lyricHitCount: report.lyricHitCount,
        report: report as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })),
    );
  });

  return {
    auditedAt,
    candidateCount: reports.length,
    confirmedCount: reports.filter((report) => report.classification === "confirmed_instrumental").length,
    mostlyCount: reports.filter((report) => report.classification === "mostly_instrumental").length,
    unknownCount: reports.filter((report) => report.classification === "unknown_insufficient").length,
    lyricLookups,
    stations: reports,
  };
}

let auditRunning = false;
let auditStartedAt: string | null = null;
let auditFinishedAt: string | null = null;
let auditLastResult: InstrumentalAuditRun | null = null;

export function getInstrumentalAuditStatus() {
  return {
    running: auditRunning,
    startedAt: auditStartedAt,
    finishedAt: auditFinishedAt,
    lastResult: auditLastResult,
  };
}

export function startInstrumentalAudit(): boolean {
  if (auditRunning) return false;
  auditRunning = true;
  auditStartedAt = new Date().toISOString();
  auditFinishedAt = null;
  void auditInstrumentalStations()
    .then((result) => {
      auditLastResult = result;
    })
    .catch((error) => {
      console.error("[lore] instrumental station audit failed", error);
    })
    .finally(() => {
      auditRunning = false;
      auditFinishedAt = new Date().toISOString();
    });
  return true;
}

export async function getInstrumentalAuditReport(): Promise<{
  auditedAt: string | null;
  counts: {
    confirmedInstrumental: number;
    mostlyInstrumental: number;
    unknownInsufficient: number;
  };
  stations: InstrumentalStationReport[];
}> {
  const rows = await db.execute<{
    audited_at: string | Date;
    report: InstrumentalStationReport;
  }>(sql`
    SELECT audited_at, report
    FROM instrumental_station_audits
    ORDER BY (report->>'classification') ASC, report->>'name' ASC
  `);
  const stations = rows.rows.map((row) => row.report);
  const auditedAt = rows.rows.length > 0
    ? new Date(rows.rows[0]!.audited_at).toISOString()
    : null;
  return {
    auditedAt,
    counts: {
      confirmedInstrumental: stations.filter((row) => row.classification === "confirmed_instrumental").length,
      mostlyInstrumental: stations.filter((row) => row.classification === "mostly_instrumental").length,
      unknownInsufficient: stations.filter((row) => row.classification === "unknown_insufficient").length,
    },
    stations,
  };
}