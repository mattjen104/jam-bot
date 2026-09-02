import {
  db,
  stationsTable,
  radioBrowserStationsTable,
  stationSourceProbesTable,
  type Station,
} from "@workspace/db";
import { asc, inArray, sql } from "drizzle-orm";
import { classifyFreshness } from "./freshness.js";

/**
 * Station source-coverage ledger — the read model behind the admin "metadata
 * coverage" surface.
 *
 * Every real, non-longtail station is classified into exactly one class:
 *
 *   healthy      — the configured public source is demonstrably producing
 *                  usable artist/title metadata right now.
 *   recoverable  — a free public-metadata fix is verified (probe found a
 *                  usable artist/title pair) or plausible (stream exists,
 *                  not yet probed / source stalled). No spend required.
 *   no_source    — the station publishes no usable public track metadata
 *                  (blank, junk, show-only, or unsupported surface). These
 *                  are the residual fingerprint candidates — the ONLY
 *                  stations a paid audio-identification fallback could help.
 *   unavailable  — the stream/endpoint did not answer (off-air, dead URL,
 *                  or transient network failure). Re-probe before concluding
 *                  anything; a dead stream cannot even be fingerprinted.
 *
 * The classification is deliberately honest: a station that exposes only a
 * show/DJ name, silence, or blank metadata is `no_source`, never "healthy".
 * Reachable audio or an ICY header alone never counts as resolution — only a
 * usable artist+title pair does (see source-probe.ts).
 *
 * Test/placeholder rows (dev-DB fixtures with example.invalid/.test hosts or
 * `test-*`-style slugs) and longtail radio-browser discoveries are excluded
 * from the ledger entirely — the ledger answers "how is the REAL roster
 * covered", and those rows are not part of it.
 */

export type SourceCoverageClass =
  | "healthy"
  | "recoverable"
  | "no_source"
  | "unavailable";

/** Mirror of station_source_probes.outcome — kept in sync with the schema. */
export type SourceProbeOutcome =
  | "usable_pair"
  | "blank_metadata"
  | "unsupported"
  | "unreachable";

/**
 * How long a radio_browser health row's lastSuccessAt stays meaningful for
 * the "answering but between tracks/talk" healthy path. ICY polls every 30s;
 * 10 minutes is ~20 missed ticks — generous enough for talk segments.
 */
const RB_HEALTHY_WINDOW_MS = 10 * 60_000;

// ---- Test/placeholder exclusion ------------------------------------------

/**
 * Slug patterns used exclusively by test fixtures and placeholder rows in the
 * dev database. Real seeded/discovered stations never match these.
 */
const TEST_SLUG_RE = /^(?:test[-_]|t\d+-|tc-|slug$)/;

/**
 * True when a station row is a test fixture / placeholder rather than a real
 * station. Two independent signals: the slug conventions above, and stream
 * URLs on reserved non-public hosts (example.invalid, anything under the
 * .invalid / .test TLDs) that no real broadcast stream uses.
 */
export function isTestLikeStation(station: {
  slug: string;
  streamUrl: string | null;
}): boolean {
  if (TEST_SLUG_RE.test(station.slug)) return true;
  const url = station.streamUrl;
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.endsWith(".invalid") || host.endsWith(".test");
}

/**
 * True when the station belongs to the real, non-longtail roster the coverage
 * ledger reports on: not a radio-browser longtail discovery and not a
 * test/placeholder row.
 */
export function isRealRosterStation(station: {
  slug: string;
  streamUrl: string | null;
  tier: string;
}): boolean {
  if (station.tier === "longtail") return false;
  return !isTestLikeStation(station);
}

// ---- Classification (pure) ------------------------------------------------

export interface CoverageInput {
  station: Pick<
    Station,
    "id" | "slug" | "nowPlayingSource" | "streamUrl" | "hidden"
  >;
  /** Newest spin that carried a usable artist+title pair, when one exists. */
  latestUsableSpin: { source: string | null; observedAt: Date } | null;
  /** radio_browser_stations health row linked to this station, when any. */
  rbHealth: {
    icyStatus: string;
    lastStreamTitle: string | null;
    lastSuccessAt: Date | null;
  } | null;
  /** Most recent persisted probe outcome, when the station was probed. */
  probe: { outcome: SourceProbeOutcome; probedAt: Date } | null;
  now?: Date;
}

export interface CoverageVerdict {
  class: SourceCoverageClass;
  /**
   * True when this station is part of the small residual set a paid
   * audio-fingerprint fallback could actually help: the station is on-air
   * (has a stream) but publishes no usable public track metadata.
   */
  fingerprintCandidate: boolean;
  /** Operator-facing recovery guidance for the admin surface. */
  guidance: string;
}

function verdict(
  cls: SourceCoverageClass,
  fingerprintCandidate: boolean,
  guidance: string,
): CoverageVerdict {
  return { class: cls, fingerprintCandidate, guidance };
}

