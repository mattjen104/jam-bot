import {
  db,
  attendanceTable,
  libraryItemsTable,
  recordingsTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getReplayManifest } from "./replay.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WeeklyWindow {
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
  timezone: "UTC";
}

export interface WeeklyRecap {
  week: {
    startDate: string;
    endDate: string;
    endDateExclusive: string;
    timezone: "UTC";
  };
  available: true;
  stationsAttended: {
    count: number;
    stations: Array<{ slug: string; name: string }>;
  };
  firstEverHeards: {
    count: number;
    items: Array<{
      mbid: string;
      title: string;
      artist: string;
      station: { slug: string; name: string };
      heardAt: string;
    }>;
  };
  ripenedCrossings: {
    count: number;
    items: Array<{
      mbid: string;
      title: string;
      artist: string;
      station: { slug: string; name: string };
      ripenedAt: string;
    }>;
  };
  missedGhostReplay: {
    replayId: number;
    date: string;
    station: { slug: string; name: string };
    show: { name: string; djName: string | null } | null;
  } | null;
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || dateString(date) !== value ? null : date;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Lore's recap clock is deliberately UTC. A recap is a Sunday-to-Saturday
 * archive window, and the exclusive end is the following Sunday at 00:00Z.
 * Keeping the boundary in one explicit timezone prevents station timezones
 * from making a listener's week change halfway through the recap.
 */
export function getCompletedWeekWindow(
  now = new Date(),
  requestedStartDate?: string,
): WeeklyWindow | null {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) return null;

  let start: Date;
  if (requestedStartDate !== undefined) {
    const requested = parseDateOnly(requestedStartDate);
    if (!requested || requested.getUTCDay() !== 0) return null;
    start = requested;
  } else {
    const currentDayStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ));
    start = new Date(currentDayStart.getTime() - currentDayStart.getUTCDay() * DAY_MS - 7 * DAY_MS);
  }

  const end = new Date(start.getTime() + 7 * DAY_MS);
  // Never expose an incomplete Sunday-to-Saturday window, including when a
  // caller guesses a future week or the current Sunday before midnight.
  if (end.getTime() > nowMs) return null;

  return {
    start,
    end,
    startDate: dateString(start),
    endDate: dateString(new Date(end.getTime() - DAY_MS)),
    timezone: "UTC",
  };
}

type StationRow = { slug: string; name: string };
type FirstHeardRow = {
  mbid: string;
  title: string;
  artist: string;
  station_slug: string;
  station_name: string;
  heard_at: Date;
};
type RipenedRow = {
  mbid: string;
  title: string;
  artist: string;
  station_slug: string;
  station_name: string;
  ripened_at: Date;
};
type ReplayCandidateRow = {
  replay_id: number;
  replay_date: string;
  station_slug: string;
  station_name: string;
};

/**
 * Build the recap from confirmed attendance only. The attendance table is
 * already deduplicated per (listener, spin), while rollup_counted is the
 * maintained dwell-gate marker; raw heartbeat/session rows never enter this
 * read model.
 */
