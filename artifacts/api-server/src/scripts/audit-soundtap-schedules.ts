/* eslint-disable no-console -- this file is a command-line audit report */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  db,
  scrapedShowsTable,
  spinsTable,
  stationQualityTable,
  stationsTable,
} from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { readMonitoredTrial } from "../lore/monitored-trial.js";

const SOUNDTAP_SOURCE = fileURLToPath(
  new URL("../../../../research/sources/soundtap-home.md", import.meta.url),
);
const REPORT_PATH = fileURLToPath(
  new URL("../../../../research/soundtap-schedule-gap.json", import.meta.url),
);
const OBSERVATION_DAYS = 7;

export interface SoundtapStation {
  slug: string;
  label: string;
  callsign: string | null;
  evidenceUrl: string;
  location: string | null;
  country: string | null;
  officialUrl?: string | null;
  streamUrl?: string | null;
  scheduleUrl?: string | null;
}

export function canonicalCallsign(value: string): string | null {
  const candidate = value
    .toUpperCase()
    .replace(/[–—].*$/, "")
    .match(/\b((?:[KWC][A-Z]{3}|4ZZZ)(?:-FM|-LP|-FM-LP|-HD\d| HD ?\d)?)\b/)?.[1]
    ?.replace(/\s+/g, "");
  if (!candidate || candidate.length < 3) return null;
  if (
    ["RADIO", "RADYO", "PURE", "LIVE", "THE", "FM", "AM", "BBC", "NTS"].includes(
      candidate,
    )
  ) {
    return null;
  }
  return candidate;
}

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(?:fm|am|radio|the)\b/g, " ")
    .replace(/\b\d{2,3}(?:\.\d+)?\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizedBrand(value: string): string {
  return fold(
    value
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+[|·]\s+.*$/, " "),
  );
}

function domain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function streamIdentity(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

const COUNTRY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["united states", "US"], ["united kingdom", "GB"], ["great britain", "GB"],
  ["south africa", "ZA"], ["deutschland", "DE"], ["switzerland", "CH"],
  ["australia", "AU"], ["germany", "DE"], ["canada", "CA"],
  ["france", "FR"], ["ireland", "IE"], ["greece", "GR"],
  ["turkiye", "TR"], ["turkey", "TR"], ["usa", "US"],
  ["us", "US"], ["uk", "GB"],
];

function countryCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = value.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(direct)) return direct;
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  for (const [alias, code] of COUNTRY_ALIASES) {
    if (normalized === alias || normalized.endsWith(` ${alias}`)) return code;
  }
  return null;
}

export interface SoundtapIdentityCandidate {
  id: number;
  slug: string;
  name: string;
  org: string | null;
  country?: string | null;
  city?: string | null;
  region?: string | null;
  streamUrl?: string | null;
  homepageUrl: string | null;
  scheduleUrl: string | null;
  active?: boolean;
  hidden?: boolean;
  config: Record<string, unknown> | null;
  [key: string]: unknown;
}

export type IdentitySignal = {
  signal: "callsign" | "brand" | "organization" | "domain" | "geography" | "stream" | "configuration";
  outcome: "supports" | "conflicts";
  reason: string;
  weight: number;
};

export type IdentityMatch<T extends SoundtapIdentityCandidate> = {
  soundtap: SoundtapStation;
  station: T;
  confidence: "high" | "medium";
  score: number;
  kind: "branded_match" | "evidence_match";
  signals: IdentitySignal[];
};

