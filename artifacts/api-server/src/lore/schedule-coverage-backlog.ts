import {
  db,
  scrapedShowExceptionsTable,
  scrapedShowsTable,
  stationsTable,
} from "@workspace/db";
import { and, asc, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  SCHEDULE_STALE_AFTER_MS,
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

export type StaleScheduleCalendar = {
  stationId: number;
  slug: string;
  stationName: string;
  scheduleUrl: string;
  lastSuccessfulScrapeAt: string;
  failureReason: ScheduleFailureReason | null;
  failureAt: string | null;
  status: "awaiting_refresh" | "transient_failure" | "unavailable";
};

let batchRunning = false;

const UNAVAILABLE_FAILURE_REASONS = new Set<ScheduleFailureReason>([
  "policy_blocked",
  "source_unavailable",
  "missing_schedule_link",
  "malformed_schedule",
]);

export function scheduleCalendarFailureStatus(
  reason: ScheduleFailureReason | null,
): StaleScheduleCalendar["status"] {
  if (reason === null) return "awaiting_refresh";
  return UNAVAILABLE_FAILURE_REASONS.has(reason)
    ? "unavailable"
    : "transient_failure";
}

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
  staleAfterMs: number;
  staleCalendars: StaleScheduleCalendar[];
}> {
  const staleCutoff = new Date(Date.now() - SCHEDULE_STALE_AFTER_MS);
  const staleRows = await db
    .select({
      stationId: stationsTable.id,
      slug: stationsTable.slug,
      stationName: stationsTable.name,
      scheduleUrl: stationsTable.scheduleUrl,
      scheduleScrapedAt: stationsTable.scheduleScrapedAt,
      failureReason: stationsTable.scheduleFailureReason,
      failureAt: stationsTable.scheduleFailureAt,
    })
    .from(stationsTable)
    .where(and(
      eq(stationsTable.active, true),
      eq(stationsTable.hidden, false),
      isNotNull(stationsTable.scheduleUrl),
      isNotNull(stationsTable.scheduleScrapedAt),
      lt(stationsTable.scheduleScrapedAt, staleCutoff),
    ))
    .orderBy(asc(stationsTable.scheduleScrapedAt));

  return {
    remaining: await countRemaining(),
    running: batchRunning,
    batchLimit: SCHEDULE_COVERAGE_BATCH_LIMIT,
    staleAfterMs: SCHEDULE_STALE_AFTER_MS,
    staleCalendars: staleRows.flatMap((row) => {
      if (!row.scheduleUrl || !row.scheduleScrapedAt) return [];
      return [{
        stationId: row.stationId,
        slug: row.slug,
        stationName: row.stationName,
        scheduleUrl: row.scheduleUrl,
        lastSuccessfulScrapeAt: row.scheduleScrapedAt.toISOString(),
        failureReason: row.failureReason,
        failureAt: row.failureAt?.toISOString() ?? null,
        status: scheduleCalendarFailureStatus(row.failureReason),
      }];
    }),
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