export async function getWeeklyRecap(
  userId: number,
  window: WeeklyWindow,
): Promise<WeeklyRecap> {
  const [stationRows, firstHeardResult, ripenedResult, replayResult] = await Promise.all([
    db
      .selectDistinct({
        slug: stationsTable.slug,
        name: stationsTable.name,
      })
      .from(attendanceTable)
      .innerJoin(spinsTable, eq(attendanceTable.spinId, spinsTable.id))
      .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
      .where(and(
        eq(attendanceTable.userId, userId),
        eq(attendanceTable.rollupCounted, true),
        sql`${spinsTable.playedAt} >= ${window.start}`,
        sql`${spinsTable.playedAt} < ${window.end}`,
        eq(stationsTable.hidden, false),
      ))
      .orderBy(stationsTable.name, stationsTable.slug),
    db.execute<FirstHeardRow>(sql`
      SELECT DISTINCT ON (s.mbid)
        s.mbid,
        r.title,
        r.artist,
        st.slug AS station_slug,
        st.name AS station_name,
        s.played_at AS heard_at
      FROM attendance a
      JOIN spins s ON s.id = a.spin_id
      JOIN recordings r ON r.mbid = s.mbid
      JOIN stations st ON st.id = s.station_id
      WHERE a.user_id = ${userId}
        AND a.rollup_counted = true
        AND s.mbid IS NOT NULL
        AND s.played_at >= ${window.start}
        AND s.played_at < ${window.end}
        AND st.hidden = false
        AND NOT EXISTS (
          SELECT 1
          FROM attendance earlier_a
          JOIN spins earlier_s ON earlier_s.id = earlier_a.spin_id
          WHERE earlier_a.user_id = a.user_id
            AND earlier_a.rollup_counted = true
            AND earlier_s.mbid = s.mbid
            AND earlier_s.played_at < ${window.start}
        )
      ORDER BY s.mbid, s.played_at, s.id
    `),
    db.execute<RipenedRow>(sql`
      SELECT DISTINCT ON (li.mbid)
        li.mbid,
        r.title,
        r.artist,
        st.slug AS station_slug,
        st.name AS station_name,
        li.added_at AS ripened_at
      FROM library_items li
      JOIN recordings r ON r.mbid = li.mbid
      JOIN attendance a ON a.user_id = li.user_id AND a.rollup_counted = true
      JOIN spins s ON s.id = a.spin_id AND s.mbid = li.mbid
      JOIN stations st ON st.id = s.station_id
      WHERE li.user_id = ${userId}
        AND li.added_at >= ${window.start}
        AND li.added_at < ${window.end}
        AND s.played_at >= ${window.start}
        AND s.played_at < ${window.end}
        AND s.played_at < li.added_at
        AND st.hidden = false
        AND EXISTS (
          SELECT 1
          FROM attendance prior_a
          JOIN spins prior_s ON prior_s.id = prior_a.spin_id
          JOIN recordings prior_r ON prior_r.mbid = prior_s.mbid
          WHERE prior_a.user_id = li.user_id
            AND prior_a.rollup_counted = true
            AND prior_s.mbid <> li.mbid
            AND prior_r.artist_mbid IS NOT NULL
            AND prior_r.artist_mbid = r.artist_mbid
            AND prior_s.played_at < li.added_at
        )
      ORDER BY li.mbid, li.added_at, s.played_at, s.id
    `),
    db.execute<ReplayCandidateRow>(sql`
      WITH candidate_spins AS (
        SELECT DISTINCT
          s.id,
          s.station_id,
          s.show_id,
          s.played_at,
          to_char(s.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS replay_date
        FROM spins s
        JOIN recordings r ON r.mbid = s.mbid
        JOIN library_items li_artist ON li_artist.user_id = ${userId}
        JOIN recordings library_artist
          ON library_artist.mbid = li_artist.mbid
         AND library_artist.artist_mbid = r.artist_mbid
        JOIN stations st ON st.id = s.station_id
        WHERE s.mbid IS NOT NULL
          AND s.played_at >= ${window.start}
          AND s.played_at < ${window.end}
          AND st.hidden = false
          AND NOT EXISTS (
            SELECT 1
            FROM attendance heard_a
            JOIN spins heard_s ON heard_s.id = heard_a.spin_id
            WHERE heard_a.user_id = ${userId}
              AND heard_a.rollup_counted = true
              AND heard_s.station_id = s.station_id
          )
      ),
      partitions AS (
        SELECT DISTINCT station_id, show_id, replay_date
        FROM candidate_spins
      ),
      anchors AS (
        SELECT
          p.station_id,
          p.show_id,
          p.replay_date,
          min(s.id) AS replay_id
        FROM partitions p
        JOIN spins s
          ON s.station_id = p.station_id
         AND s.show_id IS NOT DISTINCT FROM p.show_id
         AND to_char(s.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = p.replay_date
        GROUP BY p.station_id, p.show_id, p.replay_date
      ),
      chosen AS (
        SELECT
          a.replay_id,
          a.replay_date,
          a.station_id,
          a.show_id,
          min(c.played_at) AS played_at
        FROM candidate_spins c
        JOIN anchors a
          ON a.station_id = c.station_id
         AND a.show_id IS NOT DISTINCT FROM c.show_id
         AND a.replay_date = c.replay_date
        GROUP BY a.replay_id, a.replay_date, a.station_id, a.show_id
      )
      SELECT
        chosen.replay_id,
        chosen.replay_date,
        st.slug AS station_slug,
        st.name AS station_name
      FROM chosen
      JOIN stations st ON st.id = chosen.station_id
      ORDER BY chosen.played_at, chosen.replay_id
      LIMIT 1
    `),
  ]);

  let missedGhostReplay: WeeklyRecap["missedGhostReplay"] = null;
  const candidate = replayResult.rows[0];
  if (candidate) {
    const manifest = await getReplayManifest(candidate.replay_id);
    if (manifest) {
      missedGhostReplay = {
        replayId: manifest.replayId,
        date: manifest.bounds.date,
        station: manifest.station,
        show: manifest.show,
      };
    }
  }

  const firstHeards = firstHeardResult.rows
    .sort((a, b) => asDate(a.heard_at).getTime() - asDate(b.heard_at).getTime() || a.mbid.localeCompare(b.mbid))
    .map((row) => ({
      mbid: row.mbid,
      title: row.title,
      artist: row.artist,
      station: { slug: row.station_slug, name: row.station_name },
      heardAt: asDate(row.heard_at).toISOString(),
    }));
  const ripened = ripenedResult.rows
    .sort((a, b) => asDate(a.ripened_at).getTime() - asDate(b.ripened_at).getTime() || a.mbid.localeCompare(b.mbid))
    .map((row) => ({
      mbid: row.mbid,
      title: row.title,
      artist: row.artist,
      station: { slug: row.station_slug, name: row.station_name },
      ripenedAt: asDate(row.ripened_at).toISOString(),
    }));

  return {
    week: {
      startDate: window.startDate,
      endDate: window.endDate,
      endDateExclusive: dateString(window.end),
      timezone: window.timezone,
    },
    available: true,
    stationsAttended: {
      count: stationRows.length,
      stations: stationRows,
    },
    firstEverHeards: { count: firstHeards.length, items: firstHeards },
    ripenedCrossings: { count: ripened.length, items: ripened },
    missedGhostReplay,
  };
}