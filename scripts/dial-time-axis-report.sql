-- =============================================================================
-- Dial Time-Axis Gate Report
-- Three read-only investigations gating the dial time-axis design.
-- Run with: psql "$DATABASE_URL" -f scripts/dial-time-axis-report.sql
-- =============================================================================

\echo ''
\echo '====================================================================='
\echo 'Q1: ATTENDANCE spin_duration_seconds coverage'
\echo '====================================================================='

-- Q1a: Overall attendance coverage — all time
\echo ''
\echo '--- Q1a: Overall attendance coverage (ALL TIME) ---'
SELECT
  COUNT(*)                                                        AS total_attendance_rows,
  COUNT(a.spin_duration_seconds)                                  AS rows_with_duration,
  ROUND(100.0 * COUNT(a.spin_duration_seconds) / NULLIF(COUNT(*), 0), 1) AS pct_with_duration,
  COUNT(*) FILTER (WHERE s.mbid IS NOT NULL)                     AS mbid_resolved_rows,
  COUNT(a.spin_duration_seconds) FILTER (WHERE s.mbid IS NOT NULL) AS mbid_rows_with_duration,
  ROUND(100.0 * COUNT(a.spin_duration_seconds) FILTER (WHERE s.mbid IS NOT NULL)
        / NULLIF(COUNT(*) FILTER (WHERE s.mbid IS NOT NULL), 0), 1) AS mbid_pct_with_duration
FROM attendance a
JOIN spins s ON s.id = a.spin_id;

-- Q1b: Overall attendance coverage — last 30 days
\echo ''
\echo '--- Q1b: Overall attendance coverage (LAST 30 DAYS) ---'
SELECT
  COUNT(*)                                                        AS total_attendance_rows,
  COUNT(a.spin_duration_seconds)                                  AS rows_with_duration,
  ROUND(100.0 * COUNT(a.spin_duration_seconds) / NULLIF(COUNT(*), 0), 1) AS pct_with_duration,
  COUNT(*) FILTER (WHERE s.mbid IS NOT NULL)                     AS mbid_resolved_rows,
  COUNT(a.spin_duration_seconds) FILTER (WHERE s.mbid IS NOT NULL) AS mbid_rows_with_duration,
  ROUND(100.0 * COUNT(a.spin_duration_seconds) FILTER (WHERE s.mbid IS NOT NULL)
        / NULLIF(COUNT(*) FILTER (WHERE s.mbid IS NOT NULL), 0), 1) AS mbid_pct_with_duration
FROM attendance a
JOIN spins s ON s.id = a.spin_id
WHERE s.played_at >= NOW() - INTERVAL '30 days';

-- Q1c: Derivable duration via spins → recordings — all time
\echo ''
\echo '--- Q1c: Derivable duration via spins→recordings (ALL TIME) ---'
SELECT
  COUNT(*)                                                         AS total_spins,
  COUNT(r.duration_ms)                                             AS spins_with_duration_ms,
  ROUND(100.0 * COUNT(r.duration_ms) / NULLIF(COUNT(*), 0), 1)   AS pct_with_duration,
  COUNT(*) FILTER (WHERE s.mbid IS NOT NULL)                      AS mbid_spins,
  COUNT(r.duration_ms) FILTER (WHERE s.mbid IS NOT NULL)          AS mbid_spins_with_duration,
  ROUND(100.0 * COUNT(r.duration_ms) FILTER (WHERE s.mbid IS NOT NULL)
        / NULLIF(COUNT(*) FILTER (WHERE s.mbid IS NOT NULL), 0), 1) AS mbid_pct_with_duration
FROM spins s
LEFT JOIN recordings r ON r.mbid = s.mbid;

-- Q1d: Derivable duration via spins → recordings — last 30 days
\echo ''
\echo '--- Q1d: Derivable duration via spins→recordings (LAST 30 DAYS) ---'
SELECT
  COUNT(*)                                                         AS total_spins,
  COUNT(r.duration_ms)                                             AS spins_with_duration_ms,
  ROUND(100.0 * COUNT(r.duration_ms) / NULLIF(COUNT(*), 0), 1)   AS pct_with_duration,
  COUNT(*) FILTER (WHERE s.mbid IS NOT NULL)                      AS mbid_spins,
  COUNT(r.duration_ms) FILTER (WHERE s.mbid IS NOT NULL)          AS mbid_spins_with_duration,
  ROUND(100.0 * COUNT(r.duration_ms) FILTER (WHERE s.mbid IS NOT NULL)
        / NULLIF(COUNT(*) FILTER (WHERE s.mbid IS NOT NULL), 0), 1) AS mbid_pct_with_duration