/**
 * Classify one station's public-metadata coverage. Pure: all evidence is
 * passed in. Probe evidence outranks configuration shape; live spin/health
 * evidence outranks both (a station that is producing usable spins IS healthy
 * regardless of what an older probe recorded).
 */
export function classifySourceCoverage(input: CoverageInput): CoverageVerdict {
  const now = input.now ?? new Date();
  const { station } = input;
  const hasSource = !!station.nowPlayingSource;
  const hasStream = !!station.streamUrl;
  const probe = input.probe ?? null;

  // 1. Healthy — the configured source is producing usable metadata now.
  if (hasSource) {
    const spin = input.latestUsableSpin;
    if (
      spin &&
      classifyFreshness(
        spin.source ?? station.nowPlayingSource,
        spin.observedAt,
        now,
      ) !== "stale"
    ) {
      return verdict(
        "healthy",
        false,
        "Recent usable artist/title spins are flowing from the configured source.",
      );
    }
    // ICY stations: the stream answering recently is evidence of health even
    // with no fresh spin (talk segments and between-track gaps log nothing).
    if (
      station.nowPlayingSource === "radio_browser_icy" &&
      input.rbHealth?.icyStatus === "active" &&
      input.rbHealth.lastSuccessAt &&
      now.getTime() - input.rbHealth.lastSuccessAt.getTime() <=
        RB_HEALTHY_WINDOW_MS
    ) {
      return verdict(
        "healthy",
        false,
        "ICY metadata stream is answering; no usable track in the last few polls (talk or between tracks).",
      );
    }
  }

  // 2. Probe evidence — the probe verified what the public surface supplies.
  if (probe) {
    switch (probe.outcome) {
      case "usable_pair":
        return verdict(
          "recoverable",
          false,
          hasSource
            ? "The stream publishes usable track metadata but the configured source is not capturing it — run the metadata probe to verify and repair the configuration."
            : "Verified: a free public metadata source exists for this station. Run the metadata probe to enroll it — no fingerprinting needed.",
        );
      case "unreachable":
        return verdict(
          "unavailable",
          false,
          "The stream or metadata endpoint did not answer during the last probe. The station may be off-air or the failure may be transient — probe again before drawing conclusions; a dead stream cannot be fingerprinted either.",
        );
      case "blank_metadata":
        return verdict(
          "no_source",
          hasStream,
          "The stream answers but publishes no usable artist/title (blank, junk, or show-only metadata). Residual fingerprint candidate — only paid audio identification could cover it.",
        );
      case "unsupported":
        return verdict(
          "no_source",
          hasStream,
          "The public surface does not expose track metadata at all (no ICY metadata support / no supported platform endpoint). Residual fingerprint candidate — only paid audio identification could cover it.",
        );
    }
  }

  // 3. No probe evidence yet — classify from the configuration shape.
  if (hasSource) {
    if (hasStream) {
      return verdict(
        "recoverable",
        false,
        input.latestUsableSpin
          ? "The configured source produced usable spins before but has gone stale — run the metadata probe to check whether the stream still publishes free metadata."
          : "A metadata source is configured but has never produced a usable spin — run the metadata probe to verify the stream's public metadata.",
      );
    }
    return verdict(
      "unavailable",
      false,
      "A metadata source is configured but is not producing and there is no stream URL to probe — check the source configuration (endpoint, callsign, credentials).",
    );
  }
  if (hasStream) {
    return verdict(
      "recoverable",
      false,
      "No metadata source configured, but a stream exists — run the metadata probe to check for free ICY/platform metadata before considering fingerprinting.",
    );
  }
  return verdict(
    "no_source",
    false,
    "No metadata source and no stream URL — there is nothing public to probe or fingerprint. Add a stream URL or a metadata source manually.",
  );
}

// ---- Ledger read model ----------------------------------------------------

export interface SourceCoverageEntry {
  id: number;
  slug: string;
  name: string;
  hidden: boolean;
  favorite: boolean;
  source: string | null;
  streamUrl: string | null;
  class: SourceCoverageClass;
  fingerprintCandidate: boolean;
  guidance: string;
  /** When the newest usable artist/title spin was observed (any source). */
  lastUsableAt: string | null;
  /** The artist/title pair of that newest usable spin. */
  lastArtist: string | null;
  lastTitle: string | null;
  probe: {
    kind: string;
    outcome: SourceProbeOutcome;
    detail: string | null;
    resolvedUrl: string | null;
    sampleArtist: string | null;
    sampleTitle: string | null;
    probedAt: string;
  } | null;
}

export interface SourceCoverageLedger {
  generatedAt: string;
  rosterSize: number;
  counts: Record<SourceCoverageClass, number>;
  /** Residual stations that a paid audio-fingerprint fallback could cover. */
  fingerprintCandidateCount: number;
  stations: SourceCoverageEntry[];
}

/**
 * Build the source-coverage ledger for the real, non-longtail roster.
 * Three bounded queries (stations, latest usable spin per station, RB health
 * rows, probe rows) reduced in memory — the roster is small by definition.
 */
