import {
  db,
  scrapedShowExceptionsTable,
  scrapedShowsTable,
  stationsTable,
} from "@workspace/db";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import {
  SCHEDULE_FAILURE_REASONS,
  scrapeStationSchedule,
  type ScheduleFailureReason,
} from "./schedule-scraper.js";
import { wireScheduleExtractor } from "./schedule-wire.js";

export const SCHEDULE_COVERAGE_BATCH_LIMIT = 10;

type BacklogTarget = {
  id: number;
  slug: string;
  homepageUrl: string;
  scheduleUrl: string | null;
  city: string | null;
  country: string | null;
  ianaTimezone: string | null;
};

export type ScheduleCoverageReasonTotals = Record<
  ScheduleFailureReason | "successful" | "unclassified",
  number
>;

export type ScheduleCoverageBatchResult = {
  processed: number;
  reasonTotals: ScheduleCoverageReasonTotals;
  nextAfterId: number | null;
  remaining: number;
};

let batchRunning = false;

function emptyReasonTotals(): ScheduleCoverageReasonTotals {
  return Object.fromEntries(
    [...SCHEDULE_FAILURE_REASONS, "successful", "unclassified"].map((reason) => [reason, 0]),
  ) as ScheduleCoverageReasonTotals;
}

export function summarizeScheduleCoverageBatch(
  rows: Array<{
    scheduleScrapedAt: Date | null;
    reason: ScheduleFailureReason | null;
  }>,
): ScheduleCoverageReasonTotals {
  const totals = emptyReasonTotals();
  for (const row of rows) {
    if (row.scheduleScrapedAt) totals.successful++;
    else totals[row.reason ?? "unclassified"]++;
  }
  return totals;
}

const backlogPredicate = and(
  eq(stationsTable.active, true),
  eq(stationsTable.hidden, false),
  isNotNull(stationsTable.homepageUrl),
  isNotNull(stationsTable.scheduleAttemptedAt),
  isNull(stationsTable.scheduleScrapedAt),
  isNull(stationsTable.scheduleFailureReason),
  sql`not exists (
    select 1 from ${scrapedShowsTable}
    where ${scrapedShowsTable.stationId} = ${stationsTable.id}
      and ${scrapedShowsTable.voidedAt} is null
  )`,
  sql`not exists (
    select 1 from ${scrapedShowExceptionsTable}
    where ${scrapedShowExceptionsTable.stationId} = ${stationsTable.id}
  )`,
);

async function countRemaining(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stationsTable)
    .where(backlogPredicate);
  return row?.count ?? 0;
}

export async function getScheduleCoverageBacklogHealth(): Promise<{
  remaining: number;
  running: boolean;
  batchLimit: number;
}> {
  return {
    remaining: await countRemaining(),
    running: batchRunning,
    batchLimit: SCHEDULE_COVERAGE_BATCH_LIMIT,
  };
}

export async function runScheduleCoverageBacklogBatch(
  afterId = 0,
): Promise<ScheduleCoverageBatchResult | null> {
  if (batchRunning) return null;
  batchRunning = true;
  try {
    const selected = await db
      .select({
        id: stationsTable.id,
        slug: stationsTable.slug,
        homepageUrl: stationsTable.homepageUrl,
        scheduleUrl: stationsTable.scheduleUrl,
        city: stationsTable.city,
        country: stationsTable.country,
        ianaTimezone: stationsTable.ianaTimezone,
      })
      .from(stationsTable)
      .where(and(backlogPredicate, gt(stationsTable.id, afterId)))
      .orderBy(asc(stationsTable.id))
      .limit(SCHEDULE_COVERAGE_BATCH_LIMIT);

    const targets = selected.filter(
      (row): row is BacklogTarget => row.homepageUrl !== null,
    );
    if (targets.length > 0) await wireScheduleExtractor();
    for (const target of targets) {
      await scrapeStationSchedule(target);
    }

    let reasonTotals = emptyReasonTotals();
    if (targets.length > 0) {
      const refreshed = await db
        .select({
          scheduleScrapedAt: stationsTable.scheduleScrapedAt,
          reason: stationsTable.scheduleFailureReason,
        })
        .from(stationsTable)
        .where(sql`${stationsTable.id} = any(array[${sql.join(
          targets.map((target) => sql`${target.id}`),
          sql`, `,
        )}]::integer[])`);
      reasonTotals = summarizeScheduleCoverageBatch(refreshed);
    }

    return {
      processed: targets.length,
      reasonTotals,
      nextAfterId: targets.length > 0 ? targets[targets.length - 1]!.id : null,
      remaining: await countRemaining(),
    };
  } finally {
    batchRunning = false;
  }
}