function identitySignals(
  source: SoundtapStation,
  station: SoundtapIdentityCandidate,
): IdentitySignal[] {
  const signals: IdentitySignal[] = [];
  const configuredCallsign =
    typeof station.config?.callsign === "string"
      ? canonicalCallsign(station.config.callsign)
      : null;
  const loreCallsign =
    configuredCallsign ??
    canonicalCallsign(station.name) ??
    canonicalCallsign(station.org ?? "");
  if (source.callsign && loreCallsign === source.callsign) {
    signals.push({
      signal: "callsign", outcome: "supports",
      reason: `callsign ${source.callsign} agrees`, weight: 35,
    });
  }

  const sourceBrand = normalizedBrand(source.label);
  const nameBrand = normalizedBrand(station.name);
  const orgBrand = normalizedBrand(station.org ?? "");
  // A callsign-shaped label is the same evidence family as callsign/config,
  // not independent brand corroboration.
  if (!source.callsign && sourceBrand && sourceBrand === nameBrand) {
    signals.push({
      signal: "brand", outcome: "supports",
      reason: `normalized brand "${sourceBrand}" agrees`, weight: 60,
    });
  } else if (!source.callsign && sourceBrand && sourceBrand === orgBrand) {
    signals.push({
      signal: "organization", outcome: "supports",
      reason: `normalized organization "${sourceBrand}" agrees`, weight: 55,
    });
  }

  const sourceDomain = domain(source.officialUrl);
  const loreDomains = [station.homepageUrl, station.scheduleUrl]
    .map(domain)
    .filter((item): item is string => !!item);
  if (sourceDomain && loreDomains.length) {
    const agrees = loreDomains.some(
      (item) => item === sourceDomain || item.endsWith(`.${sourceDomain}`) || sourceDomain.endsWith(`.${item}`),
    );
    signals.push({
      signal: "domain",
      outcome: agrees ? "supports" : "conflicts",
      reason: agrees
        ? `official domain ${sourceDomain} agrees`
        : `official domain ${sourceDomain} conflicts with ${loreDomains.join(", ")}`,
      weight: agrees ? 30 : -100,
    });
  }

  const sourceCountry = countryCode(source.country ?? source.location);
  const loreCountry = countryCode(station.country);
  if (sourceCountry && loreCountry) {
    const agrees = sourceCountry === loreCountry;
    signals.push({
      signal: "geography",
      outcome: agrees ? "supports" : "conflicts",
      reason: agrees
        ? `country ${sourceCountry} agrees`
        : `country ${sourceCountry} conflicts with ${loreCountry}`,
      weight: agrees ? 15 : -70,
    });
  }

  const sourceStream = streamIdentity(source.streamUrl);
  const configuredStream =
    typeof station.config?.streamUrl === "string" ? station.config.streamUrl : null;
  const loreStreams = [station.streamUrl, configuredStream]
    .map(streamIdentity)
    .filter((item): item is string => !!item);
  if (sourceStream && loreStreams.length) {
    const agrees = loreStreams.includes(sourceStream);
    signals.push({
      signal: "stream",
      outcome: agrees ? "supports" : "conflicts",
      reason: agrees ? "stream identity agrees" : "stream identity conflicts",
      weight: agrees ? 45 : -100,
    });
  }
  return signals;
}

export function auditSoundtapIdentity<T extends SoundtapIdentityCandidate>(
  soundtap: SoundtapStation[],
  stations: T[],
): {
  shared: Array<IdentityMatch<T>>;
  branded: Array<IdentityMatch<T>>;
  ambiguous: Array<{
    soundtap: SoundtapStation;
    reason: string;
    candidates: Array<{ station: T; score: number; signals: IdentitySignal[] }>;
  }>;
  absent: SoundtapStation[];
} {
  const shared: Array<IdentityMatch<T>> = [];
  const ambiguous = [];
  const absent: SoundtapStation[] = [];

  for (const source of soundtap) {
    const ranked = stations
      // Hidden/inactive rows may retain useful history after an operator
      // resolves a duplicate. They are not eligible identities: considering
      // them here would keep the Soundtap brand ambiguous forever and could
      // make a later trial target a quarantined row.
      .filter((station) => station.active !== false && station.hidden !== true)
      .map((station) => {
        const signals = identitySignals(source, station);
        return {
          station,
          signals,
          score: signals.reduce((sum, signal) => sum + signal.weight, 0),
          conflict: signals.some((signal) => signal.outcome === "conflicts"),
        };
      })
      // Geography can corroborate identity but can never nominate a station by
      // itself. Otherwise every US listing would conflict with every non-US
      // Lore row and the quarantine cohort would become meaningless.
      .filter((candidate) => candidate.signals.some((signal) =>
        signal.signal !== "geography" && signal.outcome === "supports"))
      .sort((a, b) => b.score - a.score || a.station.id - b.station.id);
    const eligible = ranked.filter((candidate) => candidate.score >= 50 && !candidate.conflict);
    const conflicts = ranked.filter((candidate) => candidate.conflict);
    if (conflicts.length > 0) {
      ambiguous.push({
        soundtap: source,
        reason: "conflicting_identity_evidence",
        candidates: [...eligible, ...conflicts].map(
          ({ station, score, signals }) => ({ station, score, signals }),
        ),
      });
    } else if (eligible.length > 0 && eligible[0]!.score > (eligible[1]?.score ?? -Infinity)) {
      const candidate = eligible[0]!;
      shared.push({
        soundtap: source,
        station: candidate.station,
        confidence: candidate.score >= 75 ? "high" : "medium",
        score: candidate.score,
        kind: candidate.signals.some((signal) =>
          signal.signal === "brand" || signal.signal === "organization")
          ? "branded_match"
          : "evidence_match",
        signals: candidate.signals,
      });
    } else if (eligible.length > 1) {
      ambiguous.push({
        soundtap: source,
        reason: "multiple_plausible_matches",
        candidates: eligible.map(
          ({ station, score, signals }) => ({ station, score, signals }),
        ),
      });
    } else {
      absent.push(source);
    }
  }
  return {
    shared,
    branded: shared.filter((match) => match.kind === "branded_match"),
    ambiguous,
    absent,
  };
}