export async function getSourceCoverageLedger(): Promise<SourceCoverageLedger> {
  const all = await db
    .select()
    .from(stationsTable)
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));
  const roster = all.filter(isRealRosterStation);
  const ids = roster.map((s) => s.id);

  const now = new Date();
  const latestSpinByStation = new Map<
    number,
    { source: string | null; observedAt: Date; artist: string; title: string }
  >();
  const rbHealthByStation = new Map<
    number,
    { icyStatus: string; lastStreamTitle: string | null; lastSuccessAt: Date | null }
  >();
  const probeByStation = new Map<number, StationSourceProbeRow>();

  if (ids.length > 0) {
    // Newest spin with a usable artist+title pair per station. DISTINCT ON
    // keeps this to one indexed pass over spins_station_played_at ordering.
    const spinRows = await db.execute<{
      station_id: number;
      source: string | null;
      observed_at: Date | null;
      raw_artist: string | null;
      raw_title: string | null;
    }>(sql`
      SELECT DISTINCT ON (station_id)
        station_id,
        source,
        COALESCE(observed_at, created_at) AS observed_at,
        raw_artist,
        raw_title
      FROM spins
      WHERE station_id IN (SELECT unnest(ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::integer[]))
        AND raw_artist IS NOT NULL AND btrim(raw_artist) <> ''
        AND raw_title IS NOT NULL AND btrim(raw_title) <> ''
        AND lower(btrim(raw_artist)) <> lower(btrim(raw_title))
      ORDER BY station_id, COALESCE(observed_at, created_at) DESC
    `);
    for (const row of spinRows.rows) {
      if (!row.observed_at) continue;
      latestSpinByStation.set(row.station_id, {
        source: row.source,
        observedAt: new Date(row.observed_at),
        artist: row.raw_artist ?? "",
        title: row.raw_title ?? "",
      });
    }

    const rbRows = await db
      .select({
        stationId: radioBrowserStationsTable.stationId,
        icyStatus: radioBrowserStationsTable.icyStatus,
        lastStreamTitle: radioBrowserStationsTable.lastStreamTitle,
        lastSuccessAt: radioBrowserStationsTable.lastSuccessAt,
      })
      .from(radioBrowserStationsTable)
      .where(inArray(radioBrowserStationsTable.stationId, ids));
    for (const row of rbRows) {
      if (row.stationId == null) continue;
      const prev = rbHealthByStation.get(row.stationId);
      // A station can have several RB rows; the one with the newest success
      // best represents current health.
      const prevAt = prev?.lastSuccessAt?.getTime() ?? 0;
      const thisAt = row.lastSuccessAt?.getTime() ?? 0;
      if (!prev || thisAt >= prevAt) rbHealthByStation.set(row.stationId, row);
    }

    const probeRows = await db
      .select()
      .from(stationSourceProbesTable)
      .where(inArray(stationSourceProbesTable.stationId, ids));
    for (const row of probeRows) probeByStation.set(row.stationId, row);
  }

  const counts: Record<SourceCoverageClass, number> = {
    healthy: 0,
    recoverable: 0,
    no_source: 0,
    unavailable: 0,
  };
  let fingerprintCandidateCount = 0;

  const stations: SourceCoverageEntry[] = roster.map((station) => {
    const probeRow = probeByStation.get(station.id);
    const verdictResult = classifySourceCoverage({
      station,
      latestUsableSpin: latestSpinByStation.get(station.id) ?? null,
      rbHealth: rbHealthByStation.get(station.id) ?? null,
      probe: probeRow
        ? {
            outcome: probeRow.outcome as SourceProbeOutcome,
            probedAt: probeRow.probedAt,
          }
        : null,
      now,
    });
    counts[verdictResult.class] += 1;
    if (verdictResult.fingerprintCandidate) fingerprintCandidateCount += 1;
    const latest = latestSpinByStation.get(station.id);
    return {
      id: station.id,
      slug: station.slug,
      name: station.name,
      hidden: station.hidden,
      favorite: station.favorite,
      source: station.nowPlayingSource ?? null,
      streamUrl: station.streamUrl || null,
      class: verdictResult.class,
      fingerprintCandidate: verdictResult.fingerprintCandidate,
      guidance: verdictResult.guidance,
      lastUsableAt: latest ? latest.observedAt.toISOString() : null,
      lastArtist: latest ? latest.artist : null,
      lastTitle: latest ? latest.title : null,
      probe: probeRow
        ? {
            kind: probeRow.probeKind,
            outcome: probeRow.outcome as SourceProbeOutcome,
            detail: probeRow.detail ?? null,
            resolvedUrl: probeRow.resolvedUrl ?? null,
            sampleArtist: probeRow.sampleArtist ?? null,
            sampleTitle: probeRow.sampleTitle ?? null,
            probedAt: probeRow.probedAt.toISOString(),
          }
        : null,
    };
  });

  return {
    generatedAt: now.toISOString(),
    rosterSize: roster.length,
    counts,
    fingerprintCandidateCount,
    stations,
  };
}

type StationSourceProbeRow = typeof stationSourceProbesTable.$inferSelect;