FROM spins s
LEFT JOIN recordings r ON r.mbid = s.mbid
WHERE s.played_at >= NOW() - INTERVAL '30 days';

-- Q1e: Per-station top-20 breakdown
\echo ''
\echo '--- Q1e: Per-station duration coverage (TOP 20 by spin count, ALL TIME) ---'
SELECT
  st.name                                                               AS station,
  COUNT(s.id)                                                           AS spin_count,
  ROUND(100.0 * COUNT(r.duration_ms) / NULLIF(COUNT(s.id), 0), 1)     AS pct_with_duration,
  COUNT(s.id) FILTER (WHERE s.mbid IS NOT NULL)                        AS mbid_spins,
  ROUND(100.0 * COUNT(r.duration_ms) FILTER (WHERE s.mbid IS NOT NULL)
        / NULLIF(COUNT(s.id) FILTER (WHERE s.mbid IS NOT NULL), 0), 1) AS mbid_pct_with_duration
FROM spins s
JOIN stations st ON st.id = s.station_id
LEFT JOIN recordings r ON r.mbid = s.mbid
GROUP BY st.id, st.name
ORDER BY COUNT(s.id) DESC
LIMIT 20;

\echo ''
\echo '====================================================================='
\echo 'Q2: CROSSING MOMENTS for sample user (most library items)'
\echo '====================================================================='

-- Q2a: Identify sample user
\echo ''
\echo '--- Q2a: Sample user identification ---'
SELECT
  u.id                        AS user_id,
  COUNT(li.id)                AS library_item_count
FROM lore_users u
JOIN library_items li ON li.user_id = u.id
GROUP BY u.id
ORDER BY COUNT(li.id) DESC
LIMIT 1;

-- Q2b: Crossing moments (24h / 7d / 30d)
\echo ''
\echo '--- Q2b: Crossing moments by window ---'
WITH sample_user AS (
  SELECT u.id
  FROM lore_users u
  JOIN library_items li ON li.user_id = u.id
  GROUP BY u.id
  ORDER BY COUNT(li.id) DESC
  LIMIT 1
),
crossings AS (
  SELECT s.played_at
  FROM spins s
  JOIN library_items li
    ON li.mbid = s.mbid
    AND li.user_id = (SELECT id FROM sample_user)
)
SELECT
  COUNT(*) FILTER (WHERE played_at >= NOW() - INTERVAL '24 hours')  AS crossings_24h,
  COUNT(*) FILTER (WHERE played_at >= NOW() - INTERVAL '7 days')    AS crossings_7d,
  COUNT(*) FILTER (WHERE played_at >= NOW() - INTERVAL '30 days')   AS crossings_30d,
  COUNT(*)                                                           AS crossings_all_time
FROM crossings;

-- Q2c: Median gap between consecutive crossings
\echo ''
\echo '--- Q2c: Median gap between consecutive crossings (seconds) ---'
WITH sample_user AS (
  SELECT u.id
  FROM lore_users u
  JOIN library_items li ON li.user_id = u.id
  GROUP BY u.id
  ORDER BY COUNT(li.id) DESC
  LIMIT 1
),
crossings AS (
  SELECT s.played_at
  FROM spins s
  JOIN library_items li
    ON li.mbid = s.mbid
    AND li.user_id = (SELECT id FROM sample_user)
  ORDER BY s.played_at
),
gaps AS (
  SELECT
    played_at,
    LAG(played_at) OVER (ORDER BY played_at) AS prev_at,
    EXTRACT(EPOCH FROM (played_at - LAG(played_at) OVER (ORDER BY played_at))) AS gap_seconds
  FROM crossings
)
SELECT
  COUNT(gap_seconds)                                                                         AS gap_count,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_seconds)::numeric)                 AS median_gap_seconds,
  ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_seconds) / 3600.0)::numeric, 2)   AS median_gap_hours,
  ROUND(MIN(gap_seconds)::numeric)                                                          AS min_gap_seconds,
  ROUND(MAX(gap_seconds)::numeric)                                                          AS max_gap_seconds