/** Compatibility name retained for the schedule refresh command. */
export const selectVerifiedSoundtapMatches = auditSoundtapIdentity;

export type CandidateReadiness = {
  soundtap: SoundtapStation;
  readiness: "ready_for_staging" | "needs_first_party_evidence";
  score: number;
  reasons: string[];
};

export function rankAbsentCandidates(absent: SoundtapStation[]): CandidateReadiness[] {
  return absent
    .map((soundtap) => {
      const reasons: string[] = [];
      let score = 0;
      if (domain(soundtap.officialUrl)) {
        score += 40;
        reasons.push("first-party homepage recorded");
      }
      if (streamIdentity(soundtap.streamUrl)) {
        score += 40;
        reasons.push("first-party stream recorded");
      }
      if (domain(soundtap.scheduleUrl)) {
        score += 20;
        reasons.push("first-party schedule recorded");
      }
      if (score === 0) reasons.push("Soundtap listing alone is not trial evidence");
      return {
        soundtap,
        readiness:
          score >= 80 ? "ready_for_staging" as const : "needs_first_party_evidence" as const,
        score,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score || a.soundtap.label.localeCompare(b.soundtap.label));
}

type ComparableObservation = {
  spins: number;
  resolved: number;
  recordings: number;
  artists: number;
};

export function recommendFromComparableEvidence(
  observation: ComparableObservation,
  windowComplete = true,
): {
  recommendation: "retain" | "trial" | "reject";
  reason: string;
} {
  if (!windowComplete) {
    return {
      recommendation: "trial",
      reason: "monitored observation window is not complete",
    };
  }
  if (observation.spins < 20) {
    return {
      recommendation: "trial",
      reason: "fewer than 20 observations in the seven-day comparison window",
    };
  }
  const resolutionRate = observation.resolved / observation.spins;
  if (
    resolutionRate >= 0.4 &&
    observation.recordings >= 10 &&
    observation.artists >= 10
  ) {
    return {
      recommendation: "retain",
      reason: "Lore observed sufficient resolution and recording/artist breadth",
    };
  }
  if (observation.resolved === 0 && observation.recordings === 0) {
    return {
      recommendation: "reject",
      reason: "20 or more Lore observations yielded no resolved recordings",
    };
  }
  return {
    recommendation: "trial",
    reason: "Lore observations exist but resolution or breadth remains inconclusive",
  };
}

export function parseSoundtapStations(markdown: string): SoundtapStation[] {
  const stationLink = /^\[([^\]]+)\]\((https:\/\/soundtap\.fm\/stations\/([^/)]+))\)$/gm;
  const bySlug = new Map<string, SoundtapStation>();
  for (const match of markdown.matchAll(stationLink)) {
    const label = match[1]!.trim();
    const slug = match[3]!;
    const remainder = markdown.slice((match.index ?? 0) + match[0].length);
    const location =
      remainder.split("\n").map((line) => line.trim()).find((line) =>
        !!line && !line.startsWith("[") && !line.startsWith("!") && !/^\d+$/.test(line),
      ) ?? null;
    bySlug.set(slug, {
      slug,
      label,
      callsign: canonicalCallsign(label),
      evidenceUrl: match[2]!,
      location,
      country: countryCode(location),
    });
  }
  return [...bySlug.values()];
}

