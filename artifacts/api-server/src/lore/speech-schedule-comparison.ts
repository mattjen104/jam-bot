import { normalizeAttributionName } from "@workspace/lore-attribution";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type ScheduleComparison = "supporting" | "contradictory" | "inconclusive";

export interface ActiveScheduleEntry extends Record<string, unknown> {
  showName: string;
  djName: string | null;
  sourceUrl: string;
  extraction: string;
  scheduleKind: "official_exception" | "scraped_recurring";
}

/**
 * Read the active schedule at the supplied instant. Date-specific official
 * exceptions take precedence, then the recurring scraped grid uses the same
 * timezone and overnight matching as spin show attribution. This is evidence
 * lookup only; it never writes schedules, shows, or spins.
 */
export async function lookupActiveScheduleEntry(
  stationId: number,
  ianaTimezone: string | null,
  at: Date,
): Promise<ActiveScheduleEntry | null> {
  if (!ianaTimezone) return null;
  try {
    const result = await db.execute<ActiveScheduleEntry>(sql`
      WITH local_clock AS (
        SELECT ${at.toISOString()}::timestamptz AT TIME ZONE ${ianaTimezone} AS value
      )
      SELECT show_name AS "showName", dj_name AS "djName", source_url AS "sourceUrl",
        extraction, 'official_exception'::text AS "scheduleKind", 1 AS priority
      FROM scraped_show_exceptions, local_clock
      WHERE station_id = ${stationId}
        AND air_date = local_clock.value::date
        AND (
          (end_time > start_time AND local_clock.value::time >= start_time::time AND local_clock.value::time < end_time::time)
          OR (end_time < start_time AND local_clock.value::time >= start_time::time)
        )
      UNION ALL
      SELECT show_name, dj_name, source_url, extraction, 'official_exception'::text, 1
      FROM scraped_show_exceptions, local_clock
      WHERE station_id = ${stationId}
        AND air_date = (local_clock.value::date - 1)
        AND end_time < start_time
        AND local_clock.value::time < end_time::time
      UNION ALL
      SELECT show_name, dj_name, source_url, extraction, 'scraped_recurring'::text, 2
      FROM scraped_shows, local_clock
      WHERE station_id = ${stationId} AND voided_at IS NULL
        AND day_of_week = TO_CHAR(local_clock.value, 'Dy')
        AND (
          (end_time > start_time AND local_clock.value::time >= start_time::time AND local_clock.value::time < end_time::time)
          OR (end_time < start_time AND local_clock.value::time >= start_time::time)
        )
      UNION ALL
      SELECT show_name, dj_name, source_url, extraction, 'scraped_recurring'::text, 2
      FROM scraped_shows, local_clock
      WHERE station_id = ${stationId} AND voided_at IS NULL
        AND end_time < start_time
        AND day_of_week = TO_CHAR(local_clock.value - interval '1 day', 'Dy')
        AND local_clock.value::time < end_time::time
      ORDER BY priority, "showName"
      LIMIT 1
    `);
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Read-only comparison: no schedule records are created or modified. */
export function compareTranscriptToSchedule(
  transcriptValue: string,
  scheduledValue: string | null | undefined,
): ScheduleComparison {
  const heard = normalizeAttributionName(transcriptValue);
  const scheduled = normalizeAttributionName(scheduledValue);
  if (!heard || !scheduled) return "inconclusive";
  if (heard === scheduled || heard.includes(scheduled) || scheduled.includes(heard)) return "supporting";
  return "contradictory";
}

export interface IcyScheduleCorroboration {
  outcome: "supporting" | "inconclusive";
  matchedField: "show" | "dj" | null;
}

/**
 * An ICY candidate can corroborate the schedule active at the same station and
 * instant, but disagreement is not contradictory: ICY strings are untrusted
 * and may be station labels or other non-program text.
 */
export function compareIcyCandidateToSchedule(
  rawStreamTitle: string,
  schedule: Pick<ActiveScheduleEntry, "showName" | "djName"> | null,
): IcyScheduleCorroboration {
  if (!schedule) return { outcome: "inconclusive", matchedField: null };
  if (
    compareTranscriptToSchedule(rawStreamTitle, schedule.showName) === "supporting"
  ) {
    return { outcome: "supporting", matchedField: "show" };
  }
  if (
    schedule.djName &&
    compareTranscriptToSchedule(rawStreamTitle, schedule.djName) === "supporting"
  ) {
    return { outcome: "supporting", matchedField: "dj" };
  }
  return { outcome: "inconclusive", matchedField: null };
}