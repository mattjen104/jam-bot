/* eslint-disable no-console -- command-line research audit */
import { appendFile, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  db,
  stationSourceProbesTable,
  stationsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  auditExclusion,
  auditOutcome,
  classifyPlaylistEvidence,
  playlistPilotStratum,
  reuseAuditEvidence,
  safeOrigin,
  stratifiedPilot,
  wasAuditedToday,
  wilsonInterval,
  type PlaylistAuditStation,
  type PriorAuditEvidence,
} from "../lore/playlist-coverage-audit.js";
import {
  probeStationPublicMetadataForAudit,
  type ProbeResult,
} from "../lore/source-probe.js";

const ROOT = resolve(import.meta.dirname, "../../../../");
const DEFAULT_EVIDENCE = resolve(ROOT, "research/lore-playlist-coverage-evidence.jsonl");
const DEFAULT_REPORT = resolve(ROOT, "research/lore-playlist-coverage.json");
const DEFAULT_PILOT = resolve(ROOT, "research/lore-playlist-coverage-pilot.json");
const DEFAULT_LIMIT = 75;

type Args = {
  probe: boolean;
  pilot: boolean;
  limit: number;
  afterId: number;
  evidencePath: string;
  reportPath: string;
};

type PilotManifest = {
  schemaVersion: 1;
  generatedAt: string;
  eligibleAtSelection: number;
  method: "proportional_stratified_deterministic_hash_v1";
  stationIds: number[];
};

export function parsePlaylistAuditArgs(argv: string[]): Args {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=", 2)[1];
  const limit = Number(value("limit") ?? DEFAULT_LIMIT);
  const afterId = Number(value("after-id") ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer from 1 to 100");
  }
  if (!Number.isSafeInteger(afterId) || afterId < 0) {
    throw new Error("--after-id must be a non-negative integer");
  }
  return {
    probe: argv.includes("--probe"),
    pilot: argv.includes("--pilot"),
    limit,
    afterId,
    evidencePath: resolve(value("evidence") ?? DEFAULT_EVIDENCE),
    reportPath: resolve(value("report") ?? DEFAULT_REPORT),
  };
}

async function readEvidence(path: string): Promise<PriorAuditEvidence[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PriorAuditEvidence);
}