async function main(): Promise<void> {
  const now = new Date();
  const soundtap = parseSoundtapStations(await readFile(SOUNDTAP_SOURCE, "utf8"));
  const lore = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      name: stationsTable.name,
      org: stationsTable.org,
      country: stationsTable.country,
      city: stationsTable.city,
      region: stationsTable.region,
      streamUrl: stationsTable.streamUrl,
      homepageUrl: stationsTable.homepageUrl,
      scheduleUrl: stationsTable.scheduleUrl,
      active: stationsTable.active,
      hidden: stationsTable.hidden,
      source: stationsTable.source,
      nowPlayingSource: stationsTable.nowPlayingSource,
      automaticCullReason: stationsTable.automaticCullReason,
      automaticCullCanonicalStationId: stationsTable.automaticCullCanonicalStationId,
      scrapedAt: stationsTable.scheduleScrapedAt,
      showCount: stationsTable.upcomingShowCount,
      lastAliveAt: stationsTable.lastAliveAt,
      config: stationsTable.nowPlayingConfig,
      qualityTier: stationQualityTable.qualityTier,
      sampleCount: stationQualityTable.sampleCount,
      mbidResolutionRate: stationQualityTable.mbidResolutionRate,
      qualityComputedAt: stationQualityTable.computedAt,
    })
    .from(stationsTable)
    .leftJoin(stationQualityTable, eq(stationQualityTable.stationId, stationsTable.id));

  const selection = auditSoundtapIdentity(soundtap, lore);
  const matchedIds = selection.shared.map((match) => match.station.id);
  const coverage = matchedIds.length
    ? await db
        .select({
          slots: sql<number>`count(*)::int`,
          stations: sql<number>`count(distinct ${scrapedShowsTable.stationId})::int`,
          sources: sql<number>`count(distinct ${scrapedShowsTable.sourceUrl})::int`,
        })
        .from(scrapedShowsTable)
        .where(sql`${scrapedShowsTable.stationId} = any(array[${sql.join(
          matchedIds.map((id) => sql`${id}`), sql`, `,
        )}]::integer[]) and ${scrapedShowsTable.voidedAt} is null`)
    : [{ slots: 0, stations: 0, sources: 0 }];

  const cutoff = new Date(now.getTime() - OBSERVATION_DAYS * 86_400_000);
  const observationStationIds = lore.map((station) => station.id);
  const observations = observationStationIds.length
    ? await db
        .select({
          stationId: spinsTable.stationId,
          spins: sql<number>`count(*)::int`,
          resolved: sql<number>`count(${spinsTable.mbid})::int`,
          recordings: sql<number>`count(distinct ${spinsTable.mbid})::int`,
          artists: sql<number>`count(distinct nullif(lower(${spinsTable.rawArtist}), ''))::int`,
          latestSpinAt: sql<Date | null>`max(${spinsTable.playedAt})`,
        })
        .from(spinsTable)
        .where(and(
          gte(spinsTable.playedAt, cutoff),
          sql`${spinsTable.stationId} = any(array[${sql.join(
            observationStationIds.map((id) => sql`${id}`), sql`, `,
          )}]::integer[])`,
        ))
        .groupBy(spinsTable.stationId)
    : [];
  const observationsById = new Map(observations.map((row) => [row.stationId, row]));
  const historicalSpinRows = observationStationIds.length
    ? await db
        .select({
          stationId: spinsTable.stationId,
          spins: sql<number>`count(*)::int`,
        })
        .from(spinsTable)
        .where(sql`${spinsTable.stationId} = any(array[${sql.join(
          observationStationIds.map((id) => sql`${id}`), sql`, `,
        )}]::integer[])`)
        .groupBy(spinsTable.stationId)
    : [];
  const historicalSpinsById = new Map(
    historicalSpinRows.map((row) => [row.stationId, row.spins]),
  );
  for (const station of lore) {
    const trial = readMonitoredTrial(station.config);
    if (!trial) continue;
    const [trialObservation] = await db
      .select({
        stationId: spinsTable.stationId,
        spins: sql<number>`count(*)::int`,
        resolved: sql<number>`count(${spinsTable.mbid})::int`,
        recordings: sql<number>`count(distinct ${spinsTable.mbid})::int`,
        artists: sql<number>`count(distinct nullif(lower(${spinsTable.rawArtist}), ''))::int`,
        latestSpinAt: sql<Date | null>`max(${spinsTable.playedAt})`,
      })
      .from(spinsTable)
      .where(and(
        eq(spinsTable.stationId, station.id),
        gte(spinsTable.playedAt, new Date(trial.startedAt)),
        lt(spinsTable.playedAt, new Date(trial.endsAt)),
      ))
      .groupBy(spinsTable.stationId);
    observationsById.set(station.id, trialObservation ?? {
      stationId: station.id,
      spins: 0,
      resolved: 0,
      recordings: 0,
      artists: 0,
      latestSpinAt: null,
    });
  }

  const matchedStations = selection.shared.map((match) => {
    const observation = observationsById.get(match.station.id) ?? {
      stationId: match.station.id,
      spins: 0,
      resolved: 0,
      recordings: 0,
      artists: 0,
      latestSpinAt: null,
    };
    const trial = readMonitoredTrial(match.station.config);
    const windowComplete = !trial || now.getTime() >= Date.parse(trial.endsAt);
    const decision = recommendFromComparableEvidence(observation, windowComplete);
    return {
      soundtap: match.soundtap.slug,
      soundtapLabel: match.soundtap.label,
      evidenceUrl: match.soundtap.evidenceUrl,
      identity: {
        kind: match.kind,
        confidence: match.confidence,
        score: match.score,
        signals: match.signals,
      },
      lore: {
        id: match.station.id,
        slug: match.station.slug,
        name: match.station.name,
        source: match.station.source,
        streamUrl: match.station.streamUrl,
        nowPlayingSource: match.station.nowPlayingSource,
        active: match.station.active,
        hidden: match.station.hidden,
        homepageUrl: match.station.homepageUrl,
        scheduleUrl: match.station.scheduleUrl,
        streamHealthy: !!match.station.lastAliveAt,
        lastAliveAt: match.station.lastAliveAt,
      },
      observationWindow: {
        days: OBSERVATION_DAYS,
        startedAt: trial?.startedAt ?? cutoff.toISOString(),
        endsAt: trial?.endsAt ?? now.toISOString(),
        completed: windowComplete,
        spins: observation.spins,
        totalSpins: historicalSpinsById.get(match.station.id) ?? 0,
        resolved: observation.resolved,
        recordings: observation.recordings,
        artists: observation.artists,
        resolutionRate: observation.spins ? observation.resolved / observation.spins : null,
        latestSpinAt: observation.latestSpinAt,
        qualityTier: match.station.qualityTier,
        scheduleFresh:
          !!match.station.scrapedAt &&
          now.getTime() - match.station.scrapedAt.getTime() <= 14 * 86_400_000,
      },
      recommendation: decision.recommendation,
      recommendationReason: decision.reason,
    };
  });
  const weakCohort = lore
    .filter((station) => station.active && !station.hidden)
    .map((station) => {
      const observation = observationsById.get(station.id) ?? {
        spins: 0, resolved: 0, recordings: 0, artists: 0, latestSpinAt: null,
      };
      const decision = recommendFromComparableEvidence(observation);
      return {
      id: station.id,
      slug: station.slug,
      name: station.name,
      observationWindow: {
        days: OBSERVATION_DAYS,
        spins: observation.spins,
        resolved: observation.resolved,
        recordings: observation.recordings,
        artists: observation.artists,
        resolutionRate: observation.spins ? observation.resolved / observation.spins : null,
        latestSpinAt: observation.latestSpinAt,
        qualityTier: station.qualityTier,
        streamHealthy: !!station.lastAliveAt,
        scheduleFresh:
          !!station.scrapedAt &&
          now.getTime() - station.scrapedAt.getTime() <= 14 * 86_400_000,
      },
      recommendation: decision.recommendation,
      recommendationReason: decision.reason,
    };
    })
    .filter((station) => station.recommendation !== "retain")
    .sort((a, b) =>
      (a.observationWindow.spins - b.observationWindow.spins) ||
      a.name.localeCompare(b.name));
  const rankedAbsent = rankAbsentCandidates(selection.absent);

  const report = {
    generatedAt: now.toISOString(),
    methodology: {
      identity:
        "Evidence-weighted comparison of callsign, normalized brand/organization, official domains, geography, stream identity, and configuration. Callsign alone cannot verify identity; conflicts are quarantined.",
      sourceSnapshot: "research/sources/soundtap-home.md",
      candidateReadiness:
        "Readiness uses only recorded first-party homepage, stream, and schedule evidence. Soundtap presence, popularity, tags, and copy add no readiness score.",
      trial:
        "Trials remain listener-hidden and expire after a bounded observation window. Retain/reject recommendations require Lore's own comparable observations.",
    },
    soundtap: { stations: soundtap.length, shows: 7713 },
    cohorts: {
      shared: selection.shared.length,
      brandedMatches: selection.branded.length,
      ambiguous: selection.ambiguous.length,
      trulyAbsent: selection.absent.length,
    },
    sharedWithShows: matchedStations.filter((row) =>
      (selection.shared.find((match) => match.station.id === row.lore.id)?.station.showCount ?? 0) > 0
    ).length,
    showSlotCoverage: coverage[0]?.slots ?? 0,
    officialScheduleSources: coverage[0]?.sources ?? 0,
    matchedStations,
    reviewedDuplicateResolutions: lore
      .filter((station) =>
        station.hidden === true &&
        station.active === false &&
        station.automaticCullReason === "duplicate_stream" &&
        typeof station.automaticCullCanonicalStationId === "number",
      )
      .map((alias) => {
        const canonical = lore.find(
          (station) => station.id === alias.automaticCullCanonicalStationId,
        );
        return {
          alias: {
            id: alias.id,
            slug: alias.slug,
            name: alias.name,
            streamUrl: alias.streamUrl,
            totalSpins: historicalSpinsById.get(alias.id) ?? 0,
            active: alias.active,
            hidden: alias.hidden,
          },
          canonical: canonical
            ? {
                id: canonical.id,
                slug: canonical.slug,
                name: canonical.name,
                streamUrl: canonical.streamUrl,
                homepageUrl: canonical.homepageUrl,
                scheduleUrl: canonical.scheduleUrl,
                streamHealthy: !!canonical.lastAliveAt,
                totalSpins: historicalSpinsById.get(canonical.id) ?? 0,
                active: canonical.active,
                hidden: canonical.hidden,
              }
            : null,
        };
      })
      .sort((a, b) => a.alias.id - b.alias.id),
    brandedMatches: matchedStations.filter((row) => row.identity.kind === "branded_match"),
    ambiguousStations: selection.ambiguous.map((entry) => ({
      soundtap: entry.soundtap,
      reason: entry.reason,
      loreCandidates: entry.candidates.map((candidate) => ({
        id: candidate.station.id,
        slug: candidate.station.slug,
        score: candidate.score,
        signals: candidate.signals,
      })),
    })),
    absentCandidates: rankedAbsent,
    weakCohort,
    safeguards: {
      automaticPromotion: false,
      automaticRemoval: false,
      soundtapScheduleScraping: false,
    },
  };

  const shouldWrite = process.argv.includes("--write");
  if (shouldWrite) await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    cohorts: report.cohorts,
    showSlotCoverage: report.showSlotCoverage,
    officialScheduleSources: report.officialScheduleSources,
    trialReady: rankedAbsent.filter((item) => item.readiness === "ready_for_staging").length,
    weakCohort: weakCohort.length,
    wrote: shouldWrite ? REPORT_PATH : null,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}