FROM gaps
WHERE gap_seconds IS NOT NULL;

-- Q2d: Distinct run count
\echo ''
\echo '--- Q2d: Distinct run count ---'
WITH sample_user AS (
  SELECT u.id
  FROM lore_users u
  JOIN library_items li ON li.user_id = u.id
  GROUP BY u.id
  ORDER BY COUNT(li.id) DESC
  LIMIT 1
),
crossings AS (
  SELECT s.played_at, s.show_id, s.station_id
  FROM spins s
  JOIN library_items li
    ON li.mbid = s.mbid
    AND li.user_id = (SELECT id FROM sample_user)
)
SELECT
  COUNT(DISTINCT show_id) FILTER (WHERE show_id IS NOT NULL)       AS distinct_show_runs,
  COUNT(DISTINCT (station_id, DATE_TRUNC('day', played_at)))       AS station_day_buckets
FROM crossings;

\echo ''
\echo '====================================================================='
\echo 'Q3: REPLAY JOB LATENCY (resolution + materialization)'
\echo '====================================================================='

-- Q3a: replay_resolution_jobs — status distribution
\echo ''
\echo '--- Q3a: replay_resolution_jobs status distribution ---'
SELECT
  status,
  COUNT(*) AS job_count
FROM replay_resolution_jobs
GROUP BY status
ORDER BY job_count DESC;

-- Q3b: replay_resolution_jobs — p50/p90 latency (all done rows)
\echo ''
\echo '--- Q3b: replay_resolution_jobs p50/p90 wall-clock seconds (ALL done rows) ---'
SELECT
  COUNT(*)                                                                   AS done_jobs,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))
  ))                                                                         AS p50_seconds,
  ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))
  ))                                                                         AS p90_seconds
FROM replay_resolution_jobs
WHERE status IN ('done', 'done_with_errors')
  AND finished_at IS NOT NULL;

-- Q3c: replay_resolution_jobs — p50/p90 for ~15-track runs (total BETWEEN 10 AND 20)
\echo ''
\echo '--- Q3c: replay_resolution_jobs p50/p90 (total BETWEEN 10 AND 20) ---'
SELECT
  COUNT(*)                                                                   AS done_jobs,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))
  ))                                                                         AS p50_seconds,
  ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))
  ))                                                                         AS p90_seconds
FROM replay_resolution_jobs
WHERE status IN ('done', 'done_with_errors')
  AND finished_at IS NOT NULL
  AND total BETWEEN 10 AND 20;

-- Q3d: replay_materialization_jobs — status distribution
\echo ''
\echo '--- Q3d: replay_materialization_jobs status distribution ---'
SELECT
  status,
  COUNT(*) AS job_count
FROM replay_materialization_jobs
GROUP BY status
ORDER BY job_count DESC;

-- Q3e: replay_materialization_jobs — p50/p90 by service (all done rows)
\echo ''
\echo '--- Q3e: replay_materialization_jobs p50/p90 by service (ALL done rows) ---'
SELECT
  service,
  COUNT(*)                                                                   AS done_jobs,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))
  ))                                                                         AS p50_seconds,
  ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))
  ))                                                                         AS p90_seconds
FROM replay_materialization_jobs
WHERE status IN ('done', 'done_with_errors')
  AND finished_at IS NOT NULL
GROUP BY service
ORDER BY done_jobs DESC;

-- Q3f: replay_materialization_jobs — p50/p90 by service (total BETWEEN 10 AND 20)
\echo ''
\echo '--- Q3f: replay_materialization_jobs p50/p90 by service (total BETWEEN 10 AND 20) ---'
SELECT
  service,
  COUNT(*)                                                                   AS done_jobs,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))
  ))                                                                         AS p50_seconds,
  ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at))
  ))                                                                         AS p90_seconds
FROM replay_materialization_jobs
WHERE status IN ('done', 'done_with_errors')
  AND finished_at IS NOT NULL
  AND total BETWEEN 10 AND 20
GROUP BY service
ORDER BY done_jobs DESC;

\echo ''
\echo '====================================================================='
\echo 'END OF DIAL TIME-AXIS GATE REPORT'
\echo '====================================================================='