async function acquireAuditLock(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, "wx");
    await handle.writeFile(`${process.pid}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const existingPid = Number((await readFile(path, "utf8").catch(() => "")).trim());
      let running = false;
      if (Number.isSafeInteger(existingPid) && existingPid > 0) {
        try {
          process.kill(existingPid, 0);
          running = true;
        } catch {
          running = false;
        }
      }
      if (running) {
        throw new Error(`another playlist audit is running (${path})`, {
          cause: error,
        });
      }
      await unlink(path).catch(() => undefined);
      return acquireAuditLock(path);
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return async () => {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  };
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

async function main(): Promise<void> {
  const args = parsePlaylistAuditArgs(process.argv.slice(2));
  const now = new Date();
  const stationRows = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      name: stationsTable.name,
      org: stationsTable.org,
      country: stationsTable.country,
      city: stationsTable.city,
      streamUrl: stationsTable.streamUrl,
      homepageUrl: stationsTable.homepageUrl,
      nowPlayingSource: stationsTable.nowPlayingSource,
      nowPlayingConfig: stationsTable.nowPlayingConfig,
      active: stationsTable.active,
      hidden: stationsTable.hidden,
      tier: stationsTable.tier,
      automaticCullReason: stationsTable.automaticCullReason,
      automaticCullCanonicalStationId: stationsTable.automaticCullCanonicalStationId,
      scheduleScrapedAt: stationsTable.scheduleScrapedAt,
      lastAliveAt: stationsTable.lastAliveAt,
      lastUsableAt: sql<Date | null>`latest_spin.observed_at`,
      lastUsableArtist: sql<string | null>`latest_spin.raw_artist`,
      lastUsableTitle: sql<string | null>`latest_spin.raw_title`,
      probeOutcome: stationSourceProbesTable.outcome,
      probeAt: stationSourceProbesTable.probedAt,
    })
    .from(stationsTable)
    .leftJoin(
      sql`LATERAL (
        SELECT COALESCE(observed_at, created_at) observed_at, raw_artist, raw_title
        FROM spins
        WHERE station_id = ${stationsTable.id}
          AND NULLIF(btrim(raw_artist), '') IS NOT NULL
          AND NULLIF(btrim(raw_title), '') IS NOT NULL
        ORDER BY COALESCE(observed_at, created_at) DESC LIMIT 1
      ) latest_spin`,
      sql`true`,
    )
    .leftJoin(
      stationSourceProbesTable,
      eq(stationSourceProbesTable.stationId, stationsTable.id),
    )
    .orderBy(stationsTable.id) as PlaylistAuditStation[];
  const releaseLock = args.probe
    ? await acquireAuditLock(`${args.evidencePath}.lock`)
    : null;

  const exclusions: Record<string, number> = {
    test: 0, duplicate: 0, inactive: 0, hidden: 0, unsupported: 0,
  };
  const eligible: PlaylistAuditStation[] = [];
  for (const station of stationRows) {
    const exclusion = auditExclusion(station);
    if (exclusion) increment(exclusions, exclusion);
    else eligible.push(station);
  }

  const allEvidence = await readEvidence(args.evidencePath);
  const latestByStation = new Map<number, PriorAuditEvidence>();
  for (const row of allEvidence) latestByStation.set(row.stationId, row);
  const requested = args.pilot
    ? stratifiedPilot(eligible, Math.min(args.limit, Math.ceil(eligible.length * 0.1)))
    : eligible.filter((station) => station.id > args.afterId).slice(0, args.limit);
  let pilotManifest: PilotManifest | null = null;
  if (args.pilot) {
    pilotManifest = {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      eligibleAtSelection: eligible.length,
      method: "proportional_stratified_deterministic_hash_v1",
      stationIds: requested.map((station) => station.id),
    };
    await writeFile(DEFAULT_PILOT, `${JSON.stringify(pilotManifest, null, 2)}\n`);
  } else {
    try {
      pilotManifest = JSON.parse(await readFile(DEFAULT_PILOT, "utf8")) as PilotManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const probeTargets = requested.filter(
    (station) => !wasAuditedToday(latestByStation.get(station.id) ?? null, now),
  );

  const load = {
    mode: args.probe ? "probe" : "dry_run",
    selectedStations: requested.length,
    skippedDailyLimit: requested.length - probeTargets.length,
    externalProbeOperations: 0,
    externalRequestUpperBound: 0,
    evidenceRowsAppended: 0,
    elapsedMs: 0,
    byRequestedOrigin: {} as Record<string, number>,
  };
  const started = Date.now();
  if (args.probe) {
    try {
      await mkdir(dirname(args.evidencePath), { recursive: true });
      if (args.pilot) {
        for (const station of requested.filter((row) =>
          wasAuditedToday(latestByStation.get(row.id) ?? null, now),
        )) {
          const prior = latestByStation.get(station.id);
          if (!prior) continue;
          const annotation = reuseAuditEvidence(
            prior,
            new Date().toISOString(),
            "pilot",
            playlistPilotStratum(station),
          );
          await appendFile(args.evidencePath, `${JSON.stringify(annotation)}\n`);
          allEvidence.push(annotation);
          latestByStation.set(station.id, annotation);
          load.evidenceRowsAppended++;
        }
      }
      for (const station of probeTargets) {
        const origin = safeOrigin(station.streamUrl);
        const beganAt = Date.now();
        let result: ProbeResult | null;
        try {
          result = await probeStationPublicMetadataForAudit({
            ...station,
            streamUrl: station.streamUrl ?? "",
          });
        } catch (error) {
          result = {
            kind: "icy",
            outcome: "unreachable",
            detail: error instanceof Error ? error.message : String(error),
          };
        }
        const evidence: PriorAuditEvidence & Record<string, unknown> = {
          schemaVersion: 1,
          accountingVersion: 2,
          stationId: station.id,
          slug: station.slug,
          observedAt: new Date().toISOString(),
          phase: args.pilot ? "pilot" : "fleet",
          ...(args.pilot
            ? { pilotStratum: playlistPilotStratum(station) }
            : {}),
          outcome: auditOutcome(
            result?.outcome ?? "not_probeable",
            result?.detail,
          ),
          probeKind: result?.kind ?? null,
          sampleArtist: result?.sampleArtist,
          sampleTitle: result?.sampleTitle,
          detail: result?.detail ?? null,
          requestedOrigin: origin,
          latencyMs: Date.now() - beganAt,
          requestCountUpperBound: result
            ? result.kind === "icy"
              ? 4
              : 1
            : 0,
          incrementalRequestCountUpperBound: result
            ? result.kind === "icy"
              ? 4
              : 1
            : 0,
          bytesRetained: 0,
          mutationCount: 0,
        };
        await appendFile(args.evidencePath, `${JSON.stringify(evidence)}\n`);
        allEvidence.push(evidence);
        latestByStation.set(station.id, evidence);
        load.evidenceRowsAppended++;
        load.externalRequestUpperBound += Number(evidence.requestCountUpperBound);
        if (result) {
          increment(load.byRequestedOrigin, origin);
          load.externalProbeOperations++;
        }
      }
    } finally {
      await releaseLock?.();
    }
  }
  load.elapsedMs = Date.now() - started;

  const rows = eligible.map((station) => {
    const evidence = latestByStation.get(station.id) ?? null;
    return {
      id: station.id,
      slug: station.slug,
      name: station.name,
      source: station.nowPlayingSource,
      host: safeOrigin(station.streamUrl),
      country: station.country ?? "unknown",
      evidence: classifyPlaylistEvidence(station, evidence),
      historyRecoverable:
        classifyPlaylistEvidence(station, evidence) === "confirmed_history",
      liveOnly:
        classifyPlaylistEvidence(station, evidence) === "confirmed_live",
      merelyReachable:
        !station.lastUsableAt && Boolean(station.lastAliveAt),
      scheduleObservedSeparately: Boolean(station.scheduleScrapedAt),
      latestAudit: evidence,
    };
  });
  const byEvidence: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byHost: Record<string, number> = {};
  const byGeography: Record<string, number> = {};
  for (const row of rows) {
    increment(byEvidence, row.evidence);
    increment(bySource, row.source ?? "none");
    increment(byHost, row.host);
    increment(byGeography, row.country);
  }
  const confirmed =
    (byEvidence.confirmed_history ?? 0) + (byEvidence.confirmed_live ?? 0);
  const conservative = confirmed + (byEvidence.conservative_configured ?? 0);
  const potential =
    conservative +
    (byEvidence.potential_unprobed ?? 0) +
    (byEvidence.unavailable_transient ?? 0);
  const pilotIds =
    pilotManifest?.stationIds ??
    allEvidence.filter((row) => row.phase === "pilot").slice(-50).map((row) => row.stationId);
  const pilotEvidence = pilotIds
    .map((id) => latestByStation.get(id))
    .filter((row): row is PriorAuditEvidence => Boolean(row));
  const pilotConfirmed = pilotEvidence.filter(
    (row) => row.outcome === "usable_pair",
  ).length;
  const latestEvidence = [...latestByStation.values()];
  const latencies = latestEvidence
    .map((row) => Number(row.latencyMs))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))]
      : null;
  const cumulativeByRequestedOrigin: Record<string, number> = {};
  for (const row of latestEvidence) {
    increment(
      cumulativeByRequestedOrigin,
      row.requestedOrigin ?? row.origin ?? "unknown",
    );
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      cohort:
        "Eligible means active, visible, non-test, non-duplicate, with a sanctioned stream or configured metadata source. Exclusions are mutually exclusive in test, duplicate, inactive, hidden, unsupported order.",
      confirmed:
        "A usable artist/title pair was observed. History is only called recoverable when the configured history contract supports time-anchored backfill.",
      conservative:
        "Confirmed plus configured permitted metadata sources not yet positively observed.",
      potential:
        "Conservative plus unprobed stations and transient failures. Blank/unsupported metadata and policy rejections are excluded.",
      liveLimit:
        "ICY/Radiojar observations are live-only and never claimed as complete historical playlists.",
      policy:
        "No Spinitron HTML or schedule page is fetched. ICY uses bounded GET, public-IP pinning, redirect limits, timeouts, per-origin serialization/cooldowns, and Lore's identifiable network user agent.",
      schedule:
        "Schedule presence is reported separately and never contributes to playlist coverage.",
    },
    inventory: {
      total: stationRows.length,
      eligible: eligible.length,
      excludedMutuallyExclusive: exclusions,
    },
    bounds: {
      confirmed: { count: confirmed, percent: confirmed / eligible.length },
      conservative: { count: conservative, percent: conservative / eligible.length },
      potential: { count: potential, percent: potential / eligible.length },
      uncertainCount: potential - confirmed,
    },
    distinctions: {
      recoverableHistory: byEvidence.confirmed_history ?? 0,
      comparisonUsableLiveOnly: byEvidence.confirmed_live ?? 0,
      merelyReachableAudio: rows.filter((row) => row.merelyReachable).length,
      schedulesObservedSeparately: rows.filter((row) => row.scheduleObservedSeparately).length,
    },
    breakdowns: { evidenceQuality: byEvidence, sourceType: bySource, host: byHost, geography: byGeography },
    pilot: {
      stratified: pilotEvidence.length > 0 || args.pilot,
      method: pilotManifest?.method ?? "legacy_unpinned",
      eligibleAtSelection: pilotManifest?.eligibleAtSelection ?? null,
      target: pilotIds.length,
      selected: pilotEvidence.length,
      confirmed: pilotConfirmed,
      confirmedWilson95: wilsonInterval(pilotConfirmed, pilotEvidence.length),
      stationIds: pilotEvidence.map((row) => row.stationId),
    },
    batch: {
      ordering: "station_id_ascending",
      afterId: args.afterId,
      limit: args.limit,
      nextAfterId:
        args.probe && !args.pilot
          ? requested.at(-1)?.id ?? args.afterId
          : args.afterId,
      remainingAfterBatch: eligible.filter((station) =>
        station.id >
        (args.probe && !args.pilot
          ? requested.at(-1)?.id ?? args.afterId
          : args.afterId),
      ).length,
    },
    requestLoadAccounting: load,
    observedProbePerformance: {
      evidenceRows: latestEvidence.length,
      successRate:
        latestEvidence.filter((row) => row.outcome === "usable_pair").length /
        Math.max(1, latestEvidence.length),
      errorRate:
        latestEvidence.filter((row) => row.outcome === "unreachable").length /
        Math.max(1, latestEvidence.length),
      latencyMs: {
        median: percentile(0.5),
        p95: percentile(0.95),
      },
      externalRequestUpperBound: latestEvidence.reduce(
        (sum, row) => sum + (row.requestCountUpperBound ?? 0),
        0,
      ),
      byRequestedOrigin: cumulativeByRequestedOrigin,
    },
    limitations: [
      "A single live observation proves useful metadata, not completeness or continuous availability.",
      "Transient failures remain in the upper bound until rechecked in another time window.",
      "The once-per-station daily guard is based on this append-only audit evidence file.",
      "Host counts use stream origins and may group several stations behind one provider.",
    ],
    stations: rows,
  };
  await mkdir(dirname(args.reportPath), { recursive: true });
  await writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    report: args.reportPath,
    evidence: args.evidencePath,
    eligible: eligible.length,
    exclusions,
    bounds: report.bounds,
    batch: report.batch,
    requestLoadAccounting: load,
  }, null, 2));
}

if (process.env["NODE_ENV"] !== "test") {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}