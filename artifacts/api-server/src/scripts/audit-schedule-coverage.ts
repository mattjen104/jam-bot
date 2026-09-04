/* eslint-disable no-console -- this file is a command-line audit report */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  db,
  scrapedShowExceptionsTable,
  scrapedShowsTable,
  stationQualityTable,
  stationsTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  auditSoundtapIdentity,
  parseSoundtapStations,
} from "./audit-soundtap-schedules.js";
import { scrapeStationSchedule } from "../lore/schedule-scraper.js";
import { wireScheduleExtractor } from "../lore/schedule-wire.js";

const SOUNDTAP_SOURCE = fileURLToPath(
  new URL("../../../../research/sources/soundtap-home.md", import.meta.url),
);
const REPORT_PATH = fileURLToPath(
  new URL("../../../../research/lore-schedule-coverage.json", import.meta.url),
);
const FRESH_DAYS = 14;
const DEFAULT_REFRESH_LIMIT = 10;

export type CoverageArgs = {
  refresh: boolean;
  includeHidden: boolean;
  limit: number | null;
  offset: number;
  write: boolean;
};

export function parseCoverageArgs(args: string[]): CoverageArgs {
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const offsetArg = args.find((arg) => arg.startsWith("--offset="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null;
  const offset = offsetArg ? Number(offsetArg.slice("--offset=".length)) : 0;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("--offset must be a non-negative integer");
  }
  return {
    refresh: args.includes("--refresh"),
    includeHidden: args.includes("--include-hidden"),
    limit,
    offset,
    write: args.includes("--write"),
  };
}

export type ScheduleCoverageStatus =
  | "populated_current"
  | "populated_stale"
  | "valid_empty"
  | "attempted_without_success"
  | "never_attempted";

export function classifyScheduleCoverage(
  showCount: number,
  scrapedAt: Date | null,
  attemptedAt: Date | null,
  now: Date,
): ScheduleCoverageStatus {
  if (showCount > 0) {
    return scrapedAt &&
      now.getTime() - scrapedAt.getTime() <= FRESH_DAYS * 86_400_000
      ? "populated_current"
      : "populated_stale";
  }
  if (scrapedAt) return "valid_empty";
  if (attemptedAt) return "attempted_without_success";
  return "never_attempted";
}

type LoreStation = {
  id: number;
  slug: string;
  name: string;
  org: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  streamUrl: string | null;
  homepageUrl: string | null;
  scheduleUrl: string | null;
  active: boolean;
  hidden: boolean;
  scheduleScrapedAt: Date | null;
  scheduleAttemptedAt: Date | null;
  lastAliveAt: Date | null;
  qualityTier: string | null;
  sampleCount: number | null;
  mbidResolutionRate: number | null;
  config: Record<string, unknown> | null;
};

type ScheduleFact = {
  recurringCount: number;
  datedCount: number;
  showNames: Set<string>;
  sourceUrls: Set<string>;
};

function emptyFact(): ScheduleFact {
  return {
    recurringCount: 0,
    datedCount: 0,
    showNames: new Set(),
    sourceUrls: new Set(),
  };
}

async function loadScheduleFacts(stationIds: number[]): Promise<Map<number, ScheduleFact>> {
  const facts = new Map(stationIds.map((id) => [id, emptyFact()]));
  if (!stationIds.length) return facts;
  const ids = sql.join(stationIds.map((id) => sql`${id}`), sql`, `);
  const [recurring, dated] = await Promise.all([
    db
      .select({
        stationId: scrapedShowsTable.stationId,
        showName: scrapedShowsTable.showName,
        sourceUrl: scrapedShowsTable.sourceUrl,
      })
      .from(scrapedShowsTable)
      .where(sql`${scrapedShowsTable.stationId} = any(array[${ids}]::integer[])
        and ${scrapedShowsTable.voidedAt} is null`),
    db
      .select({
        stationId: scrapedShowExceptionsTable.stationId,
        showName: scrapedShowExceptionsTable.showName,
        sourceUrl: scrapedShowExceptionsTable.sourceUrl,
      })
      .from(scrapedShowExceptionsTable)
      .where(sql`${scrapedShowExceptionsTable.stationId} = any(array[${ids}]::integer[])`),
  ]);
  for (const row of recurring) {
    const fact = facts.get(row.stationId);
    if (!fact) continue;
    fact.recurringCount++;
    fact.showNames.add(row.showName.toLocaleLowerCase());
    fact.sourceUrls.add(row.sourceUrl);
  }
  for (const row of dated) {
    const fact = facts.get(row.stationId);
    if (!fact) continue;
    fact.datedCount++;
    fact.showNames.add(row.showName.toLocaleLowerCase());
    fact.sourceUrls.add(row.sourceUrl);
  }
  return facts;
}

function countByStatus(rows: Array<{ status: ScheduleCoverageStatus }>) {
  return rows.reduce<Record<ScheduleCoverageStatus, number>>(
    (counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    },
    {
      populated_current: 0,
      populated_stale: 0,
      valid_empty: 0,
      attempted_without_success: 0,
      never_attempted: 0,
    },
  );
}

function coverageSort(
  a: { status: ScheduleCoverageStatus; scheduleAttemptedAt: Date | null; name: string },
  b: { status: ScheduleCoverageStatus; scheduleAttemptedAt: Date | null; name: string },
): number {
  const priority: Record<ScheduleCoverageStatus, number> = {
    never_attempted: 0,
    attempted_without_success: 1,
    valid_empty: 2,
    populated_stale: 3,
    populated_current: 4,
  };
  return (
    priority[a.status] - priority[b.status] ||
    (a.scheduleAttemptedAt?.getTime() ?? 0) - (b.scheduleAttemptedAt?.getTime() ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

async function main(): Promise<void> {
  const args = parseCoverageArgs(process.argv.slice(2));
  const now = new Date();
  const [soundtap, lore] = await Promise.all([
    readFile(SOUNDTAP_SOURCE, "utf8").then(parseSoundtapStations),
    db
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
        scheduleScrapedAt: stationsTable.scheduleScrapedAt,
        scheduleAttemptedAt: stationsTable.scheduleAttemptedAt,
        lastAliveAt: stationsTable.lastAliveAt,
        qualityTier: stationQualityTable.qualityTier,
        sampleCount: stationQualityTable.sampleCount,
        mbidResolutionRate: stationQualityTable.mbidResolutionRate,
        config: stationsTable.nowPlayingConfig,
      })
      .from(stationsTable)
      .leftJoin(stationQualityTable, eq(stationQualityTable.stationId, stationsTable.id)),
  ]);

  const eligible = lore.filter(
    (station) =>
      station.active &&
      (args.includeHidden || !station.hidden) &&
      station.homepageUrl !== null,
  ) as LoreStation[];
  const excluded = {
    inactive: lore.filter((station) => !station.active).length,
    hidden: lore.filter((station) => station.active && station.hidden).length,
    withoutHomepage: lore.filter((station) => station.active && !station.homepageUrl).length,
  };
  const facts = await loadScheduleFacts(eligible.map((station) => station.id));
  const identity = auditSoundtapIdentity(soundtap, lore);
  const verifiedById = new Map<number, string[]>();
  const brandedById = new Map<number, string[]>();
  const ambiguousById = new Map<number, string[]>();
  for (const match of identity.shared) {
    const values = verifiedById.get(match.station.id) ?? [];
    values.push(match.soundtap.slug);
    verifiedById.set(match.station.id, values);
  }
  for (const match of identity.branded) {
    const values = brandedById.get(match.station.id) ?? [];
    values.push(match.soundtap.slug);
    brandedById.set(match.station.id, values);
  }
  for (const entry of identity.ambiguous) {
    for (const candidate of entry.candidates) {
      const values = ambiguousById.get(candidate.station.id) ?? [];
      values.push(entry.soundtap.slug);
      ambiguousById.set(candidate.station.id, values);
    }
  }

  const rows = eligible.map((station) => {
    const fact = facts.get(station.id) ?? emptyFact();
    const showCount = fact.recurringCount + fact.datedCount;
    const status = classifyScheduleCoverage(
      showCount,
      station.scheduleScrapedAt,
      station.scheduleAttemptedAt,
      now,
    );
    const verified = verifiedById.get(station.id) ?? [];
    const branded = brandedById.get(station.id) ?? [];
    const ambiguous = ambiguousById.get(station.id) ?? [];
    return {
      id: station.id,
      slug: station.slug,
      name: station.name,
      org: station.org,
      country: station.country,
      city: station.city,
      region: station.region,
      active: station.active,
      hidden: station.hidden,
      homepageUrl: station.homepageUrl,
      scheduleUrl: station.scheduleUrl,
      qualityTier: station.qualityTier,
      streamHealthy: !!station.lastAliveAt,
      schedule: {
        status,
        recurringCount: fact.recurringCount,
        datedCount: fact.datedCount,
        totalCount: showCount,
        uniqueShowNames: fact.showNames.size,
        sourceUrls: [...fact.sourceUrls].sort(),
        scrapedAt: station.scheduleScrapedAt,
        attemptedAt: station.scheduleAttemptedAt,
      },
      soundtap: {
        kind: verified.length
          ? "verified"
          : branded.length
            ? "branded"
            : ambiguous.length
              ? "ambiguous"
              : "none",
        verifiedSlugs: verified,
        brandedSlugs: branded,
        ambiguousSlugs: ambiguous,
      },
    };
  }).sort(coverageSort);

  let refreshResults: Array<Record<string, unknown>> = [];
  const refreshLimit = args.limit ?? DEFAULT_REFRESH_LIMIT;
  const selected = args.refresh ? rows.slice(args.offset, args.offset + refreshLimit) : [];
  if (args.refresh && selected.length) {
    await wireScheduleExtractor();
    refreshResults = [];
    for (const row of selected) {
      const station = eligible.find((candidate) => candidate.id === row.id)!;
      try {
        const result = await scrapeStationSchedule({
          id: station.id,
          slug: station.slug,
          homepageUrl: station.homepageUrl!,
          scheduleUrl: station.scheduleUrl,
          city: station.city,
          country: station.country,
          ianaTimezone: null,
        });
        refreshResults.push({
          id: station.id,
          slug: station.slug,
          scraped: result.scraped,
          showCount: result.showCount,
          error: null,
        });
      } catch (error) {
        refreshResults.push({
          id: station.id,
          slug: station.slug,
          scraped: false,
          showCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Read facts and timestamps again so the report describes the post-refresh
    // state, not the pre-refresh selection snapshot.
    const refreshed = await db
      .select({
        id: stationsTable.id,
        scheduleScrapedAt: stationsTable.scheduleScrapedAt,
        scheduleAttemptedAt: stationsTable.scheduleAttemptedAt,
      })
      .from(stationsTable)
      .where(sql`${stationsTable.id} = any(array[${sql.join(
        selected.map((row) => sql`${row.id}`),
        sql`, `,
      )}]::integer[])`);
    const refreshedById = new Map(refreshed.map((station) => [station.id, station]));
    const refreshedFacts = await loadScheduleFacts(selected.map((row) => row.id));
    for (const row of rows) {
      const timestamp = refreshedById.get(row.id);
      const fact = refreshedFacts.get(row.id);
      if (!timestamp || !fact) continue;
      row.schedule.recurringCount = fact.recurringCount;
      row.schedule.datedCount = fact.datedCount;
      row.schedule.totalCount = fact.recurringCount + fact.datedCount;
      row.schedule.uniqueShowNames = fact.showNames.size;
      row.schedule.sourceUrls = [...fact.sourceUrls].sort();
      row.schedule.scrapedAt = timestamp.scheduleScrapedAt;
      row.schedule.attemptedAt = timestamp.scheduleAttemptedAt;
      row.schedule.status = classifyScheduleCoverage(
        row.schedule.totalCount,
        timestamp.scheduleScrapedAt,
        timestamp.scheduleAttemptedAt,
        now,
      );
    }
  }

  const report = {
    generatedAt: now.toISOString(),
    methodology: {
      eligibleStable:
        "By default, stable means active, visible, and homepage-backed. Use --include-hidden to inspect active hidden stations.",
      schedule:
        "Recurring rows and dated exceptions are counted separately. A failed attempt never counts as a valid empty schedule.",
      freshness: `A populated schedule is current for ${FRESH_DAYS} days after its last successful scrape.`,
      identity:
        "Soundtap labels are annotations only: verified, branded, ambiguous, or none. No Soundtap URL is used as a Lore scrape target.",
    },
    inventory: {
      loreTotal: lore.length,
      eligible: eligible.length,
      excluded,
      soundtapStations: soundtap.length,
    },
    soundtapOverlap: {
      verifiedStations: new Set(identity.shared.map((match) => match.station.id)).size,
      brandedStations: new Set(identity.branded.map((match) => match.station.id)).size,
      ambiguousStations: ambiguousById.size,
      verifiedWithSchedules: rows.filter(
        (row) => row.soundtap.kind === "verified" && row.schedule.totalCount > 0,
      ).length,
    },
    coverage: {
      stationStatus: countByStatus(rows),
      stationsWithAnySchedule: rows.filter((row) => row.schedule.totalCount > 0).length,
      recurringSlots: rows.reduce((sum, row) => sum + row.schedule.recurringCount, 0),
      datedSlots: rows.reduce((sum, row) => sum + row.schedule.datedCount, 0),
      totalSlots: rows.reduce((sum, row) => sum + row.schedule.totalCount, 0),
      uniqueShowNames: new Set(
        rows.flatMap((row) => row.schedule.sourceUrls.length ? [row.id] : []),
      ).size,
    },
    refresh: {
      enabled: args.refresh,
      limit: args.refresh ? refreshLimit : null,
      offset: args.refresh ? args.offset : null,
      selectedTargets: selected.map((row) => row.slug),
      results: refreshResults,
    },
    stations: rows,
  };
  if (args.write) await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    inventory: report.inventory,
    soundtapOverlap: report.soundtapOverlap,
    coverage: report.coverage,
    refresh: report.refresh,
    wrote: args.write ? REPORT_PATH : null,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}