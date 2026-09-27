import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  GetLoreStationRecommendationsQueryParams,
  GetLoreStationRecommendationsResponse,
} from "@workspace/api-zod";
import { h } from "../../middlewares/asyncHandler.js";

const router: IRouter = Router();
const SPIN_SAMPLE_CAP = 50_000;

router.get("/recommendations/stations", h(async (req, res) => {
  const parsed = GetLoreStationRecommendationsQueryParams.safeParse(req.query);
  if (!parsed.success || parsed.data.q.trim().length === 0) {
    res.status(400).json({ error: "Provide an artist or genre query up to 100 characters" });
    return;
  }

  const kind = parsed.data.kind;
  const query = parsed.data.q.trim();
  const limit = parsed.data.limit ?? 10;
  const matchPredicate = kind === "artist"
    ? sql`(
        (s.mbid IS NOT NULL AND lower(trim(r.artist)) = lower(${query}))
        OR
        (s.mbid IS NULL AND lower(trim(s.raw_artist)) = lower(${query}))
      )`
    : sql`EXISTS (
        SELECT 1
        FROM unnest(r.genres) AS genre_name
        WHERE lower(trim(genre_name)) = lower(${query})
      )`;

  const result = await db.execute<{
    sampledSpinCount: number;
    sampledThrough: Date | string | null;
    slug: string | null;
    name: string | null;
    stationClass: string | null;
    spinCount30d: number | null;
    spinCount90d: number | null;
    latestSpinAt: Date | string | null;
  }>(sql`
    WITH bounded_spins AS MATERIALIZED (
      SELECT
        sp.id,
        sp.station_id,
        sp.mbid,
        sp.raw_artist,
        sp.played_at
      FROM spins sp
      WHERE sp.played_at >= now() - interval '90 days'
      ORDER BY sp.played_at DESC, sp.id DESC
      LIMIT ${SPIN_SAMPLE_CAP}
    ),
    sampled_spins AS MATERIALIZED (
      SELECT
        b.id,
        b.station_id,
        b.mbid,
        b.raw_artist,
        b.played_at,
        st.slug,
        st.name,
        st.station_class
      FROM bounded_spins b
      JOIN stations st ON st.id = b.station_id
        AND st.active = true
        AND st.hidden = false
    ),
    sample_stats AS (
      SELECT
        count(*)::int AS sampled_spin_count,
        min(played_at) AS sampled_through
      FROM bounded_spins
    ),
    station_matches AS (
      SELECT
        s.station_id,
        s.slug,
        s.name,
        s.station_class,
        count(*) FILTER (
          WHERE s.played_at >= now() - interval '30 days'
        )::int AS spin_count_30d,
        count(*)::int AS spin_count_90d,
        max(s.played_at) AS latest_spin_at
      FROM sampled_spins s
      LEFT JOIN recordings r ON r.mbid = s.mbid
      WHERE ${matchPredicate}
      GROUP BY s.station_id, s.slug, s.name, s.station_class
    )
    SELECT
      sample_stats.sampled_spin_count AS "sampledSpinCount",
      sample_stats.sampled_through AS "sampledThrough",
      station_matches.slug,
      station_matches.name,
      station_matches.station_class AS "stationClass",
      station_matches.spin_count_30d AS "spinCount30d",
      station_matches.spin_count_90d AS "spinCount90d",
      station_matches.latest_spin_at AS "latestSpinAt"
    FROM sample_stats
    LEFT JOIN station_matches ON true
    ORDER BY
      station_matches.spin_count_30d DESC NULLS LAST,
      station_matches.spin_count_90d DESC NULLS LAST,
      station_matches.latest_spin_at DESC NULLS LAST,
      station_matches.slug ASC NULLS LAST
    LIMIT ${limit}
  `);

  const rows = result.rows;
  const sampleCount = rows[0]?.sampledSpinCount ?? 0;
  const sampledThrough = rows[0]?.sampledThrough;
  const asIso = (date: Date | string | null): string | null => {
    if (date == null) return null;
    return (date instanceof Date ? date : new Date(date)).toISOString();
  };
  const recommendations = rows.flatMap((row) => {
    if (
      row.slug == null ||
      row.name == null ||
      row.stationClass == null ||
      row.spinCount30d == null ||
      row.spinCount90d == null ||
      row.latestSpinAt == null
    ) {
      return [];
    }
    return [{
      station: {
        slug: row.slug,
        name: row.name,
        stationClass: row.stationClass,
      },
      matchKind: kind,
      evidence: {
        spinCount30d: row.spinCount30d,
        spinCount90d: row.spinCount90d,
        latestSpinAt: asIso(row.latestSpinAt)!,
      },
    }];
  });

  res.json(GetLoreStationRecommendationsResponse.parse({
    kind,
    query,
    sample: {
      windowDays: 90,
      spinCap: SPIN_SAMPLE_CAP,
      sampledSpinCount: sampleCount,
      capReached: sampleCount === SPIN_SAMPLE_CAP,
      sampledThrough: asIso(sampledThrough ?? null),
    },
    recommendations,
  }));
}));

export default router;